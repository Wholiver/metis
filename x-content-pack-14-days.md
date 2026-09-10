# Metis X content pack — 14 days

Post one per day. Each post is below the standard 280-character limit, including X's 23-character URL weighting.

## Day 1 — Agent-harness thesis (247/280)

Most AI coding discussions ask: which model is best?

I think the agent harness matters just as much. Planning, memory, tool use, delegation, and verification all shape the final result.

That is the idea behind Metis, my open-source coding agent.

## Day 2 — Build in public (217/280)

I’m building Metis in public: an open-source AI coding agent for macOS and the terminal.

Goal: make long coding tasks easier to plan, inspect, recover, and verify—not just generate more code.

https://github.com/Wholiver/metis

Suggested media: `330_1x_shots_so.png`

## Day 3 — Plan and Build (222/280)

One product decision in Metis: Plan and Build are separate modes.

Plan explores the codebase and defines the route.
Build makes the changes.
Verification checks the result.

Simple separation, much clearer agent behavior.

## Day 4 — Durable context (220/280)

Context is not a side feature for AI coding agents. It is the product.

Metis keeps durable memory across longer tasks so the agent can retain decisions, constraints, and progress instead of rediscovering the same facts.

## Day 5 — Recursive agents (215/280)

Recursive agents sound complex, but the use case is simple: give focused subtasks to specialized workers, keep the main task coherent, and inspect each result before accepting it.

That workflow is built into Metis.

## Day 6 — macOS interface (205/280)

Designing a desktop UI for an AI coding agent means showing the work, not hiding it.

In Metis for macOS, conversations, plans, file changes, sub-agents, and context usage stay visible while the task runs.

Suggested media: `216_1x_shots_so.png`

## Day 7 — Benchmark methodology (206/280)

Benchmark details matter.

For my Terminal-Bench 2.1 comparison, Metis and OpenCode used the same DeepSeek V4 Flash model, model version, 89 tasks, environment, and budget. Only the agent framework changed.

## Day 8 — Benchmark result (179/280)

Same model. Same tasks. Same budget.

Terminal-Bench 2.1:
Metis: 73/89 solved (82.02%)
OpenCode: 60/89 solved (67.42%)

13 more tasks solved without changing the model.

#AICoding

Suggested media: `terminal-bench-2.1.jpg`

## Day 9 — Developer question (196/280)

What is your biggest frustration with AI coding agents?

A) Losing context
B) Weak planning
C) Changing too much code
D) Stopping before verification

I’m using questions like this to shape Metis.

## Day 10 — Open-source position (238/280)

Metis is MIT-licensed, fully open source, and free.

No required Metis-hosted service. No paid tier planned. The goal is to make the agent runtime inspectable, extensible, and useful with the models developers already choose.

#OpenSource

## Day 11 — Verification (216/280)

Generating code is easy. Knowing when the task is actually done is harder.

That is why verification gates matter: inspect the diff, run relevant checks, and report uncertainty instead of declaring victory too early.

## Day 12 — Terminal and desktop (183/280)

Terminal or desktop? I don’t think developers should have to choose.

Metis supports terminal workflows for speed and a macOS app for visibility. Same agent runtime, two ways to work.

Suggested media: `938_1x_shots_so.png`

## Day 13 — Product philosophy (194/280)

The best coding agent should not feel magical. It should feel legible.

You should be able to see the plan, understand the changes, inspect delegated work, and recover when something goes wrong.

## Day 14 — Feedback request (256/280)

If you experiment with AI coding agents, I’d value feedback on Metis—especially from developers working in long, messy, real-world repositories.

What should I improve first: planning, memory, verification, or the macOS experience?

https://github.com/Wholiver/metis

## Publishing guidance

- Use the posts in order or rearrange them, but do not publish several at once.
- Keep most posts link-free; this pack uses the repository link only twice.
- Use no more than two relevant hashtags. Do not add unrelated trending hashtags.
- Add one screenshot or benchmark image when suggested; media can improve discoverability in X search and timelines.
- Reply to relevant AI coding, open-source, and macOS discussions with specific observations. Do not paste promotional replies.
- Avoid deleting and reposting the same copy or publishing near-duplicates.
