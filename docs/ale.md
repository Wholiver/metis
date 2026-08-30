# Agents' Last Exam (ALE-CLI) Benchmark Adapter

This guide explains how to evaluate **Metis** against the **Agents' Last Exam (ALE-CLI)** benchmark using OpenAI Codex subscription models (`gpt-5.6-luna` with `medium` thinking level).

---

## Key Features

1. **Codex Subscription Binding**: Built-in default model configured as `--provider openai-codex --model gpt-5.6-luna --thinking medium`, utilizing existing local OAuth tokens or API credentials in `~/.metis/agent/auth.json`.
2. **Concurrency 1**: Sequential queue execution to prevent rate limit contention and ensure deterministic evaluation order.
3. **No Timeout (Full Exploration)**: Allows the agent sufficient reasoning time to solve complex, long-horizon terminal challenges.
4. **Graceful Interruption & Auto-Resume**: Press `Ctrl+C` at any point to stop safely. All progress is saved in `eval_results/ale/checkpoint.json`. Re-running will automatically resume and skip previously completed tasks.
5. **Real-Time ETA & Dashboard**: Dynamically computes average time per task, remaining tasks, estimated time of completion (ETA), token consumption, and estimated cost.

---

## Directory Structure

```
adapters/ale/
├── __init__.py           # Public exports
├── metis_adapter.py      # Metis headless execution harness
├── runner.py             # CLI runner with checkpointing & ETA tracking
└── requirements.txt      # Optional dependencies (tqdm, datasets)
```

---

## Quick Start

### 1. Requirements

Make sure Metis is built or in your PATH:

```bash
npm run build
```

### 2. Run Full ALE-CLI Benchmark

To start evaluating tasks with default settings (`gpt-5.6-luna`, `openai-codex`, thinking `medium`, concurrency 1):

```bash
python3 -m adapters.ale.runner
```

### 3. Specify Custom Dataset

You can pass a custom JSONL or JSON task file or task directory:

```bash
python3 -m adapters.ale.runner --tasks-path ./ale_tasks.jsonl
```

### 4. Dry Run / Smoke Test

Test runner mechanics and progress reporting without invoking the actual model:

```bash
python3 -m adapters.ale.runner --dry-run --limit 3
```

---

## Interruption and Resuming

When running long benchmark sessions, you can interrupt at any time by pressing **`Ctrl+C`** (`SIGINT`).

The runner will:
1. Signal the active Metis process to terminate gracefully.
2. Flush the current task state into `eval_results/ale/checkpoint.json`.
3. Preserve all finished entries in `eval_results/ale/results.jsonl`.

To resume evaluation from where you left off:

```bash
python3 -m adapters.ale.runner
```

To start fresh and overwrite previous checkpoint:

```bash
python3 -m adapters.ale.runner --no-resume
```

---

## Results and Metrics

Benchmark artifacts are saved in `eval_results/ale/` (or `--output-dir`):

- **`checkpoint.json`**: Current run metadata, list of finished task IDs, total elapsed time, tokens, and cost.
- **`results.jsonl`**: Standardized results per task (status, exit code, duration, token usage, cost, final answer).
- **`traces/<task_id>.jsonl`**: Complete trace of JSONL events emitted during task execution.
