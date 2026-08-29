<p align="center">
  <img src="docs/images/metis-readme-icon.png" width="144" alt="Metis 应用图标" />
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&amp;logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@wholiver_hu/metis"><img alt="npm 版本" src="https://img.shields.io/npm/v/%40wholiver_hu%2Fmetis?label=npm&amp;color=CB3837" /></a>
  <a href="https://github.com/Wholiver/metis/releases/latest"><img alt="最新 GitHub Release" src="https://img.shields.io/github/v/release/Wholiver/metis?label=release&amp;color=24292F" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.19.0 或更高版本" src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933?logo=nodedotjs&amp;logoColor=white" /></a>
  <a href="#许可证"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4C1" /></a>
  <a href="https://www.orcarouter.ai/ref/ref_974aa3306181497b4cdc"><img alt="Powered by OrcaRouter" src="https://img.shields.io/badge/Powered_by-OrcaRouter-2563eb" /></a>
</p>

<p align="center">
  <strong>贯穿终端与桌面的编程 Agent：搜索、记忆、执行、验证。</strong>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#基准评测与主流-agent-对比">基准评测与对比</a> ·
  <a href="#核心特性">核心特性</a> ·
  <a href="#文档">文档</a>
</p>

## 快速开始

### 桌面版

内置独立运行时与 Metis CLI / Server，无需另行安装 Node.js：

