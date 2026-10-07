# Metis × Autoprompt：Terminal-Bench/ALE 最终诊断与实施规格

状态：Issue 0–7 已完成仓库内实现与离线验收；未重跑 Terminal-Bench/ALE，实际跑分提升仍待后续独立评测证明

范围：Metis headless/print/json、Harbor Terminal-Bench 2.1、ALE one-shot artifact tasks

目标读者：负责实现的 Cursor/编码 Agent

日期：2026-09-15

## 1. 目标与验收口径

本项目目标不是增加 Agent 数量，也不是复刻 Autoprompt 的角色名称。目标是把独立分析、实现、验证、失败修复真正闭合到同一个评分工作区，并由宿主代码决定任务是否完成。

本报告不要求 Cursor 重新运行 Terminal-Bench、ALE、官方 grader 或任何 benchmark 子集。历史结果 39/89（43.82%）只作为问题证据，不是本次实现验收步骤。

实现验收仅使用仓库内确定性单元测试、集成测试、已有 trace 派生夹具、`npm run build` 和 `git diff --check`。不允许以更多 token、更多 tool call 或更多 spawned agents 代替可重复的正确性证明。

### 1.1 2026-09-15 第一轮实现复核

复核对象是 Cursor 留在当前未提交 worktree 中的 Issue 0–2 改动；因没有独立提交，结论按本文文件范围相对 `HEAD` 审查。未运行 Terminal-Bench、ALE 或 official grader。

| Issue | 状态 | 已验证结果 | 尚未闭合 |
| --- | --- | --- | --- |
| 0 | 已验收 | 7 类失败夹具、稳定 failure code、回归测试已加入 | Issue 3–5 接入后，夹具还需从结构断言升级为真实 verifier/repair 行为断言 |
| 1 | 主体完成，暂不视为最终闭环 | profile 从 CLI/main/adapters 传入；print/json 用 `ExecutionResult.status` 映射 exit 0/1/2；active/blocked performance run 拒绝成功 | `createTaskExecutionController().execute()` 没有成为生产入口；print mode 仍是运行结束后调用 finalizer；无 performance run 时 `EMPTY_TASK_CONTRACT + deriveStubCompletion()` 仍可默认 PASS |
| 2 | 主体完成，缺集成验收 | reliable-headless 默认 shared cwd；传递公开 `METIS_TASK_*` 路径；workspace probe；重叠 mutating owner 拒绝 | spawn 测试仍 mock child process，尚未证明真实 child 可见 root 未跟踪文件、任务 venv 且修改立即回到 root；reviewer/verifier 的冻结快照顺序也缺真实集成测试 |
| 3–7 | 未实现 | 无 | 按本文后续 Issue 顺序实现 |

独立复验结果：

- 10 个相关测试文件，130 tests passed。
- `npm run build` passed。
- 本文相关实现文件 `git diff --check` passed。

这些结果证明第一轮没有破坏所选回归集，但不能证明评分正确率已经提升。当前 reliable-headless 仍存在一个明确假成功路径：任务没有 active performance run、没有已编译 contract 时，空 contract 会被 stub completion 判为完成。

### 1.2 2026-09-15 最终实现复核

Cursor 共经过五轮实现与纠偏。最终结果不是“补更多角色”，而是把生产控制权、共享评分工作区、独立 oracle、结构化 child result、repair obligation 与递归 trace 串成宿主拥有的执行链。

| Issue | 最终状态 | 仓库内证据 |
| --- | --- | --- |
| 0 | 已完成 | 7 类假完成/环境失败夹具固化；稳定 failure code；正确与错误 artifact 有相反判定 |
| 1 | 已完成 | `TaskExecutionController` 成为 reliable-headless print/json 生产入口；`ExecutionResult.status` 唯一映射 exit 0/1/2；缺 contract/oracle 不再默认成功 |
| 2 | 已完成 | mutating child 默认 shared cwd；task path/venv 公开传递；workspace probe、重叠 owner 拒绝、真实临时目录 child fixture 已覆盖 |
| 3 | 已完成 | TaskContract compiler、逐 constraint evidence、artifact/check hash、file-contains/valid-json/line-count 等宿主 oracle 已接入；复杂任务缺 oracle 时调用 host-owned contract-solver |
| 4 | 已完成 | `ChildResult` 成为 child→Controller 结构化结果；普通 reliable child 不依赖手写 `performance_gate`；legacy profile 保持兼容 |
| 5 | 已完成 | verifier 失败进入 bounded repair；每轮重跑 oracle；artifact/evidence 变化进入 fingerprint；无进展确定性停止 |
| 6 | 已完成 | 生产短闭环可实际调度 planner→implementer→verifier，planner 输出进入 implementer brief；仅 Controller 内部 host-dispatch 可绕过旧 T1 角色限制，深度/并发/ownership 仍生效 |
| 7 | 已完成 | parent 从 child stdout 合并嵌套 `trace_summary`；agent/child 按稳定 ID 幂等去重；默认树与样例离线验收均通过 |

