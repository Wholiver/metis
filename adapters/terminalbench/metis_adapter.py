#!/usr/bin/env python3
"""
Metis TerminalBench & Harbor Adapter.

Provides a standard harness adapter interface to execute Metis in headless evaluation
environments (such as TerminalBench 2.1, Harbor, SWE-bench, etc.), automatically handling:
- Credential injection and environment isolation
- Headless execution with structured JSONL event logging
- Final answer separation via `--output-final-answer`
- Deterministic exit code classification (0=Success, 1=Task Failed, 2=Harness/Timeout Error)
- Full trace collection and Token / Cost / Latency aggregation across the recursive agent tree
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from typing import Any, Dict, List, Optional


@dataclass
class BenchmarkResult:
    """Standardized benchmark execution result payload."""

    exit_code: int
    status: str  # "success" | "task_failure" | "harness_error"
    final_answer: str
    duration_seconds: float
    trace_events: List[Dict[str, Any]] = field(default_factory=list)
    trace_summary: Optional[Dict[str, Any]] = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_tokens: int = 0
    total_cost: float = 0.0
    raw_stdout: str = ""
    raw_stderr: str = ""
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class MetisAdapter:
    """Harness adapter for executing Metis under automated benchmarks."""

    def __init__(
        self,
        metis_bin: str = "metis",
        default_provider: Optional[str] = None,
        default_model: Optional[str] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        default_timeout: int = 600,
        extra_args: Optional[List[str]] = None,
    ) -> None:
        self.metis_bin = metis_bin
        self.default_provider = default_provider
        self.default_model = default_model
        self.base_url = base_url
        self.api_key = api_key
        self.default_timeout = default_timeout
        self.extra_args = extra_args or []

    def inject_credentials(self, env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Prepare subprocess environment with credentials and configuration."""
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)

        if self.api_key:
            merged_env["METIS_API_KEY"] = self.api_key
            if self.default_provider == "openrouter":
                merged_env["OPENROUTER_API_KEY"] = self.api_key
            elif self.default_provider in ("openai", "openai-completions"):
                merged_env["OPENAI_API_KEY"] = self.api_key
            elif self.default_provider == "anthropic":
                merged_env["ANTHROPIC_API_KEY"] = self.api_key
            elif self.default_provider == "google":
                merged_env["GEMINI_API_KEY"] = self.api_key

        if self.base_url:
            merged_env["OPENAI_BASE_URL"] = self.base_url

        return merged_env

    def run_task(
        self,
        prompt: str,
        workdir: Optional[str | Path] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[int] = None,
        output_answer_path: Optional[str | Path] = None,
        extra_env: Optional[Dict[str, str]] = None,
        extra_args: Optional[List[str]] = None,
        verbose: bool = False,
    ) -> BenchmarkResult:
        """
        Execute a single benchmark task prompt headlessly.

        Args:
            prompt: The instruction / task description for Metis.
            workdir: Working directory where the task is executed.
            model: Model identifier or pattern (overrides default).
            provider: Provider name (e.g. openrouter, openai, google).
            base_url: Custom OpenAI-compatible endpoint URL.
            timeout: Maximum execution duration in seconds.
            output_answer_path: Optional path to save isolated assistant final answer.
            extra_env: Additional environment variables for this task.
            extra_args: Additional CLI flags to append.
            verbose: If True, stream logs to stderr.

        Returns:
            BenchmarkResult containing exit status, final answer, trace events and metrics.
        """
        resolved_workdir = Path(workdir).resolve() if workdir else Path.cwd()
        resolved_timeout = timeout or self.default_timeout
        resolved_model = model or self.default_model
        resolved_provider = provider or self.default_provider
        resolved_base_url = base_url or self.base_url

        temp_answer_file = None
        if output_answer_path:
            answer_file_path = Path(output_answer_path).resolve()
        else:
            temp_answer_file = tempfile.NamedTemporaryFile(
                prefix="metis_final_answer_", suffix=".txt", delete=False
            )
            temp_answer_file.close()
            answer_file_path = Path(temp_answer_file.name)

        cmd: List[str] = [
            self.metis_bin,
            "-p",
            prompt,
            "--mode",
            "json",
            "--output-final-answer",
            str(answer_file_path),
            "--no-session",
        ]

        if resolved_model:
            cmd.extend(["--model", resolved_model])
        if resolved_provider:
            cmd.extend(["--provider", resolved_provider])
        if resolved_base_url:
            cmd.extend(["--base-url", resolved_base_url])
        if resolved_timeout:
            cmd.extend(["--timeout", str(resolved_timeout)])

        cmd.extend(self.extra_args)
        if extra_args:
            cmd.extend(extra_args)

        env = self.inject_credentials(extra_env)

        start_time = time.time()
        raw_stdout = ""
        raw_stderr = ""
        exit_code = 0
        error_msg: Optional[str] = None
        timed_out = False

        try:
            process = subprocess.Popen(
                cmd,
                cwd=str(resolved_workdir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

            try:
                stdout_data, stderr_data = process.communicate(timeout=resolved_timeout)
                raw_stdout = stdout_data or ""
                raw_stderr = stderr_data or ""
                exit_code = process.returncode
            except subprocess.TimeoutExpired:
                timed_out = True
                process.kill()
                stdout_data, stderr_data = process.communicate()
                raw_stdout = stdout_data or ""
                raw_stderr = stderr_data or ""
                exit_code = 2
                error_msg = f"Task timed out after {resolved_timeout} seconds"
        except FileNotFoundError:
            exit_code = 2
            error_msg = f"Metis executable not found: {self.metis_bin}"
        except Exception as exc:
            exit_code = 2
            error_msg = f"Failed to execute Metis process: {exc}"

        duration = time.time() - start_time

        # Read final answer
        final_answer = ""
        if answer_file_path.exists():
            try:
                final_answer = answer_file_path.read_text(encoding="utf-8").strip()
            except Exception as e:
                if verbose:
                    sys.stderr.write(f"Warning: Failed to read final answer file: {e}\n")

        # Cleanup temporary answer file if created
        if temp_answer_file and answer_file_path.exists():
            try:
                answer_file_path.unlink(missing_ok=True)
            except Exception:
                pass

        # Parse JSONL events from stdout
        trace_events: List[Dict[str, Any]] = []
        trace_summary: Optional[Dict[str, Any]] = None
        last_assistant_text: List[str] = []

        for line in raw_stdout.splitlines():
            line_str = line.strip()
            if not line_str or not line_str.startswith("{"):
                continue
            try:
                event = json.loads(line_str)
                trace_events.append(event)
                event_type = event.get("type")

                if event_type == "trace_summary":
                    trace_summary = event
                elif event_type == "message" and event.get("role") == "assistant":
                    content = event.get("content")
                    if isinstance(content, str):
                        last_assistant_text.append(content)
                    elif isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                text_val = part.get("text", "")
                                if text_val:
                                    last_assistant_text.append(text_val)
            except json.JSONDecodeError:
                pass

        # Fallback for final_answer if file was empty
        if not final_answer and last_assistant_text:
            final_answer = last_assistant_text[-1].strip()

        # Map exit code to standard benchmark status
        if timed_out or exit_code == 2:
            status = "harness_error"
        elif exit_code == 0:
            status = "success"
        elif exit_code == 1:
            status = "task_failure"
        else:
            status = "harness_error"

        # Aggregate tokens and cost from trace_summary
        total_in_tokens = 0
        total_out_tokens = 0
        total_cache_tokens = 0
        total_cost = 0.0

        if trace_summary:
            total_in_tokens = trace_summary.get("totalInputTokens", 0)
            total_out_tokens = trace_summary.get("totalOutputTokens", 0)
            total_cache_tokens = trace_summary.get("totalCacheReadTokens", trace_summary.get("totalCachedTokens", 0))
            total_cost = float(trace_summary.get("totalCost", 0.0))
        else:
            # Aggregate from individual model_call events if summary was not emitted
            for ev in trace_events:
                if ev.get("type") == "model_call" and "usage" in ev:
                    u = ev["usage"]
                    total_in_tokens += u.get("inputTokens", 0)
                    total_out_tokens += u.get("outputTokens", 0)
                    total_cache_tokens += u.get("cacheReadTokens", 0)
                elif ev.get("type") == "turn_cost":
                    total_cost += float(ev.get("cost", 0.0))

        return BenchmarkResult(
            exit_code=exit_code,
            status=status,
            final_answer=final_answer,
            duration_seconds=round(duration, 3),
            trace_events=trace_events,
            trace_summary=trace_summary,
            total_input_tokens=total_in_tokens,
            total_output_tokens=total_out_tokens,
            total_cache_tokens=total_cache_tokens,
            total_cost=round(total_cost, 6),
            raw_stdout=raw_stdout,
            raw_stderr=raw_stderr,
            error_message=error_msg,
        )


def evaluate_task(
    task_id: str,
    prompt: str,
    workdir: Optional[str] = None,
    metis_bin: str = "metis",
    model: Optional[str] = None,
    provider: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: int = 600,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Convenience function for benchmark harness runners (TerminalBench, Harbor).
    """
    adapter = MetisAdapter(
        metis_bin=metis_bin,
        default_provider=provider,
        default_model=model,
        base_url=base_url,
        default_timeout=timeout,
    )
    result = adapter.run_task(
        prompt=prompt,
        workdir=workdir,
        model=model,
        provider=provider,
        base_url=base_url,
        timeout=timeout,
        **kwargs,
    )
    res_dict = result.to_dict()
    res_dict["task_id"] = task_id
    return res_dict


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Metis TerminalBench & Harbor Automated Evaluation Adapter"
    )
    parser.add_argument(
        "--task-id",
        default="benchmark-task",
        help="Identifier for the benchmark task instance",
    )
    parser.add_argument(
        "--prompt",
        "-p",
        required=True,
        help="Task instructions or user prompt to solve",
    )
    parser.add_argument(
        "--workdir",
        "-w",
        default=".",
        help="Workspace directory for task execution",
    )
    parser.add_argument(
        "--metis-bin",
        default="metis",
        help="Path to metis executable (default: metis)",
    )
    parser.add_argument("--model", "-m", help="Model identifier to use")
    parser.add_argument("--provider", help="Provider name (e.g. openrouter, openai)")
    parser.add_argument("--base-url", help="Custom OpenAI-compatible base URL")
    parser.add_argument(
        "--timeout",
        "-t",
        type=int,
        default=600,
        help="Execution timeout in seconds (default: 600)",
    )
    parser.add_argument(
        "--output-json",
        help="File path to save the structured benchmark result JSON",
    )
    parser.add_argument(
        "--output-final-answer",
        help="File path to save the isolated final answer text",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print verbose diagnostic logs",
    )

    args = parser.parse_args()

    adapter = MetisAdapter(
        metis_bin=args.metis_bin,
        default_provider=args.provider,
        default_model=args.model,
        base_url=args.base_url,
        default_timeout=args.timeout,
    )

    result = adapter.run_task(
        prompt=args.prompt,
        workdir=args.workdir,
        model=args.model,
        provider=args.provider,
        base_url=args.base_url,
        timeout=args.timeout,
        output_answer_path=args.output_final_answer,
        verbose=args.verbose,
    )

    if args.output_json:
        out_path = Path(args.output_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(result.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    # Print summary to stdout
    print(
        f"[MetisAdapter] Task: {args.task_id} | Status: {result.status} (exit_code={result.exit_code}) | Duration: {result.duration_seconds}s"
    )
    print(
        f"[MetisAdapter] Tokens: in={result.total_input_tokens}, out={result.total_output_tokens}, cache={result.total_cache_tokens} | Cost: ${result.total_cost:.4f}"
    )
    if result.final_answer:
        print(f"\n--- Final Answer ---\n{result.final_answer}\n--------------------")

    sys.exit(result.exit_code)


if __name__ == "__main__":
    main()