- **macOS（Apple 芯片）**：从[最新 GitHub Release](https://github.com/Wholiver/metis/releases/latest) 下载 `Metis-*-macos-arm64.dmg`，将 **Metis.app** 拖入**应用程序**。
- **Windows（x64）**：从[最新 GitHub Release](https://github.com/Wholiver/metis/releases/latest) 下载 `Metis-*-win-x64-setup.exe` 安装包或 `.zip` 解压使用。

<details>
<summary><strong>CLI 安装</strong></summary>

需要 Node.js `>=22.19.0`。

```bash
npm install -g @wholiver_hu/metis
metis
```

在任意项目目录中直接运行：

```bash
metis "解释这个代码仓库"
metis @src/main.ts "检查这个文件"
git diff | metis -p "审查这个 diff"
```

支持的订阅 Provider 可通过 `/login` 登录，也可配置 API Key。完整使用指南见[快速入门](docs/quickstart.md)。

</details>

## 基准评测与主流 Agent 对比

### Terminal-Bench 2.1 实测对比

在相同模型（**DeepSeek V4 Flash**）、相同 89 个真实编程任务、相同成本预算与执行环境下进行严格对比测试：

| Agent 框架 | 评测模型 | 评测基准 | 解决率 (准确率) | 架构与 Harness 核心优势 |
| :--- | :--- | :--- | :---: | :--- |
| **Metis** | DeepSeek V4 Flash | Terminal-Bench 2.1 (89 任务) | **73 / 89 (82.02%)** | 递归 5 角色多智能体 + SQLite 持久记忆 + Plan/Build 严格分离 |
| **OpenCode** | DeepSeek V4 Flash | Terminal-Bench 2.1 (89 任务) | 60 / 89 (67.42%) | 单线程扁平工具执行流 |
| *提升幅度* | *同等模型与预算* | *完全一致的执行环境* | **+14.6% (+13 项任务)** | *纯 Agent Harness、记忆与验证门禁带来的性能跃升* |

### 全维度特性对比矩阵

| 核心能力 | Metis | Claude Code | OpenCode | Cursor / Cline |
| :--- | :---: | :---: | :---: | :---: |
| **开源许可与费用** | **MIT ($0 完全免费)** | 闭源商业 / API 计费 | MIT ($0 免费) | 商业软件 / 增值订阅 |
| **模型生态自由度** | **任意模型 / OpenAI 兼容 / OrcaRouter / 本地** | 仅限 Anthropic | 多 Provider 支持 | 指定模型 / BYOK |
| **客户端界面** | **双端：终端 TUI + React 原生桌面端 (macOS/Win)** | 仅终端 CLI | 仅终端 CLI | 仅 IDE 插件 |
| **工作流控制** | **严格双模式（Plan 规划 ↔ Build 构建）** | 单一线性流 | 单一线性流 | 行内补全 / 侧边对话 |
| **多智能体架构** | **原生递归 L0→L4（5 具名角色 + Worktree 隔离）** | 简单子 Agent (扁平) | 基础支持 | 单 Agent 运行 |
| **持久记忆系统** | **SQLite 状态库 + 向量语义检索** | 仅当前上下文 | 仅当前上下文 | 静态代码索引 / Embeddings |
| **验证与证据门禁** | **自动化测试验证 + 视频逐帧证据检查** | 依赖手工 Bash | 依赖手工 Bash | 依赖基础 Linter |
| **无头基准评测** | **内置 Python 适配器 + JSONL 全链路 Trace + 标准退出码** | 无原生评测套件 | 部分支持 | 无 |

## 核心特性

- **Plan 与 Build 双工作流** — 在只读 Plan 模式中安全调查并生成方案；在 Build 模式下按已确认方案与动态清单可靠执行。
- **终端 TUI 与桌面端双界面** — 既可在终端使用交互式全功能 TUI，也可在 macOS 和 Windows 上使用基于 React/Vite 的可视化桌面工作区。
- **原生命名递归多智能体体系** — 内置具名 Agent 角色（`coordinator`、`planner`、`implementer`、`reviewer`、`verifier`），支持 L0→L4 递归委派与 Git Worktree 隔离。
- **持久记忆与会话恢复** — 跨重载、上下文压缩与分支操作，在 SQLite 中持久保留项目经验与决策结论。
- **全模型自由与高可扩展性** — 支持 OpenAI、Anthropic、DeepSeek、OrcaRouter、Gemini、Groq、Ollama 等任意端点，支持 TypeScript 插件、Agent Skills 与 MCP。
- **评测级可靠性与验证门禁** — 自动化验证检查、视频证据分析，全面适配 Terminal-Bench 2.1 与 Harbor 自动化评测。

## 文档

| 主题 | 指南 |
| --- | --- |
| 安装、认证与首次运行 | [快速入门](docs/quickstart.md) |
| 命令与终端界面 | [使用 Metis](docs/usage.md) · [TUI](docs/tui.md) |
| Provider 与自定义模型 | [Providers](docs/providers.md) · [Custom models](docs/models.md) · [Custom providers](docs/custom-provider.md) |
| 具名多智能体体系 | [多智能体与递归委派](docs/agents.md) |
| 基准评测与无头模式 | [TerminalBench 与 Harbor 适配](docs/terminalbench.md) |
| 会话与上下文压缩 | [Sessions](docs/sessions.md) · [Compaction](docs/compaction.md) |
| Extensions、Skills 与 Packages | [Extensions](docs/extensions.md) · [Skills](docs/skills.md) · [Packages](docs/packages.md) |
| Prompt 与界面定制 | [Prompt templates](docs/prompt-templates.md) · [Themes](docs/themes.md) · [Keybindings](docs/keybindings.md) |
| 程序化集成 | [SDK](docs/sdk.md) · [RPC](docs/rpc.md) · [JSON](docs/json.md) |
| 视频检查 | [Video tool](docs/video.md) |
| 安全与配置 | [Security](docs/security.md) · [Settings](docs/settings.md) |
| 平台与隔离 | [Windows](docs/windows.md) · [Termux](docs/termux.md) · [tmux](docs/tmux.md) · [Containers](docs/containerization.md) |

全部指南见[文档索引](docs/index.md)。

<details>
<summary><strong>开发者信息</strong></summary>

```bash
npm run build                 # 编译 TypeScript 并复制运行时资源
npm test                      # 运行 Vitest 测试套件
npm run clean                 # 删除编译输出
npm run build:binary          # 构建独立二进制文件
npm --prefix desktop run dev  # 启动 React/Vite Desktop 开发环境
npm --prefix desktop run build # 构建 Renderer 与 Electron Artifact
```

软件包从 `@wholiver_hu/metis` 导出 Node.js SDK，并从 `@wholiver_hu/metis/rpc-entry` 导出 RPC 入口。

</details>

## 参与贡献

欢迎参与 Metis 开发。开发流程、Extension 与 Package 接入、测试及 AI 辅助贡献说明见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## 许可证

本项目使用 [MIT License](LICENSE)。