第五轮额外收紧了两个生产边界：

- contract-solver 输出必须是唯一 JSON 对象，只允许声明式 `file-contains`、`file-exists`、`valid-json`、`line-count` oracle；绝对路径、`..`、symlink escape、隐藏 grader、任意 command/check、markdown fence 与前后自由文本全部 fail closed。
- named-child 必须复用当前 AgentSession 中**已激活且 workflow 可调度**的 `spawn_agent` definition，从而继承 model/thinking/auth、Performance prepare/validate 和 shared-cwd ownership；缺失或禁用时返回 `HOST_NAMED_CHILD_NO_SPAWN`，不再退回裸 tool。

独立复验结果：

- 21 个相关 TypeScript 测试文件，290 tests passed。
- ALE official Python 派生夹具，6 tests passed。
- `npm run build` passed，runtime integrity check passed。
- `offline-acceptance.mjs` 默认 trace tree 与显式 sample 两次均 passed。
- 全 worktree `git diff --check` passed。
- 直接生产 API 复现：正确 `foo` artifact PASS；错误 `bar` artifact 返回 `CONSTRAINT_FAILED`；恶意 command 与绝对路径均被拒绝。
- 直接 Controller 复现：复杂任务通过结构化 solver oracle 完成；markdown-fenced solver 输出返回 `CONTRACT_SOLVER_INVALID`。

本轮没有运行 Terminal-Bench、ALE benchmark 或 official grader，也没有启动真实联网模型 child。named-child 的进程参数、role 顺序、host-dispatch、Performance policy 与 ownership 使用真实生产 tool definition 加进程层 mock 验证。因此可以确认控制链已接通并消除已知假成功路径，但不能据此宣称 43% 已提升到某个数值。

## 2. 已纠正的两项错误归因

### 2.1 “Metis 没加载外置 skill”不是问题

OpenCode 通过外置 Autoprompt skill/controller 承载流程；Metis 把同类策略内置在 system prompt、Agent definitions、Performance runtime、`spawn_agent`、`performance_admit` 和 `performance_gate` 中。两者承载方式不同，不应检查 Metis 是否加载外置 skill。

### 2.2 “上次删掉核心角色链导致 43%”不是完整解释

上次优化之后，当前 T1 路由确实退化成 root 实现、reviewer/verifier 后置，planner/implementer 为零。但核心链路删除之前，ALE benchmark 同样没有高于原版。

因此正确结论是：

> 优化前，完整角色链因环境断裂、递归协调、错误 oracle 和无完成守卫而空转；优化后，角色链被缩成 root + 后置审查。两版症状相反，但都没有把反馈确定性地转化为真实工作区中的修复和有效产物。

## 3. 证据摘要

### 3.1 最新 Terminal-Bench 运行

从 Mac mini trace 重建：

- 89 个任务中 39 pass、50 fail，43.82%。
- 扫描 150 个 trace 文件，148 个有效 workflow sessions，总量约 7.18 GB。
- 工具调用 3,749 次。
- `performance_admit`、`performance_gate`、`spawn_agent` 共 1,034 次，占 27.6%。
- 控制面错误 644 次。
- `spawn_agent` 167 次，165 次返回工具级 success。
- 165 次工具级 success 中 106 次业务结果为 `no_verdict`，比例 64.2%。
- 所有 spawn 都发生在 root 已经开始 bash/write/edit 之后。
- 当前角色几乎全是 reviewer/verifier；planner/implementer 为零。
- 50 个失败任务中，21 个最终回复声称成功，18 个明确承认尚有问题，1 个无 final。
- 约 23 个失败涉及缺文件、缺目标产物或交付不完整；分类来自错误文本启发式，只用于确定工程优先级。
- 失败运行消耗的输入、输出和 cache token 中位数不低于成功运行，未显示简单 token 饥饿。

### 3.2 优化前 ALE 运行

既有诊断 `docs/ale-metis-agent-failure-modes.md` 记录：

- 约 96/98 个任务发生 spawn。
- 约 13 个任务触发 `MAX_CHILDREN_EXCEEDED`。
- 子 Agent 经常缺失 task pointer、Performance RUN-MARKER、Python 包、pytest 或任务环境。
- 隔离工作区丢失任务 venv、`input/`、`output/`、`software/` wrapper。
- 子 Agent 失败后，root 经常在真实工作区制作占位或 contract-shaped 产物，没有重新运行失败命令。
- completed-zero 样本 32 个：27 个文件存在但 grader 内容检查失败，3 个 submission 被 venv/runtime 污染，2 个 output 为空。

