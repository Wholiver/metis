# Development Guide

This document describes how to set up, build, develop, and test Metis from source.
For AI coding agents, also consult [AGENTS.md](../AGENTS.md) and [docs/desktop-frontend-development.md](desktop-frontend-development.md).

## Requirements

- Node.js `>=22.19.0`
- npm `>=10.0.0`
- Git

## Setup

```bash
git clone https://github.com/Wholiver/metis.git
cd metis
npm install
npm run build
```

## Running from Source

### CLI & Interactive Terminal (TUI)

After building with `npm run build`:

```bash
# Run CLI directly
node dist/cli.js

# Or pass flags
node dist/cli.js --help
node dist/cli.js -m deepseek-chat
```

### Desktop App (Electron + React 18)

Metis Desktop uses an Electron host and a modern React 18 + Tailwind CSS v4 frontend.

```bash
# Start Desktop in development mode (starts Vite dev server at http://localhost:5173 + Electron):
npm run dev
# or:
npm --prefix desktop run dev

# Build production bundle (generates desktop/renderer/ and desktop/dist/):
npm --prefix desktop run build

# Run against production built bundle:
npm --prefix desktop run start:dist
```

## Testing

```bash
# Run full Vitest suite:
npm test

# Run a specific test suite:
npm test -- test/server-mode.test.ts
npm test -- test/desktop-react-harness.test.ts
npm test -- test/desktop-*.test.ts
```

## Project Structure

```text
metis_v2/
├── src/
│   ├── main.ts              # CLI entry point, flag parsing, mode dispatcher
│   ├── cli/                 # CLI commands, arguments, flag definitions
│   ├── core/                # Core engine: session management, models, tools, harness, self-learning
│   │   ├── tools/           # Standard model tools (read, write, edit, bash, browser, etc.)
│   │   ├── providers/       # LLM provider abstractions and custom registries
│   │   ├── extensions/      # Extension runner, discovery, and TypeBox tool APIs
│   │   └── package-manager.ts # Package & skill discovery
│   └── modes/               # Execution modes
│       ├── interactive/     # Interactive TUI mode
│       ├── server/          # HTTP & SSE backend server used by Desktop
│       ├── rpc/             # JSON & streaming RPC protocols
│       └── print-mode.ts    # Headless non-interactive execution
├── desktop/                 # Electron Desktop app
│   ├── main.cjs             # Electron main process & server bridge
│   ├── preload.cjs          # Context bridge (window.metisDesktop)
│   ├── src/                 # React 18 + Tailwind CSS v4 frontend (SOURCE OF TRUTH)
│   │   ├── components/      # UI components (chat, harness, codetree, routines, inspector, atoms)
│   │   ├── hooks/           # useMetisServer, hooks, state reducers
│   │   └── styles/          # Tailwind CSS v4 & BeautifulUI foundation styling
│   ├── i18n-source.cjs      # Canonical i18n copy (en, zh-CN)
│   └── dist/ / renderer/    # Generated Vite bundle and packager output (NEVER hand-edit)
├── vendor/                  # Vendored dependencies (metis-agent-core, metis-ai, metis-tui)
├── docs/                    # Architectural and feature documentation
└── test/                    # Vitest test suites (CLI, Server, Core, Desktop)
```

## Path Resolution

Always use `src/config.ts` for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debugging

- `/debug` in interactive mode writes diagnostics to `~/.metis/agent/metis-debug.log`:
  - Rendered TUI lines
  - Messages sent to the LLM
  - Active tool states
- For Desktop, start with `npm run dev` and open Chrome DevTools (Cmd+Option+I / Ctrl+Shift+I).
