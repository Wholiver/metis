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
  <a href="https://siliconflow.cn"><img alt="Powered by 硅基流动" src="https://img.shields.io/badge/Powered_by-%E7%A1%85%E5%9F%BA%E6%B5%81%E5%8A%A8-2563eb" /></a>
</p>

<p align="center">
  <strong>The self-adaptive coding agent with evidence-backed verification gates.</strong><br />
  <em>From terminal TUI to React desktop workspace — eliminating AI hallucinations with a 5-role recursive team and physical verification receipts.</em>
</p>

<p align="center">
  <a href="#why-metis">Why Metis</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#flagship-capabilities">Flagship Capabilities</a> ·
  <a href="#community--feedback">Community & Feedback</a> ·
  <a href="#partners">Partners</a> ·
  <a href="#documentation">Documentation</a>
</p>

## Why Metis?

Most AI coding assistants operate in a fragile loop: **single-thread chat → untested code edits → prematurely claiming "it is fixed" → forgetting everything next session**.

Metis replaces this with engineering-grade rigor:

```text
Typical Agent:  Ask ──> Blind write ──> Hallucinate fixes ──> Claim "done" without tests ──> Forgotten next time
Metis:          Read-only Plan ──> 5-Role Recursive Team (Git Worktrees) ──> G0-G7 Gate Receipts (Block Fake Done) ──> Evolve
```

1. **No False Completion (`FALSE_COMPLETION_BLOCKED`)**: Built-in G0–G7 verification state machine. Agents cannot declare victory without actual test outputs and exit-code-0 receipts.
2. **Autonomous Self-Learning**: Silently distills your code diffs, recurring pitfalls, and domain skills in the background. Transparent, revisable, and roll-backable.
3. **True Multi-Role Agent Team**: Dedicated roles (`coordinator`, `planner`, `implementer`, `reviewer`, `verifier`) isolated in clean Git Worktrees.
4. **Dual Interfaces, Zero Setup**: Lightweight terminal TUI and standalone React/Vite Desktop application with bundled runtimes (no Node.js required).

## Quick start

### Desktop

Standalone application with built-in Metis CLI and Server runtime (no Node.js required):

