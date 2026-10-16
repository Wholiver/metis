<p align="center">
  <img src="docs/images/readme/zh/banner.png" alt="Metis 2.0" />
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

<p align="center">
  Metis 是一个开源编程 Agent，有桌面版、终端版和 Skill 版，每个项目都能按自己的需要定制 Agent 架构。
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&amp;logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@wholiver_hu/metis"><img alt="npm version" src="https://img.shields.io/npm/v/%40wholiver_hu%2Fmetis?label=npm&amp;color=CB3837" /></a>
  <a href="https://github.com/Wholiver/metis/releases/latest"><img alt="latest GitHub release" src="https://img.shields.io/github/v/release/Wholiver/metis?label=release&amp;color=24292F" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.19.0 or newer" src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933?logo=nodedotjs&amp;logoColor=white" /></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4C1" /></a>
  <a href="https://siliconflow.cn"><img alt="Powered by 硅基流动" src="https://img.shields.io/badge/Powered_by-%E7%A1%85%E5%9F%BA%E6%B5%81%E5%8A%A8-2563eb" /></a>
</p>

## 桌面版

<img src="docs/images/readme/zh/desktop.png" alt="桌面版" />

对话、例行任务、Git 管理、Agent 架构都在同一个窗口里。

## 任务档位

<img src="docs/images/readme/zh/tiers.png" alt="任务档位" />

你只管说任务，它自己判断走哪一档，从日常问答到跨界面协同分五档。

## 角色分工

<img src="docs/images/readme/zh/roles.png" alt="角色分工" />

规划、写代码、审代码、跑测试，分别由不同的角色来做。

## Agent 架构编辑

<img src="docs/images/readme/zh/arch.png" alt="Agent 架构编辑" />

干活的流程是一张可以改的图，每个项目单独存一套，保存在 `.metis/harness.json`。

## Git 管理

<img src="docs/images/readme/zh/git.png" alt="Git 管理" />

提交说明它帮你写，改了哪些文件一眼就能看到。

## 终端和 Skill

<img src="docs/images/readme/zh/terminal.png" alt="终端和 Skill" />

不想开桌面版就在终端里用，也能装进 Codex、OpenCode 和 DeepSeek Harness。

## 快速开始

**桌面版（推荐）**：到 [GitHub Releases](https://github.com/Wholiver/metis/releases/latest) 下载安装包，macOS 选 `.dmg`，Windows 选 `.exe`。桌面版自带运行环境，不用另装 Node.js。

**终端版**（需要 [Node.js 22.19.0 或更新版本](https://nodejs.org/)）：

```bash
npm install -g @wholiver_hu/metis
```

**Skill 版**：

```bash
npm install -g metis-skill
metis-plugin install codex
```

想装进 OpenCode 或 DeepSeek Harness，把最后的 `codex` 换成 `opencode` 或 `deepseek`。更多说明见 [Quickstart](docs/quickstart.md)。

## 合作伙伴

| 商标 | 合作方 | 链接 |
| :---: | :--- | :--- |
| <img src="docs/images/siliconflow-logo.png" alt="SiliconFlow" height="36" /> | **SiliconFlow (硅基流动)** — China's leading independent ecosystem token supply platform, providing Metis with efficient and flexible model inference. | [siliconflow.cn](https://siliconflow.cn) |

## 交流群

<p align="center">
  <img src="docs/images/metis-community-qq.png" width="220" alt="Metis 交流群二维码" /><br />
  <strong>Metis 交流群（QQ）801193315</strong>
</p>

遇到问题或有新想法，也可以到 [Issues](https://github.com/Wholiver/metis/issues) 或 [Discussions](https://github.com/Wholiver/metis/discussions) 留言。

## 文档

所有使用说明都在 [文档目录](docs/index.md)，从 [Quickstart](docs/quickstart.md) 开始看就行。

## 参与贡献

欢迎提 PR，开发和测试方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

Metis 基于 Mario Zechner 的 [pi](https://github.com/earendil-works/pi) 开发，感谢原作者。

## License

[MIT](LICENSE)

本项目认可 [LINUX DO](https://linux.do) 社区。
