#!/usr/bin/env python3
"""
ALE-CLI Benchmark Runner with Checkpointing, Interruption Recovery, and Real-Time ETA.

Usage:
    python -m adapters.ale.runner [options]
    python adapters/ale/runner.py [options]

Features:
    - Concurrency = 1 (strictly sequential execution)
    - Defaults to 'openai-codex' with 'gpt-5.6-luna' and 'medium' thinking
    - Graceful SIGINT (Ctrl+C) handling and checkpoint preservation
    - Automatic resumption from previous checkpoint
    - Real-time ETA estimation, token usage, and cost tracking
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import datetime
import json
import os
from pathlib import Path
import signal
import sys
import time
from typing import Any, Dict, List, Optional

# Ensure repository root is on sys.path for direct script execution
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from adapters.ale.metis_adapter import ALEMetisAdapter, ALEResult
except ImportError:
    from metis_adapter import ALEMetisAdapter, ALEResult  # type: ignore



@dataclass
class ALETask:
    """Task definition for an ALE-CLI benchmark task."""

    task_id: str
    prompt: str
    workdir: Optional[str] = None
    category: Optional[str] = None
    difficulty: Optional[str] = None
    reference_answer: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def format_duration(seconds: float) -> str:
    """Format duration in seconds into human-readable string (e.g. 1h 23m 45s)."""
    if seconds < 0:
        return "0s"
    sec = int(round(seconds))
    hours, rem = divmod(sec, 3600)
    minutes, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours}h {minutes:02d}m {secs:02d}s"
    if minutes > 0:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def format_tokens(n: int) -> str:
    """Format token count into compact human-readable string (e.g. 1.2M, 45.3K)."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


