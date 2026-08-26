# Changelog

This changelog starts with the Metis `1.0.0-rc.1` release candidate. Earlier development history is available through Git.

## Unreleased

## [1.1.4] - 2026-08-26

### Token Usage Metrics & Desktop Settings Upgrades

- Added real-time token usage bar displaying prompt, completion, cache, and total context usage.
- Enhanced onboarding and settings dialogs with rich provider configuration, custom base URL validation, and model switching.
- Refined subagent inspector details and layout stability.

## [1.1.3] - 2026-08-26

### Desktop Layout Resilience

- Allowed wide sidebar and inspector panels to yield space before the chat composer clips its model selector.
- Added regression coverage for minimum panel and composer widths across constrained Desktop layouts.

## [1.1.2] - 2026-08-25

### Desktop Update Check

- Added a Desktop update check that reads the release manifest through the existing local backend, surfacing the available version and upgrade notice in Settings.
- Documented the manifest contract and the desktop IPC channel used to reach it.

## [1.1.1] - 2026-08-25

### Model Catalog, Concurrent Desktop Sessions & Documentation

- Expanded the bundled provider/model catalog and added catalog-aware reasoning, thinking-level, and compatibility inference with explicit configuration overrides.
- Allowed Desktop users to switch or create conversations while another session continues running, backed by isolated sibling runtimes and updated Server/RPC session events.
- Refreshed provider display names, OAuth branding, model synchronization tooling, and related runtime documentation.
- Updated the English and Chinese READMEs with current installation notes, product capabilities, trust boundaries, CLI examples, and documentation links.

## [1.1.0] - 2026-08-24

### React Desktop, Performance Modes & Runtime Hardening

- Rebuilt Metis Desktop with React and Vite, including refreshed conversation, plan, Ask, settings, model, mode, subagent, and workspace flows.
- Added animated assistant state assets and expanded Desktop localization, runtime integrity checks, and packaging support.
- Added performance modes, framework-aware execution guidance, roadmap/runtime coordination, and performance gate tooling.
- Strengthened session memory, branching, agent spawning, worktree safety, RPC/Server contracts, and regression coverage.

## [1.0.3] - 2026-08-15

### Multi-Agent Orchestration & Desktop Polish

- Introduced hierarchical subagent spawning (`spawn_agent`), agent management, and spawn guard mechanisms.
- Added isolated worktree and sanitized environment execution for subagents.
- Added TerminalBench adapter, headless benchmark runner, and trace collection.
- Refined Desktop theme styling, renderer catalogs, and message turn interactions.

## [1.0.2] - 2026-08-14

### Memory DB Query Tooling

- Replaced `search_memory` tool with `query_memory_db` to support structured memory database querying.
- Updated memory coordinator, SDK runtime, and documentation to use `query_memory_db`.
- Added unit tests and updated regression test suites for `query_memory_db` coverage.

## [1.0.1] - 2026-08-14

### Desktop & Memory Improvements

- Enhanced memory coordinator and search memory tools.
- Refined Desktop memory state integration and status indicators.
- Performance and stability fixes across core agent session runtime.

## [1.0.0] - 2026-08-14

### Official 1.0.0 Release

- First official stable release of Metis across CLI, TUI, Desktop, and Server modes.
- Production-grade memory coordinator and search memory tools.
- Full cross-platform support with macOS DMG and Windows installers.
- Desktop UI optimizations, custom Provider management, and seamless OAuth authentication.
- Enhanced subagent workflows, plan management, and interactive session controls.

### Cross-platform video evidence

- Removed reliance on FFmpeg's optional `drawtext` filter so storyboard and motion evidence render with bundled FFmpeg on macOS, Windows, and Linux.
- Preserved exact cell-to-timestamp meaning in adjacent model-readable text, with explicit left-to-right and top-to-bottom grid instructions.
- Fixed CI vendor artifact restoration and verified video regression tests plus production builds on Ubuntu and Windows.

## [1.6.3-rc.1] - 2026-08-03

### Accurate video motion evidence

- Replaced overstated universal action guidance with a clear evidence workflow for locating events, inspecting ordered motion samples, and confirming exact visual states.
- Added exact motion timestamps, sparse versus near-continuous sampling guidance, per-step pixel-change metrics, and a separate motion-evidence map without claiming unsupported causes.
- Restored up to six 2048-pixel detail frames, fixed every 4–9 sample grid layout, and expanded real FFmpeg regression coverage.
- Added Windows and Linux CI coverage for video tests and the production TypeScript build.

