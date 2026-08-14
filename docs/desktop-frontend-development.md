# Desktop 前端开发手册

本文是 Metis Desktop 前端修改的权威操作手册。目标不是让代码“看起来改过”，而是保证修改进入真实运行路径、覆盖正确状态，并有可重复证据证明用户能看到结果。

适用范围：`desktop/`、`desktop/renderer/`、Desktop 使用的 Server API，以及 `test/desktop-*.test.ts`。

## 1. 完成标准

Desktop 前端任务只有同时满足以下条件才算完成：

1. 找到真实运行入口和状态所有者，不凭文件名猜测。
2. 修改源码，不手改生成产物。
3. 覆盖用户要求涉及的全部状态，例如加载、空态、流式、完成、错误、展开、收起。
4. 运行与风险匹配的自动化测试和 Desktop 构建。
5. 对布局、可见性或交互变化提供运行时证据，不能只展示 diff。
6. 明确报告验证命令、结果和未通过项；不能把未运行、超时或无输出称为通过。

截图、代码搜索命中、CSS 规则存在都不是单独充分的完成证据。Computer Use 可以辅助观察，但不能作为最终验证；最终证据必须可重复。

## 2. 修改前强制步骤

每次 Desktop 前端任务开始时：

1. 阅读根 `AGENTS.md` 和本文全文。
2. 运行 `git status --short`，保留所有无关用户修改。
3. 写清验收条件，包括用户能看到什么、在哪个状态看到。
4. 从入口追到最终 DOM：Server/IPC 事件、状态更新、渲染函数、选择器、测试。
5. 使用 `rg` 搜索目标函数、类名、ID、文案的全部定义和引用。
6. 检查同一选择器在 `styles.css` 中是否存在后置覆盖、媒体查询或平台覆盖。
7. 决定最小但足够的验证矩阵，然后再编辑。

工作树经常包含未提交改动。禁止为了获得“干净基线”而重置、覆盖或删除这些改动。

## 3. 运行架构与源码所有权

Desktop 是无前端打包器的 Electron 应用。Renderer 通过普通 `<script>` 顺序加载全局模块。

```text
Metis Server HTTP/SSE
        ↓
desktop/main.cjs          Electron 主进程；Server 代理、文件系统、窗口、IPC
        ↓ IPC
desktop/preload.cjs       contextBridge；唯一允许暴露给 renderer 的能力
        ↓ window.metisDesktop
desktop/renderer/*.js     状态、渲染、交互
        ↓
desktop/renderer/index.html + styles.css
```

主要文件：

| 责任 | 源码 |
| --- | --- |
| 窗口创建、Server 生命周期、SSE、IPC、工作区文件访问 | `desktop/main.cjs` |
| 安全桥接 API | `desktop/preload.cjs` |
| 静态 DOM、SVG sprite、脚本加载顺序 | `desktop/renderer/index.html` |
| 主状态、Server 同步、事件处理、DOM 增量渲染 | `desktop/renderer/app.js` |
| 消息 turn 分析、流式合并、工作区/正文拆分 | `desktop/renderer/message-turns.js` |
| 会话列表纯逻辑 | `desktop/renderer/conversations.js` |
| Markdown 清理与渲染 | `desktop/renderer/markdown.js` |
| 附件纯逻辑 | `desktop/renderer/attachments.js` |
| 模型选择纯逻辑 | `desktop/renderer/model-selection.js` |
| Onboarding | `desktop/renderer/onboarding.js` |
| 工作统计和 Token 视图纯逻辑 | `desktop/renderer/work-stats.js`、`conversation-token-comet.js` |
| 全部 Renderer 样式 | `desktop/renderer/styles.css` |
| 英文/简中权威文案 | `desktop/i18n-source.cjs` |
| 生成的多语言目录 | `desktop/renderer/i18n-catalogs.js` |
| Server API | `src/modes/server/` |