### 3.3 源码事实

当前源码明确规定：

- `src/core/system-prompt.ts`：T0 root 实现且不 spawn；T1 root 执行 G4，之后才做 G5/G6。
- `src/core/performance-runtime.ts`：T1 允许的角色只有 reviewer/verifier/fresh-verifier；planner/implementer 只在 T2/T3 出现。
- `src/core/tools/spawn_agent.ts`：每个 child 是新的 Metis CLI 进程，携带 `--collaboration-mode build`、role/lane/gate 环境变量和独立任务文件。
- `src/core/tools/spawn_agent.ts`：governed child 退出码为零但未正确调用 gate 时，返回 `no_verdict`。
- `src/modes/print-mode.ts`：收到 assistant final 后直接输出；没有根据 `performanceRun.status` 拒绝未完成任务。
- `src/core/performance-runtime.ts`：状态机允许 G5/G6 fail 回到 G4，但调用方没有进程级义务继续执行到 `completed`。

### 3.4 与 Autoprompt benchmark 的边界

公开 Autoprompt 结果是 OpenCode + DeepSeek V4 Flash：60/89 提升到 73/89。当前 Metis 对比使用 Luna low，不能直接承诺复现 82%。此外，Autoprompt run 的原始逐任务映射未保留，因此不能逐任务重建其 +13 来源。

本报告只使用该结果证明“独立验证 + 修复闭环可能产生显著增益”，不把它当作 Metis 的目标分数保证。

## 4. 根因模型

### RC1：控制权放错层级

当前实现让被评估的模型同时负责：

1. 理解任务；
2. 选择 tier；
3. 编写 roadmap；
4. 选择角色；
5. 构造 child brief；
6. 管理 gate 顺序；
7. 编写 evidence receipt；
8. 判断 evidence 是否充分；
9. 决定是否修复；
10. 判断自己是否完成。

第一次语义理解错误会传播到 roadmap、implementation、review 和 final。角色数量增加不会自动形成独立真值。

修复原则：宿主代码拥有状态、重试、完成判定和退出码；Agent 只拥有语义分析、实现、诊断和修复。

### RC2：child 执行环境与评分环境不等价

独立 Metis 进程和自动 worktree/snapshot 会改变：

- cwd；
- 绝对路径；
- 虚拟环境；
- PATH 和 wrapper；
- staged task files；
- 未跟踪文件；
- 服务进程和端口；
- 可见的 `input/`、`output/`、`software/`。

Agent 报告缺依赖时，可能不是任务本身不可解，而是 child 离开了唯一有效的执行环境。

修复原则：headless benchmark 的顺序 mutating child 默认共享 root 的真实 cwd 和任务环境；隔离仅用于已证明可隔离的 disjoint lanes。

### RC3：控制面协议超过 Luna low 的可靠执行能力

模型必须正确处理 mission pointer、nonce、hash、gate、itemId、receipt path、role binding、changed files、test command 和 verdict。64.2% `no_verdict` 说明协议执行本身已成为主要失败源。

修复原则：child 返回小型结构化业务结果；controller 从真实文件系统、diff 和命令事件生成 gate evidence。模型不手写治理凭证。

### RC4：统一软件工程 oracle 与 benchmark 任务不匹配

TDD、changed-line coverage 和 diff review 适合代码任务，但不能验证模型权重、科学计算、图像、压缩文件、数据表或服务配置。文件存在、可解析、行列齐全不等于内容正确。

修复原则：先分类 task kind，再选择 code、artifact、numeric/data、service/config 或 mixed verifier。所有 verifier 绑定任务明确提供的公共检查和可观测约束。

### RC5：修复回边没有成为完成义务

状态机允许回退不等于系统会回退。Assistant 可以在 run active、verifier fail 或 `no_verdict` 时输出 final，print mode 仍返回成功。

修复原则：final 是 controller 的派生结果，不是模型自由决定的终止信号。只有 `ExecutionResult.status === "completed"` 才允许 success exit。

### RC6：优化前后分别过度编排与不足编排

旧版默认全链路导致 recursive fleet、环境断裂和治理开销；新版 T1 root shortcut 删除了独立解题阶段。两者都缺少按任务价值选择的短闭环。

修复原则：默认采用 `contract → implement → verify → repair → finalize`。仅在真实设计分叉时添加 planner，仅在独立工作面存在时增加 implementer。

## 5. 拒绝方案

以下方案不得作为本项目主实现：

