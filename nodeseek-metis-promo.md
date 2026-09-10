# 推荐标题

Metis 1.1.0：DeepSeek V4 Flash 在 Terminal-Bench 2.1 跑到 82.02%，接近 Fable 5 的 83.8% 档位

# 正文

最近用开源 Agent 框架 Metis 1.1.0 跑了一轮 Terminal-Bench 2.1，结果比我预期的更有意思。

这次固定了模型、版本、89 个任务、运行环境和预算，只更换 Agent 框架：

- **Metis + DeepSeek V4 Flash：73/89，82.02%**
- **OpenCode + DeepSeek V4 Flash：60/89，67.42%**
- Metis 多完成 **13 个任务**，高出 **14.60 个百分点**

作为参照，Terminal-Bench 2.1 官方榜单里的 **Claude Code + Claude 5 Fable** 成绩是 **83.8%**。Metis + DeepSeek V4 Flash 的 82.02% 与它相差 1.78 个百分点，已经进入同一个 80%+ 分数段。

需要说明：这不是同一份官方榜单提交的直接排名。83.8% 来自官方榜单，82.02% 是我们的受控自测结果，所以这里主要用来观察 Agent 框架对同一模型表现的影响，不宣称 DeepSeek V4 Flash 已经等同或超过 Fable 5。

Metis 目前主要做了这些事情：

- Plan / Build 分离，先规划再执行
- SQLite 持久记忆，减少长任务中的上下文丢失
- 支持递归子 Agent，把复杂任务拆成可检查的子任务
- 加入验证门，尽量避免“代码写完就宣布完成”
- 同时提供终端和 macOS 桌面端

项目采用 MIT 协议，完全开源，目前没有收费计划。

GitHub：<https://github.com/Wholiver/metis>

CLI 安装：

```bash
npm install -g @wholiver_hu/metis
```

接下来准备继续补充完整运行轨迹、Token / 成本对比和功能消融测试。大家更想先看哪一项？也欢迎直接挑测试口径或实现上的问题。

# 配图建议

首图使用 `terminal-bench-2.1.jpg`；第二张放 macOS 界面 `330_1x_shots_so.png`。

# 备选标题

1. 只换 Agent 框架：DeepSeek V4 Flash 的 Terminal-Bench 2.1 从 67.42% 跑到 82.02%
2. DeepSeek V4 Flash + Metis 跑出 82.02%，距离 Fable 5 官方成绩只差 1.78 个百分点
3. 开源 Agent 框架 Metis：同一个 DeepSeek 模型，多完成了 13 个 Terminal-Bench 任务

# 数据口径

- Terminal-Bench 2.1 共 89 个任务。
- Metis 与 OpenCode 对比固定模型、模型版本、任务、环境和预算。
- Fable 5 的 83.8% 对应官方榜单中的 Claude Code scaffold，不应表述为裸模型成绩。
