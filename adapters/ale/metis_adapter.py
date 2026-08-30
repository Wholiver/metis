#!/usr/bin/env python3
"""
Metis Adapter for Agents' Last Exam (ALE-CLI) Benchmark.

Executes Metis headlessly on long-horizon CLI tasks with:
- Default provider 'openai-codex' and model 'gpt-5.6-luna' with 'medium' thinking
- No forced timeout by default (or configurable)
- Structured JSONL trace event parsing
- Token, latency, and cost aggregation
- Clean answer extraction via --output-final-answer
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from typing import Any, Dict, List, Optional


@dataclass
class ALEResult:
    """Standardized result payload for an ALE-CLI benchmark task."""

    task_id: str
    exit_code: int
    status: str  # "success" | "task_failure" | "harness_error" | "interrupted"
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


class ALEMetisAdapter:
    """Harness adapter for executing Metis under ALE-CLI benchmarks."""

    def __init__(
        self,
        metis_bin: str = "metis",
        default_provider: Optional[str] = "openai-codex",
        default_model: Optional[str] = "gpt-5.6-luna",
        default_thinking: Optional[str] = "medium",
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        default_timeout: Optional[int] = None,
        extra_args: Optional[List[str]] = None,
    ) -> None:
        self.metis_bin = metis_bin
        self.default_provider = default_provider
        self.default_model = default_model
        self.default_thinking = default_thinking
        self.base_url = base_url
        self.api_key = api_key
        self.default_timeout = default_timeout
        self.extra_args = extra_args or []
        self._current_process: Optional[subprocess.Popen] = None

    def inject_credentials(self, env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Prepare subprocess environment with credentials and configuration."""
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)

        if self.api_key:
            merged_env["METIS_API_KEY"] = self.api_key
            if self.default_provider == "openrouter":
                merged_env["OPENROUTER_API_KEY"] = self.api_key
            elif self.default_provider in ("openai", "openai-completions", "openai-codex"):
                merged_env["OPENAI_API_KEY"] = self.api_key
            elif self.default_provider == "anthropic":
                merged_env["ANTHROPIC_API_KEY"] = self.api_key
            elif self.default_provider == "google":
                merged_env["GEMINI_API_KEY"] = self.api_key

        if self.base_url:
            merged_env["OPENAI_BASE_URL"] = self.base_url

        return merged_env

    def terminate_current_process(self) -> None:
        """Immediately terminate running task subprocess if active."""
        proc = self._current_process
        if proc and proc.poll() is None:
            try:
                proc.send_signal(signal.SIGINT)
                time.sleep(0.5)
                if proc.poll() is None:
                    proc.kill()
            except Exception:
                pass

    def _resolve_bin_cmd(self) -> List[str]:
        """Resolve executable command, preferring current repository dist/cli.js when metis_bin is default."""
        if self.metis_bin == "metis":
            repo_dist = Path(__file__).resolve().parent.parent.parent / "dist" / "cli.js"
            if repo_dist.exists():
                return ["node", str(repo_dist)]
        return [self.metis_bin]


    def run_task(
        self,
        task_id: str,
        prompt: str,
        workdir: Optional[str | Path] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
        thinking: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[int] = None,
        output_answer_path: Optional[str | Path] = None,
        extra_env: Optional[Dict[str, str]] = None,
        extra_args: Optional[List[str]] = None,
        verbose: bool = False,
    ) -> ALEResult:
        """
        Execute a single ALE benchmark task prompt headlessly.

        Args:
            task_id: Identifier for the benchmark task.
            prompt: The instruction / task description for Metis.
            workdir: Working directory where the task is executed.
            model: Model identifier or pattern (default: gpt-5.6-luna).
            provider: Provider name (default: openai-codex).
            thinking: Thinking level (default: medium).
            base_url: Custom OpenAI-compatible endpoint URL.
            timeout: Optional maximum execution duration in seconds (default: None = no timeout).
            output_answer_path: Optional path to save isolated assistant final answer.
            extra_env: Additional environment variables for this task.
            extra_args: Additional CLI flags to append.
            verbose: If True, stream logs to stderr.

        Returns:
            ALEResult containing exit status, final answer, trace events and metrics.
        """
        resolved_workdir = Path(workdir).resolve() if workdir else Path.cwd()
        resolved_timeout = timeout if timeout is not None else self.default_timeout
        resolved_model = model or self.default_model
        resolved_provider = provider or self.default_provider
        resolved_thinking = thinking if thinking is not None else self.default_thinking
        resolved_base_url = base_url or self.base_url

        safe_task_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in task_id)
        temp_answer_file = None
        if output_answer_path:
            answer_file_path = Path(output_answer_path).resolve()
        else:
            temp_answer_file = tempfile.NamedTemporaryFile(
                prefix=f"ale_final_answer_{safe_task_id}_", suffix=".txt", delete=False
            )
            temp_answer_file.close()
            answer_file_path = Path(temp_answer_file.name)

        bin_cmd = self._resolve_bin_cmd()
        cmd: List[str] = list(bin_cmd) + [
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
        if resolved_thinking:
            cmd.extend(["--thinking", resolved_thinking])
        if resolved_base_url:
            cmd.extend(["--base-url", resolved_base_url])
        if resolved_timeout and resolved_timeout > 0:
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
        was_interrupted = False

        try:
            self._current_process = subprocess.Popen(
                cmd,
                cwd=str(resolved_workdir),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

            try:
                stdout_data, stderr_data = self._current_process.communicate(
                    timeout=resolved_timeout if (resolved_timeout and resolved_timeout > 0) else None
                )
                raw_stdout = stdout_data or ""
                raw_stderr = stderr_data or ""
                exit_code = self._current_process.returncode
            except subprocess.TimeoutExpired:
                timed_out = True
                self._current_process.kill()
                stdout_data, stderr_data = self._current_process.communicate()
                raw_stdout = stdout_data or ""
                raw_stderr = stderr_data or ""
                exit_code = 2
                error_msg = f"Task timed out after {resolved_timeout} seconds"
            except KeyboardInterrupt:
                was_interrupted = True
                self.terminate_current_process()
                try:
                    stdout_data, stderr_data = self._current_process.communicate(timeout=2)
                    raw_stdout = stdout_data or ""
                    raw_stderr = stderr_data or ""
                except Exception:
                    pass
                exit_code = 130
                error_msg = "Task interrupted by user"
        except FileNotFoundError:
            exit_code = 2
            error_msg = f"Metis executable not found: {self.metis_bin}"
        except Exception as exc:
            exit_code = 2
            error_msg = f"Failed to execute Metis process: {exc}"
        finally:
            self._current_process = None

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

        # Map exit code to standard status
        is_auth_or_infra_error = False
        stderr_lower = raw_stderr.lower()
        if exit_code != 0:
            infra_keywords = [
                "unauthorized", "401", "403", "auth", "token expired", "invalid api key",
                "rate limit", "econnrefused", "unknown option", "cannot find module",
                "syntaxerror", "referenceerror", "model not found", "operation not permitted"
            ]
            if any(kw in stderr_lower for kw in infra_keywords) or (total_in_tokens == 0 and total_out_tokens == 0):
                is_auth_or_infra_error = True

        if was_interrupted:
            status = "interrupted"
        elif timed_out or exit_code == 2 or is_auth_or_infra_error:
            status = "harness_error"
            if not error_msg and raw_stderr:
                error_msg = raw_stderr.strip().splitlines()[-1]
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
            for ev in trace_events:
                if ev.get("type") == "model_call" and "usage" in ev:
                    u = ev["usage"]
                    total_in_tokens += u.get("inputTokens", 0)
                    total_out_tokens += u.get("outputTokens", 0)
                    total_cache_tokens += u.get("cacheReadTokens", 0)
                elif ev.get("type") == "turn_cost":
                    total_cost += float(ev.get("cost", 0.0))

        return ALEResult(
            task_id=task_id,
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
    model: str = "gpt-5.6-luna",
    provider: str = "openai-codex",
    thinking: str = "medium",
    base_url: Optional[str] = None,
    timeout: Optional[int] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Convenience function for evaluating a single ALE-CLI task."""
    adapter = ALEMetisAdapter(
        metis_bin=metis_bin,
        default_provider=provider,
        default_model=model,
        default_thinking=thinking,
        base_url=base_url,
        default_timeout=timeout,
    )
    result = adapter.run_task(
        task_id=task_id,
        prompt=prompt,
        workdir=workdir,
        model=model,
        provider=provider,
        thinking=thinking,
        base_url=base_url,
        timeout=timeout,
        **kwargs,
    )
    return result.to_dict()
