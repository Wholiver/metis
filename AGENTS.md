# Agent Development Guide

This file is for AI coding agents contributing to Metis. Treat it as repository-level operating guidance. User and system instructions always take precedence.

## Objective

Help developers change Metis quickly without sacrificing scope control, compatibility, or verification. Prefer evidence from the repository over assumptions.

## Start Every Task

1. Restate the requested outcome and concrete acceptance criteria.
2. Read `git status` and preserve unrelated user changes.
3. Search for relevant code, tests, docs, and existing abstractions before editing.
4. Read the nearest applicable `AGENTS.md` if a nested one exists.
5. Identify affected modes: TUI, print, JSON, RPC, SDK, Extensions, Packages.
6. Decide the smallest validation set that can prove the change works.

If `.codegraph/` exists and its tools work, use CodeGraph before broad text search for code understanding. If the index is missing or malformed, state that once and fall back to `rg` and targeted file reads.

## Repository Map

| Area | Primary paths |
| --- | --- |
| CLI entry and mode selection | `src/main.ts`, `src/cli/`, `src/modes/` |
| Agent session and SDK | `src/core/agent-session.ts`, `src/core/agent-session-runtime.ts`, `src/core/sdk.ts` |
| Built-in model tools | `src/core/tools/` |
| Extensions | `src/core/extensions/`, `docs/extensions.md`, `examples/extensions/` |
| Package loading | `src/core/package-manager.ts`, `docs/packages.md` |
| Dream and built-ins | `src/core/builtins/` |
| TUI | `src/modes/interactive/`, `vendor/metis-tui/` |
| Desktop frontend | `desktop/`, `docs/desktop-frontend-development.md` |
| RPC | `src/modes/rpc/`, `src/rpc-entry.ts` |
| Public exports | `src/index.ts` |
| Tests | `test/`, `vitest.config.ts` |
| User documentation | `README.md`, `README.zh-CN.md`, `docs/` |

Do not modify `vendor/` unless the requested behavior belongs to a vendored package. Do not edit generated `dist/` output by hand.

## Desktop Frontend Changes (Mandatory)

Before any change under `desktop/`, any Desktop-facing Server endpoint, or any `test/desktop-*.test.ts` file, read `docs/desktop-frontend-development.md` completely and follow it as repository instructions.

Non-negotiable rules:

- Trace the real path from `desktop/main.cjs` through `preload.cjs`, renderer state/rendering, active DOM, and final CSS. Do not infer runtime ownership from filenames or screenshots.
- Treat `desktop/renderer/` as source. Never hand-edit `desktop/dist/` or renderer vendor files. If validating `start:dist` or a packaged app, rebuild first and restart that artifact.
- Preserve the plain-script load order in `desktop/renderer/index.html`. New helpers must load before `app.js`, expose the expected browser global, support Node tests where applicable, and have wiring coverage.
- Search every definition of a selector, variable, ID, function, and visible string before editing. `styles.css` has layered rules and later scoped overrides; changing the first match may do nothing.
- After state changes, prove that the correct render path runs. Account for message object-identity fast paths, requestAnimationFrame scheduling, SSE sequence/session filtering, and snapshot reconciliation.
- Assistant work spans multiple messages/articles. Keep turn-level ownership, stable `data-part-key` identities, Tool UI contracts, expanded/collapsed behavior, and the work/final-response boundary intact.
- Change canonical Desktop copy in `desktop/i18n-source.cjs`, regenerate catalogs, and test placeholder parity. Do not edit only generated catalogs.
- Visual changes require repeatable runtime evidence such as computed styles, bounding boxes, DOM/ARIA assertions, or the Electron capture path. Computer Use and screenshots may assist diagnosis but are not final proof.
- Run targeted Desktop tests, `npm --prefix desktop run build`, and `git diff --check`. Report exact failures; never claim success from a diff, a timeout, or an unverified visual assumption.

## Implementation Loop

1. **Investigate** — trace callers, state ownership, error handling, tests, and documentation.
2. **Plan** — list files to change and checks to run. Avoid speculative rewrites.
3. **Implement** — follow existing TypeScript and ESM patterns. Keep public types explicit.
4. **Test** — cover success, failure, cancellation, empty input, boundaries, and regression risk.
5. **Review** — inspect the diff for unrelated changes, stale docs, and accidental generated files.
6. **Verify prompt fidelity** — compare the result with every original requirement and later clarification.

Never report completion while a required build, test, file, or user requirement remains unfinished.

## Extension Changes

When adding or changing an Extension API:

- inspect `src/core/extensions/types.ts`, `runner.ts`, `loader.ts`, `wrapper.ts`, and public exports;
- preserve event ordering and document synchronous versus asynchronous behavior;
- pass cancellation through `AbortSignal` where work can block;
- define strict TypeBox schemas for registered tools;
- verify behavior in `tui`, `print`, `json`, and `rpc` modes;
- add or update a runnable example under `examples/extensions/`;
- update `docs/extensions.md` and `docs/packages.md` when distribution changes;
- test load, reload, shutdown, errors, state persistence, and dependency resolution.

Extensions run with full user permissions. Do not weaken trust checks or add silent destructive behavior.

## Public API Changes

For exported types or functions:

- update `src/index.ts` and relevant subpath exports;
- check SDK and RPC consumers;
- avoid breaking changes unless explicitly authorized;
- document migration steps for unavoidable breaking changes;
- add type-level and runtime coverage.

## Validation Commands

Run checks proportional to risk:

```bash
npm run build
npm test
npm test -- test/specific.test.ts
```

For docs and SVG changes also run:

```bash
git diff --check
xmllint --noout docs/images/*.svg
```

If a command hangs, identify the exact stage and process, stop only processes started by the current task, try one safe equivalent path, and report the unresolved blocker. A timeout is not a passing result.

## Git and Workspace Safety

- Preserve unrelated modifications in dirty worktrees.
- Stage explicit files when scope is mixed.
- Do not use `git reset --hard`, discard user work, or force-push without explicit authorization.
- Do not publish, open a PR, or change external state unless the user requested it.

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
5. **Silent Wait for Windows CI**:
   - Trigger `gh workflow run release-windows.yml --ref <TAG>`.
   - Windows build takes ~25 minutes. Do NOT poll in a loop. Use `schedule` with a 25-minute one-shot timer (`DurationSeconds: 1500`).
6. **GitHub Release Notes Scope**:
   - When creating `gh release create <TAG>`, pass only the release notes corresponding to that specific release version (not the full `CHANGELOG.md`).
   - Release only to NPM and GitHub Releases. Strictly do NOT upload or push to Gitee.

## Handoff

Report:

- outcome first;
- files changed;
- validation run and exact result;
- any command that could not complete;
- remaining user action, only when truly required.

Keep the handoff concise. Do not hide uncertainty or claim tests passed when they did not run.

