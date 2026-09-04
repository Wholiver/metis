#!/usr/bin/env python3
"""
ALE Leaderboard Submission Packager.

Packs eval_results/ale into the exact archive shape required by:
https://agents-last-exam.org/leaderboard/submit

Required archive shape:
├── metadata.json
├── eval.json
└── runs/
    └── <task_slug>/
        ├── eval_result.json
        ├── trajectory.jsonl
        └── output/
            └── ... (preserved artifacts)
"""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import zipfile


def package_submission(
    results_dir: Path,
    output_archive: Path,
    harness: str = "metis",
    model: str = "gpt-5.6-luna",
    benchmark_version: str = "v1",
) -> None:
    results_dir = results_dir.resolve()
    checkpoint_file = results_dir / "checkpoint.json"

    if not checkpoint_file.exists():
        raise FileNotFoundError(f"Checkpoint file not found: {checkpoint_file}")

    cp = json.loads(checkpoint_file.read_text(encoding="utf-8"))

    task_count = cp.get("total_tasks", 99)
    completed_count = cp.get("completed_count", len(cp.get("completed_task_ids", [])))
    overall_score = float(cp.get("mean_score", 0.0))
    scores = cp.get("scores", {})

    metadata = {
        "harness": harness,
        "model": model,
        "benchmark_version": benchmark_version,
        "provider": cp.get("provider", "openai-codex"),
        "thinking": cp.get("thinking", "low"),
        "total_input_tokens": cp.get("total_input_tokens", 0),
        "total_output_tokens": cp.get("total_output_tokens", 0),
        "total_cache_tokens": cp.get("total_cache_tokens", 0),
        "total_cost": cp.get("total_cost", 0.0),
        "last_updated": cp.get("last_updated"),
    }

    eval_data = {
        "overall_score": overall_score,
        "task_count": task_count,
        "completed_count": completed_count,
        "scores": scores,
        "durations": cp.get("durations", []),
        "completed_task_ids": cp.get("completed_task_ids", []),
    }

    output_archive = output_archive.resolve()
    output_archive.parent.mkdir(parents=True, exist_ok=True)

    is_zip = output_archive.suffix.lower() == ".zip"
    is_tar = any(str(output_archive).lower().endswith(ext) for ext in (".tar.gz", ".tgz"))

    if not (is_zip or is_tar):
        # Default to zip if unspecified
        output_archive = output_archive.with_suffix(".zip")
        is_zip = True

    print(f"📦 Packaging ALE submission archive: {output_archive.name}")
    print(f"   - Harness: {harness}")
    print(f"   - Model: {model}")
    print(f"   - Completed: {completed_count}/{task_count}")
    print(f"   - Overall Score: {overall_score * 100:.2f}%")

    traces_dir = results_dir / "traces"
    scores_dir = results_dir / "scores"
    artifacts_dir = results_dir / "artifacts"

    if is_zip:
        with zipfile.ZipFile(output_archive, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("metadata.json", json.dumps(metadata, indent=2))
            zf.writestr("eval.json", json.dumps(eval_data, indent=2))

            for task_id in cp.get("completed_task_ids", []):
                safe_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task_id)
                run_prefix = f"runs/{safe_id}"

                score_file = scores_dir / f"{safe_id}.json"
                if score_file.exists():
                    zf.write(score_file, f"{run_prefix}/eval_result.json")

                trace_file = traces_dir / f"{safe_id}.jsonl"
                if trace_file.exists():
                    zf.write(trace_file, f"{run_prefix}/trajectory.jsonl")

                task_art_dir = artifacts_dir / safe_id
                if task_art_dir.exists():
                    for root, _, files in os.walk(task_art_dir):
                        for f in files:
                            full_f = Path(root) / f
                            rel_f = full_f.relative_to(task_art_dir)
                            zf.write(full_f, f"{run_prefix}/output/{rel_f}")
    else:
        with tarfile.open(output_archive, "w:gz") as tf:
            m_bytes = json.dumps(metadata, indent=2).encode("utf-8")
            ti_m = tarfile.TarInfo("metadata.json")
            ti_m.size = len(m_bytes)
            tf.addfile(ti_m, io.BytesIO(m_bytes))

            e_bytes = json.dumps(eval_data, indent=2).encode("utf-8")
            ti_e = tarfile.TarInfo("eval.json")
            ti_e.size = len(e_bytes)
            tf.addfile(ti_e, io.BytesIO(e_bytes))

            for task_id in cp.get("completed_task_ids", []):
                safe_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task_id)
                run_prefix = f"runs/{safe_id}"

                score_file = scores_dir / f"{safe_id}.json"
                if score_file.exists():
                    tf.add(score_file, arcname=f"{run_prefix}/eval_result.json")

                trace_file = traces_dir / f"{safe_id}.jsonl"
                if trace_file.exists():
                    tf.add(trace_file, arcname=f"{run_prefix}/trajectory.jsonl")

                task_art_dir = artifacts_dir / safe_id
                if task_art_dir.exists():
                    for root, _, files in os.walk(task_art_dir):
                        for f in files:
                            full_f = Path(root) / f
                            rel_f = full_f.relative_to(task_art_dir)
                            tf.add(full_f, arcname=f"{run_prefix}/output/{rel_f}")

    file_size_mb = output_archive.stat().st_size / (1024 * 1024)
    print(f"✅ Submission archive created successfully: {output_archive} ({file_size_mb:.2f} MB)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Package ALE evaluation results for Leaderboard submission.")
    parser.add_argument(
        "--results-dir",
        type=Path,
        default=Path("eval_results/ale"),
        help="Path to evaluation results directory (default: eval_results/ale)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("eval_results/ale/submission.zip"),
        help="Output archive file path (default: eval_results/ale/submission.zip)",
    )
    parser.add_argument("--harness", default="metis", help="Harness name (default: metis)")
    parser.add_argument("--model", default="gpt-5.6-luna", help="Model name (default: gpt-5.6-luna)")
    parser.add_argument("--benchmark-version", default="v1", help="Benchmark version (default: v1)")

    args = parser.parse_args()
    package_submission(
        results_dir=args.results_dir,
        output_archive=args.output,
        harness=args.harness,
        model=args.model,
        benchmark_version=args.benchmark_version,
    )


if __name__ == "__main__":
    main()
