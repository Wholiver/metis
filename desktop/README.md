# Metis Desktop

Electron 框架，连接 Metis Server。开发模式使用仓库中的 CLI；安装包内置完整 CLI/Server，无需用户预装 Node.js 或 Metis CLI。

修改 Desktop 前端前，必须先阅读 [`../docs/desktop-frontend-development.md`](../docs/desktop-frontend-development.md)。其中包含真实加载链、渲染生命周期、CSS 层叠、构建产物和验证要求。

```bash
cd desktop
npm install
npm run dev
```

`npm run dev` 和 `npm start` 会先构建仓库 CLI，再启动 Desktop；无需另行执行根目录构建命令。

Desktop 启动时会检查 `http://127.0.0.1:4096`：已有 Metis Server 时直接复用，否则自动启动仓库中已构建的 CLI Server，并在应用退出时关闭自己启动的进程。设置 `METIS_DESKTOP_NO_AUTO_SERVER=1` 可关闭自动启动。项目信任检查保持启用。

Desktop 与 CLI 共用 `~/.metis/agent` 下的模型、Provider、会话及其他配置。安装包版本优先启动 App Resources 内置 CLI，因此可开箱即用。

## macOS DMG

在 Apple Silicon 或 Intel Mac 上执行：

```bash
cd desktop
npm install
npm run package:mac
```

产物写入 `desktop/release/`。DMG 包含 `Metis.app`、`Applications` 快捷方式，以及 `打不开？/Mac打不开时请看.txt`。当前流程只做 ad-hoc 本地签名，不做 Apple Developer ID 签名或公证。

## Windows ZIP

在 Windows（x64 或 arm64）上执行：

```bash
cd desktop
npm install
npm run package:win
```

产物写入 `desktop/release/`。ZIP 包含 `Metis/`（含 `Metis.exe` 与内置 CLI）以及 `Help/Windows-Open-Issue.txt`。当前流程不做 Windows 代码签名；SmartScreen 可能提示未知发布者。

## Windows NSIS 安装程序（.exe）

在 Windows（x64 或 arm64）上执行：

```bash
cd desktop
npm install
npm run package:win:installer
```

产物写入 `desktop/release/`，文件名类似 `Metis-<version>-win-<arch>-setup.exe`。安装目录默认为 `%LOCALAPPDATA%\\Metis`，并创建开始菜单、桌面快捷方式与卸载入口。若系统未安装 NSIS，请先安装并确保 `makensis` 可用（或安装 npm 包 `nsis`）。

接口协议见 [`../src/modes/server/README.md`](../src/modes/server/README.md)。

安全边界：renderer 无 Node 权限；文件访问限定当前工作区；Browser 使用隔离 webview；Metis HTTP/SSE 请求由主进程代理。

## 已接入功能

- Server：连接、断线状态、SSE 运行事件
- 会话：读取当前会话和历史消息、新建、切换
- Agent：发送 Prompt、生成中追加消息、停止生成
- 模型：读取 Server 可用模型、切换当前模型、按模型能力选择思考等级
- 工作区：添加并持久化多个独立项目、按项目隔离会话、切换 Agent 工作目录、文件树、筛选、Git Diff、在文件管理器中定位
- Browser：地址导航、前进、后退、刷新、系统浏览器打开

界面只展示以上已实现入口。附件、权限模式、PR、站点、定时任务、插件等未接入能力不放置占位按钮。