class ALERunner:
    """Runner managing the execution of ALE-CLI benchmark tasks."""

    def __init__(
        self,
        tasks: List[ALETask],
        output_dir: str | Path = "eval_results/ale",
        metis_bin: str = "metis",
        provider: str = "openai-codex",
        model: str = "gpt-5.6-luna",
        thinking: str = "medium",
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: Optional[int] = None,
        resume: bool = True,
        dry_run: bool = False,
        verbose: bool = False,
    ) -> None:
        self.tasks = tasks
        self.output_dir = Path(output_dir).resolve()
        self.metis_bin = metis_bin
        self.provider = provider
        self.model = model
        self.thinking = thinking
        self.base_url = base_url
        self.api_key = api_key
        self.timeout = timeout
        self.resume = resume
        self.dry_run = dry_run
        self.verbose = verbose

        self.checkpoint_path = self.output_dir / "checkpoint.json"
        self.results_jsonl_path = self.output_dir / "results.jsonl"
        self.traces_dir = self.output_dir / "traces"

        self.adapter = ALEMetisAdapter(
            metis_bin=self.metis_bin,
            default_provider=self.provider,
            default_model=self.model,
            default_thinking=self.thinking,
            base_url=self.base_url,
            api_key=self.api_key,
            default_timeout=self.timeout,
        )

        self._interrupted = False
        self._completed_task_ids: set[str] = set()
        self._completed_durations: List[float] = []
        self._total_in_tokens = 0
        self._total_out_tokens = 0
        self._total_cache_tokens = 0
        self._total_cost = 0.0

        self._setup_signal_handlers()
        self._ensure_output_dirs()

    def _setup_signal_handlers(self) -> None:
        """Register graceful interrupt signal handlers."""
        def handle_signal(sig: int, frame: Any) -> None:
            if not self._interrupted:
                self._interrupted = True
                print("\n\n" + "=" * 70, file=sys.stderr)
                print("🛑 Received interrupt signal (Ctrl+C). Terminating active task...", file=sys.stderr)
                print("=" * 70, file=sys.stderr)
                self.adapter.terminate_current_process()

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

    def _ensure_output_dirs(self) -> None:
        """Ensure necessary output folders exist."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.traces_dir.mkdir(parents=True, exist_ok=True)

    def load_checkpoint(self) -> None:
        """Load state from existing checkpoint.json if resume is enabled."""
        if not self.resume or not self.checkpoint_path.exists():
            return

        try:
            data = json.loads(self.checkpoint_path.read_text(encoding="utf-8"))
            self._completed_task_ids = set(data.get("completed_task_ids", []))
            self._completed_durations = data.get("durations", [])
            self._total_in_tokens = data.get("total_input_tokens", 0)
            self._total_out_tokens = data.get("total_output_tokens", 0)
            self._total_cache_tokens = data.get("total_cache_tokens", 0)
            self._total_cost = float(data.get("total_cost", 0.0))
            print(
                f"[ALE Runner] Resumed checkpoint: {len(self._completed_task_ids)}/{len(self.tasks)} tasks completed previously."
            )
        except Exception as e:
            print(f"[ALE Runner] Warning: Failed to read checkpoint ({e}). Starting fresh.", file=sys.stderr)

    def save_checkpoint(self) -> None:
        """Save current execution state to checkpoint.json."""
        payload = {
            "completed_task_ids": list(self._completed_task_ids),
            "completed_count": len(self._completed_task_ids),
            "total_tasks": len(self.tasks),
            "durations": self._completed_durations,
            "total_input_tokens": self._total_in_tokens,
            "total_output_tokens": self._total_out_tokens,
            "total_cache_tokens": self._total_cache_tokens,
            "total_cost": round(self._total_cost, 6),
            "model": self.model,
            "provider": self.provider,
            "thinking": self.thinking,
            "last_updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        temp_file = self.checkpoint_path.with_suffix(".tmp")
        temp_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        temp_file.replace(self.checkpoint_path)

    def record_result(self, result: ALEResult) -> None:
        """Record completed task result and update running aggregates."""
        self._completed_task_ids.add(result.task_id)
        self._completed_durations.append(result.duration_seconds)
        self._total_in_tokens += result.total_input_tokens
        self._total_out_tokens += result.total_output_tokens
        self._total_cache_tokens += result.total_cache_tokens
        self._total_cost += result.total_cost

        # Append to results.jsonl
        with open(self.results_jsonl_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")

        # Save trace if events are present
        if result.trace_events:
            safe_task_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in result.task_id)
            trace_file = self.traces_dir / f"{safe_task_id}.jsonl"
            trace_file.parent.mkdir(parents=True, exist_ok=True)
            with open(trace_file, "w", encoding="utf-8") as f:
                for ev in result.trace_events:
                    f.write(json.dumps(ev, ensure_ascii=False) + "\n")

        self.save_checkpoint()

    def compute_eta(self, remaining_count: int) -> tuple[float, str, str]:
        """
        Compute ETA metrics.

        Returns:
            (avg_duration, eta_formatted_string, finish_timestamp_string)
        """
        if not self._completed_durations or remaining_count <= 0:
            return 0.0, "N/A", "N/A"

        # Moving average biased toward recent tasks
        recent = self._completed_durations[-10:] if len(self._completed_durations) > 10 else self._completed_durations
        avg_duration = sum(recent) / len(recent)
        remaining_seconds = avg_duration * remaining_count
        eta_str = format_duration(remaining_seconds)

        now = datetime.datetime.now()
        finish_dt = now + datetime.timedelta(seconds=remaining_seconds)
        finish_str = finish_dt.strftime("%Y-%m-%d %H:%M:%S")

        return avg_duration, eta_str, finish_str

    def print_progress_header(self, current_idx: int, task: ALETask) -> None:
        """Render terminal status header for current task."""
        total = len(self.tasks)
        pct = (current_idx / total) * 100
        completed_count = len(self._completed_task_ids)
        remaining_count = total - completed_count

        avg_dur, eta_str, finish_str = self.compute_eta(remaining_count)

        elapsed_total = sum(self._completed_durations)
        elapsed_str = format_duration(elapsed_total)

        print("\n" + "=" * 80)
        print(f"📊 [ALE-CLI Benchmark] Task {current_idx + 1}/{total} ({pct:.1f}%) | Current: {task.task_id}")
        print(f"⏱️  Elapsed: {elapsed_str} | Avg: {format_duration(avg_dur)}/task | ETA: {eta_str} (Est. finish: {finish_str})")
        print(
            f"🪙  Tokens: In={format_tokens(self._total_in_tokens)}, Out={format_tokens(self._total_out_tokens)}, Cache={format_tokens(self._total_cache_tokens)} | Cost: ${self._total_cost:.4f}"
        )
        print(f"🤖 Model: {self.provider}:{self.model} (thinking: {self.thinking})")
        print("-" * 80)
        prompt_preview = task.prompt.strip().replace("\n", " ")
        if len(prompt_preview) > 120:
            prompt_preview = prompt_preview[:117] + "..."
        print(f"📝 Prompt: {prompt_preview}")
        print("=" * 80 + "\n")

    def run_preflight_check(self) -> bool:
        """Verify model authentication and provider connectivity before benchmark run."""
        if self.dry_run:
            print("🔍 [Pre-flight] Dry-run enabled, skipping live authentication check.")
            return True

        print("🔍 [Pre-flight] Verifying model authentication and connectivity...")
        print(f"   Target: {self.provider}:{self.model} (thinking={self.thinking})")

        preflight_res = self.adapter.run_task(
            task_id="__preflight_ping__",
            prompt="Respond with 'READY' and nothing else.",
            model=self.model,
            provider=self.provider,
            thinking=self.thinking,
            base_url=self.base_url,
            timeout=45,
            verbose=self.verbose,
        )

        if preflight_res.status != "success":
            print("\n" + "❌" * 40, file=sys.stderr)
            print("❌ PRE-FLIGHT AUTHENTICATION CHECK FAILED!", file=sys.stderr)
            print(f"   Provider: {self.provider} | Model: {self.model}", file=sys.stderr)
            print(f"   Exit Code: {preflight_res.exit_code} | Status: {preflight_res.status}", file=sys.stderr)
            if preflight_res.raw_stderr:
                print(f"   Stderr Details:\n{preflight_res.raw_stderr.strip()}", file=sys.stderr)
            elif preflight_res.error_message:
                print(f"   Error: {preflight_res.error_message}", file=sys.stderr)
            print("\n⚠️  Please ensure your Codex subscription credentials in ~/.metis/agent/auth.json or env variables are valid before running.", file=sys.stderr)
            print("❌" * 40 + "\n", file=sys.stderr)
            return False

        print(f"✅ [Pre-flight] Model connectivity and credentials verified! (response: {preflight_res.final_answer or 'OK'})\n")
        return True

    def run(self, skip_preflight: bool = False) -> Dict[str, Any]:
        """
        Execute full benchmark suite with concurrency 1.
        """
        if not skip_preflight:
            if not self.run_preflight_check():
                return {"completed_tasks": 0, "total_tasks": len(self.tasks), "interrupted": True, "error": "preflight_failed"}

        self.load_checkpoint()
        total_tasks = len(self.tasks)

        print(f"🚀 Starting ALE-CLI Benchmark Evaluation")
        print(f"   - Total Tasks: {total_tasks}")
        print(f"   - Concurrency: 1")
        print(f"   - Model: {self.provider}:{self.model} (thinking={self.thinking})")
        print(f"   - Timeout: {'None (No Timeout)' if not self.timeout else f'{self.timeout}s'}")
        print(f"   - Output Dir: {self.output_dir}")
        print(f"   - Resume: {self.resume}")
        print()

        for idx, task in enumerate(self.tasks):
            if self._interrupted:
                break

            if task.task_id in self._completed_task_ids:
                if self.verbose:
                    print(f"⏭️  Skipping completed task: {task.task_id}")
                continue

            self.print_progress_header(idx, task)

            if self.dry_run:
                # Simulated dry run
                print(f"[DRY-RUN] Simulating task {task.task_id}...")
                time.sleep(0.5)
                res = ALEResult(
                    task_id=task.task_id,
                    exit_code=0,
                    status="success",
                    final_answer="Dry run simulated answer",
                    duration_seconds=0.5,
                    total_input_tokens=1000,
                    total_output_tokens=200,
                    total_cache_tokens=500,
                    total_cost=0.001,
                )
            else:
                res = self.adapter.run_task(
                    task_id=task.task_id,
                    prompt=task.prompt,
                    workdir=task.workdir,
                    model=self.model,
                    provider=self.provider,
                    thinking=self.thinking,
                    base_url=self.base_url,
                    timeout=self.timeout,
                    verbose=self.verbose,
                )

            if res.status == "interrupted":
                print(f"\n⚠️  Task {task.task_id} was interrupted.")
                break

            self.record_result(res)

            status_icon = "✅" if res.status == "success" else "❌"
            print(
                f"{status_icon} Completed {task.task_id} | Status: {res.status} | Time: {res.duration_seconds}s | Tokens: in={res.total_input_tokens}, out={res.total_output_tokens}"
            )

        # Print final summary
        completed_count = len(self._completed_task_ids)
        total_time = sum(self._completed_durations)
        print("\n" + "=" * 80)
        if self._interrupted:
            print("🛑 EVALUATION INTERRUPTED")
            print(f"   Progress saved to: {self.checkpoint_path}")
            print(f"   To resume execution, rerun the command with --resume")
        else:
            print("🎉 EVALUATION COMPLETE")
        print(f"   Completed: {completed_count}/{total_tasks} tasks")
        print(f"   Total Duration: {format_duration(total_time)}")
        print(
            f"   Total Tokens: In={format_tokens(self._total_in_tokens)}, Out={format_tokens(self._total_out_tokens)}, Cache={format_tokens(self._total_cache_tokens)}"
        )
        print(f"   Total Cost: ${self._total_cost:.4f}")
        print(f"   Results: {self.results_jsonl_path}")
        print("=" * 80 + "\n")

        return {
            "completed_tasks": completed_count,
            "total_tasks": total_tasks,
            "interrupted": self._interrupted,
            "total_duration": total_time,
            "total_cost": self._total_cost,
        }


def load_tasks_from_file_or_dir(path_str: str) -> List[ALETask]:
    """Load benchmark tasks from a JSON, JSONL, or dataset directory."""
    path = Path(path_str).resolve()
    tasks: List[ALETask] = []

    if not path.exists():
        raise FileNotFoundError(f"Tasks path does not exist: {path}")

    if path.is_file():
        if path.suffix == ".jsonl":
            with open(path, "r", encoding="utf-8") as f:
                for line_idx, line in enumerate(f):
                    line_str = line.strip()
                    if not line_str:
                        continue
                    item = json.loads(line_str)
                    task_id = item.get("task_id") or item.get("id") or f"ale_task_{line_idx + 1}"
                    prompt = item.get("prompt") or item.get("instruction") or item.get("task") or ""
                    tasks.append(
                        ALETask(
                            task_id=task_id,
                            prompt=prompt,
                            workdir=item.get("workdir"),
                            category=item.get("category"),
                            difficulty=item.get("difficulty"),
                            reference_answer=item.get("reference_answer"),
                            metadata=item.get("metadata"),
                        )
                    )
        elif path.suffix == ".json":
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
                items = raw if isinstance(raw, list) else raw.get("tasks", [])
                for line_idx, item in enumerate(items):
                    task_id = item.get("task_id") or item.get("id") or f"ale_task_{line_idx + 1}"
                    prompt = item.get("prompt") or item.get("instruction") or item.get("task") or ""
                    tasks.append(
                        ALETask(
                            task_id=task_id,
                            prompt=prompt,
                            workdir=item.get("workdir"),
                            category=item.get("category"),
                            difficulty=item.get("difficulty"),
                            reference_answer=item.get("reference_answer"),
                            metadata=item.get("metadata"),
                        )
                    )
    elif path.is_dir():
        # Directory of individual task files or yaml/json
        for subfile in sorted(path.glob("*.json")):
            with open(subfile, "r", encoding="utf-8") as f:
                item = json.load(f)
                task_id = item.get("task_id") or subfile.stem
                prompt = item.get("prompt") or item.get("instruction") or ""
                tasks.append(
                    ALETask(
                        task_id=task_id,
                        prompt=prompt,
                        workdir=item.get("workdir"),
                        category=item.get("category"),
                        metadata=item.get("metadata"),
                    )
                )

    return tasks


def load_default_ale_tasks() -> List[ALETask]:
    """
    Attempt to load ALE-CLI dataset from huggingface datasets,
    or fallback to built-in representative sample tasks.
    """
    try:
        from datasets import load_dataset  # type: ignore

        print("[ALE Runner] Attempting to load 'agents-last-exam/agents-last-exam' from Hugging Face...")
        ds = None
        for split_candidate in ["v1.0", "test", "train"]:
            try:
                ds = load_dataset("agents-last-exam/agents-last-exam", split=split_candidate)
                break
            except Exception:
                continue

        if ds is None:
            raw_ds = load_dataset("agents-last-exam/agents-last-exam")
            if hasattr(raw_ds, "keys") and len(raw_ds) > 0:
                first_key = list(raw_ds.keys())[0]
                ds = raw_ds[first_key]

        if ds is not None:
            tasks = []
            for idx, row in enumerate(ds):
                env_type = str(row.get("environment_type", "")).lower()
                software = str(row.get("software", "")).lower()
                # Accept CLI tasks or all if environment_type is not restrictive
                is_cli = (
                    not env_type
                    or env_type in ("cli", "terminal", "bash", "all", "linux", "none")
                    or "cli" in env_type
                    or "terminal" in env_type
                )
                if is_cli:
                    prompt = (
                        row.get("task_prompt")
                        or row.get("prompt")
                        or row.get("instruction")
                        or row.get("task")
                        or row.get("summary")
                        or ""
                    )
                    task_id = str(row.get("task_id") or f"ale_{idx+1}")
                    tasks.append(
                        ALETask(
                            task_id=task_id,
                            prompt=prompt,
                            category=row.get("category") or row.get("subdomain"),
                            difficulty=row.get("difficulty"),
                            reference_answer=row.get("reference_answer"),
                            metadata={
                                "title": row.get("title"),
                                "agent_must_do": row.get("agent_must_do"),
                                "input_files": row.get("input_files"),
                            },
                        )
                    )
            if tasks:
                print(f"[ALE Runner] Loaded {len(tasks)} ALE-CLI tasks from Hugging Face dataset.")
                return tasks
    except Exception as e:
        print(f"[ALE Runner] Notice: Could not load from datasets package ({e}). Using local dataset/fallback.", file=sys.stderr)

    # Built-in representative fallback task list for demonstration/standalone testing
    sample_tasks = [
        ALETask(
            task_id="ale_cli_001_repo_refactor",
            prompt="Inspect the repository structure, diagnose failing integration tests in test/ and refactor the module while keeping public APIs backwards-compatible.",
            category="software_engineering",
            difficulty="hard",
        ),
        ALETask(
            task_id="ale_cli_002_data_pipeline",
            prompt="Build a deterministic data aggregation pipeline that reads JSON logs, computes rolling percentiles and outputs a verified summary report in CSV format.",
            category="data_analysis",
            difficulty="medium",
        ),
        ALETask(
            task_id="ale_cli_003_system_audit",
            prompt="Perform a complete security and configuration audit of the environment services, identify misconfigurations and produce remediation scripts.",
            category="system_administration",
            difficulty="hard",
        ),
    ]
    return sample_tasks


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Agents' Last Exam (ALE-CLI) Metis Evaluation Runner with GPT-5.6-Luna (OpenAI Codex)"
    )
    parser.add_argument(
        "--tasks-path",
        "-t",
        help="Path to tasks JSON/JSONL file or task directory (loads default/HF dataset if omitted)",
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        default="eval_results/ale",
        help="Directory to store checkpoint and results (default: eval_results/ale)",
    )
    parser.add_argument(
        "--model",
        "-m",
        default="gpt-5.6-luna",
        help="Model identifier (default: gpt-5.6-luna)",
    )
    parser.add_argument(
        "--provider",
        default="openai-codex",
        help="Provider name (default: openai-codex)",
    )
    parser.add_argument(
        "--thinking",
        default="medium",
        help="Thinking level (default: medium)",
    )
    parser.add_argument(
        "--base-url",
        help="Custom base URL for model provider",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="Per-task execution timeout in seconds (default: None = no timeout)",
    )
    parser.add_argument(
        "--metis-bin",
        default="metis",
        help="Path to Metis executable (default: metis)",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Do not resume from previous checkpoint, start fresh",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate execution without running actual Metis model calls",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Limit number of tasks to evaluate (useful for smoke tests)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose output",
    )

    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip pre-flight model authentication and connectivity check",
    )

    args = parser.parse_args()

    if args.tasks_path:
        tasks = load_tasks_from_file_or_dir(args.tasks_path)
    else:
        tasks = load_default_ale_tasks()

    if args.limit and args.limit > 0:
        tasks = tasks[: args.limit]

    runner = ALERunner(
        tasks=tasks,
        output_dir=args.output_dir,
        metis_bin=args.metis_bin,
        provider=args.provider,
        model=args.model,
        thinking=args.thinking,
        base_url=args.base_url,
        timeout=args.timeout,
        resume=not args.no_resume,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )

    runner.run(skip_preflight=args.skip_preflight)


if __name__ == "__main__":
    main()