## [1.6.2-rc.1] - 2026-08-03

### Dense video motion analysis

- Reworked video motion inspection into timestamped 4–9 frame sequence grids for UI transitions, human actions, sports, camera movement, and other motion.
- Added motion magnitude, changed-region bounds, and global-motion classification to guide analysis.
- Added a four-dimensional action-analysis framework and updated regression coverage for dense motion output.

## [1.6.1-rc.1] - 2026-08-02

### Desktop workflow and video inspection

- Completed Desktop OAuth through the automatic localhost callback flow, removing manual callback URL copying.
- Restored automatic Worked-section collapse after completion and live Subagent dock expansion, counts, and cleanup.
- Aligned macOS titlebar navigation controls with the traffic-light button centers.
- Added video motion composites for inspecting subtle micro-interactions, animations, and movement direction.

## [1.6.0-rc.2] - 2026-08-01

### OAuth reliability and Provider setup UI

- Replaced unsupported Desktop browser prompts with styled in-window Electron dialogs for OAuth input, selection, confirmation, and cancellation.
- Redesigned Desktop custom Provider settings into clear management, connection, model, and save sections with responsive layout.
- Redesigned CLI custom Provider setup as a five-step wizard that clears completed fields and avoids leaving API keys visible in terminal history.
- Added Desktop OAuth dialog regression coverage and expanded localization coverage for the new interface.

## [1.6.0-rc.1] - 2026-08-01

### Provider authentication and configuration

- Enabled Desktop OAuth login through the same browser-based flow used by the CLI.
- Added multi-provider OpenAI-compatible configuration, automatic model discovery, manual model entry, editing, and deletion to both CLI and Desktop interfaces.
- Removed the matching stored API key when deleting a custom provider without interrupting an active session.
- Replaced OAuth callback branding with status icons: green check for success and red cross for failure.

## [1.5.2-rc.3] - 2026-07-31

### Video tool guidelines enhancement

- Enhanced tool guidelines and inspection feedback to encourage normalized `crop` usage for fine UI details.
- Added explicit instructions for analyzing animations, hover effects, motion, and visual transitions using consecutive frame comparisons.

## [1.5.2-rc.2] - 2026-07-31

### Desktop UI fix

- Fixed model picker dropdown menu clipping by updating `.composer` container overflow to `visible`.

## [1.5.2-rc.1] - 2026-07-31

### Video tool performance optimization

- Switched detail frame export format from PNG to JPEG (`-q:v 3`), reducing data payload by 80%–90%.
- Optimized FFmpeg seeking order to use fast keyframe input seeking (`-ss` before `-i`), reducing frame extraction time to milliseconds.
- Added dynamic max dimension limits (1280px for uncropped frames, 2048px for cropped frames).
- Adjusted maximum detail frames limit from 6 to 4 (`MAX_DETAIL_FRAMES = 4`).
- Updated tool guidelines to encourage `storyboard` preview and `crop` usage.

## [1.5.1-rc.1] - 2026-07-31

### Desktop localization and platform parity

- Added complete Desktop translations for 11 languages, including settings, onboarding, native menus, dialogs, and runtime feedback.
- Added generated translation catalogs with completeness, placeholder, visible-copy, and locale-resolution coverage.
- Kept the Windows settings content and layout aligned with the macOS baseline while preserving the native title-bar hit area.
- Added cross-platform checks for settings layout and native edit-menu behavior.

## [1.5.0-rc.1] - 2026-07-31

### Desktop attachments and editing

- Added image, video, text, and binary-file attachments through picker, paste, and drag-and-drop flows.
- Added attachment previews, progress feedback, removal controls, and path-backed prompts for video and binary files.
- Added native application and editor context menus so standard editing shortcuts work consistently on macOS and Windows.
- Added cross-platform attachment classification and desktop wiring tests.

## [1.4.0-rc.1] - 2026-07-30

### Video detail inspection

