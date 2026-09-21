# 在 Metis 中使用 SiliconFlow

> 结合 SiliconFlow 高速、OpenAI 兼容的模型推理，在 Metis 的终端 TUI 与桌面端中使用硅基流动大模型。

## Metis 简介

**Metis** 是贯穿终端与桌面的开源编程 Agent（MIT），面向「搜索、记忆、执行、验证」全链路。同一模型下，它通过 harness 与工作流把模型的编程完成率明显抬高：在 Terminal-Bench 2.1（DeepSeek V4 Flash、89 题）上达到 **82.02%**，相对同模型同预算的 OpenCode（67.42%）约 **+14.6%**。

核心能力包括：

- **提升模型编程能力** — Plan / Build 双工作流、递归多智能体（coordinator / planner / implementer / reviewer / verifier）与验证门禁，让同一 SiliconFlow 模型在真实仓库任务上更稳、更完整。
- **长期记忆** — SQLite 持久记忆 + 向量检索，跨会话保留项目经验与决策结论，不因压缩或重启丢失上下文。
- **终端 + 桌面** — 交互式 TUI 与 React 桌面端共用同一套 Agent 运行时；支持任意 OpenAI 兼容端点，可直接接入硅基流动。

已内置硅基流动国内站 Provider，通过 OpenAI 兼容接口调用平台上的大模型。

| Provider | 显示名称 | 站点 | Base URL | 环境变量 | `auth.json` 键 |
| --- | --- | --- | --- | --- | --- |
| `siliconflow-cn` | SiliconFlow (China) | [硅基流动](https://www.siliconflow.cn) | `https://api.siliconflow.cn/v1` | `SILICONFLOW_CN_API_KEY` | `siliconflow-cn` |

> 💡 Metis 通过内置的 OpenAI Chat Completions 客户端（`openai` SDK）调用 SiliconFlow，无需再安装单独的 SiliconFlow SDK。

## 1. 安装 Metis

### 桌面版

内置独立运行时，无需另行安装 Node.js：

- **macOS（Apple 芯片）**：从 [GitHub Releases](https://github.com/Wholiver/metis/releases/latest) 下载 `Metis-*-macos-arm64.dmg`，将 **Metis.app** 拖入「应用程序」。
- **Windows（x64）**：下载 `Metis-*-win-x64-setup.exe` 或 `.zip`。

### CLI

需要 Node.js `>=22.19.0`：

```bash
npm install -g @wholiver_hu/metis
metis
```

## 2. 获取 SiliconFlow API Key

1. 打开 [硅基流动](https://cloud.siliconflow.cn) 并注册 / 登录。
2. 完成实名认证。
3. 进入 [API 密钥](https://cloud.siliconflow.cn/account/ak) 页面。
4. 创建新密钥并妥善保存。

> 💡 通过官网注册并完成实名认证，通常可获得可用于平台内模型的体验额度。

## 3. 在 Metis 中配置 SiliconFlow

### 3.1 桌面端（推荐）

1. 打开 Metis Desktop。
2. 进入 **Settings → Models & Providers**（模型与服务商），点击 **Add model**（添加模型）。
3. 在连接向导中选择 **SiliconFlow (China)**。
4. 粘贴第 2 步获得的 API Key，点击 Continue。
5. 在模型步骤中可「自动获取模型」或手动填写模型 ID；也可留空直接 Submit，仅使用内置目录。
6. 在聊天页模型下拉中选择例如 `deepseek-ai/DeepSeek-V4-Flash`。

首次启动也可以在 Onboarding 的 **API Key** 页选择 `siliconflow-cn` 并填入密钥。

### 3.2 终端 TUI

启动 Metis 后执行 `/login`：

1. 选择 **Use an API key**。
2. 选择 **SiliconFlow (China)**。
3. 粘贴 API Key。

密钥写入 `~/.metis/agent/auth.json`。然后用 `/model`（或 Ctrl+L）选择模型。

### 3.3 环境变量

适合 CLI、脚本和无头评测：

```bash
export SILICONFLOW_CN_API_KEY=sk-xxxxxxxxxxxx
metis --provider siliconflow-cn --model deepseek-ai/DeepSeek-V4-Flash
```

### 3.4 验证配置

在项目目录启动 Metis，发送：

```text
请简要介绍当前仓库，并说明如何运行测试。
```

若 Agent 能正常回复并开始读文件，说明配置成功。无头模式可以这样确认：

```bash
metis -p --provider siliconflow-cn --model deepseek-ai/DeepSeek-V4-Flash "Reply with the word pong."
```

## 4. 使用 SiliconFlow 模型

内置目录面向编程 Agent，模型 ID 使用 SiliconFlow 的 `org/model` 格式（Pro 线路带 `Pro/` 前缀）。当前默认模型：

`deepseek-ai/DeepSeek-V4-Flash`

常用模型还包括：

| 模型 ID | 说明 |
| --- | --- |
| `deepseek-ai/DeepSeek-V4-Flash` | 默认识别 / 编码模型，适合日常 Agent 任务 |
| `Pro/deepseek-ai/DeepSeek-V4-Flash` | Pro 线路 |
| `deepseek-ai/DeepSeek-V4-Pro` | 更强推理 |
| `Pro/moonshotai/Kimi-K2.6` | Kimi 编程向模型 |
| `moonshotai/Kimi-K2.7-Code` | Kimi Code |
| `zai-org/GLM-5.2` | GLM 编码 / Agent |
| `Qwen/Qwen3-Coder-480B-A35B-Instruct` | Qwen Coder |

完整清单以 [模型广场](https://cloud.siliconflow.cn/models) 为准。平台新增模型后，可在 `/login` 里继续用同一 Provider，或把新 ID 写入 `~/.metis/agent/models.json`。

### 4.1 切换模型

- **桌面端**：聊天页顶部模型选择器。
- **TUI**：`/model` 或 Ctrl+L。
- **CLI**：`--provider siliconflow-cn --model <id>`，也支持 `siliconflow-cn/deepseek-ai/DeepSeek-V4-Flash`。

### 4.2 推理模型

SiliconFlow 的思考模型通过模型 ID 选择，而不是额外的 `reasoning_effort` 开关。Metis 会按模型 ID 匹配内置能力目录（例如 DeepSeek V4、Kimi K2、GLM-5.x），并在支持时显示思考等级。流式响应中的 `reasoning_content` 会进入 Metis 的思考块。

### 4.3 无头 / 一次性任务

```bash
metis -p --provider siliconflow-cn --model deepseek-ai/DeepSeek-V4-Flash "Summarize this repository"
git diff | metis -p --provider siliconflow-cn --model deepseek-ai/DeepSeek-V4-Flash "Review this diff"
```

## 5. 配置参考

`~/.metis/agent/auth.json`：

```json
{
  "siliconflow-cn": { "type": "api_key", "key": "sk-xxxxxxxxxxxx" }
}
```

如需覆盖端点或追加模型，编辑 `~/.metis/agent/models.json`：

```json
{
  "providers": {
    "siliconflow-cn": {
      "baseUrl": "https://api.siliconflow.cn/v1",
      "apiKey": "$SILICONFLOW_CN_API_KEY",
      "api": "openai-completions",
      "models": [
        { "id": "deepseek-ai/DeepSeek-V4-Flash" }
      ]
    }
  }
}
```

默认模型可写在 `~/.metis/agent/settings.json`：

```json
{
  "defaultProvider": "siliconflow-cn",
  "defaultModel": "deepseek-ai/DeepSeek-V4-Flash"
}
```

相关文档：[Providers](providers.md) · [Custom models](models.md) · [Quickstart](quickstart.md)
