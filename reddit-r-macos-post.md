# r/MacOS — Metis post

## Recommended title

**I built an open-source coding agent for Mac—it solved 73/89 tasks vs OpenCode’s 60/89 with the same model**

## Post body

Hi r/MacOS — I’m the solo developer behind Metis.

I built it because I wanted coding-agent work to be easier to follow on a Mac: conversations on the left, the active task in the center, and plans, file changes, sub-agents, and context usage visible on the right.

I also ran a controlled Terminal-Bench 2.1 comparison using the same DeepSeek V4 Flash model, model version, 89 tasks, environment, and budget. Only the agent framework changed:

- OpenCode: **60/89 solved (67.42%)**
- Metis: **73/89 solved (82.02%)**

That is 13 additional tasks in this test. It is one benchmark, not a claim that Metis will outperform everywhere, but it suggests the planning, memory, orchestration, and verification layer can make a meaningful difference.

Metis is MIT-licensed, fully open source, and free. The current Mac build supports Apple silicon only and is ad-hoc signed rather than Apple-notarized, so I want to be transparent about that upfront.

GitHub: https://github.com/Wholiver/metis

What should I prioritize for the Mac app next: notarization, broader Mac support, or more native UI polish?

## Alternate titles

1. **Same model, 13 more tasks solved: I built a free, open-source coding agent for Mac**
2. **I changed the agent, not the model—Metis for Mac scored 82.02% vs OpenCode’s 67.42%**
3. **Built for Mac: an open-source coding agent that solved 73/89 Terminal-Bench tasks**

## Posting notes

- Post only on **Saturday in UTC**. Promotional posts on other days are removed.
- Link to the main GitHub repository, not a redirect or third-party download page.
- Recommended image order: `330_1x_shots_so.png` first, `terminal-bench-2.1.jpg` second, then `216_1x_shots_so.png`.
- Keep the Apple-silicon and non-notarized disclosure in the body.
