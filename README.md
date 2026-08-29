<p align="center">
  <img src="docs/images/metis-readme-icon.png" width="144" alt="Metis app icon" />
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&amp;logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@wholiver_hu/metis"><img alt="npm version" src="https://img.shields.io/npm/v/%40wholiver_hu%2Fmetis?label=npm&amp;color=CB3837" /></a>
  <a href="https://github.com/Wholiver/metis/releases/latest"><img alt="latest GitHub release" src="https://img.shields.io/github/v/release/Wholiver/metis?label=release&amp;color=24292F" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.19.0 or newer" src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933?logo=nodedotjs&amp;logoColor=white" /></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4C1" /></a>
  <a href="https://www.orcarouter.ai/ref/ref_974aa3306181497b4cdc"><img alt="Powered by OrcaRouter" src="https://img.shields.io/badge/Powered_by-OrcaRouter-2563eb" /></a>
</p>

<p align="center">
  <strong>A coding agent that searches, remembers, executes, and verifies across terminal and desktop.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#benchmark--comparison">Benchmark & Comparison</a> ·
  <a href="#key-features">Key features</a> ·
  <a href="#documentation">Documentation</a>
</p>

## Quick start

### Desktop

Standalone application with built-in Metis CLI and Server runtime (no Node.js required):

- **macOS (Apple Silicon)**: Download `Metis-*-macos-arm64.dmg` from the [latest GitHub Release](https://github.com/Wholiver/metis/releases/latest) and drag to **Applications**.
- **Windows (x64)**: Download `Metis-*-win-x64-setup.exe` or `.zip` from the [latest GitHub Release](https://github.com/Wholiver/metis/releases/latest).

<details>
<summary><strong>CLI installation</strong></summary>

Requires Node.js `>=22.19.0`.

```bash
npm install -g @wholiver_hu/metis
metis
```

Run in any repository or directory:

```bash
metis "Explain this repository"
metis @src/main.ts "Review this file"
git diff | metis -p "Review this diff"
```

Use `/login` for subscription providers or configure an API key. See [Quickstart](docs/quickstart.md) for the complete guide.

</details>

## Benchmark & Comparison

### Terminal-Bench 2.1 Benchmark Results

In a controlled benchmark run using the same model (**DeepSeek V4 Flash**), same 89 real-world tasks, identical budget, and environment:

| Agent Framework | Model | Benchmark | Solved (Accuracy) | Architecture & Harness Advantage |
| :--- | :--- | :--- | :---: | :--- |
| **Metis** | DeepSeek V4 Flash | Terminal-Bench 2.1 (89 tasks) | **73 / 89 (82.02%)** | Recursive 5-role agents + SQLite memory + Plan/Build separation |
| **OpenCode** | DeepSeek V4 Flash | Terminal-Bench 2.1 (89 tasks) | 60 / 89 (67.42%) | Single-thread flat tool execution |
| *Improvement* | *Same Model & Budget* | *Same Environment* | **+14.6% (+13 tasks)** | *Harness, memory, and verification gates alone* |

### Feature Comparison Matrix

| Capability | Metis | Claude Code | OpenCode | Cursor / Cline |
| :--- | :---: | :---: | :---: | :---: |
| **License & Pricing** | **MIT ($0 Free)** | Proprietary / API costs | MIT ($0 Free) | Commercial / Freemium |
| **Model Freedom** | **Any Model / OpenAI Compat / OrcaRouter** | Anthropic Only | Multi-provider | Specific / BYOK |
| **User Interfaces** | **Dual: Terminal TUI + React Desktop (macOS/Win)** | Terminal Only | Terminal Only | IDE Plugin Only |
| **Workflow Separation** | **Strict Dual-Mode (Plan ↔ Build)** | Single Flow | Single Flow | Inline / Chat Flow |
| **Multi-Agent Architecture** | **Native Recursive L0→L4 (5 Named Roles + Worktrees)** | Subagents (Flat) | Limited | Single Agent |
| **Durable Memory** | **SQLite State + Vector Semantic Search** | Ephemeral | Ephemeral | Index / Embeddings |
| **Verification & Evidence** | **Automated Test Gates + Video Frame Inspection** | Manual Bash | Manual Bash | Manual Linter |
| **Headless Benchmark Ready** | **Python Adapter + JSONL Trace + POSIX Codes** | No Native Harness | Partial | None |

## Key Features

- **Plan & Build Dual Workflows** — Safely investigate in read-only Plan mode, then execute approved plans with a live-updating checklist in Build mode.
- **Dual Interface for Terminal & Desktop** — Work directly in your terminal via the rich interactive TUI, or use the dedicated React/Vite Desktop workspace on macOS and Windows.
- **Recursive Multi-Agent System** — Native named agents (`coordinator`, `planner`, `implementer`, `reviewer`, `verifier`) with L0→L4 recursive delegation and Git Worktree isolation.
- **Durable Memory & Resumable Sessions** — Project knowledge and decisions persist in SQLite across restarts, context compactions, and session forks.
- **Extensible & Model-Agnostic** — Use any LLM provider (OpenAI, Anthropic, DeepSeek, OrcaRouter, Gemini, Groq, Ollama, vLLM) and extend with TypeScript plugins, Agent Skills, and MCP.
- **Benchmark-Grade Reliability** — Automated verification gates, video evidence inspection, and full Terminal-Bench & Harbor evaluation readiness.

## Documentation

| Topic | Guide |
| --- | --- |
| Install, authenticate, and start | [Quickstart](docs/quickstart.md) |
| Commands and terminal UI | [Using Metis](docs/usage.md) · [TUI](docs/tui.md) |
| Providers and custom models | [Providers](docs/providers.md) · [Custom models](docs/models.md) · [Custom providers](docs/custom-provider.md) |
| Multi-Agent System | [Named Agents & Delegation](docs/agents.md) |
| Benchmark & Evaluation | [TerminalBench & Harbor](docs/terminalbench.md) |
| Sessions and compaction | [Sessions](docs/sessions.md) · [Compaction](docs/compaction.md) |
| Extensions, skills, and packages | [Extensions](docs/extensions.md) · [Skills](docs/skills.md) · [Packages](docs/packages.md) |
| Prompts and interface customization | [Prompt templates](docs/prompt-templates.md) · [Themes](docs/themes.md) · [Keybindings](docs/keybindings.md) |
| Programmatic integration | [SDK](docs/sdk.md) · [RPC](docs/rpc.md) · [JSON](docs/json.md) |
| Video inspection | [Video tool](docs/video.md) |
| Security and configuration | [Security](docs/security.md) · [Settings](docs/settings.md) |
| Platforms and isolation | [Windows](docs/windows.md) · [Termux](docs/termux.md) · [tmux](docs/tmux.md) · [Containers](docs/containerization.md) |

See the [documentation index](docs/index.md) for every guide.

<details>
<summary><strong>Developer information</strong></summary>

```bash
npm run build                 # Compile TypeScript and copy runtime assets
npm test                      # Run the Vitest suite
npm run clean                 # Remove compiled output
npm run build:binary          # Build the standalone binary
npm --prefix desktop run dev  # Start the React/Vite Desktop app in development
npm --prefix desktop run build # Build the renderer and Electron artifact
```

The package exports the Node.js SDK from `@wholiver_hu/metis` and the RPC entry point from `@wholiver_hu/metis/rpc-entry`.

</details>

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development, Extension and Package integration, testing, and AI-assisted contribution guidance.

## License

Distributed under the [MIT License](LICENSE).
