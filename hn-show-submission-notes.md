# Show HN submission notes for Metis

Do not paste this file into Hacker News. HN currently asks founders to write submission text themselves without LLM generation or editing. Use these verified facts to write a short first-person version in your own words.

## Fix the current title

Current wording to avoid:

`Metis Agent, a free, opensource agent that boosts coding performance by 50%`

Problems:

- `open source` should be `open-source` when used as an adjective.
- `50%` is not supported by the benchmark.
- The measured change is **67.42% to 82.02%**, equal to **+14.60 percentage points** or about **+21.7% relative improvement**.
- HN discourages promotional claims such as “boosts performance.”
- Because people can install and run Metis, the title should begin with `Show HN:`.

## Neutral title structure to rewrite

`Show HN: Metis – [neutral description of the working project]`

Possible factual descriptions:

- open-source coding-agent runtime
- coding agent with durable memory and verification
- coding agent for terminal and macOS
- open-source agent that scored 82.02% on Terminal-Bench 2.1

Keep the final title factual and preferably under 80 characters. Write the exact wording yourself.

## Facts for the submission text

### What it is

- MIT-licensed coding-agent runtime.
- Runs in the terminal and has a macOS desktop interface.
- Supports Plan/Build separation, durable SQLite-backed memory, recursive named agents, recoverable sessions, and verification gates.
- Users choose their own supported model provider.

### Why it exists

- Main question: how much can the agent harness improve results when the underlying model stays fixed?
- Goal: make long coding tasks easier to plan, inspect, recover, and verify.

### Benchmark

- Terminal-Bench 2.1, 89 tasks.
- Same DeepSeek V4 Flash model and model version.
- Same environment and budget.
- Only the agent framework changed.
- Metis: 73/89, 82.02%.
- OpenCode: 60/89, 67.42%.
- Difference: 13 additional tasks, +14.60 percentage points, about +21.7% relative.
- Caveat: this is one controlled benchmark, not evidence that Metis wins in every repository or workload.

### How people can try it

- Repository: `https://github.com/Wholiver/metis`
- CLI install: `npm install -g @wholiver_hu/metis`
- No signup to inspect or install the open-source project.

### Limitations worth stating

- macOS desktop build currently supports Apple silicon only.
- Current Mac release is ad-hoc signed rather than Apple-notarized.
- Model-provider costs or subscription requirements depend on the provider selected by the user.

## Handwritten paragraph order

1. Say what Metis is in one plain sentence.
2. Explain the problem that made you build it.
3. Mention two or three technical decisions that differ from other agents.
4. Give the controlled benchmark conditions and result.
5. State the benchmark caveat and current Mac limitations.
6. Explain how to install it.
7. Ask one concrete technical question, such as which benchmark, trace, or ablation readers want next.

## HN-specific reminders

- Use the GitHub repository as the URL.
- Do not ask friends or users to upvote or add promotional comments.
- Stay available after posting to answer technical questions yourself.
- Avoid sales language, exclamation marks, unsupported comparisons, and generic praise.
