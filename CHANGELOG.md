# Changelog

This changelog starts with the Metis `1.0.0-rc.1` release candidate. Earlier development history is available through Git.

## Unreleased

### Desktop

- Added Windows desktop packaging (`npm run package:win`) that produces a portable ZIP with a bundled CLI/Server runtime.
- Improved Windows window chrome with native title-bar overlay controls and File Explorer wording.

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
