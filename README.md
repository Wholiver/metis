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
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&amp;logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@wholiver_hu/metis"><img alt="npm version" src="https://img.shields.io/npm/v/%40wholiver_hu%2Fmetis?label=npm&amp;color=CB3837" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.19.0 or newer" src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933?logo=nodedotjs&amp;logoColor=white" /></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4C1" /></a>
</p>

<p align="center">
  <strong>A coding agent that searches, remembers, executes, and verifies across terminal and desktop.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#highlights">Highlights</a> ·
  <a href="#how-metis-works">How it works</a> ·
  <a href="#documentation">Documentation</a>
</p>

---

<p align="center">
  <img src="docs/images/metis-desktop.png" width="100%" alt="Metis Desktop workspace" />
</p>

## Quick start

### Desktop installation

Desktop includes the Metis CLI and Server runtime; Node.js is not required separately.

| Platform | Build | Install |
| --- | --- | --- |
| macOS | Apple silicon (`arm64`) | Download `Metis-*-macos-arm64.dmg`, then drag **Metis.app** to **Applications**. |
| Windows | `x64` | Run `Metis-*-win-x64-setup.exe`, or extract `Metis-*-win-x64.zip` and launch **Metis.exe**. |

Download files and matching `.sha256` checksums from the [latest GitHub Release](https://github.com/Wholiver/metis/releases/latest). If Windows SmartScreen reports an unknown publisher, continue only when the file came from the official release page and its checksum matches.

<details>
<summary><strong>CLI installation</strong></summary>

Requires Node.js `>=22.19.0` and npm.

```bash
npm install -g --ignore-scripts @wholiver_hu/metis@latest
metis
```

Use `/login` for supported subscription providers, or configure an API key. Run `metis --help` for CLI options and see the [Quickstart](docs/quickstart.md) for the complete first-run flow.

</details>

## Highlights

- **Plan and Build workflows** — investigate safely in read-only Plan mode, then execute an approved proposal with a persistent checklist in Build mode.
- **Durable memory and recovery** — search reusable project knowledge and resume work after interruption, compaction, or session reload.
- **Flexible models and authentication** — use built-in subscription login, API-key providers, or custom OpenAI-compatible providers with model discovery.
- **Desktop workspace** — attach images, videos, text, and other files through the picker, clipboard, or drag and drop; manage providers and sessions graphically.
- **Video evidence** — inspect local video through metadata, timestamped storyboards, ordered motion samples, high-resolution frames, subtitles, and local transcription.
- **Extensible core** — add TypeScript extensions, Agent Skills, prompt templates, themes, and Metis packages; integrate through print, JSON, RPC, Server, or the Node.js SDK.
- **Verified execution** — coordinate subagents, preserve tool-result ordering, run relevant checks, and compare delivery against the original request.

## How Metis works

1. **Ground** — load trusted instructions and relevant context, then search code, memory, or authoritative sources when needed.
2. **Plan or build** — Plan mode stays read-only and produces a durable proposal; Build mode performs evidence-supported changes.
3. **Persist** — retain sessions, message/tool pairs, workflow checkpoints, plans, and compacted context.
4. **Verify** — run risk-proportionate checks and report completed requirements, evidence, and remaining risk.

<details>
<summary><strong>Technical design</strong></summary>

### Deterministic workflow runtime

Metis freezes a `StepSnapshot` before every model sample. Model, reasoning level, collaboration mode, instructions, messages, visible tools, dispatcher, and context window therefore remain consistent for that step. Safe reads may run in parallel; writes and mixed tools are serialized. Steering and follow-ups are applied only after current tool results persist.

### Plans and interactive input

New interactive and Desktop sessions start in Plan mode. `/mode plan` and `/mode build` switch workflows when idle. Approved proposals survive reload and compaction through `read_plan`; Build checklists update in place in TUI and Desktop. Interactive hosts can answer `ask_user`, while unattended print/JSON and SDK runs return a recoverable unsupported result instead of hanging.

### Memory

Metis checkpoints active work after prompts, completed steps, compaction, errors, aborts, and completion. Durable records and their search index live in `~/.metis/memories/state.sqlite`. `query_memory_db` is available on demand in Plan and Build; results are advisory and never override current instructions.

Use `/memory status|on|off|run|search|forget|reset`. Proposal artifacts and long-term memory remain separate, so an unexecuted draft is not promoted automatically.

</details>

<details>
<summary><strong>Performance example</strong></summary>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-speed.dark.png" />
    <img src="docs/images/metis-speed.png" width="100%" alt="User test comparing Metis and OpenCode task completion time" />
  </picture>
</p>

In one user test on the same task, Metis finished in 1 minute 30 seconds and OpenCode in 3 minutes 30 seconds, with no observed accuracy difference. This single comparison is not a universal benchmark; results depend on the task, model, tools, and environment.

</details>

## Documentation

| Topic | Guide |
| --- | --- |
| Install, authenticate, and start | [Quickstart](docs/quickstart.md) |
| Commands and interactive usage | [Using Metis](docs/usage.md) |
| Providers and custom models | [Providers](docs/providers.md) · [Custom models](docs/models.md) |
| Sessions and compaction | [Sessions](docs/sessions.md) · [Compaction](docs/compaction.md) |
| Extensions, skills, and packages | [Extensions](docs/extensions.md) · [Skills](docs/skills.md) · [Packages](docs/packages.md) |
| Programmatic integration | [SDK](docs/sdk.md) · [RPC](docs/rpc.md) · [JSON](docs/json.md) |
| Video inspection | [Video tool](docs/video.md) |
| Security and configuration | [Security](docs/security.md) · [Settings](docs/settings.md) |

See the [documentation index](docs/index.md) for every guide.

<details>
<summary><strong>Developer information</strong></summary>

```bash
npm run build                 # Compile TypeScript and copy runtime assets
npm test                      # Run the Vitest suite
npm run clean                 # Remove compiled output
npm run build:binary          # Build the standalone binary
```

The package exports the Node.js SDK from `@wholiver_hu/metis` and the RPC entry point from `@wholiver_hu/metis/rpc-entry`.

</details>

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development, Extension and Package integration, testing, and AI-assisted contribution guidance.

## License

Distributed under the [MIT License](https://opensource.org/license/mit).
