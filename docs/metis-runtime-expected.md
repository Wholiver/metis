# Metis 原版与 Skill 正常运行时应该长什么样

给后续实现和对照验收用。这里只写轨迹，不写某一句用户请求。实现和验收都按所有权形状套用，不要把某次会话里的产物、文件名或旁白当成规则。

Skill 文案在 [`agents/codex/skills/metis/SKILL.md`](../agents/codex/skills/metis/SKILL.md)。原版运行时在 `src/core/performance-runtime.ts`、`src/core/system-prompt.ts`、`src/core/tools/spawn_agent.ts`、`desktop/browser-host.cjs`。

两边要达成的结果相同：交付物就是用户要的那个东西；作者先在产物上验证并修好；然后由另一个角色评审、再由另一个角色核验。作者不能给自己盖评审门和核验门。

---

## 1. 分级（两边相同）

只按所有权形状分级。步数、文件数、仓库大小、失败过一次、模型觉得难、或想多派几个 agent，都不升档。

| 形状 | 级别 | 谁做实现 |
| --- | --- | --- |
| 问候、解释、只读 | 对话 | 直接回答。不 admit、不 spawn、不写治理文件 |
| 改动已经写死（冻结 diff 或逐条命令），没有设计 | T0 + `apply` | 根会话。零 spawn |
| 恰好一个所有权表面 | T1 | 根会话。框架按工作种类选，不按「要生成一个文件」选 `generation` |
| 至少两个表面，必须串行（共享可变状态、路径重叠、有先后依赖） | T2 | 串行 implementer。一条 lane 永远不是 T2 |
| 至少两个表面，路径两两不相交、没有共享可变状态、可以并行 | T3 | 并行 implementer。做不到不相交就降回 T2 |

框架由工作种类决定（新界面、修缺陷、文档、后端实现等），选完就固定。不要在执行中途因为产物是某种文件而改级别。

开场必须先记下三件事，再改交付物：

```text
Route: T0 | T1 | T2 | T3
Framework: <按工作种类>
Gates: <该级别的门禁序列>
```

| 级别 | 门禁序列 |
| --- | --- |
| T0 | G4（证据写在 G4 receipt 里；跳过 G5/G6/G7/goal-check） |
| T1 | G4 → G5 → G6（跳过 G7、sweep、goal-check） |
| T2 | G2 →（仅真有设计分叉才有 G1）→ 各 lane 的 G4 → G5 → G6 → 一个 G7 → goal-check |
| T3 | G2 → 各 lane 的 G4 → 集成后的 G5 → G6 → sweep → goal-check |
| 缺陷修复 | 在所选级别的 G4 之前插入 G0 → G1 → G3.5 |

---

## 2. 两边共用的产物环

实现者（T0/T1 是根会话，T2/T3 是该 lane 的 implementer）停在交付物上，直到该 lane 的验证通过：

```text
改交付物
  -> 跑该 lane 声明的验证
  -> 看失败点或渲染结果里具体哪里不对
  -> 只改那一处
  -> 再验证
  -> 通过后才关闭这一道实现门
```

验证方式跟着框架走，不要换成另一套：

- 行为/代码框架：跑声明的测试或命令，看退出码和输出。
- 视觉/结构框架：渲染交付物并查看，再按看到的问题改。结构合法（能解析）只是其中一项，不是看过渲染的替代。
- 文档框架：对照真实代码核对说法，不发明覆盖率。

正常修改是对着失败证据改局部。整文件反复重写、旁白只说「更好」，而没有指出验证里哪里错，不算产物环。

预览或验证失败时留在同一交付物上重试。不要为此新建包装页、复制一份新文件、或改去写说明文档。不要把用户要的应用、界面或功能换成一篇文章。

---

## 3. Skill 正常轨迹

宿主是 Codex，或其它显式装了 Metis skill 的宿主。只有 `$metis` / `[$metis]` / `@metis`，或 `metis-plugin activate`，才进入这条轨迹。普通写代码请求不激活 skill。`/metis` 不是激活方式。

### 3.1 开场

1. 用宿主计划工具记下 Route、Framework、Gates。没有计划工具就用 Markdown 清单。
2. 这条记录出现之前，不写交付物。
3. 然后按第 2 节进入产物环。不要先巡视空目录、读一份不存在的计划、再绕治理文件。

对用户可见的中间文用用户的语言，一两句说清在改什么、验证里哪里不对。不要每步都说「正在…」「我将…」。

### 3.2 谁关哪一道门

- **T0**：根会话做完产物环，把验证证据放进 G4，自己关闭 G4。不 spawn。
- **T1**：根会话做完产物环并关闭 G4。然后 spawn `metis-reviewer`（G5），再 spawn `metis-verifier`（G6）。不 spawn planner、depth-prober、implementer。没有陪审，没有 goal-check。
- **T2**：根会话自己执行 G2 并写下 receipt。实现按依赖串行 spawn implementer。之后 G5、G6、一个 juror、一个 goal-checker。只在真有设计分叉时 spawn planner。不 spawn scope-coordinator。
- **T3**：根会话自己执行 G2。并行 spawn 的 implementer 必须是真实目录、路径两两不重叠。重叠或共享可变状态则降为 T2。集成后 G5、G6、一个 sweeper。不 spawn planner、juror、goal-checker；goal-check 由根会话做。
- **缺陷修复**：G4 之前插入 G0、G1、G3.5。T1 和 T3 上这三道由根会话关闭（对应角色不在 spawn 允许列表里）。T2 上 G3.5 spawn depth-prober；G6 之后加一个 juror 和一个 goal-checker。