纯逻辑优先放在可被 Node 直接 `require` 的 helper 文件，并为其写单元测试。只有 DOM 协调和跨模块状态留在 `app.js`。

## 4. Renderer 加载顺序

`index.html` 当前按以下顺序加载：

1. `vendor/marked.js`
2. `vendor/purify.js`
3. `markdown.js`
4. `i18n-catalogs.js`
5. `i18n.js`
6. `conversations.js`
7. `message-turns.js`
8. `model-selection.js`
9. `onboarding.js`
10. `attachments.js`
11. `work-stats.js`
12. `conversation-token-comet.js`
13. `app.js`

Helper 通过 `window.metis…` 暴露，`app.js` 在文件顶部读取。新增 helper 时必须：

- 在 `app.js` 之前加载；
- 同时支持浏览器全局和 Node 测试所需的 `module.exports`；
- 为脚本存在、顺序和全局名添加契约测试；
- 不能假设 ESM import、bundler tree-shaking 或热模块替换存在。

## 5. 开发源与构建产物

真实源文件是：

- `desktop/main.cjs`
- `desktop/preload.cjs`
- `desktop/renderer/`

`desktop/scripts/build.mjs` 会删除并重建 `desktop/dist/`，然后复制上述文件。规则：

- 永远不要手改 `desktop/dist/`；下次构建会覆盖。
- 永远不要把 `desktop/renderer/vendor/` 当业务源码；它由 `prepare:renderer` 同步。
- `index.html.bak`、设计稿、截图和 Stitch 文件不是运行入口，除非 `index.html` 明确引用。
- `npm --prefix desktop run dev` / `start` 加载源码目录。
- `npm --prefix desktop run start:dist` 加载 `desktop/dist/`；源码变化必须先运行 Desktop build。
- 安装包加载 App Resources 内复制的产物；修改仓库源码不会让已安装应用自动变化。

“改了但没反应”时，首先确认当前运行的是源码、`desktop/dist`，还是已安装 App。

## 6. IPC、HTTP 与 SSE 数据流

Renderer 禁止 Node 集成。新增系统能力必须走：

1. `main.cjs` 注册 `ipcMain.handle`；
2. `preload.cjs` 暴露最小 API；
3. Renderer 调用 `window.metisDesktop`；
4. 为输入校验、路径边界和失败状态写测试。

Metis Server 请求统一经过 `desktop.metis.request` 和 `requestServer()`，不要在 Renderer 直接 `fetch` Server。

SSE 路径：

```text
main.cjs /event → metis:event IPC → handleMetisEvent()
→ acceptServerEvent() 去重/校验 session
→ state 更新
→ scheduleServerMessageRender() 或 syncServerSession()
→ DOM
```

排查事件“收到了但 UI 不变”时检查：

- `serverInstanceId` 是否一致；
- `serverSequence` 是否被判定为旧事件；
- `serverSessionId` 是否匹配当前 session；
- 事件分类是否触发 render、flush 或 snapshot sync；
- 断线/重连是否更新 `state.serverConnected`。

## 7. 状态与渲染生命周期

### 7.1 Snapshot 同步

`syncServerSession()` 从 `/session`、`/session/messages`、`/sessions` 和配置接口恢复权威状态。切换项目、切换会话、abort 后对账等流程依赖它。

不要只改局部 DOM。如果 Server snapshot 随后会覆盖该状态，修改必须进入权威 state 或 Server 数据。

### 7.2 增量消息渲染

`renderServerMessages()` 不是无条件全量重画。它会根据以下信息跳过稳定消息：

- DOM article 类型；
- `metisRenderedMessage === message` 对象身份；
- `metisRenderedLanguage`；
- `metisRenderedStreaming`；
- 当前 turn 是否活跃。

因此：

