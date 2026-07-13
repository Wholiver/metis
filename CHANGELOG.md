# Changelog

This changelog starts with the Metis `1.0.0-rc.1` release candidate. Earlier development history is available through Git.

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
