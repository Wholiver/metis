<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/modes/interactive/assets/metis-pixel-mark-white-on-black.png" />
    <img src="src/modes/interactive/assets/metis-pixel-mark.png" width="144" alt="Metis 像素标志" />
  </picture>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&amp;logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@wholiver_hu/metis"><img alt="npm 版本" src="https://img.shields.io/npm/v/%40wholiver_hu%2Fmetis?label=npm&amp;color=CB3837" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.19.0 或更高版本" src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933?logo=nodedotjs&amp;logoColor=white" /></a>
  <a href="#许可证"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4C1" /></a>
</p>

<p align="center">
  <strong>通过更完整的上下文、可复用经验和结果验证，让编程模型写得更好、完成得更快。</strong>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#为什么选择-metis">为什么选择 Metis</a> ·
  <a href="#提升编程表现">编程表现</a> ·
  <a href="#它为什么更可靠">可靠性</a>
</p>

---

## 快速开始

选择一种界面即可。两种方式共用同一套 Metis 配置、模型和会话。

| 界面 | 适合场景 | 运行要求 |
| --- | --- | --- |
| **桌面应用** | 图形化工作区，内置 CLI 与 Server | Apple 芯片（`arm64`）Mac 或 Windows（`x64`） |
| **CLI** | 终端、脚本、Print/JSON、RPC 与 SDK 集成 | Node.js `>=22.19.0` 和 `npm` |

### macOS 桌面应用