子代理只输出一行 ChildResult JSON 后退出。它不调用 `performance_gate`，也不再 spawn。编排者根据 ChildResult 记下该门。根会话不把验收门记成自己的通过，也不另写一份验收 receipt 再自己盖章。

评审和核验看的是交付物，以及一次新的渲染或命令输出。没有 git diff 不等于没有改动。ChildResult 的 status、findings 必须和结论一致。

同一道门最多修两次。失败指纹是 `门:失败码:目标文件`。指纹重复则停在 `BLOCKED`，不要换一种说法再试。

### 3.3 Skill 上不该出现的东西

- 没记下路由就改交付物。
- 单表面任务走出 T2/T3、ROADMAP 或 L0–L4 编队。
- 作者给自己盖 G5/G6。
- 门禁被拒后去读 Metis 源码，或去搜自己的 session。
- 验证失败后离开交付物，去新建包装物或改写用户请求。

---

## 4. 原版正常轨迹

宿主是 Metis Desktop / CLI。Build 模式。工具是 `performance_admit`、`performance_gate`、`spawn_agent`、以及该任务用得到的验证工具（浏览器只在需要看渲染时使用）。

### 4.1 开场

1. 只读查看可以发生在 admit 之前。
2. 第一次写文件、跑会改东西的命令、spawn、改计划、或会改页面的浏览器操作之前，调用一次 `performance_admit`。
3. 准入结果就是第 1 节的 Route / Framework / 起始门。Admit 之后立刻进入产物环。
4. 计划如果存在，步骤是交付物上的工作，不是「写凭证、推进门禁」这种离开产物的清单。

### 4.2 谁关哪一道门

- **T0 / T1 的实现门**：根会话走完产物环，写一张 receipt 到该 run 的治理目录 `artifacts/`，再 `performance_gate`。证据路径是相对治理根的，例如 `artifacts/g4-receipt.json`，不是用户仓库里的 `./artifacts/`。T0 到此结束。T1 的根会话只关 G4。
- **T1 的 G5 / G6**：frontier 为 `G4-assurance` 后，spawn reviewer，再 spawn verifier。子代理不调用 `performance_gate`。Host 用子代理的 `agentId` 和角色写 receipt 并记账。工具结果里带上新 frontier 和唯一的下一步。
- **T2**：spawn 串行 implementer，一次一个。Host 记下该 lane 的 G4，再记 G5、G6、一个 G7、goal-check。根会话可以自己接受 G2。根会话不给 G4/G5/G6/G7/goal-check 盖章。
- **T3**：spawn 并行、工作树隔离的 implementer。每条 lane 的 G4 由 host 记账，全部完成才进入 `G4-assurance`。然后 reviewer、verifier、一个 sweeper，都由 host 记账。goal-checker 不在 T3 的 spawn 列表里时，goal-check 由根会话在 sweep 通过后关闭。根会话仍然不能给 G4/G5/G6 盖章。

根会话若对一道应由子代理关闭的门调用 `performance_gate`，必须被拒绝。拒绝文案指向工具结果里的下一步（通常是 spawn 对应角色，或 host 已经记下）。不要读 Metis 源码，不要搜当前 session。

需要看渲染时用内置浏览器打开交付物本身并截图。独立文档型矢量图可以按内容裁剪，裁剪矩形必须在视口内。裁剪失败或超时后，不裁剪再截一次。超时文案说明这是截图超时，并要求重新打开同一交付物后再试；文案里不能出现 “aborted”。两次都失败仍留在原交付物上，不新建包装页。

### 4.3 原版 host 自动记账的门

`G0`、`G1`、`G1-review`、`G1-verify`、`G2-review`、`G2-verify`、`G3.5`、`G4`、`G5`、`G6`、`G7`、`sweep`、`goal-check`。

记账 actor 是子代理，不是 `root`。失败的 ChildResult 记 fail，frontier 退回该门允许的修复点（验收失败回到实现门），不让根会话自己猜。

Skill 没有 `performance_gate` 这套工具。等价行为是：子代理只出 ChildResult，编排者记下该门，并且不把作者写成评审者。

### 4.4 原版上不该出现的东西

- Admit 之后先写流程清单，再离开交付物。
- 验证没指出具体错误，就整文件重写。
- 预览失败后新建包装页，或把超时说成用户取消。
- 子代理已经给出结论，根会话再写一张验收 receipt 并自己 `performance_gate`。
- 门禁被拒后打开 Metis 仓库或当前 session 文件来查实现。

---

## 5. 怎样算轨迹正确

看任意一次真实请求的轨迹，不看文采，也不对照某一次历史会话的文件名。

Skill：

- 第一条推进任务的记录是 Route、Framework、Gates，且与所有权形状一致。
- 这条记录之后才改交付物。
- 实现阶段至少有一次「验证 → 指出具体问题 → 局部修改」。
- 该级别要求的独立角色都 spawn 过，顺序与第 3.2 节一致。
- 会话没有去读 Metis 源码。交付物仍是用户要的那一类东西。

原版：

- 一次 `performance_admit`，级别和起始门与第 1 节一致。
- 实现阶段的工具停在交付物和它的验证上。验证失败后的下一步仍是验证或修改该交付物。
- 根会话成功调用的 `performance_gate` 只包括它有权关闭的门（T0/T1 的 G4，以及 T2/T3 的 G2；T3 在没有 goal-checker 时还可以是 goal-check）。
- 其余门出现在 `spawn_agent` 的结果里，由 host 记账，并带有 frontier 和 next action。
- 要求的门都通过后，frontier 为 `complete`。