- 原地修改 message 对象可能被稳定区跳过；优先替换对象或明确安排重绘。
- 更新 state 后必须确认调用了对应 render 函数。
- 流式消息使用 `mergeStreamingMessage()`；不能让缺少某 part 的 partial snapshot 删除已经发出的 tool call。
- 高频流式更新使用 `requestAnimationFrame` 调度；需要立刻收敛的结束/abort 状态使用 flush 或 snapshot sync。

### 7.3 DOM 身份

动态节点必须有稳定身份：消息用 message ID/timestamp，工作项用 `data-part-key`，项目和会话用稳定 ID。不要用显示文案或数组当前位置作为唯一身份，除非该列表明确不会重排。

更新时优先复用节点，避免：

- 丢失用户展开/收起状态；
- 重播入场动画；
- 滚动位置跳动；
- 事件监听重复绑定；
- 流式文本闪烁。

## 8. Assistant 思考、工具与正文

一个用户 turn 可能对应多个 assistant message/article。不能把单个 article 当成完整 turn。

关键链路：

1. `message-turns.js` 的 `analyzeAssistantTurn()` 判断当前 turn、最终正文、工作状态和默认折叠。
2. `getAssistantWorkLayout()` 将 thinking、状态文、tool call、Subagent card 与最终正文分离。
3. `updateOrCreateAssistantMessage()` 按 `data-part-key` 增量更新每个 article。
4. `syncAssistantTurnPresentations()` 在本轮 DOM 全部完成后统一标记工作段、正文段、展开/收起和分割线状态。

强制规则：

- 保持 tool card 的 DOM 和交互契约，除非任务明确要求修改 Tools UI。
- 展开/收起必须以 turn 为单位同步，不能在渲染半成品兄弟节点时推断最终布局。
- 分割线属于工作区与最终正文的语义边界，只在完成且展开时显示。
- 中间状态文字使用 `.cot-text`，真实 reasoning 使用 `.cot-thinking`，最终回答使用 `.assistant-text-part`；不要混用。
- 修改间距时同时检查 `Thoughts → text`、`Tool → text`、`text → Tool`、跨 article continuation、单行和换行文本。
- 可见间距要按视觉边界验证。透明 34px 控件与有背景的 34px 卡片即使几何 gap 相同，光学间距也可能不同。
- 禁止重新引入负 article margin、依赖渲染顺序的补偿或大范围 `!important`。

当前工作区节奏由 `[data-purpose="main-chat"]` 下的 `--work-item-gap`、`--work-final-gap` 和 `--work-turn-end-gap` 统一控制。需要例外时用语义相邻选择器做最小光学修正，不要复制另一套间距常量。

### 8.1 Plan、Build 与 Ask 专用界面

这三类界面都位于聊天区，但职责和权威状态不同，不能互相复用正文或通过 DOM 位置推断状态。

| 界面 | 权威状态 | 展示职责 |
| --- | --- | --- |
| Plan proposal 预览 | `state.session.workflowProposal` | 在对应 assistant 历史消息中展示完整 proposal；只有当前分支最新版可修改或 Process |
| Build 执行计划 | `state.session.workflowPlan` | composer 上方持续显示阶段、说明和 checklist；不重复显示完整 proposal |
| Ask | `state.session.pendingUserInput` | 待回答时替换 composer，每次只展示一个问题；提交、取消或恢复后还原 composer 和焦点 |

强制规则：