1. [下载最新版 Apple 芯片 `.dmg`](https://github.com/Wholiver/metis/releases/latest)（`Metis-*-macos-arm64.dmg`）。
2. 打开安装包，将 **Metis.app** 拖入 **应用程序 (Applications)** 文件夹。
3. 启动 **Metis**。Node.js 已包含在应用中。

### Windows 桌面应用

Windows 版同样内置完整的 Metis CLI 与 Server 运行环境。可选择安装版 EXE，也可选择免安装 ZIP。

> **当前版本：** 支持 Windows `x64`，无需另行安装 Node.js。

1. 打开[最新 GitHub Release](https://github.com/Wholiver/metis/releases/latest)。
2. 下载并运行 `Metis-*-win-x64-setup.exe`；或下载 `Metis-*-win-x64.zip`，解压后进入 **Metis** 文件夹，双击 **Metis.exe**。
3. 使用附带的 `.sha256` 文件校验下载内容。若 Windows SmartScreen 提示“未知发布者”，仅在文件来自官方 Release 页面时继续运行。

### CLI 与命令行

安装 Metis，然后启动交互式会话：

```bash
npm install -g --ignore-scripts @wholiver_hu/metis@latest
metis
```

运行 `metis --help` 查看全部命令行选项。

## 为什么选择 Metis

Metis 是面向编程模型的 Agent 工作层。它不替换模型，也不修改模型权重，而是通过更好的搜索、记忆、执行和自检方式，提升模型的实际编程表现。

这意味着更深入地理解代码仓库、更少无依据的假设和需求遗漏、更可靠的任务闭环，以及更少重复上下文所消耗的时间。

### 提升编程表现

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-coding-performance.zh-CN.dark.png" />
    <img src="docs/images/metis-coding-performance.zh-CN.png" width="100%" alt="Metis 如何帮助同一个编程模型获得更好的编程结果" />
  </picture>
</p>

对于同一个底层模型，Metis 会强化模型周围的工作系统：

- **相关上下文** — 修改前搜索代码仓库与权威资料。
- **可复用经验** — 将有价值的决策、Lessons 和技术知识带入后续任务。
- **基于证据的实现** — 遵循现有代码、约束和项目约定，而不是凭空猜测。
- **经过验证的完成** — 构建、测试、检查输出，并对照用户原始要求确认结果。

这些机制无需重新训练或替换模型，就能提升实际编码结果。最终效果仍取决于模型、任务、工具和运行环境。

### 更快完成

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-speed.zh-CN.dark.png" />
    <img src="docs/images/metis-speed.zh-CN.png" width="100%" alt="Metis 与 OpenCode 的用户实测任务完成时间对比" />
  </picture>
</p>

在一次使用相同任务的用户实测中：

- **Metis 用时 1 分 30 秒。**
- **OpenCode 用时 3 分 30 秒。**
- 该次测试中没有观察到准确率差异。

在这次对比中，Metis 使用的时间减少了约 57%。这只是一次用户测试，并非通用基准；实际结果会受到任务、模型、工具和运行环境影响。

## 它为什么更可靠

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-capabilities.zh-CN.dark.png" />
    <img src="docs/images/metis-capabilities.zh-CN.png" width="100%" alt="Metis 的工作流、记忆、搜索和验证能力" />
  </picture>
</p>

### 确定性工作流运行时

每次模型采样前，Metis 都会冻结 `StepSnapshot`：模型、思考等级、Build/Plan 模式、指令栈、消息、可见工具、dispatcher 与上下文窗口。工具调用始终绑定到声明它的 snapshot；模型、工具、扩展、指令或模式变化只会在下一 step 生效。

本地 dispatcher 会并发运行明确安全的只读工具，并串行运行 write/mixed 工具。Steering 只会在当前工具结果持久化后消费；follow-up 必须等待本轮其它工作结束。这样可在重试、压缩、中止和恢复时保持 assistant/tool-result 配对完整。

### Build 与 Plan

CLI、TUI 和 Desktop 的新会话默认进入 Plan；恢复、切换和 fork 的旧会话保留已保存模式，显式选择 Build 优先。SDK 为兼容性保留现有默认值，调用方可传入 `collaborationMode`。Build 拥有已配置工具和用户正常权限；非简单任务会在修改前初始化 `update_plan`，保持一个活跃步骤，并持续更新到验证完成。Build 也会在关键工具批次前后使用用户语言输出简短普通进度文字。

Plan 是只读协作模式，不是 OS 沙箱。它会隐藏并硬拒绝 write、mixed、shell、edit、未分类工具以及 `update_plan`；先调查可发现事实，通过 `ask_user` 询问无法从仓库推导的关键偏好，最后输出决策完整的 `<proposed_plan>`。最新版 proposal 是分支级持久 artifact，重载或上下文压缩后模型仍可用 `read_plan` 读取全文。切回 Build 会恢复保存的 Build 工具集。Desktop 会把最新 proposal 显示为紧凑、可展开的预览；点击 **Process** 会先读取最新版，再切换到 Build 实施和验证。

CLI 使用 `/mode build` 或 `/mode plan`；Desktop 在模型选择器旁提供同一套仅空闲时可切换的选项。Desktop 收到 `ask_user` 后会用单个问题替换输入框，逐题确认，提交或取消后恢复编辑器。TUI 会隐藏 proposal 协议标签，预览最多显示 12 个源文本行，并在空闲 composer 中提供终端原生的 **Process** 与 **提交更改**。Process 会先读取持久 proposal 与当前执行进度，再在使用其他工具前创建 Build 清单。CLI、Desktop、JSON、RPC、Server 与 SDK 共享模式、context window、计划和指令来源状态。TUI、Desktop 或配置了 handler 的 SDK 可回答 `ask_user`；print/JSON 与无人值守 SDK 会立即返回可恢复的 unsupported 结果，不会挂起。

### 执行计划

Build 会保存绑定当前任务的结构化执行 checklist，最多一个 `in_progress`。Desktop 与 TUI 都会在 composer 上方持续显示一张“执行计划”界面并原位更新，因此工具运行、中止、上下文压缩和会话恢复后仍可查看进度。Process 开始时先显示“读取方案”和“建立清单”状态；Runtime 会在 `read_plan`、随后 `update_plan` 成功前阻止任何其他工具。该界面只显示执行状态和清单项；完整已确认 proposal 仍可通过对话预览和 `read_plan` 读取。原始 `update_plan` 工具卡会隐藏，避免重复显示。已完成清单会在后续独立 Build Prompt 开始时清除，中止任务仍可继续。`read_plan` 同时返回最新版 proposal 和当前执行清单。

### 记忆

Metis 会在 prompt、完整 step、压缩、错误、中止和完成后自动写入活跃任务 checkpoint；不要求模型调用记忆工具，也不增加前台模型轮次。

持久记忆协调器将任务、记录、来源和检索索引保存在 `~/.metis/memories/state.sqlite`，并生成可检查的 `MEMORY.md`、项目视图和摘要索引。全局偏好、项目知识和 checkout 路径事实彼此隔离。Plan 与 Build 都向模型提供 `search_memory`：模型按需主动搜索、改写查询并可不限次数继续搜索；Runtime 不再对每个 Prompt 自动检索和注入。搜索结果只是建议性证据，不能覆盖当前用户要求或 developer/AGENTS 指令。

后台提取只开放 `search_memory`，Metis 不再额外设置输出 Token 上限或搜索轮数上限。支持 reasoning 的模型使用 `low`，不支持的模型完全省略 reasoning 参数。Provider/模型自身限制、中止、超时、单次搜索结果量和每 checkpoint 最多 6 条候选仍然生效。

使用 `/memory status|on|off|run|search|forget|reset`；`reset` 必须明确确认。`/memory status` 和 Desktop 会说明零记录原因、pending/eligible 时间、最近处理与新增数量、模型失败和 fallback 状态。proposal artifact 与长期 Memory 相互独立，未执行草案不会自动进入长期记忆。旧 Dream 扩展、brain map 与 `.temp` 记忆日志已移除。

### 先搜索，再行动

Metis 会先调查，再修改。它先搜索代码仓库，并在需要时通过 Web 搜索核对权威文档、已知解决方案、版本说明或安全信息。

### 日志与验证

Metis 会自动记录有意义的错误和任务完成摘要。在宣布完成之前，它会把结果与用户最初的 Prompt 对比，逐项检查要求、限制条件和后续补充；如果项目提供构建、测试或功能检查，也会运行相关验证。

这些机制让同一个编程模型获得更完整的上下文、更少的假设，以及更可靠的任务闭环，从而提升实际编码表现。

## 工作方式

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-workflow.zh-CN.dark.png" />
    <img src="docs/images/metis-workflow.zh-CN.png" width="100%" alt="Metis 工作流：理解、执行、验证" />
  </picture>
</p>

1. **冻结上下文** — 组合可信 base/developer 指令、不可信运行时 context、相关建议性记忆和真实用户要求。
2. **调查或构建** — Plan 只读调查并提出方案；Build 只基于证据修改。
3. **持久化与恢复** — 保存消息/工具配对、workflow checkpoint、结构化计划和压缩摘要。
4. **验证与交付** — 按风险运行检查、报告证据，并说明剩余风险。

<details>
<summary><strong>开发者信息</strong></summary>

### 接口

Metis 支持交互式终端、Print 和 JSON 输出、RPC 集成，以及面向 Node.js 应用的 SDK。

软件包从 `@wholiver_hu/metis` 导出 SDK，并从 `@wholiver_hu/metis/rpc-entry` 导出 RPC 入口。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 编译 TypeScript 并复制运行时资源。 |
| `npm test` | 运行 Vitest 测试。 |
| `npm run clean` | 删除编译输出。 |
| `npm run build:binary` | 构建独立二进制文件。 |

</details>

## 参与贡献

欢迎参与 Metis 开发。核心功能开发、Extension 接入、Package 分发、测试与 AI 辅助开发说明见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## 许可证

本项目使用 [MIT License](https://opensource.org/license/mit)。
