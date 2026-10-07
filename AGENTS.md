# Agent Development Guide

This file is for AI coding agents contributing to Metis. Treat it as repository-level operating guidance. User and system instructions always take precedence.

## Objective

Help developers change Metis quickly without sacrificing scope control, compatibility, or verification. Prefer evidence from the repository over assumptions.

## Start Every Task

1. Restate the requested outcome and concrete acceptance criteria.
2. Read `git status --short` and strictly preserve unrelated user changes and dirty worktree files.
3. Search for relevant code, tests, docs, and existing abstractions before editing.
4. Read the nearest applicable `AGENTS.md` if a nested one exists.
5. Identify affected modes and surfaces:
   - **CLI / TUI**: Interactive terminal UI (`src/modes/interactive/`, `vendor/metis-tui/`)
   - **Headless / Print**: Non-interactive execution (`src/modes/print-mode.ts`)
   - **RPC / JSON**: Programmatic streaming and JSON protocols (`src/modes/rpc/`, `src/rpc-entry.ts`)
   - **Server**: HTTP / SSE server engine (`src/modes/server/`)
   - **Desktop**: Electron host (`desktop/main.cjs`) + React frontend (`desktop/src/`)
   - **SDK / Core**: Public API and core session management (`src/core/agent-session.ts`, `src/core/sdk.ts`)
   - **Extensions & Packages**: User extensions, MCP, package manager (`src/core/extensions/`, `src/core/package-manager.ts`)
6. Decide the smallest validation set that can prove the change works.

If `.codegraph/` exists and its tools work, use CodeGraph before broad text search for code understanding (`codegraph explore "<query>"`, `codegraph node <symbol-or-file>`). If the index is missing or malformed, state that once and fall back to `rg` and targeted file reads.

## Repository Map

| Area | Primary paths | Notes |
| --- | --- | --- |
| CLI entry and routing | `src/main.ts`, `src/cli/`, `src/modes/` | Parses CLI flags, routes to execution modes |
| Agent session and SDK | `src/core/agent-session.ts`, `src/core/agent-session-runtime.ts`, `src/core/sdk.ts` | Session lifecycle, compaction, cancellation, history persistence |
| Models & Providers | `src/core/model-registry.ts`, `src/core/model-resolver.ts`, `src/core/providers/` | Model registry, auto-detection, custom providers, streaming |
| Built-in model tools | `src/core/tools/` | Standard coding tools (`read`, `edit`, `write`, `bash`, `grep`, `find`, `ls`), `update-plan`, `browser`, `video`, etc. |
| Self-Learning Adaptations | `src/core/adaptations/`, `src/core/tools/adapt.ts` | Dynamic runtime architecture adaptation, outcome ledger, idle learner, journal/snapshots |
| Multi-Agent & Orchestration | `src/core/tools/spawn_agent.ts`, `src/core/agent-definition.ts` | Recursive subagent delegation, worktrees, roles, and capability scoping |
| Performance & Plan Runtime | `src/core/performance-runtime.ts`, `src/core/workflow-runtime.ts`, `src/core/tools/update-plan.ts` | Execution plan tracking, roadmap gates, progress narration |
| Server mode (Backend API) | `src/modes/server/`, `src/modes/server/server-mode.ts` | Metis HTTP & SSE server used by Desktop and external clients |
| Desktop Electron Host | `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/main-menu.cjs` | Main process, contextBridge, IPC handlers, server lifecycle |
| Desktop React Frontend | `desktop/src/` (`App.tsx`, `components/`, `hooks/`, `lib/`, `styles/`) | React 18 + Tailwind CSS v4 UI source of truth |
| Desktop i18n | `desktop/i18n-source.cjs`, `desktop/scripts/generate-i18n-catalogs.mjs` | Canonical translation strings and catalog generator |
| Desktop Build Artifacts | `desktop/renderer/`, `desktop/dist/` | Generated Vite bundle and Electron distribution output — NEVER edit by hand |
| Extensions | `src/core/extensions/`, `docs/extensions.md`, `examples/extensions/` | Extension API, runtime runner, wrapper, TypeBox tool registration |
| Package loading | `src/core/package-manager.ts`, `docs/packages.md` | Skill and package discovery and resolution |
| Vendored dependencies | `vendor/metis-agent-core/`, `vendor/metis-ai/`, `vendor/metis-tui/` | Vendored workspace modules; edit only when fixing upstream issues |
| Benchmarking & Adapters | `adapters/` (ALE, Harbor, TerminalBench) | Benchmark evaluation harnesses and test adapters |
| Public exports | `src/index.ts`, `src/rpc-entry.ts` | Public npm package exports |
| Tests | `test/`, `vitest.config.ts` | Vitest test suites (CLI, Server, Core, Desktop) |
| Documentation | `README.md`, `README.zh-CN.md`, `docs/` | User and architectural documentation |

Do not modify `vendor/` unless the requested behavior belongs to a vendored package. Do not edit generated `dist/` or `desktop/renderer/` output by hand.