- `workflowProposal` 是最新版 proposal 的权限依据。禁止使用“最后一张 proposal 卡”、DOM 顺序或可见位置判断哪个版本可 Process。
- 完整 proposal 只属于对话预览和 `read_plan` 读取路径。Build 的 `workflowPlanCard` 只显示执行清单，即使 session 同时含有 `workflowProposal` 也不能把 Markdown 拼入卡片。
- `workflowPlanCard` 只在 Build 且存在 `workflowPlan` 时显示；完成后可以自动折叠，但中止、刷新、压缩和会话恢复后必须保留当前清单。
- Process 必须基于持久 proposal 发起，并由 Runtime 强制先 `read_plan`、再 `update_plan`。Renderer 不能复制 proposal 正文作为隐藏 Prompt 或前端临时状态。
- `update_plan` 的原始通用 tool card 保持隐藏，避免与专用执行清单重复。专用卡必须由 snapshot/SSE 的权威 `workflowPlan` 原位更新。
- Ask 使用 `requestId` 与 `toolCallId` 建立稳定身份。临时 SSE 断线后以 `/session.pendingUserInput` 恢复；已提交、取消、过期或会话替换的请求不能继续留在界面。
- Ask、proposal 修改输入和 Process 的 disabled/busy 状态必须同时考虑 streaming、断线、pending Ask、发送中和 compaction，不能允许用户绕过尚未提交的状态。

修改这些界面时，至少验证：最新版与旧 revision、Plan/Build 切换、Process 准备阶段、checklist 原位更新、完成折叠、中止恢复、Ask 单题前进/取消、刷新重连，以及 composer 的替换与焦点恢复。

## 9. CSS 修改规则

本项目使用普通 CSS，不引入第二套样式系统。

`styles.css` 历史较长，存在基础规则、主题规则、平台/宽度媒体查询和文件尾部的 main-chat 精修规则。任何 CSS 修改前：

```bash
rg -n "目标选择器|相关变量" desktop/renderer/styles.css
```

必须阅读全部命中，确认最终层叠结果。不要只改第一个同名规则。

规则：

- 主聊天精修优先限定在 `[data-purpose="main-chat"]`，避免污染设置、Inspector 或 Browser。
- 间距、颜色、圆角优先复用现有 custom properties。
- 不使用 `transition: all`；明确列出属性。
- 动态数字使用 `font-variant-numeric: tabular-nums`。
- 标题用 `text-wrap: balance`，正文用 `text-wrap: pretty`。
- 动画只改变合适的 compositor 属性；遵守 `prefers-reduced-motion`。
- 小图标按钮的视觉尺寸可以紧凑，但点击区使用伪元素扩展；不能让点击区互相重叠。
- 深浅主题都使用语义色变量；不要为 light mode 写死只在当前截图正确的颜色。
- 不用 z-index、绝对定位或负 margin 掩盖错误 DOM 所有权。

布局问题最终要测 `getBoundingClientRect()` 或 computed style。只看到 CSS 中有 `gap: 6px`，不能证明用户感知的间距一致。

## 10. HTML 与可访问性

- 新控件优先使用原生 `button`、`input`、`dialog`、`select`。
- 非原生交互节点必须提供 role、tabindex、Enter/Space 键盘行为和准确的 `aria-expanded` 等状态。
- ID 必须在真实活动 DOM 中唯一。修改前确认命中的不是备份、隐藏副本或非活动布局。
- 新 SVG 使用现有 sprite 和 `currentColor`；不要为状态复制多个图标资产。
- 用户内容进入 HTML 前必须经过现有 Markdown + DOMPurify 链路；禁止直接插入未清理 HTML。

## 11. i18n 修改

英文和简中权威源是 `desktop/i18n-source.cjs`。流程：

1. 同时添加/更新 `en` 与 `zh-CN`，占位符名称必须一致。
2. HTML 使用 `data-i18n`、`data-i18n-placeholder`、`data-i18n-aria-label` 等现有属性。
3. JS 使用 `uiText(key, variables)`，不要新增硬编码用户可见文案。
4. 运行：

```bash
npm --prefix desktop run i18n:generate
npm test -- test/desktop-i18n.test.ts
```

`desktop/renderer/i18n-catalogs.js` 是生成文件，不应单独手改。生成器可能调用翻译服务；若环境无法完成，必须报告，不能伪造“全部语言已更新”。

## 12. 常见修改配方

### 12.1 纯视觉修改

