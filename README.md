<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/modes/interactive/assets/metis-pixel-mark-white-on-black.png" />
    <img src="src/modes/interactive/assets/metis-pixel-mark.png" width="144" alt="Metis pixel mark" />
  </picture>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Help coding models write better code and finish faster with better context, reusable experience, and verified results.</strong>
</p>

<p align="center">
  <a href="#why-metis">Why Metis</a> ·
  <a href="#better-coding-performance">Coding performance</a> ·
  <a href="#what-makes-it-reliable">Reliability</a> ·
  <a href="#quick-start">Quick start</a>
</p>

---

## Quick start

Requires Node.js `>=22.19.0` and npm.

```bash
npm i -g @wholiver_hu/metis@rc
metis
```

To see available options:

```bash
metis --help
```

## Why Metis

Metis is an agent layer for coding models. It does not replace the model or change its weights. It improves the model's effective coding performance by giving it a better way to search, remember, work, and check its own result.

That means better repository understanding, fewer unsupported assumptions and missed requirements, stronger task completion, and less time spent repeating context.

### Better coding performance

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-coding-performance.dark.png" />
    <img src="docs/images/metis-coding-performance.png" width="100%" alt="How Metis helps the same coding model achieve better coding outcomes" />
  </picture>
</p>

For the same underlying model, Metis strengthens the system around it:

- **Relevant context** — search the repository and authoritative sources before editing.
- **Reusable experience** — carry useful decisions, lessons, and technical knowledge into later work.
- **Evidence-based implementation** — follow existing code, constraints, and project conventions instead of guessing.
- **Verified completion** — build, test, inspect output, and compare the result with the original request.

These mechanisms can improve practical coding outcomes without retraining or replacing the model. Results still depend on the model, task, tools, and environment.

### Faster completion

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-speed.dark.png" />
    <img src="docs/images/metis-speed.png" width="100%" alt="User test comparing Metis and OpenCode task completion time" />
  </picture>
</p>

In one user test with the same task:

- **Metis finished in 1 minute 30 seconds.**
- **OpenCode finished in 3 minutes 30 seconds.**
- No accuracy difference was observed in that test.

Metis used about 57% less time in this comparison. This is one user test, not a universal benchmark; results depend on the task, model, tools, and environment.

## What makes it reliable

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-capabilities.dark.png" />
    <img src="docs/images/metis-capabilities.png" width="100%" alt="Metis memory, Dream, search, and verification features" />
  </picture>
</p>

### Memory and Lessons

Metis checks its brain map before starting technical work. It can reuse relevant decisions, project knowledge, and technical lessons from earlier sessions instead of rediscovering them every time.

During long tasks, Metis keeps an append-only working log with compact checkpoints, diagnosed errors, verification state, and next steps. It restores the latest state after resume, interruption, or context compaction; Dream later consolidates the complete history.

### Dream

Dream reviews completed work and consolidates useful notes into structured memories and lessons. Temporary task context becomes reusable knowledge, while low-value details can be cleaned up.

### Search before action

Metis investigates before making changes. It searches the repository first and uses web research when needed to check authoritative documentation, known solutions, release notes, or security information.

### Logs and verification

Metis records meaningful errors and completion summaries. Before it says a task is finished, it compares the result with the user's original prompt and checks every requirement, constraint, and later clarification. It also runs relevant builds, tests, and functional checks when available.

Together, these behaviors help the same coding model work with better context, fewer assumptions, and a stronger completion loop.

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-workflow.dark.png" />
    <img src="docs/images/metis-workflow.png" width="100%" alt="Metis workflow: Understand, Build, Verify" />
  </picture>
</p>

1. **Understand** — read the request, recall relevant lessons, and investigate the codebase.
2. **Build** — make focused changes and keep a useful work record.
3. **Verify** — test the result and compare it with the original request.

<details>
<summary><strong>Developer information</strong></summary>

### Interfaces

Metis supports an interactive terminal, print and JSON output, RPC integration, a Desktop server, and an SDK for Node.js applications. Desktop uses the persistent local server; normal CLI/TUI commands continue to run directly.

The package exports the SDK from `@wholiver_hu/metis`, the RPC entry point from `@wholiver_hu/metis/rpc-entry`, and the server entry point from `@wholiver_hu/metis/server-entry`. See [Desktop Server](docs/server.md).

### Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript and copy runtime assets. |
| `npm test` | Run the Vitest test suite. |
| `npm run clean` | Remove compiled output. |
| `npm run build:binary` | Build the standalone binary. |

</details>

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for core development, Extension integration, Package distribution, testing, and AI-assisted contribution guidance.

## License

Distributed under the [MIT License](https://opensource.org/license/mit).
