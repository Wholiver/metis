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

选择适合当前工作方式的界面。两种方式共用同一套 Metis 配置、模型和会话。

### macOS 桌面应用

桌面应用提供图形化工作区，并内置完整的 Metis CLI 与 Server 运行环境。

> **当前安装包：** 适用于 Apple 芯片（`arm64`）Mac，无需另行安装 Node.js。

1. 从 [GitHub Releases](https://github.com/Wholiver/metis/releases/latest) 下载最新的 `Metis-*-macos-arm64.dmg`。
2. 打开安装包，将 **Metis.app** 拖入 **应用程序 (Applications)** 文件夹。
3. 从“应用程序”文件夹启动 **Metis**。

### Windows 桌面应用

Windows 版同样内置完整的 Metis CLI 与 Server 运行环境，解压即可使用。

> **当前安装包：** 适用于 Windows `x64` 或 `arm64`，无需另行安装 Node.js。

1. 从 [GitHub Releases](https://github.com/Wholiver/metis/releases/latest) 下载最新的 `Metis-*-win-x64.zip` 或 `Metis-*-win-arm64.zip`（按你的系统架构选择）。
2. 解压 ZIP，进入 **Metis** 文件夹，双击 **Metis.exe** 启动。
3. 若 Windows SmartScreen 提示“未知发布者”，请查看压缩包内 **Help/Windows-Open-Issue.txt**。

### CLI 与命令行

CLI 适合终端工作流、脚本、Print/JSON 输出、RPC 与 SDK 集成。

> **运行要求：** Node.js `>=22.19.0` 和 `npm`。

1. 全局安装最新版本：

   ```bash
   npm install -g @wholiver_hu/metis@latest
   ```

2. 启动交互式会话：

   ```bash
   metis
   ```

3. 查看全部命令行选项：

   ```bash
   metis --help
   ```

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
    <img src="docs/images/metis-capabilities.zh-CN.png" width="100%" alt="Metis 的记忆、Dream、搜索和验证能力" />
  </picture>
</p>

### Memory 与 Lessons

Metis 会在开始技术任务前检查自己的知识地图。它可以复用之前会话中的相关决策、项目知识和技术经验，不必每次都从头发现。

长任务执行期间，Metis 会在追加式工作日志中保存精简 checkpoint、已诊断错误、验证状态和下一步。恢复会话、中断继续或上下文压缩后，它会重新载入最新状态；Dream 随后仍会整理完整历史。

### Dream

Dream 会整理已完成的工作，把有价值的记录归纳为结构化记忆和技术经验。临时任务上下文能够转化为可复用知识，低价值细节则可以被清理。

### 先搜索，再行动

Metis 会先调查，再修改。它先搜索代码仓库，并在需要时通过 Web 搜索核对权威文档、已知解决方案、版本说明或安全信息。

### 日志与验证

Metis 会记录有意义的错误和任务完成摘要。在宣布完成之前，它会把结果与用户最初的 Prompt 对比，逐项检查要求、限制条件和后续补充；如果项目提供构建、测试或功能检查，也会运行相关验证。

这些机制让同一个编程模型获得更完整的上下文、更少的假设，以及更可靠的任务闭环，从而提升实际编码表现。

## 工作方式

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/metis-workflow.zh-CN.dark.png" />
    <img src="docs/images/metis-workflow.zh-CN.png" width="100%" alt="Metis 工作流：理解、执行、验证" />
  </picture>
</p>

1. **理解** — 阅读需求、回忆相关经验，并调查代码仓库。
2. **执行** — 进行聚焦修改，同时保留有用的工作记录。
3. **验证** — 测试结果，并与用户最初的要求进行对比。

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
