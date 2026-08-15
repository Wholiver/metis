# TerminalBench 2.1 & Harbor Benchmark Guide (评测接入指南)

Metis is engineered for state-of-the-art automated benchmarks, including **TerminalBench 2.1**, **Harbor**, **SWE-bench**, and custom agent evaluation frameworks.

---

## 1. Key Headless Benchmark Features

Metis provides first-class support for unattended, machine-driven evaluation harnesses:

| Feature | CLI Flag / Behavior | Benefit for Benchmarks |
| :--- | :--- | :--- |
| **Headless Non-Interactive Mode** | `-p, --print` with `--mode json` | Fully headless execution without TTY dependency or ANSI escape clutter. |
| **Final Answer Separation** | `--output-final-answer <file>` | Writes clean assistant answer to an isolated file, preventing log contamination. |
| **Standard Exit Codes** | `0` / `1` / `2` | Reliable exit code categorization for benchmark pass/fail evaluation. |
| **No-Hang User Interaction Fallback** | Auto-fallback in `ask_user` | Automatically responds with default/recommended choices in headless mode; never blocks. |
| **Full Trace & Cost Aggregation** | JSONL `trace_summary` | Emits total input/output/cached tokens, latency, and estimated cost across the agent tree. |
| **Arbitrary Base URL & Models** | `--base-url <url> --model <id>` | Connects to any local/remote OpenAI-compatible endpoint (vLLM, Ollama, SGLang, LiteLLM). |
| **Deterministic Timeout** | `--timeout <seconds>` | Subprocess timer ensures tasks terminate cleanly without leaking zombie processes. |

---

## 2. Standard Exit Code Classification

Metis maps execution results to standardized POSIX exit codes:

- **`0` (Success)**: Task completed successfully without fatal errors.
- **`1` (Task Failure)**: The model executed the task but encountered validation errors, test failures, or unmet task objectives.
- **`2` (Harness / Timeout / Infrastructure Error)**: Process timed out, invalid CLI arguments, authentication failures, or missing executables.

---

## 3. Direct Headless CLI Invocation

### Basic Headless Benchmark Run
```bash
metis -p "Fix the failing tests in test/auth.test.ts" \
  --mode json \
  --output-final-answer ./outputs/final_answer.txt \
  --no-session \
  --timeout 300
```

### Running with Custom Provider Endpoint & Model
```bash
metis -p "Implement binary search tree in src/tree.ts" \
  --mode json \
  --provider openai \
  --base-url "http://127.0.0.1:8000/v1" \
  --model "deepseek-coder-v3" \
  --output-final-answer ./outputs/final_answer.txt \
  --no-session
```

### Specifying Multi-Agent Recursion Controls
```bash
metis -p "Coordinate multi-role refactoring" \
  --agent coordinator \
  --max-spawn-depth 4 \
  --max-concurrent 4 \
  --mode json \
  --output-final-answer ./outputs/answer.txt \
  --no-session
```

---

## 4. Python Adapter (`adapters/terminalbench/`)

Metis provides a standardized Python adapter `MetisAdapter` located in `adapters/terminalbench/` for seamless integration into Python-based evaluation harnesses.

### 4.1 Adapter Quickstart

```python
from adapters.terminalbench.metis_adapter import MetisAdapter

adapter = MetisAdapter(
    metis_bin="metis",
    default_provider="openrouter",
    default_model="anthropic/claude-3-7-sonnet",
    default_timeout=600,
)

result = adapter.run_task(
    prompt="Resolve issue #104: Fix null pointer in parser.ts",
    workdir="/path/to/repo",
    output_answer_path="/path/to/repo/answer.txt",
)

print(f"Status: {result.status}")          # "success" | "task_failure" | "harness_error"
print(f"Exit Code: {result.exit_code}")    # 0 | 1 | 2
print(f"Duration: {result.duration_seconds}s")
print(f"Tokens: In={result.total_input_tokens}, Out={result.total_output_tokens}")
print(f"Total Cost: ${result.total_cost:.4f}")
print(f"Final Answer: {result.final_answer}")
```

### 4.2 TerminalBench & Harbor Task Function

```python
from adapters.terminalbench.metis_adapter import evaluate_task

# Standard benchmark evaluation entry point
benchmark_output = evaluate_task(
    task_id="terminalbench_task_042",
    prompt="Configure nginx reverse proxy on port 8080",
    workdir="./workspace",
    model="openai/gpt-4o",
    timeout=300,
)
```

### 4.3 CLI Execution via Adapter

You can also run the adapter directly as a standalone CLI tool:

```bash
python -m adapters.terminalbench.metis_adapter \
  --task-id "task-001" \
  --prompt "Refactor user authentication module" \
  --workdir "./my-project" \
  --model "anthropic/claude-3-7-sonnet" \
  --output-json "./results/task_001.json" \
  --output-final-answer "./results/task_001_answer.txt"
```

---

## 5. Trace Events & Metric Extraction

In `--mode json`, Metis streams JSONL events to standard output.

### 1. `traceContext` Injection
Every lifecycle, tool execution, and model call event includes `traceContext`:

```json
{
  "type": "tool_execution_start",
  "toolName": "bash",
  "traceContext": {
    "rootRunId": "run-6f3b2a",
    "agentId": "implementer-01",
    "parentId": "coordinator-root",
    "depth": 1,
    "provider": "openrouter",
    "model": "anthropic/claude-3-7-sonnet"
  }
}
```

### 2. `trace_summary` Event
At the conclusion of the run, Metis emits a `trace_summary` event aggregating usage across the entire recursive tree:

```json
{
  "type": "trace_summary",
  "rootRunId": "run-6f3b2a",
  "totalInputTokens": 14250,
  "totalOutputTokens": 3120,
  "totalCachedTokens": 8400,
  "totalCost": 0.0543,
  "totalDurationMs": 18450,
  "agents": {
    "root": {
      "inputTokens": 4200,
      "outputTokens": 800,
      "cachedTokens": 2400,
      "cost": 0.0152,
      "durationMs": 5200,
      "model": "anthropic/claude-3-7-sonnet",
      "provider": "openrouter",
      "depth": 0
    },
    "implementer-01": {
      "inputTokens": 10050,
      "outputTokens": 2320,
      "cachedTokens": 6000,
      "cost": 0.0391,
      "durationMs": 13250,
      "model": "anthropic/claude-3-7-sonnet",
      "provider": "openrouter",
      "depth": 1
    }
  }
}
```
