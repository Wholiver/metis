# Description of the launch

Metis is an MIT-licensed coding agent runtime for terminal and desktop. Unlike thin model wrappers, it focuses on the agent harness: durable memory, Plan/Build workflows, recursive named agents, verification gates, and recoverable sessions. In a controlled Terminal-Bench 2.1 run using the same DeepSeek V4 Flash model and budget, Metis solved 73/89 tasks vs 60/89 with OpenCode. This launch adds React Desktop and benchmark-ready JSONL, RPC, and SDK modes.

Character count: 457

# First comment

Hey Product Hunt 👋 I’m the maker of Metis.

I started building it after noticing that the same capable model could produce very different coding results depending on the agent around it. Models were improving quickly, but long-running work still failed in familiar ways: context disappeared, execution started before the problem was understood, and a plausible answer was often treated as a finished, verified result.

I wanted an agent runtime built around a simple loop: search, remember, execute, and verify.

Metis began as a terminal-first tool. Over time it grew into explicit Plan and Build workflows, durable memory and recoverable sessions, recursive named agents with controlled tool access, and verification gates. I later added the React Desktop app so plans, subagents, questions, model usage, and execution progress are easier to inspect instead of being hidden inside a terminal log.

The result that encouraged me most came from a controlled Terminal-Bench 2.1 run. Using the same DeepSeek V4 Flash model, version, environment, task inputs, and budget, Metis solved 73 of 89 tasks (82.02%), compared with 60 of 89 (67.42%) using OpenCode.

That is one benchmark, not a claim that Metis universally makes every model better. I see it as evidence that agent architecture matters—and as a result worth reproducing, challenging, and breaking down feature by feature.

Metis is MIT licensed, and I’d love feedback from people building with coding agents. What would help you evaluate it most: exact benchmark configs, per-task traces, cost and token comparisons, or orchestration ablations?

Thanks for checking it out. Issues, independent benchmark runs, and contributions are especially welcome 🙌

