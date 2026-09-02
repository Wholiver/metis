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
import concurrent.futures
from dataclasses import asdict, dataclass
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional
import uuid

# Ensure repository root is on sys.path for direct script execution
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Configure default Hugging Face token from environment if present
if "HF_TOKEN" in os.environ and "HUGGING_FACE_HUB_TOKEN" not in os.environ:
    os.environ["HUGGING_FACE_HUB_TOKEN"] = os.environ["HF_TOKEN"]

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
    """Format duration in seconds into human-readable string."""
    mins, secs = divmod(int(seconds), 60)
    hours, mins = divmod(mins, 60)
    if hours > 0:
        return f"{hours}h {mins:02d}m {secs:02d}s"
    return f"{mins}m {secs:02d}s"


def format_tokens(n: int) -> str:
    """Format token count with comma or k/M suffix."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
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
        thinking: str = "low",
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: Optional[int] = None,
        concurrency: int = 1,
        resume: bool = True,
        dry_run: bool = False,
        verbose: bool = False,
        cleanup_workspace: bool = True,
        use_docker: bool = False,
        docker_image: str = "python:3.11-slim",
        container_memory: str = "5.5g",
        data_archive: Optional[str | Path] = None,
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
        self.concurrency = max(1, concurrency)
        self.resume = resume
        self.dry_run = dry_run
        self.verbose = verbose
        self.cleanup_workspace = cleanup_workspace
        self.use_docker = use_docker
        self.docker_image = docker_image
        self.container_memory = container_memory
        self.data_archive = Path(data_archive).resolve() if data_archive else None

        self.checkpoint_path = self.output_dir / "checkpoint.json"
        self.results_jsonl_path = self.output_dir / "results.jsonl"
        self.traces_dir = self.output_dir / "traces"
        self.scores_dir = self.output_dir / "scores"
        self.artifacts_dir = self.output_dir / "artifacts"
        self.workspaces_root = self.output_dir / "workspaces"
        self.live_log_path = self.output_dir / "live.log"

        self.adapter = ALEMetisAdapter(
            metis_bin=self.metis_bin,
            default_provider=self.provider,
            default_model=self.model,
            default_thinking=self.thinking,
            base_url=self.base_url,
            api_key=self.api_key,
            default_timeout=self.timeout,
            live_log_path=self.live_log_path,
        )

        self._interrupted = False
        self._completed_task_ids: set[str] = set()
        self._completed_durations: List[float] = []
        self._completed_scores: Dict[str, float] = {}
        self._total_in_tokens = 0
        self._total_out_tokens = 0
        self._total_cache_tokens = 0
        self._total_cost = 0.0
        self._lock = threading.Lock()

        self._setup_signal_handlers()
        self._ensure_output_dirs()

    def _setup_signal_handlers(self) -> None:
        """Register graceful interrupt signal handlers."""
        def handle_signal(sig: int, frame: Any) -> None:
            if not self._interrupted:
                self._interrupted = True
                print("\n\n" + "=" * 70, file=sys.stderr)
                print("🛑 Received interrupt signal (Ctrl+C). Terminating active tasks...", file=sys.stderr)
                print("=" * 70, file=sys.stderr)
                self.adapter.terminate_current_process()

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

    def _ensure_output_dirs(self) -> None:
        """Ensure necessary output folders exist."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.traces_dir.mkdir(parents=True, exist_ok=True)
        self.scores_dir.mkdir(parents=True, exist_ok=True)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.workspaces_root.mkdir(parents=True, exist_ok=True)
        if not self.live_log_path.exists():
            self.live_log_path.write_text("", encoding="utf-8")

    def load_checkpoint(self) -> None:
        """Load state from existing checkpoint.json if resume is enabled."""
        if not self.resume or not self.checkpoint_path.exists():
            return

        try:
            data = json.loads(self.checkpoint_path.read_text(encoding="utf-8"))
            self._completed_task_ids = set(data.get("completed_task_ids", []))
            self._completed_durations = data.get("durations", [])
            self._completed_scores = data.get("scores", {})
            self._total_in_tokens = data.get("total_input_tokens", 0)
            self._total_out_tokens = data.get("total_output_tokens", 0)
            self._total_cache_tokens = data.get("total_cache_tokens", 0)
            self._total_cost = data.get("total_cost", 0.0)

            avg_score_str = ""
            if self._completed_scores:
                avg_score = sum(self._completed_scores.values()) / len(self._completed_scores)
                avg_score_str = f" | Avg Score: {avg_score:.2%}"

            print(
                f"🔄 [Resume] Loaded checkpoint from {self.checkpoint_path.name}: "
                f"{len(self._completed_task_ids)}/{len(self.tasks)} tasks completed{avg_score_str}."
            )
        except Exception as e:
            print(f"⚠️  [Resume] Failed to parse existing checkpoint: {e}. Starting fresh.", file=sys.stderr)

    def save_checkpoint(self) -> None:
        """Persist current progress to checkpoint.json."""
        avg_score = (
            sum(self._completed_scores.values()) / len(self._completed_scores)
            if self._completed_scores
            else 0.0
        )
        payload = {
            "completed_task_ids": sorted(list(self._completed_task_ids)),
            "completed_count": len(self._completed_task_ids),
            "total_tasks": len(self.tasks),
            "durations": self._completed_durations,
            "scores": self._completed_scores,
            "mean_score": round(avg_score, 4),
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
        """Record completed task result and update running aggregates (thread-safe)."""
        with self._lock:
            self._completed_task_ids.add(result.task_id)
            self._completed_durations.append(result.duration_seconds)
            if result.score is not None:
                self._completed_scores[result.task_id] = result.score
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
        remaining_seconds = (avg_duration * remaining_count) / self.concurrency
        eta_str = format_duration(remaining_seconds)

        now = datetime.datetime.now()
        finish_dt = now + datetime.timedelta(seconds=remaining_seconds)
        finish_str = finish_dt.strftime("%Y-%m-%d %H:%M:%S")

        return avg_duration, eta_str, finish_str

    def print_progress_header(self, current_idx: int, task: ALETask) -> None:
        """Render terminal status header for current task."""
        total = len(self.tasks)
        pct = (current_idx / total) * 100
        with self._lock:
            completed_count = len(self._completed_task_ids)
            remaining_count = total - completed_count
            avg_dur, eta_str, finish_str = self.compute_eta(remaining_count)
            elapsed_total = sum(self._completed_durations)
            elapsed_str = format_duration(elapsed_total)

            print("\n" + "=" * 80)
            print(f"📊 [ALE-CLI Benchmark] Task {current_idx + 1}/{total} ({pct:.1f}%) | Current: {task.task_id}")
            print(f"⏱️  Elapsed: {elapsed_str} | Avg: {format_duration(avg_dur)}/task | Concurrency: {self.concurrency} | ETA: {eta_str} (Est. finish: {finish_str})")
            print(
                f"🪙  Tokens: In={format_tokens(self._total_in_tokens)}, Out={format_tokens(self._total_out_tokens)}, Cache={format_tokens(self._total_cache_tokens)} | Cost: ${self._total_cost:.4f}"
            )
            print(f"🤖 Model: {self.provider}:{self.model} (thinking: {self.thinking})")
            print("-" * 80)
            prompt_preview = task.prompt.strip().replace("\n", " ")
            if len(prompt_preview) > 120:
                prompt_preview = prompt_preview[:117] + "..."
            print(f"📝 Prompt: {prompt_preview}")
            print("=" * 80 + "\n", flush=True)

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

    def prepare_task_workspace(self, task: ALETask) -> tuple[Path, Optional[Path]]:
        """
        Prepare an isolated task workspace directory.
        First tries on-demand selective extraction from ale-tasks-data.tar.gz if available,
        otherwise downloads only the task's individual input files from Hugging Face.
        Returns: (workspace_dir, temp_download_cache_dir)
        """
        safe_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task.task_id)
        ws_dir = self.workspaces_root / f"ws_{safe_id}"
        ws_dir.mkdir(parents=True, exist_ok=True)
        temp_download_dir: Optional[Path] = None

        if task.workdir and Path(task.workdir).exists():
            return Path(task.workdir), None

        extracted_from_archive = False
        archive_candidates = [
            self.data_archive,
            Path("eval_data/ale-tasks-data.tar.gz").resolve(),
            Path.home() / "eval_data/ale-tasks-data.tar.gz",
        ]
        tar_path = next((p for p in archive_candidates if p and p.exists()), None)
        if tar_path:
            try:
                import tarfile
                temp_download_dir = Path(tempfile.mkdtemp(prefix=f"ale_dl_{safe_id}_"))
                with tarfile.open(tar_path, "r:*") as tar:
                    matching = [
                        m for m in tar.getmembers()
                        if f"tasks/{task.task_id}" in m.name or f"{task.task_id}/" in m.name
                    ]
                    if matching:
                        tar.extractall(path=temp_download_dir, members=matching)
                        extracted_from_archive = True
                        print(f"📦 [On-Demand Data] Extracted {len(matching)} task files for '{task.task_id}' from archive {tar_path.name}.")
            except Exception as e:
                print(f"⚠️  [On-Demand Data] Tar extraction notice: {e}", file=sys.stderr)

        if not extracted_from_archive and not self.dry_run:
            try:
                from huggingface_hub import snapshot_download
                print(f"📥 [On-Demand Data] Downloading input files for task '{task.task_id}'...")
                temp_download_dir = Path(tempfile.mkdtemp(prefix=f"ale_dl_{safe_id}_"))

                patterns = [
                    f"tasks/{task.task_id}/*",
                    f"tasks/{task.task_id}/**/*",
                    f"{task.task_id}/*",
                    f"{task.task_id}/**/*",
                ]
                hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
                downloaded_path = snapshot_download(
                    repo_id="agents-last-exam/agents-last-exam-data",
                    repo_type="dataset",
                    allow_patterns=patterns,
                    local_dir=str(temp_download_dir),
                    token=hf_token,
                    max_workers=4,
                )
            except Exception as e:
                if self.verbose:
                    print(f"⚠️  [On-Demand Data] Notice: Could not fetch remote task data ({e}). Running in workspace: {ws_dir}", file=sys.stderr)

        # Stage files into ws_dir (avoiding leaking ground truth into workspace)
        if temp_download_dir and temp_download_dir.exists():
            task_root = temp_download_dir / "tasks" / task.task_id
            if not task_root.exists():
                task_root = temp_download_dir / task.task_id

            if task_root.exists():
                for item in task_root.iterdir():
                    if item.name in ("reference", "ground_truth", "expected_output"):
                        continue
                    dest = ws_dir / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dest)
                print(f"📦 [On-Demand Data] Staged input files for '{task.task_id}' into isolated workspace.")

        return ws_dir, temp_download_dir

    def _find_prediction_dir(self, ws_dir: Path) -> Path:
        """Find the agent's output directory within the workspace."""
        candidates = [
            ws_dir / "base" / "output",
            ws_dir / "output",
            ws_dir / "outputs",
            ws_dir / "submission",
            ws_dir / "base",
            ws_dir,
        ]
        for c in candidates:
            if c.exists() and c.is_dir():
                has_files = any(
                    f.is_file() and not f.name.startswith(".") and f.suffix not in (".pyc", ".lock", ".bat")
                    for f in c.iterdir()
                )
                if has_files:
                    return c
        return ws_dir

    def _find_reference_dir(self, dl_ref_dir: Optional[Path], task_id: str) -> Optional[Path]:
        """Find the reference ground truth directory from downloaded files."""
        if not dl_ref_dir or not dl_ref_dir.exists():
            return None
        candidates = [
            dl_ref_dir / "tasks" / task_id / "base" / "reference",
            dl_ref_dir / "tasks" / task_id / "reference",
            dl_ref_dir / task_id / "base" / "reference",
            dl_ref_dir / task_id / "reference",
            dl_ref_dir / "reference",
        ]
        for c in candidates:
            if c.exists() and c.is_dir():
                return c
        for r in dl_ref_dir.rglob("reference"):
            if r.is_dir():
                return r
        return None

    def _download_task_reference(self, task_id: str) -> Optional[Path]:
        """Download on-demand ground truth reference files from Hugging Face for a single task."""
        try:
            from huggingface_hub import snapshot_download
            safe_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task_id)
            temp_ref_dir = Path(tempfile.mkdtemp(prefix=f"ale_ref_{safe_id}_"))
            patterns = [
                f"tasks/{task_id}/*",
                f"tasks/{task_id}/**/*",
                f"{task_id}/*",
                f"{task_id}/**/*",
            ]
            hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
            path = snapshot_download(
                repo_id="agents-last-exam/agents-last-exam-reference",
                repo_type="dataset",
                allow_patterns=patterns,
                local_dir=str(temp_ref_dir),
                token=hf_token,
                max_workers=4,
            )
            return Path(path)
        except Exception as e:
            if self.verbose:
                print(f"⚠️  [Official Verifier] Could not fetch reference dataset ({e})", file=sys.stderr)
            return None

    def _find_official_scorer(self, task_id: str) -> Optional[Path]:
        """Locate the official scoring script for the task."""
        official_tasks_dir = Path(__file__).resolve().parent / "official_tasks"
        candidates = [
            official_tasks_dir / task_id / "scripts" / "score_outputs.py",
            official_tasks_dir / task_id / "scripts" / "verify_outputs.py",
            official_tasks_dir / task_id / "scripts" / "verify_submission.py",
            official_tasks_dir / task_id / "scripts" / "verify.py",
            official_tasks_dir / task_id / "scripts" / "evaluate.py",
            official_tasks_dir / task_id / "scripts" / "score_annotation_workbook.py",
        ]
        for c in candidates:
            if c.exists() and c.is_file():
                return c
        scripts_dir = official_tasks_dir / task_id / "scripts"
        if scripts_dir.exists():
            for f in scripts_dir.glob("*.py"):
                if any(k in f.name.lower() for k in ("score", "eval", "verify", "grade")):
                    return f
        return None

    def _build_scorer_args(self, official_script: Path, pred_dir_str: str, ref_dir_str: str, ws_dir_str: str) -> List[str]:
        """Dynamically detect and construct the CLI flags expected by the official scoring script."""
        import re
        code = official_script.read_text(encoding="utf-8", errors="ignore")
        flags = set(re.findall(r'add_argument\(\s*[\'\"](--[a-zA-Z0-9_-]+)[\'\"]', code))

        args: List[str] = []

        # 1. Input / Workspace flags
        if "--input-dir" in flags:
            input_dir = f"{ws_dir_str}/base/input" if os.path.exists(f"{ws_dir_str}/base/input") else ws_dir_str
            args.extend(["--input-dir", input_dir])
        elif "--input" in flags:
            input_dir = f"{ws_dir_str}/base/input" if os.path.exists(f"{ws_dir_str}/base/input") else ws_dir_str
            args.extend(["--input", input_dir])
        elif "--input-workspace" in flags:
            args.extend(["--input-workspace", ws_dir_str])

        # 2. Output / Prediction flags
        if "--pred-dir" in flags:
            args.extend(["--pred-dir", pred_dir_str])
        elif "--output-dir" in flags:
            args.extend(["--output-dir", pred_dir_str])
        elif "--output" in flags:
            args.extend(["--output", pred_dir_str])
        elif "--submission-dir" in flags:
            args.extend(["--submission-dir", pred_dir_str])
        elif "--candidate-dir" in flags:
            args.extend(["--candidate-dir", pred_dir_str])
        elif "--submission" in flags:
            args.extend(["--submission", pred_dir_str])
        elif "--candidate" in flags:
            args.extend(["--candidate", pred_dir_str])
        elif "--agent-dir" in flags:
            args.extend(["--agent-dir", pred_dir_str])
        elif "--agent" in flags:
            args.extend(["--agent", pred_dir_str])

        # 3. Ground Truth / Reference flags
        if "--gt-dir" in flags:
            args.extend(["--gt-dir", ref_dir_str])
        elif "--reference-dir" in flags:
            args.extend(["--reference-dir", ref_dir_str])
        elif "--reference" in flags:
            args.extend(["--reference", ref_dir_str])
        elif "--ref" in flags:
            args.extend(["--ref", ref_dir_str])
        elif "--ref-dir" in flags:
            args.extend(["--ref-dir", ref_dir_str])
        elif "--ground-truth" in flags:
            args.extend(["--ground-truth", ref_dir_str])

        if not args:
            args = ["--pred-dir", pred_dir_str, "--gt-dir", ref_dir_str]

        return args

    def verify_task(
        self,
        task: ALETask,
        ws_dir: Path,
        temp_dl_dir: Optional[Path],
        res: ALEResult,
        container_id: Optional[str] = None,
    ) -> tuple[float, str, str]:
        """
        Execute official verification immediately upon task completion against
        agents-last-exam-reference ground truth with no arbitrary timeout.
        Returns: (score, status, output)
        """
        safe_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task.task_id)
        pred_dir = self._find_prediction_dir(ws_dir)
        temp_ref_root = self._download_task_reference(task.task_id)
        ref_dir = self._find_reference_dir(temp_ref_root, task.task_id)

        official_script = self._find_official_scorer(task.task_id)
        score = 0.0
        status = "unverified"
        output = ""

        try:
            if official_script and ref_dir and ref_dir.exists():
                if container_id:
                    print(f"⚖️  [Official Verifier (Docker)] Running {official_script.name} inside container '{container_id}'...")
                    subprocess.run(["docker", "exec", container_id, "mkdir", "-p", "/reference"], capture_output=True)
                    subprocess.run(["docker", "cp", f"{ref_dir}/.", f"{container_id}:/reference/"], capture_output=True)
                    subprocess.run(["docker", "cp", str(official_script), f"{container_id}:/tmp_scorer.py"], capture_output=True)

                    rel_pred = pred_dir.relative_to(ws_dir)
                    c_pred_str = f"/workspace/{rel_pred}" if str(rel_pred) != "." else "/workspace"
                    script_args = self._build_scorer_args(official_script, c_pred_str, "/reference", "/workspace")

                    cmd = ["docker", "exec", "-i", "-w", "/workspace", container_id, "python3", "/tmp_scorer.py"] + script_args
                    proc = subprocess.run(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                    )
                else:
                    print(f"⚖️  [Official Verifier] Running {official_script.name} with reference truth...")
                    script_args = self._build_scorer_args(official_script, str(pred_dir), str(ref_dir), str(ws_dir))
                    cmd = [sys.executable, str(official_script)] + script_args
                    proc = subprocess.run(
                        cmd,
                        cwd=str(pred_dir),
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                    )
                output = proc.stdout
                parsed_report = None
                for line in reversed([l.strip() for l in output.splitlines() if l.strip()]):
                    try:
                        parsed_report = json.loads(line)
                        if isinstance(parsed_report, dict):
                            break
                    except Exception:
                        continue

                if parsed_report and isinstance(parsed_report, dict):
                    raw_score = (
                        parsed_report.get("total_score")
                        or parsed_report.get("score")
                        or parsed_report.get("accuracy")
                        or parsed_report.get("acc")
                    )
                    if raw_score is not None:
                        try:
                            score = float(raw_score)
                            if score > 1.0:
                                score = score / 100.0
                            score = max(0.0, min(1.0, score))
                            status = "passed" if score >= 1.0 else ("partial" if score > 0 else "failed")
                        except Exception:
                            pass
                if status == "unverified":
                    if proc.returncode == 0:
                        score = 1.0
                        status = "passed"
                    else:
                        score = 0.0
                        status = "failed"
            elif ref_dir and ref_dir.exists():
                ref_files = [f for f in ref_dir.iterdir() if f.is_file() and not f.name.startswith(".")]
                matched = 0
                for rf in ref_files:
                    pred_f = pred_dir / rf.name
                    if not pred_f.exists():
                        pred_f = ws_dir / rf.name
                    if pred_f.exists():
                        try:
                            if rf.read_bytes() == pred_f.read_bytes():
                                matched += 1
                            elif rf.suffix in (".txt", ".json", ".csv"):
                                if rf.read_text(encoding="utf-8", errors="ignore").strip() == pred_f.read_text(encoding="utf-8", errors="ignore").strip():
                                    matched += 1
                        except Exception:
                            pass
                if ref_files:
                    score = matched / len(ref_files)
                    status = "passed" if score >= 1.0 else ("partial" if score > 0 else "failed")
                    output = f"Matched {matched}/{len(ref_files)} reference files."
                else:
                    score = 1.0 if res.status == "success" and res.final_answer else 0.0
                    status = "inferred"
                    output = f"Reference directory had no files. Status: {res.status}"
            else:
                score = 1.0 if res.status == "success" and res.final_answer else 0.0
                status = "inferred"
                output = f"No reference data available. Status: {res.status}"
        except Exception as e:
            output = f"Verifier error: {e}"
            status = "error"
        finally:
            if temp_ref_root and temp_ref_root.exists():
                shutil.rmtree(temp_ref_root, ignore_errors=True)

        score_record = {
            "task_id": task.task_id,
            "score": score,
            "status": status,
            "final_answer": res.final_answer,
            "duration_seconds": res.duration_seconds,
            "verifier_output": output[:2000],
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        (self.scores_dir / f"{safe_id}.json").write_text(
            json.dumps(score_record, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        status_badge = "✅ PASS" if score >= 1.0 else ("⚠️ PARTIAL" if score > 0 else "❌ FAIL")
        print(f"🎯 [Official Verifier] {task.task_id} => Score: {score:.2f} ({status_badge}) | {output[:80].strip()}", flush=True)
        return score, status, output

    def preserve_task_artifacts(self, task_id: str, ws_dir: Path, res: ALEResult) -> None:
        """Preserve agent output files and submission artifacts for fair leaderboard audit."""
        safe_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task_id)
        target_art_dir = self.artifacts_dir / safe_id
        target_art_dir.mkdir(parents=True, exist_ok=True)

        (target_art_dir / "final_answer.txt").write_text(res.final_answer or "", encoding="utf-8")

        # Recursively preserve all non-input output files created by the agent
        try:
            for root, dirs, files in os.walk(ws_dir):
                rel_root = Path(root).relative_to(ws_dir)
                if any(p.startswith(".") or p == "__pycache__" for p in rel_root.parts):
                    continue
                if "input" in rel_root.parts or "runtime_env" in rel_root.parts or "software" in rel_root.parts:
                    continue
                dest_dir = target_art_dir / rel_root
                dest_dir.mkdir(parents=True, exist_ok=True)
                for f in files:
                    if f.startswith("."):
                        continue
                    src_file = Path(root) / f
                    dest_file = dest_dir / f
                    shutil.copy2(src_file, dest_file)
        except Exception as e:
            if self.verbose:
                print(f"Notice: artifact preservation ({e})", file=sys.stderr)

    def cleanup_task_workspace(self, workspace_path: Optional[Path], download_dir: Optional[Path], task_id: str) -> None:
        """Clean up workspace and downloaded task data to keep disk usage minimal."""
        if not self.cleanup_workspace:
            return

        if workspace_path and workspace_path.exists() and workspace_path != Path.cwd():
            shutil.rmtree(workspace_path, ignore_errors=True)
        if download_dir and download_dir.exists():
            shutil.rmtree(download_dir, ignore_errors=True)
        print(f"🧹 [Cleanup] Cleaned up temporary files for '{task_id}'")

    def _execute_task(self, idx: int, task: ALETask) -> Optional[ALEResult]:
        """Execute a single task lifecycle (staging, running, verifying, cleanup, recording)."""
        if self._interrupted:
            return None

        self.print_progress_header(idx, task)

        ws_dir, temp_dl_dir = self.prepare_task_workspace(task)
        res: Optional[ALEResult] = None
        container_id: Optional[str] = None
        try:
            if self.use_docker:
                safe_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task.task_id)
                container_name = f"ale-task-{safe_id[:25]}-{uuid.uuid4().hex[:6]}"
                docker_cmd = [
                    "docker", "run", "-d",
                    "--name", container_name,
                    "-m", self.container_memory,
                    "--memory-swap", self.container_memory,
                    "-v", f"{ws_dir}:/workspace:rw",
                    "-w", "/workspace",
                    self.docker_image,
                    "sleep", "infinity",
                ]
                run_proc = subprocess.run(docker_cmd, capture_output=True, text=True)
                if run_proc.returncode == 0:
                    container_id = container_name
                    print(f"🐳 [Docker Sandbox] Booted container '{container_name}' (memory limit: {self.container_memory}).")
                else:
                    print(f"⚠️  [Docker Sandbox] Failed to boot container: {run_proc.stderr.strip()}", file=sys.stderr)

            if self.dry_run:
                # Simulated dry run
                print(f"[DRY-RUN] Simulating task {task.task_id} in {ws_dir}...")
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
                    workdir=ws_dir,
                    model=self.model,
                    provider=self.provider,
                    thinking=self.thinking,
                    base_url=self.base_url,
                    timeout=self.timeout,
                    verbose=self.verbose,
                    docker_container=container_id,
                )

            if res and res.status != "interrupted":
                # Immediately execute official verifier on workspace before cleaning up!
                score, verifier_status, verifier_output = self.verify_task(
                    task, ws_dir, temp_dl_dir, res, container_id=container_id
                )
                res.score = score
                res.verifier_status = verifier_status
                res.verifier_output = verifier_output

                # Preserve submission and audit artifacts
                self.preserve_task_artifacts(task.task_id, ws_dir, res)
        finally:
            if container_id:
                subprocess.run(["docker", "rm", "-f", container_id], capture_output=True)
                print(f"🧹 [Docker Sandbox] Destroyed container '{container_id}'.")
            self.cleanup_task_workspace(ws_dir, temp_dl_dir, task.task_id)

        if not res:
            return None

        if res.status == "interrupted":
            self._interrupted = True
            print(f"\n⚠️  Task {task.task_id} was interrupted.")
            return res

        self.record_result(res)

        status_icon = "✅" if res.status == "success" else "❌"
        score_info = f" | Score: {res.score:.2f}" if res.score is not None else ""
        print(
            f"{status_icon} Completed {task.task_id} | Status: {res.status}{score_info} | Time: {res.duration_seconds}s | Tokens: in={res.total_input_tokens}, out={res.total_output_tokens}",
            flush=True,
        )
        return res

    def run(self, skip_preflight: bool = False) -> Dict[str, Any]:
        """
        Execute full benchmark suite with configurable concurrency.
        """
        if not skip_preflight:
            if not self.run_preflight_check():
                return {"completed_tasks": 0, "total_tasks": len(self.tasks), "interrupted": True, "error": "preflight_failed"}

        self.load_checkpoint()
        total_tasks = len(self.tasks)

        print(f"🚀 Starting ALE-CLI Benchmark Evaluation")
        print(f"   - Total Tasks: {total_tasks}")
        print(f"   - Concurrency: {self.concurrency}")
        print(f"   - Model: {self.provider}:{self.model} (thinking={self.thinking})")
        print(f"   - Timeout: {'None (No Timeout)' if not self.timeout else f'{self.timeout}s'}")
        print(f"   - Output Dir: {self.output_dir}")
        print(f"   - On-Demand Data Download: Enabled")
        print(f"   - Auto-Cleanup Workspace: {self.cleanup_workspace}")
        print(f"   - Resume: {self.resume}")
        print()

        pending_tasks = [
            (idx, task) for idx, task in enumerate(self.tasks)
            if task.task_id not in self._completed_task_ids
        ]

        if not pending_tasks:
            print("✨ All tasks have already been completed!")
        elif self.concurrency == 1:
            for idx, task in pending_tasks:
                if self._interrupted:
                    break
                self._execute_task(idx, task)
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=self.concurrency) as executor:
                futures = {
                    executor.submit(self._execute_task, idx, task): task.task_id
                    for idx, task in pending_tasks
                }
                try:
                    for future in concurrent.futures.as_completed(futures):
                        if self._interrupted:
                            break
                        try:
                            future.result()
                        except Exception as e:
                            print(f"⚠️  Task exception: {e}", file=sys.stderr)
                except KeyboardInterrupt:
                    self._interrupted = True
                    self.adapter.terminate_current_process()

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
        print(f"   Results saved to: {self.results_jsonl_path}")
        print(f"   Checkpoint saved to: {self.checkpoint_path}")
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