- Added a `frames` action that returns up to six independent lossless PNG frames for detailed visual inspection.
- Added exact timestamp selection and normalized cropping for reading small UI regions and precise video states.
- Exposed video frame-rate metadata and included it in inspection guidance.
- Exported the public `VideoCrop` type and documented the expanded evidence workflow.

## [1.3.4-rc.1] - 2026-07-29

### Desktop

- Added Windows desktop packaging (`npm run package:win`) that produces a portable ZIP with a bundled CLI/Server runtime.
- Added an NSIS Windows installer with per-user installation, shortcuts, and uninstall support.
- Improved Windows window chrome with native title-bar overlay controls and File Explorer wording.
- Added custom-provider reasoning configuration and model-registry refresh support.
- Prevented Desktop from restoring the internal `unknown/unknown` placeholder after custom-provider refresh.
- Preserved an available active model or fell back to the imported `other` model.

### Release automation

- Added a manually triggered Windows release build that produces portable ZIP, checksum, and installer artifacts.

## [1.3.3-rc.1] - 2026-07-29

### Desktop final-response divider

- Guaranteed exactly one divider above the final response whenever the Worked section is expanded.
- Unified inline, separate-message, historical string, restored-session, and streaming render paths under one divider owner.
- Fixed stale streaming state captured by the collapse handler, which could hide the divider after expanding completed work.
- Removed legacy work-container dividers and reconciled stale or duplicated divider nodes during DOM reuse.

## [1.3.2-rc.3] - 2026-07-29

### Provider-independent session titles

- Guaranteed a persisted session title after the first exchange regardless of provider behavior.
- Added local title fallbacks for empty text, reasoning-only responses, provider and authentication failures, timeouts, missing models, and image-only messages.
- Removed leading file paths from fallback titles while preserving explicit cancellation behavior.

## [1.3.2-rc.2] - 2026-07-29

### Desktop session titles

- Added a hard timeout and cancellation handling for automatic title generation so unresponsive providers cannot leave Desktop stuck on "Generating title".
- Stopped session polling from repeatedly retrying title generation after a provider failure.

## [1.3.2-rc.1] - 2026-07-29

### Video model compatibility

- Defaulted custom OpenAI-compatible models with unspecified input capabilities to multimodal input so storyboard images reach vision models.
- Added an explicit warning for text-only models instead of silently omitting storyboard images.
- Exposed video dimensions, audio, and subtitle availability during inspection and avoided recommending transcription for silent videos.
- Guided agents to analyze frames in batches with sampling gaps of no more than four source frames.
- Improved storyboard extraction speed with fast input seeking.

## [1.3.1-rc.1] - 2026-07-28

### Video runtime initialization

- Made npm CLI and Desktop releases prefer bundled FFmpeg and FFprobe executables, including installs made with `--ignore-scripts`.
- Added automatic first-use Whisper model preparation in the shared user agent directory with offline verification and cache reuse.
- Fixed embedded WebVTT subtitle timestamps emitted in `MM:SS.mmm` form.
- Added release-artifact smoke coverage for inspection, storyboards, sidecar and embedded subtitles, local Whisper transcription, and transcript caching.

### Desktop and installation

- Restored native macOS window corners in the Desktop app.
- Improved English and Chinese quick-start documentation and standardized the npm installation command with `--ignore-scripts`.

## [1.3.0-rc.1] - 2026-07-28

### Desktop connectivity and server mode

- Added an HTTP server mode with session, prompt, model, command, and extension UI endpoints for desktop and remote clients.
- Added raw reasoning stream handling and automatic desktop connection behavior when no project is active.
- Added standalone macOS desktop app installation guidance to the CLI documentation.

### Web research behavior

- Changed web research from mandatory for every task to a search-leaning, evidence-based policy.
- Preferred one focused search for current, external, unfamiliar, or high-risk claims, with broader searches only for evidence gaps or conflicts.
- Avoided unnecessary searches for tasks fully answerable from local or supplied content and for deterministic transformations.

## [1.2.0-rc.3] - 2026-07-27

### CLI sessions and Subagents

- Hid Dream and Subagent worker sessions from current-folder and all-project `/resume` lists.
- Added a strict synchronization barrier so parent Agents wait for every running Subagent before continuing work.
- Displayed the number of running Subagents in the interactive footer.
- Added automatic AI-generated session titles after the first completed exchange.

### Providers and runtime compatibility

