# Metis Desktop 前端开发指南 (Desktop Frontend Development Guide)

本文是 Metis Desktop 前端架构、开发规范与变更操作的权威指南。
目标是确保所有前端改动均作用于**真实源码**、覆盖完整的状态生命周期，并具备可重复的自动化验证证据。

适用范围：`desktop/src/`、`desktop/main.cjs`、`desktop/preload.cjs`、Desktop 使用的 Server API，以及 `test/desktop-*.test.ts`。

---

## 1. 核心架构与源码所有权 (Source of Truth)

Metis Desktop 是基于 **Electron + React 18 + TypeScript + Tailwind CSS v4 + Vite** 的现代化桌面应用。

```text
Metis Server (HTTP / SSE on 127.0.0.1)
        ↓
desktop/main.cjs          Electron 主进程：Server 生命周期、窗口管理、文件系统代理、IPC 桥接
        ↓ IPC (metis:event, metis:request)
desktop/preload.cjs       contextBridge：向渲染进程暴露 window.metisDesktop API
        ↓
desktop/src/              【唯一源码真相源 (Source of Truth)】
├── App.tsx               根组件、主布局、路由/视态切换
├── components/           React 组件树 (chat/, harness/, codetree/, routines/, inspector/, atoms/)
├── hooks/                useMetisServer.ts (主状态引擎与 SSE 事件流还原)
├── lib/                  纯函数工具集与模型提示词改写器
└── styles/               Tailwind CSS v4 样式与 BeautifulUI 设计系统变量
        ↓ Vite 构建 (vite build && node scripts/build.mjs)
desktop/renderer/         【构建产物目录】编译后的 HTML / JS / CSS bundle
desktop/dist/             【分发打包目录】Electron 生产运行资源
```

### 严格规则

1. **源码真相源**：所有前端 UI 界面开发与修改，**只在 `desktop/src/` 下进行**。
2. **严禁手改构建产物**：`desktop/renderer/` 和 `desktop/dist/` 是由 `npm --prefix desktop run build` 生成的编译产物，**绝对不要手动修改**，任何手动修改都会在下次构建时被完全覆盖。
3. **双重运行模式**：
   - **开发模式** (`npm run dev` 或 `npm --prefix desktop run dev`)：Electron 启动并加载 Vite Dev Server (`http://localhost:5173`)，支持热重载。
   - **打包测试模式** (`npm --prefix desktop run start:dist`)：Electron 直接加载 `desktop/renderer/index.html`。源码变更后必须先执行 `npm --prefix desktop run build`，产物才会生效。

---

## 2. 状态流、SSE 与消息渲染生命周期

### 2.1 数据与事件流向
```text
Metis Server HTTP/SSE (/session, /session/messages, /events)
        ↓
desktop/main.cjs (IPC metis:event)
        ↓
desktop/src/hooks/useMetisServer.ts (状态 Reducer、SSE 序列号去重与会话过滤)
        ↓ React State (messages, session, isStreaming, workflowPlan)
desktop/src/components/chat/MessageList.tsx & AssistantTurn.tsx
```

### 2.2 消息渲染与 Turn 边界演进（从传统渲染到 React）
在早期版本中，桌面端曾使用过程式全局渲染函数（如 `renderServerMessages()`、通过 `metisRenderedMessage === message` 进行对象身份比对，以及 `syncAssistantTurnPresentations()` 统筹思考区与工具卡片折叠）。

在当前的 React 18 架构中，这一契约已完全由 React 组件化生命周期与状态所有权所接管：
- **Turn 级别所有权**：由 `AssistantTurn.tsx` 与 `TurnGroup.tsx` 管理。一个用户 turn 可能包含多次 LLM 工具调用、思考流与最终回答，不可将其割裂为独立零散的节点。
- **对象身份与快照对齐**：通过 `entry.id` 与 `serverTimestamp` 双重匹配快照，防止 `adoptSnapshotWithoutRegressing` 在会话恢复或中止重连时造成消息重复。
- **流式增量更新**：流式 token 更新必须平滑追加，不可在流式中间状态销毁已有的 toolCall 卡片或重置展开折叠态。

---

## 3. 设计系统与组件规范 (UI & Styling)

Metis Desktop 采用基于 Tailwind CSS v4 与 BeautifulUI 的原子化设计系统。