1. 定位真实 DOM class/ID。
2. 搜索全部 CSS 定义和媒体查询。
3. 写/更新 CSS 契约测试。
4. 验证所有相关状态和主题。
5. 用 computed style 或 offscreen BrowserWindow 测量关键值。

### 12.2 新增 Server 数据展示

1. 在 `src/modes/server/` 定义响应和错误行为。
2. 通过 `requestServer()` 读取，不直接 fetch。
3. 明确 state 所有者、缓存和刷新时机。
4. 将计算逻辑放入可测试 helper。
5. 覆盖连接、断线、空数据、错误和刷新。

### 12.3 新增本地系统能力

1. `main.cjs` 实现并校验输入。
2. `preload.cjs` 暴露最小桥接。
3. Renderer 调用桥接。
4. 测试路径越界、错误和平台差异。

### 12.4 修改消息展示

至少检查：历史 snapshot、流式 delta、tool start/end、abort、retry、Subagent、同 message 最终正文、跨 message 最终正文、展开、收起、刷新后状态。

## 13. “改了但没反应”排查表

按顺序检查，不要继续堆补丁：

| 现象 | 常见原因 | 证据/处理 |
| --- | --- | --- |
| 源码已改，运行界面完全不变 | 运行的是 `desktop/dist` 或安装包 | 确认启动命令；build 后重启正确产物 |
| JS helper 改了但未执行 | `index.html` 未加载、顺序错误、全局名不一致 | 检查 script 顺序和 `window.metis…` |
| CSS 规则存在但无效果 | 后置选择器、媒体查询、主题或 inline style 覆盖 | 搜索全部定义，读取 computed style |
| state 已变化但 DOM 不变 | 没调用 render，或增量渲染 identity fast path 跳过 | 检查 render 调用和 `metisRendered*` |
| 流式过程正确，结束后回退 | snapshot sync 覆盖本地临时状态 | 修正权威 Server/state 数据 |
| SSE 日志有事件但 UI 不变 | sequence、instance 或 session 过滤 | 检查 `acceptServerEvent()` |
| 文案 key 不显示 | 改错源、未生成 catalogs、占位符不一致 | 修改 canonical source 并运行生成/测试 |
| 只在某台机器错 | macOS/Windows、宽度、深浅主题、reduced motion 差异 | 覆盖对应 class/media query |
| 截图看起来改了，真实交互没变 | 修改了静态样例、备份或错误节点 | 从运行入口追到事件监听与活动 DOM |
| 工具/思考布局偶发错位 | 把 article 当完整 turn，或在渲染中途计算兄弟关系 | 使用 turn 级最终同步 |
| Build 执行卡重复显示完整方案 | 把 `workflowProposal.markdown` 拼进 `workflowPlanCard` | 执行卡只绑定 `workflowPlan`；完整方案留在历史预览和 `read_plan` |
| Process/修改按钮出现在旧方案 | 用 DOM 最后位置判断最新版 | 使用 `state.session.workflowProposal` 的 revision/来源标识判定 |
| Ask 断线后消失或重复 | pending 请求只存在局部 DOM，或重连时重复创建 | 用 `/session.pendingUserInput` 对账并按 request/tool 身份复用节点 |

## 14. 验证矩阵

按风险选择，但不能省略与需求直接相关的状态。

### 14.1 最低自动化验证

```bash
node --check desktop/main.cjs
node --check desktop/preload.cjs
node --check desktop/renderer/app.js
npm test -- test/desktop-relevant.test.ts
npm --prefix desktop run build
git diff --check
```

只运行实际修改涉及的语法检查。Helper 同时需要对应 Node 单元测试。

### 14.2 Desktop 回归集合

常用测试：

