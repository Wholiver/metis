# Changelog

This changelog starts with the Metis `1.0.0-rc.1` release candidate. Earlier development history is available through Git.

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