1. **完整恢复旧 Fleet。** 已被旧 ALE trace 证伪；会恢复递归爆炸和环境断裂。
2. **简单把所有任务强制 T2/T3。** Tier 提升不修复 workspace、oracle 和 completion。
3. **继续增加 reviewer/verifier。** 当前多数 verifier 没有有效 verdict，且失败不会强制修复。
4. **仅修改 system prompt。** Prompt 无法保证进程继续、工作区一致或 exit code 正确。
5. **仅提高 token budget。** 失败运行已消耗更多 token；治理浪费会同步放大。
6. **读取或调用隐藏 grader。** 评测污染，禁止。只能使用任务公开文件、公开脚本和自建不泄露答案的检查。
7. **以文件存在替代内容正确。** 这是既有假完成的直接来源。
8. **为 benchmark 硬编码任务 ID 或答案。** 会过拟合并破坏通用能力。

## 6. 目标架构

### 6.1 深模块：`TaskExecutionController`

新增一个小接口、大实现的控制模块。调用方不再理解 G0–G7、receipt、nonce 或 role-specific 状态推进。

建议接口：

```ts
export interface ExecutionRequest {
  instruction: string;
  cwd: string;
  profile: "legacy" | "reliable-headless";
  deadlineMs: number;
  taskPaths?: {
    input?: string;
    output?: string;
    software?: string;
  };
}

export interface ExecutionResult {
  status: "completed" | "task_failed" | "harness_error";
  contract: TaskContract;
  attempts: ExecutionAttempt[];
  completion: CompletionDecision;
  finalText: string;
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface TaskExecutionController {
  execute(request: ExecutionRequest, signal?: AbortSignal): Promise<ExecutionResult>;
}
```

删除测试：假设删除该模块，task contract、workspace probe、dispatch、repair、completion、exit mapping 会重新散落到 print mode、AgentSession、spawn tool 和 adapters，说明该 seam 有足够深度。

### 6.2 `TaskContract`

建议结构：

```ts
export type TaskKind = "code" | "artifact" | "numeric-data" | "service-config" | "mixed";

export interface TaskContract {
  kind: TaskKind;
  requiredArtifacts: Array<{
    path: string;
    type?: string;
    nonEmpty: boolean;
  }>;
  forbiddenArtifacts: string[];
  constraints: Array<{
    id: string;
    description: string;
    authority: "task" | "public-check" | "derived-invariant";
  }>;
  checks: Array<{
    id: string;
    command: string[];
    cwd: string;
    timeoutMs: number;
    authority: "task" | "bundled-public" | "agent-authored";
  }>;
  environment: {
    requiredPaths: string[];
    requiredCommands: string[];
  };
  unresolved: string[];
}
```

规则：

- 原始 instruction 是最高任务真值。
- 文件系统发现只能补充事实，不能删除 instruction 中的要求。
- Agent 可提出 contract；宿主必须做 schema、路径和命令安全校验。
- `unresolved` 非空且会改变结果时，任务不能自动标记 completed。
- 无公共检查不等于自动失败，也不等于自动通过；使用结构约束、任务派生不变量和独立语义 verifier，并标记证据等级。

### 6.3 child 任务与结果接口

```ts
export interface ChildTask {
  role: "contract-solver" | "planner" | "implementer" | "verifier" | "repairer";
  objective: string;
  cwd: string;
  ownedPaths: string[];
  contract: TaskContract;
  priorFailure?: VerificationFailure;
}

export interface ChildResult {
  status: "completed" | "failed" | "blocked" | "invalid";
  summary: string;
  filesChanged: string[];
  commands: Array<{
    argv: string[];
    cwd: string;
    exitCode: number | null;
  }>;
  findings: Array<{
    code: string;
    message: string;
    evidence?: string;
  }>;
  proposedRepair?: string;
}
```

child 不再调用 `performance_gate`。退出码 0 且缺少合法 `ChildResult` 应返回 `invalid`，不能返回工具级 success + `no_verdict`。

### 6.4 默认可靠闭环

```text
controller workspace probe
    ↓
contract compile + deterministic validation
    ↓
optional planner/contract-solver
    ↓
one implementer in real shared cwd
    ↓
task-kind verifier
    ↓ fail
targeted repair with exact failure evidence
    ↓
re-run affected checks, then full completion checks
    ↓
controller completion decision and exit code
```

默认最多两次有实质差异的 repair。相同 failure fingerprint 连续出现时停止，返回 `task_failed`，避免无效循环。

### 6.5 路由原则

- 机械且有确定 checker：root/implementer 单执行者 + verifier。
- 局部不确定：增加一个 planner，禁止多 planner 投票。
- 多个不相交可写路径：允许多个 implementer；controller 验证 ownership 不重叠。
- 同一路径、同一服务、同一 output：顺序所有权，禁止并发写。
- Reviewer 仅在 diff/claim review 能提供不同证据时启用；普通 verifier 已同时覆盖行为和完成度时，不重复启动同证据 reviewer。
- Coordinator/manager 不是默认角色；只有真实 dependent work groups 才启用。

