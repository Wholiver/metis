# Contributing Guide

**English** · [简体中文](CONTRIBUTING.zh-CN.md)

Thank you for contributing to Metis. This guide is for core developers, Extension authors, and Package maintainers. It explains how to understand the repository, implement changes, validate results, and prepare a contribution.

If an AI coding agent assists your work, also read [AGENTS.md](AGENTS.md). It gives agents a repository map, execution order, safety boundaries, and verification requirements.

## Before you start

- Use Node.js `>=22.19.0`.
- Search existing issues, documentation, implementations, and tests before adding new behavior.
- Keep changes focused; do not mix unrelated refactors into a contribution.
- Do not commit API keys, tokens, session logs, `.env`, `dist/`, local indexes, or generated output.
- Extensions run with the current user's full system permissions. Install and distribute only trusted code.

## Local development

```bash
git clone https://github.com/Wholiver/metis.git
cd metis
npm install
npm run build
npm test
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Clean `dist/`, compile TypeScript, and copy runtime assets. |
| `npm test` | Run the full Vitest suite. |
| `npm test -- test/example.test.ts` | Run one test file. |
| `npm run clean` | Remove generated build output. |
| `npm run build:binary` | Build the standalone binary and bundled assets. |

If a build or test hangs, do not report it as passing. Record the exact stage, process, and recovery attempt, then disclose the limitation in the pull request.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | CLI startup, argument handling, mode selection, and top-level orchestration. |
| `src/core/` | Agent sessions, SDK, settings, model registry, resource loading, and core runtime. |
| `src/core/tools/` | Built-in tools callable by models. |
| `src/core/extensions/` | Extension discovery, lifecycle events, registration APIs, and execution. |
| `src/core/builtins/` | Built-in capabilities such as Dream. |
| `src/modes/interactive/` | Interactive terminal mode, components, themes, and rendering. |
| `src/modes/print-mode.ts` | Print and JSON output. |
| `src/modes/rpc/` | RPC server, client, and process integration. |
| `src/index.ts` | Public SDK and type exports. |
| `vendor/` | Local dependencies used by this repository. Change only when the requested behavior belongs there. |
| `test/` | Vitest tests and required fixtures. |
| `docs/` | User, Extension, Package, SDK, and platform documentation. |
| `examples/extensions/` | Runnable Extension examples. |

When public types or exports change, check `src/index.ts`, SDK consumers, RPC consumers, tests, and documentation.

## Core development workflow

1. **Confirm requirements** — list user requirements, compatibility constraints, and acceptance conditions.
2. **Locate the implementation** — inspect existing abstractions, callers, tests, and error behavior.
3. **Design the smallest change** — identify state ownership, failure boundaries, cancellation, and affected modes.
4. **Implement** — follow existing TypeScript, ESM, naming, and error-handling patterns.
5. **Test** — cover success, failure, cancellation, empty input, boundaries, and regressions.
6. **Verify prompt fidelity** — compare the result against the original request and every later clarification.
7. **Update documentation** — document user-visible behavior, configuration, commands, public APIs, and Extension changes.

Use path helpers from `src/config.ts` for package assets. Do not infer package resource locations from `__dirname`.

## Extension integration

Metis calls its plugin interface an **Extension**. Extensions are TypeScript or JavaScript modules that can:

- register tools callable by the model;
- register slash commands, shortcuts, and CLI flags;
- observe or intercept Session, Agent, Model, Tool, and other lifecycle events;
- add interactive UI, status items, widgets, and custom renderers;
- persist custom session state;
- integrate webhooks, CI, file watchers, or external services.

### Minimal Extension

Create `.metis/extensions/hello.ts`:

```typescript
import type { ExtensionAPI } from "metis";
import { Type } from "typebox";

export default function (metis: ExtensionAPI) {
  metis.registerTool({
    name: "hello",
    label: "Hello",
    description: "Return a greeting",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  metis.registerCommand("hello", {
    description: "Show a greeting",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello, ${args || "world"}!`, "info");
    },
  });
}
```

Load it directly:

```bash
node dist/cli.js -e ./.metis/extensions/hello.ts
```

Auto-discovery locations:

| Location | Scope |
| --- | --- |
| `~/.metis/agent/extensions/*.ts` | All projects. |
| `~/.metis/agent/extensions/*/index.ts` | All projects, directory form. |
| `.metis/extensions/*.ts` | Current trusted project. |
| `.metis/extensions/*/index.ts` | Current trusted project, directory form. |

Auto-discovered Extensions can be hot-reloaded with `/reload`. Project-local Extensions load only after the project is trusted.

### Extension requirements

- Define clear and strict TypeBox schemas for tool parameters.
- Respect `AbortSignal`; long-running operations must support cancellation.
- Return actionable errors with failure and recovery details.
- Keep destructive writes, deletion, privilege escalation, and external publishing behind explicit authority boundaries.
- Consider `tui`, `print`, `json`, and `rpc` modes; provide a fallback when UI is unavailable.
- Release long-lived resources during lifecycle events such as `session_shutdown`.
- Put third-party runtime packages in `dependencies`, not only `devDependencies`.

See [docs/extensions.md](docs/extensions.md) for the full API and [docs/custom-provider.md](docs/custom-provider.md) for custom model providers.

## Distributing a Metis Package

A Package can distribute Extensions, Skills, Prompt Templates, and Themes together.

```text
my-metis-package/
  package.json
  extensions/
  skills/
  prompts/
  themes/
```

```json
{
  "name": "my-metis-package",
  "keywords": ["metis-package"],
  "metis": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  },
  "peerDependencies": {
    "metis": "*",
    "typebox": "*"
  }
}
```

Install and test:

```bash
metis install ./my-metis-package
metis install -l ./my-metis-package
metis list
metis update --extensions
metis remove ./my-metis-package
```

`-l` writes to project settings; without `-l`, commands use user settings. npm, git, URLs, and local paths are supported. See [docs/packages.md](docs/packages.md) for complete source and manifest rules.

## Testing requirements

Choose checks based on risk, not convenience:

- Core runtime: build, type checks, targeted tests, failure, and cancellation.
- CLI: argument combinations, TTY/non-TTY, exit codes, stdin, stdout, and stderr.
- TUI: keyboard behavior, layout, narrow terminals, light/dark themes, and non-interactive environments.
- Extensions: load, reload, event order, tool results, cancellation, errors, state, and every supported mode.
- Packages: local installation, production dependencies, discovery, enable/disable, update, and removal.
- Documentation and SVG: links, commands, XML, light/dark rendering, and mobile scaling.

For bug fixes, add a test that reproduces the problem before validating the fix.

## Pull requests

Before opening a pull request:

- [ ] Scope matches the issue or request; no unrelated rewrite is included.
- [ ] New behavior has tests; existing tests were not weakened without justification.
- [ ] `npm run build` and relevant tests pass, or the exact blocker is disclosed.
- [ ] User-visible changes update the README, `docs/`, or examples.
- [ ] No secrets, logs, generated directories, sessions, or local state are included.
- [ ] The description explains motivation, user impact, validation, and known limits.

Use Conventional Commits:

```text
feat(extensions): add tool cancellation hook
fix(rpc): preserve request error details
docs: add package integration guide
```

