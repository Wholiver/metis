# Why are you the right founder/team to work on this?

I am a solo, full-time technical founder and built Metis end to end: the agent runtime, terminal interface, React Desktop application, model and provider integrations, multi-agent orchestration, memory system, SDK/RPC interfaces, benchmark adapter, tests, releases, and documentation.

That breadth matters for this product. Improving a coding agent is not only a model problem; it requires understanding context management, tool execution, failure recovery, developer workflows, evaluation, security boundaries, and user experience as one system. I work directly across all of those layers and can turn observed failures into tested product changes without coordination gaps between separate teams.

I also use benchmark evidence instead of relying only on demos. In a controlled Terminal-Bench 2.1 comparison using the same DeepSeek V4 Flash model, version, environment, task inputs, and budget, Metis solved 73 of 89 tasks, compared with 60 of 89 using OpenCode. I treat that result as something to reproduce and investigate, not as a universal claim.

# Why did you pick this idea to work on?

I kept seeing capable models fail at software tasks for reasons that were not primarily about code generation. They lost important context, acted before understanding the problem, handled long-running work poorly, and often stopped when an answer looked plausible instead of when the result had been verified.

That led me to a simple question: how much coding ability is already present in current models but remains inaccessible because of the agent around them?

I built Metis to explore that question. Its core loop is search, remember, execute, and verify. It combines explicit Plan and Build workflows, durable memory, recoverable and branchable sessions, recursive named agents, controlled tool access, and verification-oriented completion. It works in both terminal and desktop environments and can also run headlessly through JSONL, RPC, and a Node.js SDK.

The controlled Terminal-Bench result—73/89 tasks with Metis versus 60/89 with OpenCode using the same DeepSeek V4 Flash setup—strengthened my belief that agent architecture can materially affect the value users receive from the same underlying model.

# Who are your competitors, and what do you understand about this idea that they don't?

The competitive set includes Claude Code, Codex CLI, OpenCode, Aider, Cline, Cursor, and other coding-agent products and open-source agent frameworks.

My differing view is that the durable advantage will not come only from access to a strong model or from adding more tools. Models change quickly and increasingly become interchangeable. The agent runtime must reliably preserve intent across long tasks, control when and how work executes, recover from interruptions, coordinate specialized agents, and require evidence before declaring completion.

Many products are optimized around the immediate chat-and-edit loop. Metis is designed as a complete, inspectable execution system: deterministic step state, explicit Plan/Build boundaries, durable memory, branchable sessions, recursive delegation, optional worktree isolation, verification gates, and machine-readable benchmark and automation modes.

Metis is also fully open source and provider-flexible. Users can inspect the runtime, connect subscription or API-key providers, use compatible custom endpoints, extend tools and workflows, and avoid being locked into one model vendor. The goal is not to hide orchestration behind a proprietary service; it is to make the agent layer auditable, reproducible, and improvable by its users.

# What's your revenue and/or growth rate?

Metis is pre-revenue and was launched recently. It currently has 51 GitHub stars, which is the clearest early public adoption signal available. There is not yet enough history to report a meaningful growth rate.

Metis is fully open source, and I do not plan to charge users now or in the future. I am currently focused on product quality, independent benchmark reproduction, contributor growth, and building a durable open-source community rather than monetization.

# Anything else you would like investors to know?

Metis is intended to remain fully open source and free. I am not planning a paid tier, feature paywall, or proprietary edition.

Because of that commitment, Metis is not a conventional venture-backed SaaS opportunity. The best fit would be a mission-aligned open-source fund, research partner, strategic sponsor, or infrastructure provider that values open developer tooling and transparent agent evaluation.

Support would be used to sustain full-time development, improve security and cross-platform reliability, publish reproducible benchmark artifacts and feature ablations, expand documentation and integrations, and help contributors participate effectively. It would not be used to move community features behind a closed product.

The larger goal is to create an open, model-independent agent runtime that helps developers obtain more reliable results from rapidly improving models—and gives the community enough visibility to understand why those results improve or fail.
