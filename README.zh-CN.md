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
</p>

<p align="center">
  <strong>贯穿终端与桌面的编程 Agent：搜索、记忆、执行、验证。</strong>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#主要能力">主要能力</a> ·
  <a href="#工作方式">工作方式</a> ·
  <a href="#文档">文档</a>
</p>

## 快速开始

### 桌面版安装

桌面版已内置 Metis CLI 与 Server 运行环境，无需另行安装 Node.js。

| 平台 | 架构 | 安装方式 |
| --- | --- | --- |
| macOS | Apple 芯片（`arm64`） | 下载 `Metis-*-macos-arm64.dmg`，再将 **Metis.app** 拖入**应用程序**。 |
| Windows | `x64` | 运行 `Metis-*-win-x64-setup.exe`；或解压 `Metis-*-win-x64.zip` 后启动 **Metis.exe**。 |

安装包及对应 `.sha256` 校验文件见[最新 GitHub Release](https://github.com/Wholiver/metis/releases/latest)。当前 macOS 构建仅使用 ad-hoc 签名且未经 Apple 公证，Windows 构建也未进行代码签名。若 Gatekeeper 或 SmartScreen 提示“未知开发者/发布者”，仅在文件来自官方 Release 页面且校验值一致时继续。

<details>
<summary><strong>CLI 安装</strong></summary>

需要 Node.js `>=22.19.0` 与 npm。

```bash
npm install -g --ignore-scripts @wholiver_hu/metis@latest
metis
```

支持的订阅 Provider 可通过 `/login` 登录，也可配置 API Key。运行 `metis --help` 查看全部命令行选项；完整首次使用流程见[快速入门](docs/quickstart.md)。

```bash
metis "解释这个代码仓库"
metis @src/main.ts "检查这个文件"
git diff | metis -p "审查这个 diff"
```

</details>

## 主要能力

- **Plan 与 Build 工作流** — 在只读 Plan 模式中安全调查，再由 Build 模式按已确认方案执行，并持久保存检查清单。
- **面向 macOS 与 Windows 的 React 桌面端** — 在基于 Vite 的工作区中管理对话、计划、交互提问、文件与媒体附件、模型、Provider、会话及 Subagent 活动。
- **持久记忆与恢复** — 检索可复用的项目知识；中断、上下文压缩或会话重载后继续工作。
- **可分支会话** — 恢复和命名会话、浏览对话树、Fork 或 Clone 分支、压缩长上下文，并导入或导出 JSONL/HTML 记录。
- **灵活的模型与认证** — 使用内置订阅登录、API Key Provider，或带模型发现能力的自定义 OpenAI 兼容 Provider。
- **原生命名递归多智能体体系** — 内置具名 Agent 角色（`coordinator`、`planner`、`implementer`、`reviewer`、`verifier`），支持 L0→L4 递归委派、角色工具白名单、可选 Git Worktree 隔离与生命周期控制。
- **交互与自动化运行模式** — 使用终端 TUI 交互，或通过 Print、JSONL、RPC、Server 和 Node.js SDK 无人值守运行。
- **TerminalBench 与 Harbor 评测就绪** — 无头机器可读 JSONL 执行、标准退出码（`0`/`1`/`2`）、最终回答文件隔离、全链路 Trace/Token/Cost 聚合以及内置 Python Harness 适配器。
- **性能工作流** — 针对实现、调试、评审、重构、研究与文档任务选择专用框架，采用自适应 T0–T3 层级、独立评审与证据门禁。
- **视频证据** — 通过元数据、时间戳故事板、有序运动样本、高清帧、字幕与本地转录检查视频。
- **可扩展核心** — 加载 TypeScript Extensions、Agent Skills、Prompt Templates、Themes 与 Metis Packages，并注册自定义工具、命令、Provider、UI 与生命周期 Hooks。
- **明确的信任模型** — 项目级设置与资源必须经过信任确认；Metis 不内置操作系统级沙箱，需要更强隔离时可按文档使用 Docker、OpenShell 或 Gondolin。
- **经过验证的执行** — 协调 Subagents、保持工具结果顺序、运行相关检查，并逐项对照原始要求交付。

## 工作方式

1. **建立依据** — 加载可信指令与相关上下文，按需搜索代码、记忆或权威资料。
2. **规划或执行** — Plan 只读调查并生成持久方案；Build 只进行证据支持的修改。
3. **保存状态** — 保留会话、消息/工具配对、工作流检查点、计划与压缩后的上下文。
4. **验证结果** — 按风险运行检查，报告已完成要求、证据与剩余风险。

<details>
<summary><strong>技术设计</strong></summary>

### 确定性工作流运行时

每次模型采样前，Metis 都会冻结 `StepSnapshot`。模型、思考等级、协作模式、指令、消息、可见工具、Dispatcher 与上下文窗口在当前 Step 内保持一致。安全只读工具可并发运行；写入及混合工具串行运行。Steering 和 Follow-up 仅在当前工具结果持久化后生效。

### 计划与交互输入

新的交互式会话和 Desktop 会话默认进入 Plan。空闲时可用 `/mode plan` 与 `/mode build` 切换工作流。已确认方案通过 `read_plan` 跨重载和压缩保存；Build 清单在 TUI 与 Desktop 中原位更新。交互式 Host 可回答 `ask_user`；无人值守的 Print/JSON 与 SDK 运行会返回可恢复的 unsupported 结果，不会挂起。

### 记忆

Metis 会在 Prompt、完整 Step、上下文压缩、错误、中止及完成后自动保存活跃工作。持久记录和检索索引位于 `~/.metis/memories/state.sqlite`。Plan 与 Build 均可按需调用 `query_memory_db`；搜索结果只作为建议性证据，不能覆盖当前指令。

使用 `/memory status|on|off|run|search|forget|reset`。方案 Artifact 与长期记忆彼此独立，未执行草案不会自动进入长期记忆。

</details>

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

本项目使用 [MIT License](https://opensource.org/license/mit)。
