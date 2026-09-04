"""MetisConfig — per-episode knobs for the official ALE Metis deployer.

Secrets are never stored here as defaults. Host-side paths (auth JSON) are
read once in ``__post_init__`` and embedded as content so the in-sandbox
deployer can write them without reaching back to the Colab host FS.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar

logger = logging.getLogger(__name__)

_DEFAULT_GIT_URL = "https://github.com/Wholiver/metis.git"
_DEFAULT_PROVIDER = "openai-codex"
_DEFAULT_MODEL = "gpt-5.6-luna"
_DEFAULT_THINKING = "low"


@dataclass
class MetisConfig:
	"""Tunables for :class:`MetisDeployer`.

	Standalone config (ALE convention: no shared base class). Episode wall
	budget is orchestration-owned and is not an agent knob.
	"""

	name: ClassVar[str] = "metis"

	# Fixed eval identity (override only for diagnostics).
	provider: str = _DEFAULT_PROVIDER
	model: str = _DEFAULT_MODEL
	thinking: str = _DEFAULT_THINKING
	collaboration_mode: str = "build"

	# How Metis is obtained inside the sandbox.
	# - git: shallow-clone ``metis_git_url`` @ ``metis_git_ref``, then npm build
	# - path: use an already-present absolute install under ``metis_install_dir``
	install_mode: str = "git"
	metis_git_url: str = _DEFAULT_GIT_URL
	metis_git_ref: str = "main"
	metis_install_dir: str = ""
	"""Absolute sandbox path to an existing Metis checkout (install_mode=path)."""

	npm_install_timeout_s: int = 1800
	build_timeout_s: int = 1800
	clone_timeout_s: int = 600

	# Host path to Metis auth.json (OAuth / API). Resolved host-side into
	# ``auth_json_content`` so the sandbox deployer never sees the host path.
	auth_json_path: str = ""
	auth_json_content: str = ""
	"""Auto-populated from ``auth_json_path``. Do not set by hand in YAML."""

	# Extension + CUA bridge
	extension_relpath: str = "adapters/ale_official/extension/cua_tools.ts"
	enable_cua_tools: bool = True

	# Extra CLI flags appended after the fixed argv (advanced / diagnostics).
	extra_args: list[str] = field(default_factory=list)

	# Session + hot artifacts
	session_subdir: str = "sessions"
	keep_json_stdout: bool = True

	def __post_init__(self) -> None:
		if self.auth_json_path and not self.auth_json_content:
			try:
				raw = Path(self.auth_json_path).read_text(encoding="utf-8")
			except OSError as exc:
				raise RuntimeError(
					f"metis: auth_json_path {self.auth_json_path!r} could not be read: {exc}"
				) from exc
			# Validate JSON without logging contents.
			import json

			try:
				parsed = json.loads(raw)
			except json.JSONDecodeError as exc:
				raise RuntimeError(f"metis: auth_json_path is not valid JSON: {exc}") from exc
			if not isinstance(parsed, dict):
				raise RuntimeError("metis: auth_json_path must contain a JSON object")
			self.auth_json_content = raw
			logger.info("metis: embedded auth.json content (%d bytes) for sandbox install", len(raw))