| 修改区域 | 测试 |
| --- | --- |
| Shell、DOM、脚本接线 | `test/desktop-chat-shell.test.ts` |
| 消息 turn、流式、Subagent、正文 | `test/desktop-message-turns.test.ts` |
| 视觉变量、交互细节、间距契约 | `test/desktop-interface-polish.test.ts`、`desktop-flat-accent.test.ts` |
| i18n | `test/desktop-i18n.test.ts` |
| 会话/项目 | `test/desktop-conversations.test.ts` |
| 附件 | `test/desktop-attachments.test.ts` |
| 模型/Provider | `test/desktop-model-selection.test.ts`、`desktop-provider-config.test.ts` |
| Onboarding | `test/desktop-onboarding.test.ts` |
| Memory/统计/Token | 对应 `desktop-memory-state`、`desktop-work-stats`、`desktop-session-token-totals`、`desktop-conversation-token-comet` 测试 |
| Plan proposal、Ask、Build checklist | `test/desktop-chat-shell.test.ts`、`test/desktop-interface-polish.test.ts`、`test/server-mode.test.ts`，以及对应 core/TUI 组件测试 |
| 主进程 Server API | `test/server-mode.test.ts` 与相关 Desktop 测试 |

可运行：

```bash
npm test -- test/desktop-*.test.ts
```

若仓库其他未提交工作导致无关测试失败，仍需保证目标测试通过，并在交付中列出完整失败名称和原因。不能删除或放宽无关测试来获得绿色结果。

### 14.3 运行时验证

视觉或交互任务至少需要一种可重复运行时验证：

- 使用 `METIS_DESKTOP_CAPTURE` 的 Electron 捕获路径；
- 使用隐藏/离屏 `BrowserWindow` 读取 computed style 和 `getBoundingClientRect()`；
- 使用可重复脚本驱动指定状态并断言 DOM/ARIA；
- 由用户提供真实截图时，将截图作为问题证据，再用自动化验证修复结果。

必须验证精确状态，不接受只打开首页。涉及消息工作区时至少覆盖：

- active/streaming；
- completed expanded；
- completed collapsed；
- 中间文字单行与换行；
- Tool 前后；
- Thoughts 前后；
- 最终正文和分割线。

涉及工作流专用界面时还要覆盖：

- Plan 历史预览显示完整 proposal，Build 执行卡只显示 checklist；
- session 同时含 proposal 与 workflow plan 时，执行卡 DOM 不出现 proposal 正文；
- 执行卡宽度与 composer 一致，完成后自动折叠且可手动重新展开；
- Ask 替换 composer、逐题前进、取消、提交、断线恢复和焦点还原；
- 旧 proposal revision 不显示可执行入口，最新版的 Process/修改禁用条件正确。

截图只能说明某一帧外观；还要验证状态转换和语义属性。

## 15. 禁止模式

- 修改 `desktop/dist` 后声称完成。
- 只改 CSS，不确认选择器命中活动 DOM。
- 在文件末尾不断追加更高 specificity 或 `!important` 掩盖旧规则。
- 使用负 margin 抵消错误的 article/turn 所有权。
- 原地改 state 后假设增量渲染一定重画。
- 只测最终静态状态，不测 streaming/abort/retry。
- 重写 tool card DOM，却没有覆盖运行、完成、错误和展开状态。
- 在 Build 执行清单中再次渲染完整 proposal，制造重复内容和第二滚动区域。
- 通过 DOM 顺序判断最新版 proposal、pending Ask 或 Process 权限。
- 手改生成的 i18n catalogs 而不改 canonical source。
- 用 Computer Use、单张截图、肉眼判断或“代码看起来正确”作为最终证明。
- 隐瞒失败测试、未运行 build，或把 timeout 当通过。

## 16. 交付格式

最终报告必须包含：

1. 用户可见结果；
2. 修改文件和关键入口；
3. 验证命令及精确结果；
4. 运行时验证覆盖的状态；
5. 未通过项及其与本次修改的关系；
6. 仅在确有必要时给出用户后续动作。

禁止只说“已修改”“应该生效”“测试没问题”。