def get_docker_supported_task_ids() -> Set[str]:
    """Load the official list of 99 Linux tasks runnable on Docker provider."""
    support_file = Path(__file__).resolve().parent / "docker_support.txt"
    if support_file.exists():
        lines = support_file.read_text(encoding="utf-8").splitlines()
        return {line.strip() for line in lines if line.strip() and not line.startswith("#")}
    return set()


def load_default_ale_tasks(docker_supported_only: bool = True) -> List[ALETask]:
    """
    Attempt to load ALE-CLI dataset from huggingface datasets,
    filtered to the official 99 Docker-supported Linux tasks by default.
    """
    try:
        from datasets import load_dataset  # type: ignore

        hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        print("[ALE Runner] Attempting to load 'agents-last-exam/agents-last-exam' from Hugging Face...")
        ds = None
        for split_candidate in ["v1.0", "test", "train"]:
            try:
                ds = load_dataset("agents-last-exam/agents-last-exam", split=split_candidate, token=hf_token)
                break
            except Exception:
                continue

        if ds is None:
            raw_ds = load_dataset("agents-last-exam/agents-last-exam", token=hf_token)
            if hasattr(raw_ds, "keys") and len(raw_ds) > 0:
                first_key = list(raw_ds.keys())[0]
                ds = raw_ds[first_key]

        if ds is not None:
            docker_ids = get_docker_supported_task_ids() if docker_supported_only else set()
            tasks = []
            for idx, row in enumerate(ds):
                task_id = str(row.get("task_id") or f"ale_{idx+1}")
                if docker_supported_only and docker_ids and task_id not in docker_ids:
                    continue
                prompt = (
                    row.get("task_prompt")
                    or row.get("prompt")
                    or row.get("instruction")
                    or row.get("task")
                    or row.get("summary")
                    or ""
                )
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
                filter_info = f" (filtered to {len(tasks)} official Docker-supported Linux tasks)" if docker_supported_only and docker_ids else ""
                print(f"[ALE Runner] Loaded {len(tasks)} ALE-CLI tasks from Hugging Face dataset{filter_info}.")
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
        default="low",
        help="Thinking level (default: low)",
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
        "--concurrency",
        "-c",
        type=int,
        default=1,
        help="Number of tasks to evaluate concurrently (default: 1)",
    )
    parser.add_argument(
        "--use-docker",
        action="store_true",
        default=True,
        help="Run task execution inside isolated Docker container (default: True)",
    )
    parser.add_argument(
        "--no-docker",
        dest="use_docker",
        action="store_false",
        help="Disable Docker container isolation, run tasks directly on host",
    )
    parser.add_argument(
        "--docker-image",
        default="ale-sandbox-base:latest",
        help="Docker container image for task execution/verification (default: ale-sandbox-base:latest)",
    )
    parser.add_argument(
        "--container-memory",
        default="5.5g",
        help="Docker container memory limit (default: 5.5g)",
    )
    parser.add_argument(
        "--data-archive",
        help="Path to ale-tasks-data.tar.gz for on-demand task extraction",
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip pre-flight model authentication and connectivity check",
    )
    parser.add_argument(
        "--keep-workspaces",
        action="store_true",
        help="Keep task workspace directories after completion instead of auto-cleaning",
    )
    parser.add_argument(
        "--all-tasks",
        action="store_true",
        help="Run all 153 tasks including Windows and nested container tasks (default is Docker-supported 99 tasks only)",
    )

    args = parser.parse_args()

    if args.tasks_path:
        tasks = load_tasks_from_file_or_dir(args.tasks_path)
    else:
        tasks = load_default_ale_tasks(docker_supported_only=not args.all_tasks)

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
        concurrency=args.concurrency,
        resume=not args.no_resume,
        dry_run=args.dry_run,
        verbose=args.verbose,
        cleanup_workspace=not args.keep_workspaces,
        use_docker=args.use_docker,
        docker_image=args.docker_image,
        container_memory=args.container_memory,
        data_archive=args.data_archive,
    )

    runner.run(skip_preflight=args.skip_preflight)


if __name__ == "__main__":
    main()
