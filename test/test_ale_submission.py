from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "build_leaderboard_submission", ROOT / "scripts" / "build_leaderboard_submission.py"
)
assert SPEC and SPEC.loader
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


def trusted(task_id: str, score: float = 0.0) -> dict:
    return {
        "task_id": task_id,
        "outcome": "scored",
        "score": score,
        "official_commit": PACKAGE.OFFICIAL_ALE_COMMIT,
        "input_sha256": "i",
        "reference_sha256": "r",
        "artifact_sha256": "a",
        "data_revision": "d",
        "reference_revision": "v",
        "evaluator_stdout_sha256": "o",
        "evaluator_stderr_sha256": "e",
    }


class SubmissionTests(unittest.TestCase):
    def test_zero_score_stays_zero_and_99_usage_is_aggregatable(self):
        task_ids = [f"domain/task_{index}" for index in range(99)]
        results = {task_id: trusted(task_id, 0.0) for task_id in task_ids}
        PACKAGE.require_trusted_scores(results, task_ids)
        self.assertEqual(sum(float(row["score"]) for row in results.values()), 0.0)

    def test_any_blocked_result_stops_packaging(self):
        task_ids = [f"domain/task_{index}" for index in range(99)]
        results = {task_id: trusted(task_id) for task_id in task_ids}
        results[task_ids[42]]["outcome"] = "blocked"
        with self.assertRaises(ValueError):
            PACKAGE.require_trusted_scores(results, task_ids)

    def test_metis_trace_converts_to_official_schema(self):
        events = [
            {"type": "session", "id": "episode", "timestamp": "2026-09-01T00:00:00Z",
             "traceContext": {"model": "gpt-5.6-luna", "provider": "openai-codex"}},
            {"type": "message_end", "message": {"role": "user", "timestamp": 1,
             "content": [{"type": "text", "text": "instruction"}]}},
            {"type": "trace_summary", "totalInputTokens": 10, "totalOutputTokens": 2,
             "totalCacheReadTokens": 3, "totalCacheWriteTokens": 4,
             "totalCost": 0.25, "totalDurationMs": 1000},
        ]
        trajectory, metrics = PACKAGE.canonical_trajectory("domain/task", events, 0.0)
        self.assertEqual(trajectory["schema_version"], "ALE-v1.0")
        self.assertEqual(metrics["reward"], 0.0)
        self.assertEqual(metrics["total_cache_read_tokens"], 3)

    def test_artifact_output_never_packages_wrapper(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "artifacts" / "business_finance_pe_screening_memo_1"
            output = source / "zscaler_fy2025" / "output"
            output.mkdir(parents=True)
            (source / "final_answer.txt").write_text("done", encoding="utf-8")
            (output / "screening_memo.md").write_text("memo", encoding="utf-8")
            self.assertEqual(PACKAGE.artifact_output(root, "business_finance/pe_screening_memo_1"), output)

    def test_missing_output_is_packaged_as_empty_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "artifacts" / "health_medicine_missing"
            (source / "base").mkdir(parents=True)
            (source / "final_answer.txt").write_text("no files", encoding="utf-8")
            self.assertIsNone(PACKAGE.artifact_output(root, "health_medicine/missing"))


if __name__ == "__main__":
    unittest.main()
