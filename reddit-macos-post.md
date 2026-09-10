# r/MacOS post

## Recommended title

I changed the agent, not the model: Metis scored 82.02% vs OpenCode's 67.42%

## Body

Same DeepSeek V4 Flash model, same model version, same 89 Terminal-Bench 2.1 tasks, same environment, and same budget.

- OpenCode: 60/89 solved (67.42%)
- Metis: 73/89 solved (82.02%)
- Difference: 13 more tasks, or 14.60 percentage points

I am Metis's developer. I built it to test how much the agent runtime itself matters when the underlying model stays fixed. Metis adds explicit planning, persistent context, recursive sub-agents, and verification-focused execution instead of relying on a single linear agent loop.

This is one controlled benchmark, not a claim that Metis wins every workload. I am sharing the full numbers so others can inspect or reproduce the comparison.

For Mac users: Metis has an Apple-silicon desktop app and also runs in the terminal. It is MIT-licensed, fully open source, and free with no paid tier. Current Mac builds are ad-hoc signed, not Apple-notarized, so please review the source before installing.

Source: https://github.com/Wholiver/metis

Download: https://github.com/Wholiver/metis/releases/latest

What would you want included in a more rigorous follow-up comparison: more models, more agents, or repeated runs?

## Media

Attach `/Users/huchenrui/Downloads/terminal-bench-2.1.jpg` as the benchmark image.

## Posting notes

- Post only during Developer Saturday: Saturday, 00:00-23:59 UTC.
- Use the Developer Saturday flair if available.
- Limit: one promotional post per user per week.
- Keep the developer disclosure and non-notarized-build warning.
- Policy source: https://www.reddit.com/r/MacOS/comments/1rsxzup/new_policy_introducing_developer_saturday/

## Alternate high-click titles

1. Same DeepSeek model, 13 more tasks solved: Metis beat OpenCode 82.02% to 67.42%
2. Metis vs OpenCode on the same DeepSeek model: 73/89 solved vs 60/89
3. How much does the coding agent matter? 82.02% vs 67.42% with the same model