### 6.6 Completion decision

```ts
export interface CompletionDecision {
  passed: boolean;
  reasons: Array<{
    code: string;
    message: string;
    evidence?: string;
  }>;
  requiredArtifactsPresent: boolean;
  forbiddenArtifactsAbsent: boolean;
  checksPassed: boolean;
  unresolvedFindings: number;
}
```

`passed` 必须由宿主计算。任何 Agent 的 `PASS`、`DONE` 或自然语言声明只属于证据输入。

## 7. 实施 Issues

### Issue 0 — 固化基线与最小回归夹具

**当前状态：已验收。** 夹具和回归测试已落地；后续 Issue 3–5 必须复用这些 failure code，不能另建不兼容协议。

**目的**

在修改控制流前，把当前失败模式变成可重复红灯。否则只能依赖昂贵的 89-task 跑分定位回归。

**改动位置**

- 新增 `test/fixtures/performance-controller/`。
- 新增 `test/performance-controller-regressions.test.ts`。
- 可复用 `test/spawn-agent.test.ts`、`test/print-mode.test.ts`、`test/headless-benchmark-trace.test.ts`。

**必需夹具**

1. child exit 0，但没有 gate/result。
2. verifier 返回 fail，root 随后输出成功 final。
3. 必需产物缺失。
4. output 含 `.venv`、cache 或无关 runtime 文件。
5. 文件 schema 正确但数值 tolerance 失败。
6. child worktree 看不到 root staged path/venv。
7. 相同失败重复两次形成 no-progress fingerprint。

**完成标准**

- 夹具在当前实现上复现对应问题。
- 每个失败都有稳定 code，不断言完整自然语言。
- 不引用真实隐藏 grader 内容。

### Issue 1 — 引入 execution profile 与 Controller seam

**当前状态：主体完成，尚有生产接线缺口。** CLI/profile/exit mapping 已落地。第二轮先让 Controller 成为 reliable-headless 的真实执行入口，并禁止空 contract 默认成功。

**依赖**：Issue 0。

**改动位置**

- 新增 `src/core/task-execution-controller.ts`。
- 新增 `src/core/execution-types.ts`。
- 修改 `src/core/agent-session.ts` 或 `src/core/agent-session-runtime.ts`，注入 controller dependency。
- 修改 `src/modes/print-mode.ts`，使用 `ExecutionResult` 决定 final 与 exit code。
- 修改 `src/cli/args.ts`，增加实验性 `--execution-profile legacy|reliable-headless`。
- 如需公共调用，更新 `src/index.ts`；否则先保持 internal。

**约束**

- `legacy` 必须保持当前行为，提供兼容和回滚路径。
- 第一阶段只在 print/json headless 接入；不要顺带重写 TUI、RPC 或 Desktop。
- Controller 接收依赖，不在内部创建全局 AgentSession、process launcher 或 filesystem singleton。

**完成标准**

- `legacy` 现有测试不回归。
- `reliable-headless` 的 final/exit 完全由 `ExecutionResult.status` 决定。
- `completed → exit 0`、`task_failed → exit 1`、`harness_error → exit 2`。
- active/incomplete run 不能输出成功状态。
- contract 未编译、oracle 未运行或 completion evidence 缺失时不能输出成功状态。
- 生产路径必须覆盖 Controller 自身 `execute()`；只测试注入 `executionResult` 或 post-hoc finalizer 不算完成。

### Issue 2 — 工作区与执行环境同一性

**当前状态：主体完成，缺真实 child 集成验收。** shared cwd、task path、probe、owner mutex 已落地；mock process 单测不能替代下述跨进程可见性证明。

**依赖**：Issue 1。

**改动位置**

- 修改 `src/core/tools/spawn_agent.ts`。
- 修改 `src/core/worktree.ts`。
- 修改 `src/core/agent-session.ts` 中 child runtime context。
- 修改 `adapters/harbor_tb/agent.py`。
- 修改 `adapters/ale/metis_adapter.py` 和/或 `adapters/ale_official` 对应入口。
- 扩展 `test/worktree-and-env.test.ts`、`test/spawn-agent.test.ts`、`test/terminalbench-adapter.test.ts`、`test/ale-adapter.test.ts`。

**要求**

- `reliable-headless` 的 mutating child 默认 `workspacePolicy=shared`。
- 传递并验证 canonical cwd 及 input/output/software 绝对路径。
- 宿主在 spawn 前执行最小 probe：路径存在、可读写权限、必要命令可解析。
- 共享 cwd 下同时只允许一个 mutating owner。
- isolated workspace 需要显式 route 决策和可隔离证据。
- reviewer/verifier 只能在 implementer 结束后读取冻结版本。

