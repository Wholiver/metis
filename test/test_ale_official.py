"""Focused tests for official ALE Metis trajectory conversion + config.

No Docker / ALE checkout required.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from adapters.ale_official.config import MetisConfig
from adapters.ale_official.trajectory_convert import (
	convert_metis_session_to_steps,
	find_session_jsonl,
)


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "ale_official"


class MetisConfigTests(unittest.TestCase):
	def test_defaults_match_fixed_eval_identity(self) -> None:
		cfg = MetisConfig()
		self.assertEqual(cfg.provider, "openai-codex")
		self.assertEqual(cfg.model, "gpt-5.6-luna")
		self.assertEqual(cfg.thinking, "low")
		self.assertEqual(cfg.name, "metis")
		self.assertEqual(cfg.install_mode, "git")

	def test_auth_json_path_embeds_content_without_logging_secrets(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			auth = Path(tmp) / "auth.json"
			payload = {"openai-codex": {"type": "oauth", "access": "SECRET_TOKEN_DO_NOT_LEAK"}}
			auth.write_text(json.dumps(payload), encoding="utf-8")
			cfg = MetisConfig(auth_json_path=str(auth))
			self.assertIn("SECRET_TOKEN_DO_NOT_LEAK", cfg.auth_json_content)
			self.assertTrue(cfg.auth_json_content.startswith("{"))

	def test_invalid_auth_json_raises(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			auth = Path(tmp) / "auth.json"
			auth.write_text("not-json", encoding="utf-8")
			with self.assertRaises(RuntimeError):
				MetisConfig(auth_json_path=str(auth))


class TrajectoryConvertTests(unittest.TestCase):
	def test_converts_fixture_session(self) -> None:
		session = FIXTURES / "sample_session.jsonl"
		steps = convert_metis_session_to_steps(session, skip_first_user=True)
		sources = [s["source"] for s in steps]
		self.assertEqual(sources, ["agent", "environment", "agent"])

		agent0 = steps[0]
		self.assertEqual(agent0["source"], "agent")
		self.assertIn("I'll take a screenshot", agent0["message"])
		self.assertEqual(len(agent0["tool_calls"]), 1)
		self.assertEqual(agent0["tool_calls"][0]["name"], "cua_screenshot")
		self.assertEqual(agent0["metrics"]["input_tokens"], 100)
		self.assertEqual(agent0["metrics"]["output_tokens"], 20)

		env = steps[1]
		self.assertEqual(env["source"], "environment")
		self.assertEqual(env["observation"]["results"][0]["tool_call_id"], "call_1")
		self.assertFalse(env["observation"]["results"][0]["is_error"])
		self.assertEqual(env["observation"]["results"][0]["content"][0]["type"], "text")

		agent1 = steps[2]
		self.assertEqual(agent1["source"], "agent")
		self.assertIn("Done", agent1["message"])
		self.assertNotIn("tool_calls", agent1)

	def test_skip_first_user_false_keeps_instruction(self) -> None:
		session = FIXTURES / "sample_session.jsonl"
		steps = convert_metis_session_to_steps(session, skip_first_user=False)
		self.assertEqual(steps[0]["source"], "user")
		self.assertIn("Solve the task", steps[0]["message"])

	def test_find_session_jsonl(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			wd = Path(tmp)
			sessions = wd / "sessions" / "nested"
			sessions.mkdir(parents=True)
			src = FIXTURES / "sample_session.jsonl"
			dest = sessions / "abc.jsonl"
			dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
			(wd / "transcript.jsonl").write_text('{"type":"noise"}\n', encoding="utf-8")
			found = find_session_jsonl(wd, "sessions")
			self.assertEqual(found, dest)


if __name__ == "__main__":
	unittest.main()
