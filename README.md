<p align="center">
  <img src="docs/images/readme/en/banner.png" alt="Metis 2.0" />
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  Metis is an open-source coding agent that runs as a desktop app, in the terminal, or as a Skill, and every project can shape its own agent architecture.
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&amp;logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@wholiver_hu/metis"><img alt="npm version" src="https://img.shields.io/npm/v/%40wholiver_hu%2Fmetis?label=npm&amp;color=CB3837" /></a>
  <a href="https://github.com/Wholiver/metis/releases/latest"><img alt="latest GitHub release" src="https://img.shields.io/github/v/release/Wholiver/metis?label=release&amp;color=24292F" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.19.0 or newer" src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-339933?logo=nodedotjs&amp;logoColor=white" /></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4C1" /></a>
  <a href="https://siliconflow.cn"><img alt="Powered by 硅基流动" src="https://img.shields.io/badge/Powered_by-%E7%A1%85%E5%9F%BA%E6%B5%81%E5%8A%A8-2563eb" /></a>
</p>

<p align="center"><img src="docs/images/readme/en/sections/quickstart.png" alt="Quick start" width="100%"></p>

**Desktop (recommended):** download the installer from [GitHub Releases](https://github.com/Wholiver/metis/releases/latest): `.dmg` for macOS, `.exe` for Windows. The runtime is bundled, so you don't need Node.js.

**Terminal** (requires [Node.js 22.19.0 or newer](https://nodejs.org/)):

```bash
npm install -g @wholiver_hu/metis
```

**Skill:**

```bash
npm install -g metis-skill
metis-plugin install codex
```

For OpenCode or DeepSeek Harness, replace `codex` with `opencode` or `deepseek`. See the [Quickstart](docs/quickstart.md) for details.

## Desktop app

<img src="docs/images/readme/en/desktop.png" alt="Desktop app" />

Chat, routines, Git and your agent architecture, all in one window.

## Task tiers

<img src="docs/images/readme/en/tiers.png" alt="Task tiers" />

Just describe the task. Metis picks one of five tiers on its own, from quick questions to work that spans multiple interfaces.

## Roles

<img src="docs/images/readme/en/roles.png" alt="Roles" />

Planning, coding, code review and testing are each handled by a different role.

## Agent architecture editor

<img src="docs/images/readme/en/arch.png" alt="Agent architecture editor" />

The workflow is a graph you can edit. Each project keeps its own copy in `.metis/harness.json`.

## Git

<img src="docs/images/readme/en/git.png" alt="Git" />

Metis drafts your commit messages, and you can see every changed file at a glance.

## Terminal and Skill

<img src="docs/images/readme/en/terminal.png" alt="Terminal and Skill" />

Prefer the terminal? Use it there. You can also install it into Codex, OpenCode and DeepSeek Harness.

<p align="center"><img src="docs/images/readme/en/sections/partners.png" alt="Partners" width="100%"></p>

| Logo | Partner | Link |
| :---: | :--- | :--- |
| <img src="docs/images/siliconflow-logo.png" alt="SiliconFlow" height="36" /> | **SiliconFlow (硅基流动)** — China's leading independent ecosystem token supply platform, providing Metis with efficient and flexible model inference. | [siliconflow.cn](https://siliconflow.cn) |

<p align="center"><img src="docs/images/readme/en/sections/community.png" alt="Community" width="100%"></p>

<p align="center">
  <img src="docs/images/metis-community-qq.png" width="220" alt="Metis QQ group QR code" /><br />
  <strong>Metis Community (QQ): 801193315</strong>
</p>

Found a bug or have an idea? Open an [issue](https://github.com/Wholiver/metis/issues) or start a [discussion](https://github.com/Wholiver/metis/discussions).

<p align="center"><img src="docs/images/readme/en/sections/docs.png" alt="Documentation" width="100%"></p>

Every guide is listed in the [documentation index](docs/index.md). Start with the [Quickstart](docs/quickstart.md).

<p align="center"><img src="docs/images/readme/en/sections/contributing.png" alt="Contributing" width="100%"></p>

PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and testing.

Metis builds on [pi](https://github.com/earendil-works/pi) by Mario Zechner.

<p align="center"><img src="docs/images/readme/en/sections/license.png" alt="License" width="100%"></p>

[MIT](LICENSE)

This project supports the [LINUX DO](https://linux.do) community.