### 3.1 原子控件 (Atoms)
- 位于 `desktop/src/components/atoms/`：
  - `Button.tsx`：基础按钮组件，内置 `primary`, `secondary`, `ghost`, `quiet` 等变体。
  - `EntityChip.tsx` / `ValuePill.tsx` / `SelfLearningBadge.tsx`：状态胶囊与元数据药丸。

### 3.2 胶囊控件与阴影边框契约 (Pill Alignment & shadow-btn)
在工具栏、导航条或操作行中，并排的胶囊控件（如输入框与操作按钮）必须保持视觉对齐：
- **`shadow-btn` 机制**：`Button` 的 `secondary` 变体使用 `--shadow-btn: 0 0 0 1px var(--line-strong), var(--shadow-xs)`。这是一个外扩 1px 的环形阴影加上微小下沉投影，因此 `h-[28px]` 的按钮视觉外盒高度为 `30px`。
- **输入框与按钮同步**：并列的搜索框或输入胶囊若要与右侧 `Button` 高度完全一致，应优先采用相同的 `h-[28px]`、`rounded-full` 与 `shadow-btn`，而不要使用会被盒模型内卷的 `border border-line`（会导致输入框比按钮矮 2px，出现上下内缩错位）。
- **字号与内边距**：标准工具栏胶囊文本统一使用 `text-[12.5px]`，内边距必须留出足够空间，避免中文或多语言占位符贴边截断。

### 3.3 布局边界与不可折叠面板
- **Inspector 保持常开**：右侧 Inspector 面板没有折叠按钮，`data-inspector-shell` 恒为 `contents`。宽度支持拖拽缩放。
- **Traffic Light 间距**：仅在 macOS (`isMac`) 上渲染左侧红绿灯占位 (`w-[66px]`)；Windows 11 上系统控制按钮位于右上角，右侧工具栏需预留 `pr-[140px]` 避免被系统按钮遮挡。
- **跨平台路径比较**：禁止使用严格 `===` 比较路径；必须使用 `pathsEqual()` / `pathsMatch()` 兼容 Windows 盘符大小写与斜杠。

---

## 4. 多语言国际化 (i18n)

### 4.1 规范流程
1. **修改权威源**：所有文本变更必须在 `desktop/i18n-source.cjs` 中同时添加/更新 `en` 与 `zh-CN`。
2. **生成语言包**：运行生成脚本：
   ```bash
   node desktop/scripts/generate-i18n-catalogs.mjs
   ```
   该脚本会自动更新 `desktop/src/i18n-catalogs.cjs` 和 `desktop/src/i18n-catalogs.js`。
3. **在组件中使用**：
   ```tsx
   import { useTranslation } from '../../i18n';
   const { t } = useTranslation();
   // 或通过 t('key') 获取本地化文本
   ```

---

## 5. 高效排查与开发协议 (Fast-Path Debugging)

为了保证高效开发，避免无效搜索或超时：

1. **避免全局无约束搜索**：
   - **绝对禁止使用 bare `git grep --untracked`**！仓库根目录下含有庞大的 `node_modules`、打包产物及基准测试日志，无约束检索会导致命令挂起。
   - 优先使用聚焦路径的 `rg` 或精准文件定位：
     ```bash
     rg "harnessFilterPlaceholder" desktop/src/
     rg --glob '!node_modules' "关键词" desktop/
     ```
2. **UI 尺寸与对齐排查路径**：
   - 看到 UI 对齐/尺寸问题时，直接审查对应的 JSX 结构与 Tailwind 类名（`h-`, `w-`, `padding`, `text-`, `box-shadow` vs `border`）。
   - 切忌为简单的盒模型对齐问题编写复杂的二进制像素解码脚本；直接依据盒模型与 CSS 属性做精确修复。
3. **保留未提交的修改**：
   - 开始任务前运行 `git status --short`，严格保留工作区内已有的其他用户改动，不可随意 `git reset` 或删除。

---

## 6. 验证矩阵与完成标准

任何前端改动完成必须提供可重复的运行证据：

### 6.1 必须运行的命令
1. **针对性单元与契约测试**：
   ```bash
   npm test -- test/desktop-react-*.test.ts test/desktop-frontend-guide.test.ts
   ```
2. **Desktop 生产构建验证**：
   ```bash
   npm --prefix desktop run build
   ```

### 6.2 运行时证据
- 对于布局和视觉调整，必须在测试中断言关键属性，或通过 DOM 状态、`getBoundingClientRect()`、computed styles 等提供明确的依据。
- Computer Use 和屏幕截图可以辅助人工核对，但不能作为替代自动化验证与构建通过的唯一依据。