**完成标准**

- child 能看到 root 的 staged task files、未跟踪输入和任务 venv。
- child 修改在 root 完成检查前立即可见，不需要人工 cherry-pick。
- 两个 mutating child 声明重叠 owned paths 时确定性拒绝。
- probe 失败返回 harness error，不允许 root 制作占位产物。
- 至少一个测试启动真实 fixture child，验证 cwd、公开任务路径、未跟踪文件、任务环境和 child 写入在 root 中一致可见。
- 至少一个测试证明 verifier/reviewer 在 mutating owner 释放后读取冻结版本，不与 implementer 并发观察半成品。

### Issue 3 — TaskContract 编译与任务类型 verifier

**依赖**：Issue 1；可与 Issue 2 部分并行。

**改动位置**

- 新增 `src/core/task-contract.ts`。
- 新增 `src/core/task-verifier.ts`。
- 新增 `test/task-contract.test.ts`、`test/task-verifier.test.ts`。
- Adapter 通过 `ExecutionRequest.taskPaths` 提供 benchmark 路径，不在 core 硬编码 Harbor/ALE。

**要求**

- 支持 `code | artifact | numeric-data | service-config | mixed`。
- 每条 constraint 保留 authority 和 evidence。
- checker 以 argv 数组表示，禁止拼接 shell 字符串作为唯一形式。
- 公开任务脚本优先于 Agent 自建检查。
- 结构检查先执行；统计/语义检查后执行。
- 禁止探测、读取或调用隐藏 grader。
- verifier 返回逐 constraint 结果，不能只返回一个总 PASS。

**完成标准**

- 缺文件、污染文件、格式错误、数值越界、服务不可达都有不同失败 code。
- “文件存在但内容错误”夹具失败。
- 无公共 checker 时，evidence level 明确降低，不能自动 PASS。
- 修改输入或产物后，旧 evidence 自动失效。

### Issue 4 — Controller-owned child result 与 gate 推进

**依赖**：Issue 1、Issue 2。

**改动位置**

- 修改 `src/core/tools/spawn_agent.ts`。
- 修改 `src/core/performance-runtime.ts`。
- 修改 `src/core/tools/performance-gate.ts`。
- 修改 `src/core/agent-definition.ts`，从普通 worker prompt 删除 receipt/gate 负担。
- 扩展 `test/spawn-agent.test.ts`、`test/performance-runtime.test.ts`、`test/performance-mode.test.ts`。

**要求**

- child 输出唯一 `ChildResult` schema。
- Controller 从 child result、filesystem snapshot、command events 生成 gate report。
- 普通 planner/implementer/reviewer/verifier 不直接调用 `performance_gate`。
- `performance_gate` 可暂时保留给 legacy profile，禁止破坏兼容。
- child exit 0 + invalid/missing result 为 `CHILD_RESULT_INVALID`。
- 工具级成功与业务成功分离，但不存在 `success + no_verdict` 的终态。

**完成标准**

- 新 profile 中 `no_verdict` 路径不可达。
- gate schema/receipt path 错误归零。
- child 的实际 files/commands 与声明不一致时，Controller 拒绝业务 pass。
- legacy profile 现有 gate 测试继续通过。

### Issue 5 — 自动 repair loop 与强制 completion guard

**依赖**：Issue 3、Issue 4。

**改动位置**

- 实现于 `src/core/task-execution-controller.ts`。
- 修改 `src/modes/print-mode.ts`。
- 必要时在 `src/core/agent-session.ts` 增加受控 continuation seam。
- 新增 `test/task-execution-controller.test.ts`；扩展 `test/print-mode.test.ts`。

**要求**

- verifier fail 自动创建定向 repair task，附 exact failure evidence。
- repair 完成后先重跑受影响检查，再跑完整 completion checks。
- 最大两次 materially different repair。
- failure fingerprint 至少包含 check id、exit code、标准化错误摘要和相关产物 hash。
- 相同 fingerprint 连续出现时停止，不刷新预算。
- Assistant final 不能绕过 active/failed run。
- 失败 final 可以解释 blocker，但 exit code 必须为 1 或 2。

**完成标准**

- verifier fail 后必然出现 repair 或明确 terminal failure。
- 没有 `completed` decision 时不会写成功 final。
- 必需产物缺失、污染、未解决 finding 任一存在都阻止 completion。
- 旧 trace 中“模型承认失败但 exit 0”的回归夹具转绿。

### Issue 6 — 用短闭环替换 tier 驱动 Fleet