**LINUX DO 开源推广（gotcha）**：公开版面发帖须完整开源 + 默认分支 README 已挂认可 [LINUX DO](https://linux.do) 链接 + `#开源推广` 模板五项全「是」。站规禁止 AI 生成/润色正文；仓库根目录 [`linuxdo-metis-post.md`](linuxdo-metis-post.md) 是发帖材料包（合规清单与可截图介绍），**不得**把其段落直接粘贴到 linux.do。本地改 README 未推默认分支不算友链已挂。

## Desktop Frontend Changes (Mandatory)

Before any change under `desktop/`, any Desktop-facing Server endpoint, or any `test/desktop-*.test.ts` file, read `docs/desktop-frontend-development.md` completely and follow it as repository instructions.

Non-negotiable rules:

- **Source of truth**: `desktop/src/` is the modern React 18 + TypeScript + Tailwind CSS v4 source of truth. Treat `desktop/renderer/` and `desktop/dist/` strictly as build artifacts (`vite build && node scripts/build.mjs`). Never hand-edit files in `desktop/renderer/` or `desktop/dist/`.
- **Trace the complete path**: Trace from `desktop/main.cjs` through `desktop/preload.cjs`, IPC bridges (`desktop/sse-ipc-bridge.cjs`), custom hooks (`desktop/src/hooks/useMetisServer.ts`), active React state/components, and final styling. Do not infer runtime ownership from filenames or screenshots.
- **Development vs. Production loading**:
  - In development (`npm --prefix desktop run dev`), Electron loads the Vite dev server at `http://localhost:5173`.
  - In built mode (`npm --prefix desktop run start:dist`), Electron loads `desktop/renderer/index.html`. Source changes require `npm --prefix desktop run build` before running `start:dist`.
- **Styling and CSS**: Desktop styles use Tailwind CSS v4 and scoped styles in `desktop/src/index.css` and `desktop/src/styles/`. Check for layered rules, container queries, and platform-specific classes (`platform-darwin`, `platform-win32`, `platform-linux`) on `document.body`.
- **State flow, SSE, and render lifecycle**:
  - Metis Server SSE stream events flow through `main.cjs` → IPC `metis:event` → `useMetisServer.ts` state reducer.
  - Account for SSE sequence deduplication, session filtering, and snapshot reconciliation (`/session`, `/session/messages`, `/sessions`).
  - Transcript rendering: preserve message object identity and avoid unmounting the transcript tree on conversation switch (key by session id safely).
  - **Abort/reconcile duplicate turn (gotcha)**: SSE `toMessage` synthesizes ids as `role-<timestamp>` because metis-ai messages have no `id`; `/session/messages` uses session `entry.id`. After `agent_end` → `loadMessages`, `adoptSnapshotWithoutRegressing` must match live vs snapshot by `role` + `serverTimestamp` (not id alone), or the same user+assistant turn renders twice (common after `Request was aborted`). Test with `npm test -- test/desktop-chat-performance.test.ts -t "does not duplicate a completed turn"`.
  - **SSE mid-turn blip (gotcha)**: A transient SSE drop must not clear live `isStreaming` / the bottom "思考中" row while the agent is still running. `onDisconnect` keeps streaming when local was streaming, probes `/session`, and only clears when the server reports idle (probe failure keeps thinking until `server.connected` + `loadMessages`). Live IPC must not forward multi-MB screenshot base64 — `desktop/sse-ipc-bridge.cjs` strips `image.data` before `webContents.send` (session JSONL and `/session/messages` still keep full images).
  - **Streaming heat (gotcha)**: Live final answers use Streamdown with `animated={false}` in `PacedMarkdown.tsx` — never re-enable per-word `blurIn` / `sep: 'word'` (each token creates a compositor layer with `filter: blur`). `DesktopI18nProvider` must only full-walk the document on language change; MutationObserver updates are incremental and must skip `.markdown-content` subtrees (`FILTER_REJECT`). Trailing work narration passes `streaming` into `MarkdownContent` so settled segments keep the LRU cache.
- **Assistant work and Turn boundaries**:
  - Assistant work spans multiple messages, tool calls, and status cards.
  - Preserve turn-level ownership, stable part identities, tool UI contracts, collapsed/expanded thinking and tool blocks, and the boundary between in-progress work and final responses.
  - **Tool row leading icons (gotcha)**: Ordinary tool rows omit leading decorative icons — `BasicTool` has no `icon` prop, `ToolCard` does not pass one, and `ToolChips` / `ai-agent-response` rows keep chevron/status affordances only. **Exception**: `TaskToolChip` keeps `SubagentIcon` (and the running spinner). Context groups already have no leading icon. Do not reintroduce Glasses / Wrench / tool-type Lucide icons on non-subagent triggers unless product asks for icons again.
  - **Composer prompt rewrite (gotcha)**: `desktop/src/lib/prompt-rewrite.ts` swaps one exact composer trigger for a longer model-facing prompt inside `useMetisServer.sendMessage`; `revealPromptForDisplay` maps it back for the user bubble, copy button, and sidebar titles. Only an exact (trimmed) match rewrites. Keep the English fuse paragraph (`does not skip performance_admit`, `root-owned zero spawn`). Test with `npm test -- test/desktop-react-prompt-rewrite.test.ts test/desktop-react-user-bubble.test.ts`.
  - **Inspector browser-fit (gotcha)**: `desktop/src/lib/browser-fit.ts` (+ twin `desktop/browser-fit.cjs`) must fit **media/SVG documents only** (`shouldFit = media || isSvgUrl`). Do not treat arbitrary `file://` HTML apps as media — flex-centering those pages makes the painted size look like the Inspector panel, and agents bake that size into source (letterboxing in external browsers). Canvas-only media fills the viewport (`object-fit: fill`); img/video/SVG keep `contain`/`meet`. Keep host/renderer scripts contract-tested in sync. The `metis-browser` skill forbids hardcoding Inspector panel pixel sizes into authored layouts.
  - **Inspector reserved port 5173 (gotcha)**: Port 5173 is reserved for Metis Desktop Vite (`desktop/vite.config.ts` / `desktop/scripts/dev.mjs`). Agent `browser_navigate` / `browser_tabs` reject `:5173` URLs; when browser_* tools are active, bash also rejects binding preview/test servers to 5173 (including bare `vite` / `vite preview`). Agents must use another port (e.g. `--port 4173`). Manual address-bar navigation is unaffected; `desktop/browser-host.cjs` does not enforce this (tool layer does).
  - **Inspector browser input (gotcha)**: `desktop/browser-host.cjs` must drive click / press_key / mouse via guest `sendInputEvent` (trusted). Do not synthesize `el.click()` or untrusted `KeyboardEvent` for those ops — pointer lock and game `keydown`/`code` listeners ignore them. `press_key` maps `w`/`KeyW` → Electron `keyCode` `W` with `holdMs` before `keyUp`. FPS look after lock must send `movementX`/`movementY` on `browser_mouse` move/look (absolute x/y alone does not turn the camera). Clicks wait briefly for `pointerlockchange` before reporting `pointerLocked`. **`browser_scroll` fusion**: send trusted `mouseWheel` at ref center or viewport mid with `hasPreciseScrollingDeltas` (pixel `deltaX`/`deltaY` — never treat pixels as `wheelTicks`, never aim at fixed `(10,10)`); if `window.scrollX/Y` did not move, fall back to `window.scrollBy` so ordinary documents still scroll while games still receive wheel. Screenshots crop **standalone SVG documents only**; never `querySelector('svg')` on HTML apps (HUD icons). Localhost/127.0.0.1 same-URL navigate uses `reloadIgnoringCache()`; remote URLs keep the fitted skip path.
  - **Inspector browser permissions (gotcha)**: `persist:metis-browser` session must allow `pointerLock` (and `fullscreen`) via `setPermissionCheckHandler` / `setPermissionRequestHandler`. Denying all permissions makes every enter-game click report `pointerLocked: false` and blocks FPS look.
- **Copy and i18n**:
  - All Desktop copy changes must be made in `desktop/i18n-source.cjs`.
  - Regenerate catalogs with `node desktop/scripts/generate-i18n-catalogs.mjs` (which updates `desktop/src/i18n-catalogs.cjs` and `desktop/src/i18n-catalogs.js`).
  - In React components, consume strings via `useTranslation()` / `t()`.
  - Maintain key and placeholder parity across all supported languages (en, zh-CN).
  - DOM auto-translate (`desktop/src/i18n.tsx`) caches the reverse English catalog and compiled template matchers; do not rebuild them per text node.
  - **Direct key resolution in translateExact (gotcha)**: `translateExact` and `SettingsDialog`'s `translate` helper resolve canonical catalog keys (e.g. `selfLearning`, `learnedAdaptations`) directly as well as natural English sentences, supporting optional variable interpolation (`{count}`, `{name}`). Never rely purely on reverse English lookup when code passes catalog identifiers.
- **macOS DMG packaging & troubleshooting (gotcha)**:
  `desktop/scripts/package-macos.mjs` generates a styled DMG with a Retina-ready TIFF background (`desktop/public/assets/dmg-background.svg`), centered arrow, 660x480 window bounds, left `Metis.app` (165, 175), right `Applications` (495, 175), and bottom-centered bilingual help directory `Cannot Open? (打不开？)` (330, 365) containing `How-to-Open (打不开点我).txt` (sourced from `desktop/scripts/dmg-help-content.mjs`). Troubleshooting guides MUST emphasize moving the app to `/Applications` first before running commands, provide `xattr -cr /Applications/Metis.app` (and `sudo xattr -cr`), and instruct macOS 15 Sequoia users on System Settings (Control-click bypass is deprecated). Finder AppleScript styling includes an automated graceful fallback for headless CI environments. Test with `npm test -- test/desktop-macos-dmg-help.test.ts`.
- **Desktop installer size (gotcha)**: `desktop/scripts/prune-packaged-app.mjs` runs from the macOS DMG, Windows ZIP, and NSIS packagers after `npm ci`. It deletes `onnxruntime-node` binaries for other OS/CPU targets, `onnxruntime-web` `.wasm` files (Node transcription uses `onnxruntime-node`; the static web import still resolves), and `node_modules` source maps. It also removes Electron `.lproj` / `locales/*.pak` other than English and Chinese, before codesign or ZIP/NSIS. Do not delete `dist/video-bin` ffmpeg/ffprobe or `photon` wasm. Test with `npm test -- test/desktop-package-prune.test.ts`.
- **Windows 11 caption buttons & titlebar overlay (gotcha)**: Traffic light spacers (`w-[66px]`) must only render on macOS (`isMac`). On Windows, caption buttons (minimize/maximize/close) are placed at the top-right via `titleBarOverlay`; right-aligned headers (`ChatHeader` when Inspector is closed, and `Inspector` when open) require right padding (`pr-[140px]`) on Windows so interactive buttons are not covered by system controls.
- **Cross-platform path equality in sessions (gotcha)**: Never compare session paths or project paths with strict `===` or `!==`. Windows drive letters (`C:` vs `c:`) and slashes (`\` vs `/`) differ across Node, dialogs, and browser state. Always use `pathsEqual()` in desktop React hooks and `pathsMatch()` in server mode.
- **Conversation history windowing (gotcha)**: Long chat sessions (> 25 turns) mount the latest `INITIAL_VISIBLE_GROUPS` (25 turns) on initial open or switch. Scrolling near the top silently pages earlier turns (`LOAD_MORE_GROUPS_STEP = 25`) with scroll-height delta adjustment to prevent viewport jumps. This avoids mounting hundreds of complex components and multi-MB tool outputs at once.
- **Review directory tree view (gotcha)**: The Inspector Review panel supports both hierarchical Tree view and flat List view (persisted via `metis:review:view-mode`). Tree view computes aggregate additions/deletions for folders and supports expand/collapse while preserving `data-review-file` and `data-active` attributes on file items.
- **Self-learning Settings & User Profile traits (gotcha)**: User profile traits from `effective.ts` provide `statement: string` (not `trait`), `dimension` (not `category`), `confidence: number`, and optional `userStated?: boolean`. The Self-Learning panel in `desktop/src/components/settings/SettingsDialog.tsx` renders them using concentric `rounded-card bg-surface shadow-card` containers, localized dimension tags (`communication`, `coding_style`, etc.), tabular confidence pills, clean metric tiles for the evaluator dashboard (total runs, win rate, active/trial/retired), and removes redundant status pills beside the global toggle to match Metis Settings conventions.
- **Verification and repeatable evidence**:
  - Visual changes require repeatable runtime evidence such as computed styles, bounding boxes, DOM/ARIA assertions, or the Electron capture path. Computer Use and screenshots may assist diagnosis but are not final proof.
  - Run targeted Desktop tests (e.g. `npm test -- test/desktop-react-*.test.ts`, `test/desktop-*.test.ts`), `npm --prefix desktop run build`, and `git diff --check`. Report exact failures; never claim success from a diff, a timeout, or an unverified visual assumption.

## Server Mode & IPC Guidelines

When modifying Server endpoints (`src/modes/server/`) or Desktop-Server communication:

- **Protocol contracts**: Metis Server serves HTTP REST and SSE on `127.0.0.1`. Preserve the contract for `/session`, `/sessions`, `/session/messages`, `/session/prompt`, `/session/abort`, `/config`, and `/files`.
- **SSE event stream**: Events are emitted with monotonic sequence numbers and session IDs. Changes to event payloads must be backward-compatible with both Desktop and headless consumers.
- **Cancellation & Abortion**: Aborts must cleanly terminate in-flight model requests and child processes without leaving orphan subagents or corrupting session history.
- **Mainland China Gitee version mirror & single-parse sessions (gotcha)**: `resolveManifestSources` automatically detects mainland China environments (timezones such as `Asia/Shanghai`, `PRC` or `zh` locale) and races the Gitee release API (`oliverhuchenrui/metis`) concurrently with GitHub (`latest-version.json`). `METIS_GITEE_TOKEN` is appended only when set; never hardcode a Gitee access token in source. The desktop update download link always targets GitHub releases. `SessionManager.open` reads only the first line for the session header rather than parsing full multi-megabyte JSONL files twice, and `sessionInfoCache` persists to `~/.metis/agent/cache/sessions-index-v1.json` so cold-start `/sessions` listings avoid re-reading unchanged files.
- **Full conversation history on reload & compaction omission (gotcha)**: `GET /session/messages` returns all conversational messages along the active branch (`session.sessionManager.getBranch()` filtered to `entry.type === 'message'`) falling back to `session.messages`. This ensures reloading or switching sessions preserves complete historical conversation turns even after context compaction pruned `session.messages`. On the desktop frontend, `toMessage()` in `useMetisServer.ts` and `MessageList.tsx` omit `compactionSummary` messages so compaction summaries/cards are not displayed in the chat flow.
- **Verification**: Run `npm test -- test/server-mode.test.ts` and `npm test -- test/desktop-server-connection.test.ts`.

## Implementation Loop

1. **Investigate** — trace callers, state ownership, error handling, tests, and documentation.
2. **Plan** — list files to change and checks to run. Avoid speculative rewrites.
3. **Implement** — follow existing TypeScript and ESM patterns. Keep public types explicit.
4. **Test** — cover success, failure, cancellation, empty input, boundaries, and regression risk.
5. **Review** — inspect the diff for unrelated changes, stale docs, and accidental generated files.
6. **Update AGENTS.md** — every time you edit code or workflows, review and update `AGENTS.md` to reflect new patterns, paths, architectural decisions, or test commands.
7. **Verify prompt fidelity** — compare the result with every original requirement and later clarification.

Never report completion while a required build, test, file, or user requirement remains unfinished.

## Continuous Maintenance of AGENTS.md (Mandatory)

Every time an agent/model completes editing in this repository, it MUST review and update `AGENTS.md`:

- **Keep It Synchronized**: Whenever you add, modify, or refactor functionality, adjust commands, touch architectural surfaces, or establish new patterns, update `AGENTS.md` in the same turn before finishing.
- **Record Nuances & Gotchas**: If you discover non-obvious runtime behaviors, test quirks, platform nuances, or build constraints, document them in the appropriate section of `AGENTS.md`.
- **Preserve Invariants**: When updating `AGENTS.md`, never drop mandatory contractual strings (such as those checked by `test/desktop-frontend-guide.test.ts`) or release pipeline invariants.
- **Prune Stale Guidance**: Actively clean up outdated assumptions so future agents do not follow deprecated patterns.

## Built-in Tools & Plan Tracking

When implementing or modifying model tools (`src/core/tools/`):

- **TypeBox schemas**: Define strict, complete TypeBox schemas with human-readable descriptions for every property.
- **Session plan tracking (`update_plan`)**:
  - Used by models to maintain a visible implementation/verification checklist.
  - Steps must have `pending`, `in_progress`, or `completed` status. At most one step may be `in_progress` at any time.
  - Step descriptions and explanations must match the language of the user's latest prompt.
  - Guard against false completion: do not allow marking all steps completed while a performance run or active subtask is unfinished.
  - **Stale checklist nudge (gotcha)**: After an active checklist is created, root sessions inject a `workflow_context` reminder (`reason: checklist`) every 8 mutating tools (`write` / `edit` / mutating `bash` / mutating `browser_*`) without another `update_plan`. Explore tools (read/grep/screenshot) do not count. Failed verify checks still take priority. Named subagent sessions skip progress nudges (`!_namedAgentSession`).
  - **Strict language consistency (gotcha)**: Models must strictly match the language of the user's latest prompt across all visible outputs (visible intermediate milestone notes before tools, `update_plan` steps, questions, and final answers). Both `DEFAULT_BASE_INSTRUCTIONS`, `PLAN_BASE_INSTRUCTIONS`, `turnBoundaryGuidance`, and `formatProgressNudge` enforce that models must never switch spontaneously to English or another language when the user prompt is in Chinese or another language. Test with `npm test -- test/system-prompt.test.ts`.
- **Filesystem mutations**: Coordinate multi-file edits safely; do not overwrite or discard uncommitted working tree changes.

## Self-Learning Runtime Adaptations

Metis supports continuous self-learning through runtime adaptations (`src/core/adaptations/`):

- **Activation & Precedence**:
  - Global config toggle `selfLearning.enabled` (default: `false`).
  - Command-line flag `--adaptations on|off` and environment variable `METIS_ADAPTATIONS` (`on` | `off` | `1` | `0` | `true` | `false`).
  - Precedence: explicit `off` > explicit `on` > benchmark profile `reliable-headless` (default `false`) > config `selfLearning.enabled`.
  - **Clean Baseline Guarantee**: When `selfLearning.enabled` is `false` (and not forced on via CLI/env), behavior, tools, system prompt, and roles are 100% byte-identical to a clean baseline with no adaptations directory.
- **Storage & Isolation**:
  - User-scoped adaptations: `~/.metis/agent/adaptations/`
  - Project-scoped adaptations: `~/.metis/agent/adaptations/projects/<projectKey>/` (governance files never in project `cwd`).
  - Untrusted projects cannot load project-scoped adaptations until approved.
- **Safety Baselines**:
  - Control-plane tools (`CONTROL_PLANE_TOOLS`: `performance_admit`, `performance_gate`, `update_plan`, `read_plan`, `spawn_agent`, `ask_user`, `adapt`) are strictly protected. Adaptations cannot hide, intercept, or modify control-plane tools.
  - Subagents and active Performance runs are isolated from mutating adaptations; adaptation hooks never receive control-plane events and never run during active Performance runs.
- **In-Turn `adapt` Tool**:
  - Root sessions can dynamically inspect (`list`), apply (`apply`), or revert (`rollback`) adaptations.
  - Plan mode allows data-only adaptations without requiring performance admission.
  - Every change is recorded in `journal.jsonl` with full revision snapshots in `history/<id>`.
- **Idle Learner & Outcome Ledger**:
  - Triggers on session idle for interactive sessions: scheduled after `bindExtensions` in `interactive-mode.ts` (`mode: "tui"`) and `server-mode.ts` (`mode: "server"`).
  - Automatically bails out without running when self-learning is inactive, when mode is non-interactive (`print` / `json`), or when session is non-persistent (`--no-session`).
  - Dispatched as fire-and-forget (does not await, logs on error, never blocks session startup).
  - Successful synthesis applies data adaptations, calls `refreshAdaptations()`, and broadcasts `adaptation_changed`.
  - Zero-token local heuristic filters: only runs when real user corrections, repeated command failures, or pending checks exist. User text is read from both string content and text parts. Repeated bash failures come from `toolResult` messages with `isError`, matched by `toolCallId`.
  - When the live session has no user text yet, the learner reads the newest other `.jsonl` session in the same directory (skipping files at or before the watermark or already marked in `cache/learner-sessions-v1.json`).
  - **Session index persistence & unchanged session invariance (gotcha)**: `cache/learner-sessions-v1.json` tracks `lastProcessedMtime` per session file outside the volatile `adaptations/` directory. If the user deletes `~/.metis/agent/adaptations/`, unchanged historical sessions are never re-learned on cold restart; re-learning only triggers when a session file is actually modified with new conversation messages.
  - **Explicit Agent Prompt Awareness (gotcha)**: When self-learning is active, `getLearnedAdaptationsPromptSummary` builds a structured `<learned_adaptations>` block in `<developer_instructions source="self-learning runtime">` summarizing active skills, guidelines, and user preferences. The agent is explicitly instructed to apply them and answer direct user inquiries about learned project knowledge without searching disk files. When self-learning is off, this block is omitted (100% byte-identical clean baseline).
  - Model calls use `completeSimple` through the session model registry. A `model.complete` method remains a test seam. A missing completion path does not consume the daily call quota.
  - Strict 6,000 token budget cap, uncapped daily model calls/writes by default (optional `dailyCallBudget` can be configured), data products only for autonomous writes.
  - Plan mode keeps `adapt` visible. The tool still rejects `tool` and `hook` writes in Plan; those require Build.
  - Outcome ledger records active adaptations, execution results, and user corrections. Recurring corrections trigger rewriting instead of stacking new adaptations.
- **Turn-Level Closed Loop & Evaluator**:
  - `runTurnLearner` & `scheduleTurnLearning`: triggers after important turns (error recovery, user correction, repeated tool failures) with 5-phase progress (`observe`, `review`, `guard`, `write`, `evaluate`). Progress bar copy distinguishes between turn review ("复盘本回合 {step}/{total}") and idle consolidation ("整理经验 {step}/{total}").
  - Learned skills must be `SKILL.md` with `name` and `description` frontmatter (`ensureSkillDocument` wraps bare learner output). A skill whose description does not match the user's words is never loaded, so the next turn cannot use it.
  - **Write-time merging & protection (gotcha)**: `architecture` writes merge into existing guidelines (matching text updates, untouched kept, hash IDs assigned) rather than overwriting. `profile` writes merge traits by statement without shadowing `profile.md` when `profile.json` exists. Shorter `skill` updates that drop command flags or tokens (`--lang`, `CMS_STAMP`, `nonce`) are rejected with journal action `"reject"`. Bad JSON output refunds `callsCount` and advances `watermarkTimestamp`. Learner prompts instruct the model not to create a second similar named adaptation; revise the existing name instead.
  - **Cross-Adaptation Deduplication & In-Place Evolution (gotcha)**: `runIdleLearner` and `runTurnLearner` inject rich active adaptations summaries (`buildActiveAdaptationsSummary`) into prompts—detailing existing skills (with key commands), profile traits (dimension, statement, confidence), architecture guidelines (id, text, trigger), and proposals—so the model updates existing adaptations in-place rather than creating duplicate mechanisms or variant names. Store writes (`writeAdaptation`) enforce multi-tier deduplication:
    - **Skills**: Normalized kebab-case names and executable command overlap matching (`hasCommandOverlap`) resolve writes into existing skills (incrementing revision Rev 1 -> Rev 2) while enforcing flag non-regression. Operational command workflows are strictly confined to `skill` adaptations.
    - **User Profile (`profile.json`)**: Traits within the same dimension match via semantic statement similarity (`areStatementsSimilar`, detecting shared CJK concepts like 中文/表格/要点, stop word filtering, and token overlap), merging in-place by taking max confidence, combined evidence, and richer statements. Follow-up predictions normalize trigger patterns and merge support counts.
    - **Architecture Guidelines (`architecture.json`)**: Guidelines match by ID, exact text, trigger, or semantic rule similarity (`areGuidelinesSimilar`), updating in-place while preserving stable IDs. Task-specific execution commands overlapping with skills are filtered out, and empty architecture files are unlinked.
    - **Roles (`roles/*.md`)**: Normalized kebab-case names resolve variant names (e.g. `frontend_tester` -> `frontend-tester.md`) to the existing role file and update in-place.
    - **Workflow Proposals (`workflow-proposals/*.json`)**: Normalized names and matching check commands resolve to existing proposals.
    - **Workflows (`workflow.json`)**: `extraChecks` deduplicate by command signature or ID, and string arrays (`verificationCommands`, `userAddenda`, `doneCriteria`) are unified into unique sets.
    - **Consolidation**: `consolidateDuplicateAdaptations()` automatically unifies historical duplicates and near-synonyms across skills, architecture guidelines, profile traits, roles, and proposals.
  - **Learned Skill Capacity Limit & Safe Archival (gotcha)**: To prevent skill explosion and prompt degradation, learned skills are capped per scope (`DEFAULT_MAX_LEARNED_SKILLS = 30`, configurable via `selfLearning.maxLearnedSkills`). Capacity is enforced at both learner prompt generation and store write time (`writeAdaptation`). Learner prompts receive a summary of existing skills with metrics (`appliedCount`, `helped`, `hurt`, `lastRunAt`) and are instructed to update existing skills in-place or specify `"replaces": "<old-skill>"` when at capacity. When a skill is replaced or retired (`retireSkill`), it is safely moved to `archive/skills/<name>`, snapshotted in `history/`, logged with `action: "retire"` in `journal.jsonl`, and marked `status: "retired"` in `outcome-ledger.json`. Archived skills are completely excluded from `discoverAdaptationResources` and system prompt summaries (`getLearnedAdaptationsPromptSummary`), but can be restored via `rollbackAdaptation`. If a new skill is written at capacity without `replaces`, `selectLowestValueSkill` automatically evicts the lowest-value skill (retired > highest hurt/error rate > lowest composite score > LRU).
  - **Mandatory triggers on object guidelines (gotcha)**: Object-form `customGuidelines` must define at least one valid trigger (`keyword`, `regex`, `intent`, `command`, `filePattern`, `error`, `errorPattern`, etc.); object guidelines without triggers fail validation. String guidelines remain always-on.
  - **Unified 3-part adaptation ID & Holdout invariance (gotcha)**: `adaptationId(scope, kind, name)` provides a consistent identity (`<scope>:<kind>:<name>`) across store, recall, ledger stats, and rollbacks. Successful turns increment `helped` exactly once (no double counting). Holdout turns skip recording `hurt` for tool errors and trial adaptations. Retired guidelines/skills are skipped at recall time rather than deleting files from disk.
  - Tool calls record `arguments ?? args ?? input` into command fingerprints. Recovery command pairs and exit-0 fingerprints are passed directly to learner prompt.
  - A Performance run that reached `completed` is a successful adaptation outcome even if a tool error was recovered. Tool error text is not a user correction.
  - Architecture custom guidelines support dynamic trigger conditions (`regex`, `filePattern`, `commandPattern`, `errorPattern`, `keyword`, `intent`). On error or command match, runtime experience context is injected into session state.
  - Structured User Profile (`UserProfileData` with traits, confidence decay, follow-up predictions) with dual-format backward compatibility (`profile.md` / `profile.json`).
  - 15% deterministic AB holdout group (`isControlGroupHoldout(sessionId, turnIndex)`) where tentative/trial items are withheld (active items and user-stated traits are never withheld) to measure counterfactual baseline.
  - Outcome attribution tracks `helped` and `hurt` in `outcomes.jsonl`. Tentative/trial adaptations with 3 helped and 0 hurt graduate to `active`; 2 hurts trigger retirement and automatic rollback for tools/hooks.
  - Daily growth reporting (`generateDailyGrowthReport`) tracks evaluated runs, success rate, and active/trial/retired counts.
  - **Real-time Growth & Adaptation Presentation (gotcha)**: `/adaptations` calculates `generateDailyGrowthReport` dynamically against freshly scanned adaptations and recent turn outcomes across scopes (`outcomes.jsonl`). `activeCount`, `trialCount`, and `retiredCount` reflect all live adaptations rather than solely entries with recorded runs in `ledger.perAdaptationStats`. When `totalEvaluatedRuns === 0`, `adaptationSuccessRate` is `undefined` so Desktop displays neutral pending status ("暂无评估记录") rather than a misleading 100%. `listAdaptations` extracts human-readable `description` and `reason` across skills (YAML frontmatter), architecture (custom guidelines summary), profile (traits summary), and workflow (checks summary), rendering clear, descriptive cards in Desktop Settings with automatic SSE sync, manual refresh affordance, and interval polling.
- **Main Workflow Boundary Invariance**:
  - `assertMainWorkflowInvariance(content)` strictly guards against control plane tool mentions, performance gate numbers (G0-G7), receipt tampering, and bypass/skip intents.
  - Zero modifications to reliable-headless performance main workflow files (`performance-runtime.ts`, `performance-gate.ts`, `task-execution-controller.ts`, etc.).
- **Workflow & Performance Run Snapshot Isolation**:
  - `getEffectiveWorkflow()` checks `isSelfLearningActive(options)` first and returns `undefined` immediately when inactive without reading disk files.
  - `PerformanceRuntime.admit()` records an immutable `workflowSnapshot` into the run state when active (or `undefined` when off).
  - `allowedSpawnRoles()` and gate verification extraChecks strictly read `workflowSnapshot` from the active run state without querying disk.
  - Modifying `workflow.json` on disk or toggling self-learning flags mid-run has zero impact on the active run; changes only take effect upon the next `admit()`.

## Scheduled Routines System

When modifying routines scheduling (`src/core/routine-host.ts`, `src/core/tools/routine.ts`, `desktop/routine-host.cjs`):

- **Cron & Interval Execution**: Support standard 5-field cron syntax (`* * * * *`) and interval formats.
- **State Persistence & History**: Routine state, last run timestamp, and run histories persist safely across sessions.
- **Desktop UI Parity**: Routines are exposed via Desktop settings dialog and sidebar tabs with bilingual status narration and direct toggle controls.

## Metis Plugin Contracts Architecture

When modifying plugins or role definitions (`bin/metis-plugin.js`, `contracts/`, `packages/`):

- **Zero Contract Drift**: Always run `npm run check-contracts` to validate that `contracts/*.json` match BUILTIN definitions in `src/core/agent-definition.ts` and the 16 frameworks in `src/core/performance-frameworks.ts`.
- **Role Projection**: Keep plugin role projections in parity across Codex, OpenCode, and DeepSeek environments.

## Metis Skill (插件版) Release

Skill / plugin distribution is separate from Desktop and CLI (`@wholiver_hu/metis`) versioning.

- **Package**: `metis-skill` (CLI bins: `metis-plugin`, `metis-skill`)
- **Pack**: `npm run pack:skill` → `scripts/pack-metis-skill.mjs` (esbuild-bundles TS; ships `contracts/`; Node cannot type-strip under `node_modules`)
- **Tag / asset**: `skill-vX.Y.Z` + `metis-skill-X.Y.Z.tgz` on GitHub Releases (do not reuse the Desktop/CLI `vX.Y.Z` latest tag for skill-only bumps)
- **Install (README Quick start, below Desktop, not collapsed)**:
  `npm install -g https://github.com/Wholiver/metis/releases/download/skill-vX.Y.Z/metis-skill-X.Y.Z.tgz` then `metis-plugin`
- **Smoke**: after pack, `npm install -g --prefix /tmp/metis-skill-smoke ./metis-skill-X.Y.Z.tgz` and `metis-plugin --version` / `metis-plugin install codex --root <tmpdir>`

## Recursive Multi-Agent System

When touching subagent execution (`src/core/tools/spawn_agent.ts`, `src/core/agent-definition.ts`):

- Metis supports L0 → L4 recursive delegation with role-based tool sandboxing and physical workspace isolation (worktrees).
- Preserve runtime context inheritance (`rootRunId`, `parentId`, `agentId`, `depth`).
- Verify execution under concurrency limits and propagate `AbortSignal` for graceful teardown.

## Extension Changes

When adding or changing an Extension API:

- Inspect `src/core/extensions/types.ts`, `runner.ts`, `loader.ts`, `wrapper.ts`, and public exports;
- Preserve event ordering and document synchronous versus asynchronous behavior;
- Pass cancellation through `AbortSignal` where work can block;
- Define strict TypeBox schemas for registered tools;
- Verify behavior in `tui`, `print`, `json`, `rpc`, and `server` modes;
- Add or update a runnable example under `examples/extensions/`;
- Update `docs/extensions.md` and `docs/packages.md` when distribution changes;
- Test load, reload, shutdown, errors, state persistence, and dependency resolution.

Extensions run with full user permissions. Do not weaken trust checks or add silent destructive behavior.

## Public API Changes

For exported types or functions:

- Update `src/index.ts` and relevant subpath exports (`rpc-entry`);
- Check SDK and RPC consumers;
- Avoid breaking changes unless explicitly authorized;
- Document migration steps for unavoidable breaking changes;
- Add type-level and runtime coverage.

## Validation Commands

Run checks proportional to risk:

```bash
# Core & CLI unit tests
npm test
npm test -- test/specific.test.ts

# Server mode tests
npm test -- test/server-mode.test.ts

# Desktop React tests
npm test -- test/desktop-react-view-switch.test.ts
npm test -- test/desktop-react-composer.test.ts

# Generate Desktop i18n catalogs (after editing desktop/i18n-source.cjs)
node desktop/scripts/generate-i18n-catalogs.mjs

# Desktop build (Vite + Electron packaging staging)
npm --prefix desktop run build

# Core build & runtime validation
npm run build
node scripts/validate-runtime.mjs dist
```

For docs and SVG changes also run:

```bash
git diff --check
xmllint --noout docs/images/*.svg
```

If a command hangs, identify the exact stage and process, stop only processes started by the current task, try one safe equivalent path, and report the unresolved blocker. A timeout is not a passing result.

## Git and Workspace Safety

- Preserve unrelated modifications in dirty worktrees (run `git status --short` before and after changes).
- Stage explicit files when scope is mixed (`git add <specific-file>`).
- Do not use `git reset --hard`, `git checkout .`, `git clean -fd`, or discard user work without explicit authorization.
- Do not modify secrets, credentials, environment files, or production configs.
- Do not commit, publish, open a PR, or change external git remotes unless explicitly requested.

## Release Pipeline Guidelines (When Releasing Metis)

When asked to bump, package, or release a new Metis version (e.g., `1.x.y`):

1. **No Subagents**: Run the release process directly in the main thread. Do NOT invoke subagents.
2. **Pre-commit Cleanliness & Push Protection**:
   - Never commit hardcoded secret tokens (Hugging Face, NPM, API keys) — read them from `os.environ` / `process.env`.
   - Ensure large artifacts (e.g., `eval_results/`, `dist/`, `.dmg`, `.zip`) are not tracked by Git.
3. **Version Synchronization**:
   - Bump `version` in `package.json` and `desktop/package.json`.
   - Prepend the new release section to `CHANGELOG.md` with only the version's specific highlights.
   - Update `latest-version.json` in `Wholiver/metis-check-update` on GitHub `main`.
4. **NPM Publishing Invariant**:
   - Always run `npm run build` explicitly first.
   - To avoid `prepublishOnly` build script lockups or tarball race conditions, invoke NPM publish with `--ignore-scripts`:
     ```bash
     npm publish --access public --tag latest --ignore-scripts --//registry.npmjs.org/:_authToken=<TOKEN>
     ```
5. **Silent Wait for Desktop CI**:
   - Prefer CI upload for large Desktop installers when the local network to `uploads.github.com` is slow or stalls.
   - Trigger `gh workflow run release-windows.yml --ref <TAG> -f ref=<TAG>`.
   - Trigger `gh workflow run release-macos.yml --ref main -f ref=<TAG> -f tag=<TAG>` (workflow file must be on `main`; it packages the release ref and attaches the DMG).
   - Windows build takes ~25 minutes; macOS packaging+upload takes ~15–25 minutes. Do NOT poll in a loop. Use a one-shot wait, then attach Windows artifacts via `attach-windows-release-assets.yml` when needed.
6. **GitHub Release Notes Scope**:
   - When creating `gh release create <TAG>`, pass only the release notes corresponding to that specific release version (not the full `CHANGELOG.md`).
   - Upload installer/binary assets only (`.dmg`, `.zip`, `-setup.exe`). Do **not** upload companion `.sha256` checksum files — they clutter the release asset list.
   - Release only to NPM and GitHub Releases. Strictly do NOT upload or push to Gitee.

## Handoff

Before concluding any task:

1. Confirm that `AGENTS.md` has been reviewed and updated if relevant conventions, paths, rules, or workflows were touched.
2. Report:
   - outcome first;
   - files changed (including `AGENTS.md` when updated);
   - validation run and exact result;
   - any command that could not complete;
   - remaining user action, only when truly required.

Keep the handoff concise. Do not hide uncertainty or claim tests passed when they did not run.