- **macOS (Apple Silicon)**: Download `Metis-*-macos-arm64.dmg` from the [latest GitHub Release](https://github.com/Wholiver/metis/releases/latest) and drag to **Applications**.
- **Windows (x64)**: Download `Metis-*-win-x64-setup.exe` or `.zip` from the [latest GitHub Release](https://github.com/Wholiver/metis/releases/latest).

<details>
<summary><strong>CLI installation (Node.js &gt;= 22.19.0)</strong></summary>

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

## Flagship Capabilities

### 1. 🛡️ Evidence-Backed G0–G7 Verification Gates
- **Eliminate AI Hallucinations**: Every task execution runs on an immutable performance state machine. Each milestone requires a structured governance receipt.
- **Strict Anti-Premature-Exit**: Even if an LLM outputs "all tests passed", Metis verifies the exit code, test stdout, and diff boundaries. If receipts are missing, `FALSE_COMPLETION_BLOCKED` intercepts the completion and forces repair.
- **Multimodal Proof**: Includes bundled ffmpeg/ffprobe video inspection and screenshot assertion tools to verify visual animations and interactive states objectively.

### 2. 🧠 Autonomous Self-Learning Closed Loop
- **Zero-Token Implicit Learning**: Learns your coding style, conventions, and recurring project architecture without nagging or tedious prompt injection.
- **Local Profile & Skill Distillation**: Stored safely on disk under `~/.metis/agent/adaptations/`. Metis automatically creates, tests, and decays custom skills.
- **Auditable & Reversible**: Review learned behaviors directly in the desktop settings panel, with complete history and one-click rollback.

### 3. 👥 Recursive 5-Role Multi-Agent Architecture
- **Purpose-Built Roles**: `coordinator` oversees strategy, `planner` computes roadmaps, `implementer` writes minimal diffs, `reviewer` conducts peer review, and `verifier` runs automated proof.
- **Physical Git Worktree Isolation**: Subagents run inside temporary worktrees, preventing simultaneous edits from corrupting your branch.
- **Bound Recursion Depth (L0→L4)**: Strict budget, spawn depth, and timeout enforcement avoid runaway token burns.

### 4. ⚡ Plan ↔ Build Dual Workflow & Total Ecosystem Freedom
- **Read-Only Plan Mode**: Deep codebase exploration and risk assessment with guaranteed zero writes.
- **Dynamic Build Mode**: Live interactive checklists that adapt as subtasks complete.
- **Universal Model Compatibility**: Bring any provider (OpenAI, Anthropic, DeepSeek, Gemini, Groq, Ollama, vLLM, OrcaRouter), plus full support for TypeScript extensions, Agent Skills, and MCP.

<details>
<summary><strong>Benchmark &amp; Comparison Matrix</strong></summary>

### Terminal-Bench 2.1 Benchmark Results

In a controlled benchmark run using the same model (**DeepSeek V4 Flash**), same 89 real-world tasks, identical budget, and environment:

| Agent Framework | Model | Benchmark | Solved (Accuracy) | Architecture & Harness Advantage |
| :--- | :--- | :--- | :---: | :--- |
| 🏆 **Metis** | DeepSeek V4 Flash | Terminal-Bench 2.1 (89 tasks) | **73 / 89 (82.02%)** | ✅ Recursive 5-role agents + Self-learning adaptations + Plan/Build |
| **OpenCode** | DeepSeek V4 Flash | Terminal-Bench 2.1 (89 tasks) | 60 / 89 (67.42%) | ⚠️ Single-thread flat tool execution |
| 📈 *Improvement* | *Same Model & Budget* | *Same Environment* | **+14.6% (+13 tasks)** | 🚀 *Harness, adaptations, and verification gates alone* |

### Feature Comparison Matrix

| Capability | Metis | Claude Code | OpenCode | Cursor / Cline |
| :--- | :---: | :---: | :---: | :---: |
| **License & Pricing** | ✅ **MIT ($0 Free)** | ❌ Proprietary | ✅ MIT ($0 Free) | ⚠️ Commercial |
| **Model Freedom** | ✅ **Any Model / OrcaRouter** | ❌ Anthropic Only | ✅ Multi-Provider | ⚠️ Limited / BYOK |
| **User Interfaces** | ✅ **TUI + React Desktop** | ⚠️ Terminal Only | ⚠️ Terminal Only | ⚠️ IDE Only |
| **Workflow Mode** | ✅ **Plan ↔ Build Dual-Mode** | ⚠️ Single Flow | ⚠️ Single Flow | ⚠️ Chat / Inline |
| **Multi-Agent System** | ✅ **Recursive L0→L4 (5 Roles)** | ⚠️ Flat Subagents | ⚠️ Basic | ❌ None |
| **Self-Learning Adaptations** | ✅ **Filesystem Profile & Workflow Evolution** | ❌ Ephemeral | ❌ Ephemeral | ⚠️ Code Embeddings |
| **Verification Gates** | ✅ **Test Gates + Video Evidence** | ⚠️ Manual Bash | ⚠️ Manual Bash | ⚠️ Basic Linter |
| **Headless Benchmark** | ✅ **Python Adapter + Trace** | ❌ None | ⚠️ Partial | ❌ None |

</details>

## Partners

| Logo | Partner | Link |
| :---: | :--- | :--- |
| <img src="docs/images/siliconflow-logo.png" alt="SiliconFlow" height="36" /> | **SiliconFlow (硅基流动)** — China's leading independent ecosystem token supply platform, providing Metis with efficient and flexible model inference. | [siliconflow.cn](https://siliconflow.cn) |

## Documentation

| Topic | Guide |
| --- | --- |
| Install, authenticate, and start | [Quickstart](docs/quickstart.md) |
| Commands and terminal UI | [Using Metis](docs/usage.md) · [TUI](docs/tui.md) |
| Autonomous Self-Learning | [Autonomous Self-Learning](docs/self-learning.md) |
| Multi-Agent System | [Named Agents & Delegation](docs/agents.md) |
| Benchmark & Evaluation | [TerminalBench & Harbor](docs/terminalbench.md) |
| Providers and custom models | [Providers](docs/providers.md) · [Use SiliconFlow in Metis](docs/use-siliconcloud-in-metis.md) · [Custom models](docs/models.md) · [Custom providers](docs/custom-provider.md) |
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

## Community & Feedback

Join the Metis developer community! Whether discussing use cases, reporting bugs, proposing new features, or sharing multi-agent ideas, everyone is welcome:

<p align="center">
  <img src="docs/images/metis-community-qq.png" width="220" alt="Metis QQ Group" /><br />
  <strong>Metis Community Group (QQ): 801193315</strong>
</p>

- 🐛 **Bug Reports & Feature Requests**: Open an issue on [GitHub Issues](https://github.com/Wholiver/metis/issues).
- 💡 **Discussions & Ideas**: Join conversations on [GitHub Discussions](https://github.com/Wholiver/metis/discussions).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development, Extension and Package integration, testing, and AI-assisted contribution guidance.

## Acknowledgements

Metis builds upon and is inspired by [pi](https://github.com/earendil-works/pi) by Mario Zechner.

## License

Distributed under the [MIT License](LICENSE).

本项目认可 [LINUX DO](https://linux.do) 社区。