**依赖**：Issue 3、Issue 5。

**改动位置**

- 修改 `src/core/system-prompt.ts`。
- 修改 `src/core/agent-definition.ts`。
- 修改 `src/core/performance-runtime.ts` 或新增 `src/core/execution-policy.ts`。
- 扩展 `test/performance-admit.test.ts`、`test/performance-runtime.test.ts`、`test/agent-definition.test.ts`。

**建议接口**

```ts
export interface ExecutionPlan {
  implementationOwner: "root" | "implementer";
  workspacePolicy: "shared" | "isolated";
  plannerRequired: boolean;
  verifierKind: TaskKind;
  independentLanes: Array<{
    id: string;
    ownedPaths: string[];
    dependencies: string[];
  }>;
  maxRepairAttempts: number;
}
```

**规则**

- 单输出不代表简单；按 uncertainty、oracle 和环境依赖判断。
- 默认闭环是 contract → implementer → verifier → repair。
- planner 只处理会改变实现的真实不确定性。
- Coordinator/manager 只处理 dependent work groups。
- Reviewer 需要不同于 verifier 的证据责任，否则省略。
- 所有 role prompt 删除重复 doctrine，只保留角色动作、输入、禁止项和结果 schema。

**完成标准**

- 普通单产物任务不会产生 L0→L4 递归树。
- 复杂任务能出现 planner/implementer，但不是为了满足计数指标。
- 任一 spawned role 都有可说明的独立信息增益。
- prompt snapshot 测试证明 child 不继承无关 controller doctrine。

### Issue 7 — Trace 聚合与离线验收

**依赖**：Issue 1–6。

**改动位置**

- 修改 `src/core/trace-collector.ts`。
- 修改 `src/core/tools/spawn_agent.ts` 的 child event 汇入。
- 扩展 `test/headless-benchmark-trace.test.ts`。
- 修改 Harbor/ALE adapter 的结果元数据。
- 新增只读分析脚本，建议放入 `scripts/eval/`。

**每次运行必须记录**

- profile、Metis commit、model、thinking、provider。
- root 和每个 child 的实际 cwd、workspace policy、role、model。
- TaskContract hash、产物 hash、checker 定义 hash。
- child 业务结果、命令退出码、repair 次数和 failure fingerprint。
- completion decision 及每条 reason。
- root + child 的 token、latency、tool errors。
- 若 adapter 已收到 official verifier reward，可原样记录；实现和测试不得主动调用 official verifier。

**离线验收顺序**

1. 把既有 trace 中的假完成、`no_verdict`、环境断裂和 output 污染转换为脱敏夹具。
2. 运行 TaskContract、ChildResult、CompletionDecision 单元测试。
3. 运行 shared-cwd、repair loop、final guard 集成测试。
4. 运行现有 performance、spawn、print、adapter 回归测试。
5. 运行 `npm run build` 和 `git diff --check`。

**完成条件**

- 所有确定性测试通过。
- 既有 trace 派生失败夹具全部转绿。
- 新 profile 中 `no_verdict`、假完成、环境漂移和 output 污染路径均有不可绕过的失败断言。
- Trace 能解释每次 dispatch、verification、repair 和 completion decision。
- Cursor 不启动 Terminal-Bench、ALE、official grader 或 benchmark sentinel run。

## 8. 硬性指标

新 profile 合入默认前必须满足：

| 指标 | 当前观察 | 目标 |
|---|---:|---:|
| child `no_verdict` | 64.2% | 0% |
| gate/schema/receipt 错误 | 644 个控制面错误中的主要部分 | 新 profile 0 |
| 未完成却 success exit | 已观察 | 0 |
| verifier fail 后无 repair/terminal failure | 已观察 | 0 |
| reliable-headless child 环境 probe | 非确定 | 100% |
| output pollution | 已观察 | 0 |
| required artifact completeness | 多个失败 | 100% 检查覆盖 |
| child trace 聚合 | root summary 不完整 | 100% |

时间和 token 是二级观测指标，不作为本次实现完成条件。不得以“流程更完整”替代上述确定性断言。

## 9. 测试矩阵

### 单元测试

- TaskContract schema、路径规范化、authority、hash invalidation。
- Task kind 分类边界。
- CompletionDecision 各失败 code。
- failure fingerprint 稳定性。
- ExecutionPlan ownership 和 dependency 校验。
- ChildResult 缺字段、虚假 changed files、命令声明不一致。

### 集成测试

- shared cwd child 读取 input、调用 software wrapper、写 output。
- verifier fail → repair → pass。
- verifier fail → 相同失败 → terminal task failure。
- assistant 尝试 final，但 run active → final 被拒绝。
- child exit 0 无结构化结果 → harness error/invalid child，不是 pass。
- isolated lane 显式集成后 verifier 看到同一冻结版本。
- AbortSignal、deadline、child timeout 全链传递。

