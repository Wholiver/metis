# Title

Show HN: Metis – Open-source coding agent, 82% on Terminal-Bench 2.1

# URL

https://github.com/Wholiver/metis

# Text

Hi HN, I’m the solo developer behind Metis, an MIT-licensed coding-agent runtime for the terminal and macOS.

I built it to explore a question: how much does the agent harness matter when the underlying model stays the same? Most coding-agent comparisons focus on models, but planning, memory, delegation, tool use, recovery, and verification also affect whether a task is completed correctly.

Metis separates planning from implementation, keeps durable SQLite-backed memory, supports recursive named agents, preserves recoverable sessions, and uses verification gates before considering work complete. The terminal and desktop interfaces use the same runtime.

I tested Metis 1.1.0 against OpenCode on Terminal-Bench 2.1. Both runs used the same DeepSeek V4 Flash model and model version, the same 89 tasks, environment, and budget. Only the agent framework changed.

Metis completed 73/89 tasks (82.02%). OpenCode completed 60/89 (67.42%). That is 13 additional tasks, or 14.60 percentage points. This is one controlled benchmark, not a claim that Metis will outperform on every repository or workload.

You can install the CLI with:

`npm install -g @wholiver_hu/metis`

The project is fully open source and free. The current macOS build supports Apple silicon only and is ad-hoc signed rather than Apple-notarized. Model-provider requirements and costs depend on the provider you choose.

I’d appreciate technical feedback on the runtime design and evaluation. Which would be most useful to publish next: complete run traces, token and cost comparisons, or feature ablations?
