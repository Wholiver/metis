# r/saasbuild — Metis launch post

## Recommended title

**I changed the agent—not the model—and beat OpenCode 82.02% to 67.42% on Terminal-Bench**

## Post body

Most coding-agent launches focus on the model. I wanted to test how much the agent harness itself matters.

So I ran Metis 1.1.0 against OpenCode on Terminal-Bench 2.1 with the same DeepSeek V4 Flash model, model version, 89 tasks, environment, and budget. Only the agent framework changed.

- OpenCode: **60/89 solved (67.42%)**
- Metis: **73/89 solved (82.02%)**
- Difference: **13 more tasks solved, +14.60 percentage points**

Metis is the coding-agent runtime I have been building as a solo developer. Its current design combines durable memory, separate Plan/Build modes, recursive agents, recoverable sessions, and verification gates. This benchmark does not isolate each feature, but it convinced me that better orchestration can materially improve the same underlying model.

Metis is fully open source under MIT, free now and free forever—no paid tier planned. It works in the terminal and has a Mac desktop app.

GitHub: https://github.com/Wholiver/metis

I would value blunt feedback on the benchmark. What should I publish next: full run traces, a cost/token comparison, or feature ablations?

## Alternate high-click titles

1. **Same DeepSeek model. Same budget. Metis beat OpenCode 82.02% to 67.42%.**
2. **OpenCode solved 60/89. My open-source agent solved 73/89—with the exact same model.**
3. **The model wasn't the bottleneck: one agent framework scored 82.02%, the other 67.42%**
4. **I stopped chasing better models—and got 13 more Terminal-Bench tasks solved**

## Posting notes

- Attach `terminal-bench-2.1.jpg` immediately after the result bullets.
- Use **SaaS Journey** flair if available; otherwise **SaaS Promote**.
- Keep founder disclosure in the post: “the coding-agent runtime I have been building as a solo developer.”
- Community rules allow promotion when paired with concrete learning; this draft leads with method, result, and lessons instead of only a link.