### 模式回归

- `print`：exit code 与 final 分离正确。
- `json`：事件流包含 ExecutionResult 和 child events。
- `tui/rpc/sdk`：第一阶段不得因 headless seam 改变既有行为；后续接入需单独 issue。
- Harbor/ALE：adapter 传入 canonical task paths，不传隐藏 verifier 路径。

### 评测安全边界

- 不读或运行 hidden tests、official grader、Terminal-Bench、ALE benchmark。
- 只使用脱敏 trace 派生夹具和仓库内测试资源。
- 夹具不得包含隐藏答案、任务专用答案或 grader 实现。
- 保存每个夹具的 contract、checks、repair、completion decision，保证回归可解释。

## 10. 实施顺序与提交边界

推荐提交顺序：

1. `test: capture headless false-completion regressions`（已落地）
2. `feat: add reliable headless execution controller seam`（主体已落地，需收口生产入口）
3. `fix: preserve benchmark workspace and task environment for children`（主体已落地，需补真实 child 集成测试）
4. `feat: compile task contracts and select task-kind verifiers`
5. `refactor: move gate evidence ownership from model to controller`
6. `feat: enforce repair loop and completion decision`
7. `refactor: replace default fleet with value-based short routing`
8. `test: add recursive trace aggregation and offline acceptance fixtures`

每个提交只解决一个 failure class。不得把 profile、workspace、contract、repair、prompt 全塞入一个大提交；否则无法定位回归来源。

## 11. Cursor 执行规则

Cursor 实现时遵守：

1. Issue 0–7 已完成；后续变更从失败回归或新 trace 证据开始，不得重建旧 Fleet 或绕过当前 Controller。
2. 每个 issue 开始前读取对应源码和现有测试，不根据本文猜测函数形状。
3. 保留 `legacy` profile，直到新 profile 完成全部确定性测试并具备明确回滚路径。
4. 不修改无关 Desktop 文件或用户现有 dirty changes。
5. 不手改 `dist/`。
6. 新公共类型若导出，更新 `src/index.ts` 并增加类型/运行时测试。
7. 每个 issue 结束运行目标测试、`npm run build`、`git diff --check`。
8. 任何测试超时都按失败处理，不能当作通过。
9. 报告精确命令与结果；不以 diff 或 Agent 自述证明正确。
10. 本轮已按 Issue 1 收口 → Issue 2 集成验收 → Issue 3 → 4 → 5 → 6 → 7 完成；后续继续禁止用 benchmark 代替仓库内确定性验收。
11. 禁止保留任何 `EMPTY_TASK_CONTRACT`、缺 oracle 或缺 evidence 时默认 PASS 的兼容分支；兼容仅由 `legacy` profile 承担。

## 12. 尚未证明的假设

以下内容仍未证明，不属于本次实现验收，也不应写进实现注释作为事实：

- Luna low 是否能从独立 planner 获得稳定收益。
- OpenCode + Autoprompt 的 +13 中有多少来自 planner、implementer、verifier 或 repair。
- 两次 repair 是否是最佳预算；先作为安全上限验证。
- 共享 cwd 是否适合所有 Metis 用户；当前只要求 reliable-headless profile。
- host-owned contract-solver 只接受四类声明式 oracle；它对复杂自然语言约束的覆盖率和完整性仍依赖模型输出，仓库测试只证明非法输出会 fail closed。
- 未运行真实联网模型 child 的端到端任务；当前证据覆盖真实 production tool definition、进程参数和 policy/ownership，但 child 输出由进程层 fixture 提供。
- 未重跑 Terminal-Bench/ALE，因此本次改动对 43.82% 的实际提升幅度仍未知。

## 13. 最终问题定义

Metis 此前不是“缺少 Autoprompt 架构”，而是缺少一个能把该架构可靠执行出来的宿主控制层：

- 优化前，模型用自然语言模拟多层 controller，导致治理空转和环境断裂。
- 优化后，路由减少空转，却同时退化成单 Agent 主执行。
- 两版都让模型控制 completion，都没有把 verifier failure 变成不可绕过的修复义务。
- 两版都没有用任务真实 oracle 决定提交是否正确。

当前 worktree 已实现这层宿主控制链，并通过仓库内离线验收。剩余问题从“链路是否存在”变成“真实模型下的 contract 覆盖率、短路由收益和 benchmark 效果是否足够”。

修复成功的定义只有一个：

> 在同一真实评分工作区中，独立检查产生的失败证据被宿主代码强制送回实现者，修复后重新运行正确 oracle；只有所有任务契约成立时，进程才返回成功。
