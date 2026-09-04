"""Convert Metis native session JSONL into ALE-v1.0 step payloads.

Pure stdlib + JSON. Does not import ``ale_run`` so unit tests can run without
Docker or the ALE checkout. The deployer maps these payloads onto
``TrajectoryBuilder`` when running under official ``ale_run``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable


def _as_text_parts(content: Any) -> tuple[str | None, list[dict[str, Any]]]:
	"""Return (plain_text_or_None, structured content parts)."""
	if content is None:
		return None, []
	if isinstance(content, str):
		return content, [{"type": "text", "text": content}]
	if not isinstance(content, list):
		text = str(content)
		return text, [{"type": "text", "text": text}]

	texts: list[str] = []
	parts: list[dict[str, Any]] = []
	for block in content:
		if not isinstance(block, dict):
			continue
		btype = block.get("type")
		if btype == "text":
			t = block.get("text") or ""
			texts.append(t)
			parts.append({"type": "text", "text": t})
		elif btype == "image":
			parts.append(
				{
					"type": "image",
					"image": {
						"type": "base64",
						"data": block.get("data"),
						"media_type": block.get("mimeType") or "image/png",
					},
				}
			)
		elif btype == "thinking":
			# Reasoning is handled separately by callers; skip from message body.
			continue
	plain = "\n".join(t for t in texts if t).strip() or None
	return plain, parts


def _thinking_text(content: Any) -> str | None:
	if not isinstance(content, list):
		return None
	chunks: list[str] = []
	for block in content:
		if isinstance(block, dict) and block.get("type") == "thinking":
			t = block.get("thinking")
			if t:
				chunks.append(str(t))
	return "\n".join(chunks) if chunks else None


def _tool_calls(content: Any) -> list[dict[str, Any]]:
	out: list[dict[str, Any]] = []
	if not isinstance(content, list):
		return out
	for block in content:
		if not isinstance(block, dict) or block.get("type") != "toolCall":
			continue
		out.append(
			{
				"id": str(block.get("id") or ""),
				"name": str(block.get("name") or ""),
				"arguments": block.get("arguments")
				if isinstance(block.get("arguments"), dict)
				else {},
			}
		)
	return out


def _usage_metrics(usage: Any) -> dict[str, Any] | None:
	if not isinstance(usage, dict):
		return None
	cost = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
	return {
		"input_tokens": usage.get("input"),
		"output_tokens": usage.get("output"),
		"cache_read_tokens": usage.get("cacheRead"),
		"cache_creation_tokens": usage.get("cacheWrite"),
		"cost_usd": cost.get("total"),
	}


def iter_session_entries(path: Path) -> Iterable[dict[str, Any]]:
	"""Yield parsed JSON objects from a Metis session JSONL file."""
	raw = path.read_text(encoding="utf-8", errors="replace")
	if raw.startswith("\ufeff"):
		raw = raw[1:]
	for line in raw.splitlines():
		line = line.strip()
		if not line:
			continue
		try:
			obj = json.loads(line)
		except json.JSONDecodeError:
			yield {"type": "_parse_error", "raw": line}
			continue
		if isinstance(obj, dict):
			yield obj


def find_session_jsonl(work_dir: Path, session_subdir: str = "sessions") -> Path | None:
	"""Locate the newest Metis session JSONL under ``work_dir/session_subdir``."""
	root = work_dir / session_subdir
	if not root.exists():
		# Fallback: any *.jsonl that looks like a session header in work_dir.
		candidates = sorted(work_dir.rglob("*.jsonl"))
	else:
		candidates = sorted(root.rglob("*.jsonl"))
	session_files: list[Path] = []
	for cand in candidates:
		name = cand.name
		if name in {"transcript.jsonl", "stderr.log"} or name.startswith("otel"):
			continue
		try:
			first = next(iter_session_entries(cand), None)
		except OSError:
			continue
		if isinstance(first, dict) and first.get("type") == "session":
			session_files.append(cand)
	if not session_files:
		return None
	session_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
	return session_files[0]


def convert_metis_session_to_steps(
	session_path: Path | str,
	*,
	skip_first_user: bool = True,
) -> list[dict[str, Any]]:
	"""Convert a Metis session JSONL into ALE-oriented step dicts.

	Each returned dict has keys consumed by ``MetisDeployer.parse_artifacts``:
	``source``, optional ``message`` / ``reasoning`` / ``tool_calls`` /
	``observation`` / ``metrics`` / ``extra``.

	When ``skip_first_user`` is True (default), the first user message is
	omitted because ALE already seeds the instruction as a leading user step.
	"""
	path = Path(session_path)
	steps: list[dict[str, Any]] = []
	saw_user = False

	for entry in iter_session_entries(path):
		etype = entry.get("type")
		if etype == "_parse_error":
			steps.append(
				{
					"source": "system",
					"message": "metis: unparsable session line",
					"extra": {"raw_preview": str(entry.get("raw", ""))[:200]},
				}
			)
			continue

		if etype != "message":
			continue

		message = entry.get("message")
		if not isinstance(message, dict):
			continue
		role = message.get("role")

		if role == "user":
			plain, parts = _as_text_parts(message.get("content"))
			if skip_first_user and not saw_user:
				saw_user = True
				continue
			saw_user = True
			steps.append(
				{
					"source": "user",
					"message": plain if plain is not None else parts,
					"extra": {"metis_entry_id": entry.get("id")},
				}
			)
			continue

		if role == "assistant":
			content = message.get("content")
			plain, parts = _as_text_parts(content)
			# Prefer structured parts when images present; else plain text.
			has_image = any(p.get("type") == "image" for p in parts)
			msg_payload: Any = parts if has_image else plain
			reasoning = _thinking_text(content)
			tool_calls = _tool_calls(content)
			metrics = _usage_metrics(message.get("usage"))
			step: dict[str, Any] = {
				"source": "agent",
				"message": msg_payload,
				"extra": {
					"metis_entry_id": entry.get("id"),
					"provider": message.get("provider"),
					"model": message.get("model"),
					"stop_reason": message.get("stopReason"),
				},
			}
			if reasoning:
				step["reasoning"] = reasoning
			if tool_calls:
				step["tool_calls"] = tool_calls
			if metrics:
				step["metrics"] = metrics
			steps.append(step)
			continue

		if role == "toolResult":
			plain, parts = _as_text_parts(message.get("content"))
			has_image = any(p.get("type") == "image" for p in parts)
			content_parts = parts if has_image or parts else [{"type": "text", "text": plain or ""}]
			steps.append(
				{
					"source": "environment",
					"observation": {
						"results": [
							{
								"tool_call_id": str(message.get("toolCallId") or ""),
								"content": content_parts,
								"is_error": bool(message.get("isError")),
							}
						]
					},
					"extra": {
						"metis_entry_id": entry.get("id"),
						"tool_name": message.get("toolName"),
					},
				}
			)
			continue

	return steps
