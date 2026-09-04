"""MetisDeployer — official ALE in-sandbox deployer for the Metis CLI.

Shape mirrors ``ale_run.agents.codex.deployer.CodexDeployer``:
install Metis inside the sandbox, ensure the cua MCP bridge, launch the
CLI headlessly, and convert native session JSONL → ALE-v1.0 trajectory.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, ClassVar

from ale_run.base_interface import (
	AgentRunResult,
	BaseAgentDeployer,
	ContentPart,
	ImageSource,
	Observation,
	StepMetrics,
	ToolCall,
	ToolResult,
	TrajectoryBuilder,
)

from .config import MetisConfig
from .trajectory_convert import convert_metis_session_to_steps, find_session_jsonl

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 2.0
_TERM_GRACE_S = 2.0


class MetisDeployer(BaseAgentDeployer):
	"""Stdlib-oriented deployer for the Metis coding-agent CLI."""

	default_executor: ClassVar[str] = "sandbox"
	supported_executors: ClassVar[frozenset[str]] = frozenset({"sandbox"})
	hot_artifacts: ClassVar[tuple[str, ...]] = (
		"transcript.jsonl",
		"stderr.log",
		"metis.pid",
	)

	@property
	def version(self) -> str | None:
		cfg: MetisConfig = self.config  # type: ignore[assignment]
		return getattr(cfg, "metis_git_ref", None) or "unknown"

	# =========================================================================
	# install
	# =========================================================================

	async def install(self) -> None:
		cfg: MetisConfig = self.config  # type: ignore[assignment]
		sandbox = self.executor.sandbox
		self._is_linux = bool(sandbox.is_linux)

		from ale_run.agents._bootstrap import cua_bridge_env, ensure_cua_mcp_server, ensure_node_npm

		await ensure_node_npm()
		self._metis_root = await self._ensure_metis_install(cfg)
		self._metis_cli = self._resolve_metis_cli(self._metis_root)
		await self._probe_metis(self._metis_cli)

		wd = Path(self.executor.work_dir)
		wd.mkdir(parents=True, exist_ok=True)

		await ensure_cua_mcp_server(sandbox)
		self._cua_env = cua_bridge_env(self.executor)
		self._mcp_entry = self._join(
			sandbox.mcp_server_dir,
			"src",
			"index.js",
			is_linux=self._is_linux,
		)
		self._node_bin = sandbox.node

		# Stage extension path (from the installed Metis tree).
		ext = self._join(self._metis_root, cfg.extension_relpath, is_linux=True)
		if not Path(ext).is_file():
			raise RuntimeError(f"metis: CUA extension missing at {ext}")
		self._extension_path = ext

		await self._write_auth(cfg)
		await self._write_runtime_settings(cfg)

		mcp_meta = {
			"node": self._node_bin,
			"entry": self._mcp_entry,
			"env": self._cua_env,
		}
		(wd / "cua_mcp_meta.json").write_text(json.dumps(mcp_meta, indent=2), encoding="utf-8")
		logger.info("metis: install ready root=%s cli=%s", self._metis_root, self._metis_cli)

	async def _ensure_metis_install(self, cfg: MetisConfig) -> str:
		if cfg.install_mode == "path":
			root = cfg.metis_install_dir.strip()
			if not root or not Path(root).is_dir():
				raise RuntimeError(
					"metis: install_mode=path requires metis_install_dir to an existing checkout"
				)
			cli = self._resolve_metis_cli(root)
			if not Path(cli).exists():
				await self._npm_build(root, cfg)
			return root

		if cfg.install_mode != "git":
			raise RuntimeError(f"metis: unknown install_mode {cfg.install_mode!r}")

		home = os.path.expanduser("~")
		root = os.path.join(home, ".metis-ale", "src")
		marker = os.path.join(root, ".ale_metis_ref")
		need_clone = True
		if Path(root, "package.json").is_file() and Path(marker).is_file():
			try:
				if Path(marker).read_text(encoding="utf-8").strip() == cfg.metis_git_ref:
					need_clone = False
			except OSError:
				need_clone = True

		if need_clone:
			parent = os.path.dirname(root)
			os.makedirs(parent, exist_ok=True)
			if Path(root).exists():
				shutil.rmtree(root)
			logger.info(
				"metis: cloning %s @ %s → %s",
				cfg.metis_git_url,
				cfg.metis_git_ref,
				root,
			)
			proc = await asyncio.to_thread(
				subprocess.run,
				[
					"git",
					"clone",
					"--depth",
					"1",
					"--branch",
					cfg.metis_git_ref,
					cfg.metis_git_url,
					root,
				],
				capture_output=True,
				text=True,
				timeout=cfg.clone_timeout_s,
			)
			if proc.returncode != 0:
				raise RuntimeError(
					"metis: git clone failed "
					f"(rc={proc.returncode}): {(proc.stderr or proc.stdout or '')[-800:]}"
				)
			Path(marker).write_text(cfg.metis_git_ref, encoding="utf-8")

		await self._npm_build(root, cfg)
		return root

	async def _npm_build(self, root: str, cfg: MetisConfig) -> None:
		npm = shutil.which("npm")
		if not npm:
			raise RuntimeError("metis: npm not found after ensure_node_npm()")
		logger.info("metis: npm ci / install in %s", root)
		# Prefer ci when lockfile exists; fall back to install.
		lock = Path(root, "package-lock.json")
		shrink = Path(root, "npm-shrinkwrap.json")
		install_cmd = [npm, "ci"] if (lock.is_file() or shrink.is_file()) else [npm, "install"]
		proc = await asyncio.to_thread(
			subprocess.run,
			install_cmd,
			cwd=root,
			capture_output=True,
			text=True,
			timeout=cfg.npm_install_timeout_s,
		)
		if proc.returncode != 0:
			# One retry with npm install for vendor/file: deps edge cases.
			proc = await asyncio.to_thread(
				subprocess.run,
				[npm, "install"],
				cwd=root,
				capture_output=True,
				text=True,
				timeout=cfg.npm_install_timeout_s,
			)
			if proc.returncode != 0:
				raise RuntimeError(
					"metis: npm install failed "
					f"(rc={proc.returncode}): {(proc.stderr or proc.stdout or '')[-800:]}"
				)
		logger.info("metis: npm run build in %s", root)
		proc = await asyncio.to_thread(
			subprocess.run,
			[npm, "run", "build"],
			cwd=root,
			capture_output=True,
			text=True,
			timeout=cfg.build_timeout_s,
		)
		if proc.returncode != 0:
			raise RuntimeError(
				"metis: npm run build failed "
				f"(rc={proc.returncode}): {(proc.stderr or proc.stdout or '')[-800:]}"
			)

	@staticmethod
	def _resolve_metis_cli(root: str) -> str:
		cli = os.path.join(root, "dist", "cli.js")
		return cli

	async def _probe_metis(self, cli: str) -> None:
		node = shutil.which("node") or "node"
		if not Path(cli).is_file():
			raise RuntimeError(f"metis: CLI missing at {cli}")
		proc = await asyncio.to_thread(
			subprocess.run,
			[node, cli, "--help"],
			capture_output=True,
			text=True,
			timeout=60,
			stdin=subprocess.DEVNULL,
		)
		if proc.returncode not in (0, 1, 2):
			# help may exit non-zero on some builds; only fail hard if binary broken.
			err = (proc.stderr or proc.stdout or "")[:400]
			if "Cannot find module" in err or "ERR_" in err:
				raise RuntimeError(f"metis: CLI probe failed: {err}")
		logger.info("metis: CLI probe ok (%s)", cli)

	async def _write_auth(self, cfg: MetisConfig) -> None:
		if not cfg.auth_json_content:
			logger.warning(
				"metis: no auth_json_content — relying on pre-existing ~/.metis/agent/auth.json"
			)
			return
		agent_dir = Path(os.path.expanduser("~")) / ".metis" / "agent"
		agent_dir.mkdir(parents=True, exist_ok=True)
		auth_path = agent_dir / "auth.json"
		auth_path.write_text(cfg.auth_json_content, encoding="utf-8")
		try:
			os.chmod(auth_path, 0o600)
		except OSError:
			pass
		logger.info("metis: wrote auth.json (%d bytes)", len(cfg.auth_json_content))

	async def _write_runtime_settings(self, cfg: MetisConfig) -> None:
		"""Ensure headless trust defaults so print mode never blocks on prompts."""
		agent_dir = Path(os.path.expanduser("~")) / ".metis" / "agent"
		agent_dir.mkdir(parents=True, exist_ok=True)
		settings_path = agent_dir / "settings.json"
		settings: dict[str, Any] = {}
		if settings_path.is_file():
			try:
				settings = json.loads(settings_path.read_text(encoding="utf-8"))
				if not isinstance(settings, dict):
					settings = {}
			except json.JSONDecodeError:
				settings = {}
		settings.setdefault("defaultProjectTrust", "always")
		settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")

	# =========================================================================
	# launch
	# =========================================================================

	async def launch(self, prompt: str) -> AgentRunResult:
		cfg: MetisConfig = self.config  # type: ignore[assignment]
		wd = Path(self.executor.work_dir)
		wd.mkdir(parents=True, exist_ok=True)

		prompt_file = wd / "prompt.txt"
		transcript_file = wd / "transcript.jsonl"
		stderr_log = wd / "stderr.log"
		pid_file = wd / "metis.pid"
		session_dir = wd / cfg.session_subdir
		session_dir.mkdir(parents=True, exist_ok=True)

		for f in (transcript_file, stderr_log, pid_file):
			if f.exists():
				try:
					f.unlink()
				except OSError:
					pass

		prompt_file.write_text(prompt, encoding="utf-8")

		# Metis prefers a git worktree for some tools; init if missing.
		if not (wd / ".git").exists():
			await asyncio.to_thread(
				subprocess.run,
				["git", "init"],
				capture_output=True,
				cwd=str(wd),
				timeout=15,
			)

		argv = self._build_argv(cfg, session_dir=str(session_dir))
		env = self._build_env(cfg)

		t0 = time.monotonic()
		with open(prompt_file, "rb") as pin, open(transcript_file, "wb") as tout, open(
			stderr_log, "wb"
		) as terr:
			proc = await asyncio.to_thread(
				subprocess.Popen,
				argv,
				stdin=pin,
				stdout=tout,
				stderr=terr,
				env=env,
				cwd=str(wd),
				start_new_session=True if hasattr(os, "setsid") else False,
			)
		pid_file.write_text(str(proc.pid), encoding="ascii")
		logger.info("metis: spawned pid=%s", proc.pid)

		try:
			while proc.poll() is None:
				await asyncio.sleep(_POLL_INTERVAL_S)
		except asyncio.CancelledError:
			self._terminate_proc_group(proc, force=False)
			try:
				await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=_TERM_GRACE_S)
			except (asyncio.TimeoutError, asyncio.CancelledError):
				self._terminate_proc_group(proc, force=True)
			raise

		duration_s = time.monotonic() - t0
		exit_code = proc.returncode
		status = "completed" if exit_code == 0 else "failed"
		error: str | None = None
		if status == "failed":
			error = self._diagnose_failure(stderr_log, transcript_file, exit_code)

		# Copy newest session JSONL next to hot artifacts for gather reliability.
		session = find_session_jsonl(wd, cfg.session_subdir)
		if session and session.exists():
			try:
				shutil.copy2(session, wd / "session.jsonl")
			except OSError as exc:
				logger.warning("metis: could not copy session.jsonl: %s", exc)

		return AgentRunResult(
			status=status,
			pid=proc.pid,
			exit_code=exit_code,
			transcript_path=str(transcript_file),
			stderr_path=str(stderr_log),
			duration_s=duration_s,
			error=error,
		)

	def _build_argv(self, cfg: MetisConfig, *, session_dir: str) -> list[str]:
		node = shutil.which("node") or self._node_bin or "node"
		argv = [
			node,
			self._metis_cli,
			"--print",
			"--mode",
			"json",
			"--collaboration-mode",
			cfg.collaboration_mode,
			"--provider",
			cfg.provider,
			"--model",
			cfg.model,
			"--thinking",
			cfg.thinking,
			"--session-dir",
			session_dir,
			"--approve",
		]
		if cfg.enable_cua_tools:
			argv.extend(["--extension", self._extension_path])
		argv.extend(cfg.extra_args)
		# Prompt comes from stdin (prompt.txt wired by launch).
		return argv

	def _build_env(self, cfg: MetisConfig) -> dict[str, str]:
		env = os.environ.copy()
		for k, v in (self.executor.env or {}).items():
			env[k] = v

		# Point the CUA extension at the official bridge.
		cua_url = (self._cua_env or {}).get("CUA_SERVER_URL") or env.get("CUA_SERVER_URL")
		if cua_url:
			env["CUA_SERVER_URL"] = cua_url
		env["ALE_CUA_MCP_NODE"] = self._node_bin or (shutil.which("node") or "node")
		env["ALE_CUA_MCP_ENTRY"] = self._mcp_entry
		env["NO_COLOR"] = "1"
		env["METIS_OFFLINE"] = env.get("METIS_OFFLINE", "0")
		# Avoid accidental interactive prompts.
		env["CI"] = "1"
		return env

	@staticmethod
	def _terminate_proc_group(proc: subprocess.Popen, *, force: bool) -> None:
		try:
			if hasattr(os, "killpg") and hasattr(os, "getpgid"):
				import signal

				os.killpg(
					os.getpgid(proc.pid),
					signal.SIGKILL if force else signal.SIGTERM,
				)
			elif force:
				proc.kill()
			else:
				proc.terminate()
		except (ProcessLookupError, OSError):
			pass

	@staticmethod
	def _diagnose_failure(stderr_log: Path, transcript: Path, exit_code: int | None) -> str:
		bits: list[str] = [f"exit_code={exit_code}"]
		for label, path in (("stderr", stderr_log), ("transcript", transcript)):
			if not path.exists():
				bits.append(f"{label}=missing")
				continue
			try:
				tail = path.read_text(encoding="utf-8", errors="replace")[-600:]
			except OSError:
				bits.append(f"{label}=unreadable")
				continue
			bits.append(f"{label}_tail={tail!r}")
		return "metis failed: " + " | ".join(bits)

	@staticmethod
	def _join(*parts: str, is_linux: bool) -> str:
		sep = "/" if is_linux else "\\"
		head = parts[0].rstrip("/\\")
		tail = sep.join(p.strip("/\\") for p in parts[1:])
		return f"{head}{sep}{tail}" if tail else head

	# =========================================================================
	# parse_artifacts
	# =========================================================================

	@classmethod
	def parse_artifacts(
		cls,
		*,
		work_dir: Path,
		config: MetisConfig,
		run_result: AgentRunResult,
		builder: TrajectoryBuilder,
	) -> None:
		session = work_dir / "session.jsonl"
		if not session.exists():
			found = find_session_jsonl(work_dir, getattr(config, "session_subdir", "sessions"))
			if found:
				session = found

		if not session.exists():
			builder.add_step(
				source="system",
				message=f"metis: no session JSONL under {work_dir}",
				extra={"reason": "no_session"},
			)
			cls._attach_extra(builder, work_dir, run_result)
			return

		step_dicts = convert_metis_session_to_steps(session, skip_first_user=True)
		if not step_dicts:
			builder.add_step(
				source="system",
				message="metis: session JSONL contained no convertible messages",
				extra={"session_path": str(session)},
			)

		for raw in step_dicts:
			cls._emit_step(builder, raw)

		cls._attach_extra(builder, work_dir, run_result, session_path=str(session))

	@classmethod
	def _emit_step(cls, builder: TrajectoryBuilder, raw: dict[str, Any]) -> None:
		source = raw.get("source", "system")
		kwargs: dict[str, Any] = {"extra": dict(raw.get("extra") or {})}

		message = raw.get("message")
		if message is not None:
			kwargs["message"] = cls._coerce_message(message)

		if raw.get("reasoning"):
			kwargs["reasoning"] = raw["reasoning"]

		if raw.get("tool_calls"):
			kwargs["tool_calls"] = [
				ToolCall(
					id=tc.get("id") or "",
					name=tc.get("name") or "",
					arguments=tc.get("arguments") if isinstance(tc.get("arguments"), dict) else {},
				)
				for tc in raw["tool_calls"]
				if isinstance(tc, dict)
			]

		if raw.get("observation"):
			kwargs["observation"] = cls._coerce_observation(raw["observation"])

		if raw.get("metrics"):
			m = raw["metrics"]
			if isinstance(m, dict):
				kwargs["metrics"] = StepMetrics(
					input_tokens=m.get("input_tokens"),
					output_tokens=m.get("output_tokens"),
					cache_read_tokens=m.get("cache_read_tokens"),
					cache_creation_tokens=m.get("cache_creation_tokens"),
					cost_usd=m.get("cost_usd"),
					duration_ms=m.get("duration_ms"),
				)

		builder.add_step(source=source, **kwargs)

	@classmethod
	def _coerce_message(cls, message: Any) -> str | list[ContentPart]:
		if isinstance(message, str):
			return message
		if isinstance(message, list):
			parts: list[ContentPart] = []
			for item in message:
				if not isinstance(item, dict):
					continue
				if item.get("type") == "text":
					parts.append(ContentPart(type="text", text=item.get("text") or ""))
				elif item.get("type") == "image":
					img = item.get("image") if isinstance(item.get("image"), dict) else {}
					parts.append(
						ContentPart(
							type="image",
							image=ImageSource(
								type="base64",
								data=img.get("data"),
								media_type=img.get("media_type") or "image/png",
							),
						)
					)
			return parts
		return str(message)

	@classmethod
	def _coerce_observation(cls, observation: Any) -> Observation:
		if not isinstance(observation, dict):
			return Observation()
		results: list[ToolResult] = []
		for item in observation.get("results") or []:
			if not isinstance(item, dict):
				continue
			content_parts: list[ContentPart] = []
			for part in item.get("content") or []:
				if not isinstance(part, dict):
					continue
				if part.get("type") == "text":
					content_parts.append(ContentPart(type="text", text=part.get("text") or ""))
				elif part.get("type") == "image":
					img = part.get("image") if isinstance(part.get("image"), dict) else {}
					content_parts.append(
						ContentPart(
							type="image",
							image=ImageSource(
								type="base64",
								data=img.get("data"),
								media_type=img.get("media_type") or "image/png",
							),
						)
					)
			results.append(
				ToolResult(
					tool_call_id=str(item.get("tool_call_id") or ""),
					content=content_parts,
					is_error=bool(item.get("is_error")),
				)
			)
		return Observation(results=results, error=observation.get("error"))

	@staticmethod
	def _attach_extra(
		builder: TrajectoryBuilder,
		work_dir: Path,
		run_result: AgentRunResult,
		session_path: str | None = None,
	) -> None:
		builder.trajectory.extra.setdefault("metis", {}).update(
			{
				"exit_code": run_result.exit_code,
				"transcript_path": str(work_dir / "transcript.jsonl"),
				"stderr_path": str(work_dir / "stderr.log"),
				"session_path": session_path,
			}
		)