- Added guided setup for custom OpenAI-compatible providers, including model discovery and persisted configuration.
- Kept Dream and Subagent child processes runnable when Metis is launched through Electron.
- Allowed the RPC entrypoint to honor explicit print and mode arguments.

## [1.2.0-rc.2] - 2026-07-25

### Packaging & Installation

- Removed install lifecycle scripts (`postinstall`) to allow clean, warning-free global installation across npm 11 and earlier npm versions.

## [1.2.0-rc.1] - 2026-07-25

### Video tools

- Added video inspection tool with timestamped 3×3 storyboard extraction and transcript processing.
- Bundled platform ffmpeg and ffprobe binary preparation helpers.

## [1.1.0-rc.3] - 2026-07-18

### Agent research workflow

- Required deep, multi-query web investigation before substantive work, with authoritative-source verification through web fetches.
- Added disposable research scratch guidance so durable conclusions can survive unfinished work without polluting live working memory.
- Clarified tool guidance and user-facing output rules for research-driven tasks.

## [1.1.0-rc.2] - 2026-07-17

### Interactive terminal

- Added `/language` with automatic locale detection and 11 selectable interface languages.
- Persisted the selected UI language globally and redrew built-in terminal interface text immediately after a change.
- Kept Agent responses, prompts, command tokens, extensions, tool output, print, JSON, RPC, and SDK behavior unchanged.

## [1.1.0-rc.1] - 2026-07-15

### Highlights

- Upgraded the append-only task log into live working memory with explicit read, checkpoint, error, and completion actions.
- Restored the latest checkpoint after startup, resume, interruption, and manual or automatic context compaction.

### Agent reliability

- Added configurable checkpoint reminders after non-log tool activity and immediate transient reminders after tool errors.
- Kept reminders out of UI, RPC, session persistence, and Dream logs.
- Preserved the existing Dream consolidation, scheduling, log path, and cleanup behavior while retaining diagnosed errors in the complete log history.

### Compatibility and documentation

- Preserved legacy `{ content }` log calls as completion entries and retained the legacy `getPiUserAgent` utility export.
- Documented working-memory defaults, configuration, recovery behavior, and the checkpoint-to-Dream lifecycle in English and Simplified Chinese.

## [1.0.0-rc.2] - 2026-07-13

### Fixes

- Kept Dream Phase cleanup and state updates working after the originating Extension context becomes stale.
- Avoided stale-context UI notifications after session replacement or Extension reload.

### Documentation

- Updated English and Simplified Chinese Quick Start instructions to install Metis directly from npm.

## [1.0.0-rc.1] - 2026-07-12

### Highlights

- Introduced Metis as an agent layer that improves how coding models search, remember, execute, and verify work.
- Added a repository-first workflow built around understanding context, making focused changes, and validating results.
- Added interactive terminal, print, JSON, RPC, and SDK interfaces.

### Agent reliability

- Added Memory and Lessons lookup through the brain map before technical tasks.
- Added Dream consolidation for promoting useful task notes into reusable memories and technical lessons.
- Added search-first behavior for repository investigation and authoritative web research.
- Added material error logs and task-completion summaries.
- Added final verification against every requirement and clarification in the user's original prompt.
- Added risk-based build, test, functional, boundary, regression, and compatibility checks.

### Extensions and packages

- Added TypeScript and JavaScript Extension loading with global and project-local discovery.
- Added custom tools, commands, shortcuts, flags, lifecycle events, UI components, and renderers.
- Added Metis Package support for distributing Extensions, Skills, Prompt Templates, and Themes through npm, git, URLs, or local paths.
- Added Package installation, removal, listing, updating, dependency resolution, and project-scoped settings.

### Documentation

- Added simplified English and Simplified Chinese READMEs.
- Added adaptive light/dark SVG visuals in English and Chinese.
- Added contributor guides for core development, Extension integration, Package distribution, testing, and pull requests.
- Added repository-level guidance for AI coding agents.

### Repository hygiene

- Removed local indexes, temporary subagent logs, one-off test scripts, unused visuals, and generated icon artifacts.
- Added ignore rules for local CodeGraph data, task logs, and generated output.

### Release candidate notice

`1.0.0-rc.1` is a release candidate. Public APIs, Extension events, Package metadata, and behavior may still change before the stable `1.0.0` release.
