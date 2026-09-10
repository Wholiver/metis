# Recommended title

I built Metis to see how much an agent harness can change the same model — 73/89 vs 60/89 on Terminal-Bench 2.1

# Alternative titles

1. The same DeepSeek V4 Flash model solved 13 more Terminal-Bench tasks with Metis than with OpenCode
2. I built an open-source coding-agent runtime, then tested it against OpenCode on 89 Terminal-Bench tasks
3. Metis 1.1.0 scored 82.02% on our Terminal-Bench 2.1 run — looking for people to challenge the result

# Post

Full disclosure: I maintain Metis.

I kept wondering how much coding performance comes from the model, and how much comes from the agent wrapped around it. So I built Metis, an MIT-licensed coding-agent runtime for terminal and desktop.

I ran Metis 1.1.0 and OpenCode on the same 89 Terminal-Bench 2.1 tasks. Both runs used the same DeepSeek V4 Flash model and version, environment, task inputs, and budget. Only the agent framework changed.

- **OpenCode:** 60/89 solved — 67.42%
- **Metis:** 73/89 solved — 82.02%

That is 13 additional solved tasks, or a 14.60 percentage-point difference.

Metis is not another model. The main things I have been experimenting with are durable context and recovery, structured multi-agent execution, and making verification part of completion instead of stopping at a plausible answer.

I do not want to overstate one benchmark. This does not prove that Metis makes every model 21.7% better, and the comparison does not yet tell me which part of the harness caused the difference. I would rather have people reproduce it, inspect the failures, and find where the result breaks.

GitHub: https://github.com/Wholiver/metis

If this direction interests you, a star helps, but issues, PRs, and independent benchmark runs are more useful. What should I publish first to make the comparison easier to audit: exact configs, per-task traces, cost/token data, or feature ablations?

# Posting notes

- Use the `Promotional` flair.
- Attach `terminal-bench-2.1.jpg`.
- Recommended title: first title above. It is personal and evidence-led without claiming universal superiority.
- Stay available after posting. r/opensource explicitly discourages drive-by promotion.
- Before posting, verify every benchmark-condition statement and replace any phrasing that does not sound like you.

