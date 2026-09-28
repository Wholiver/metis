# Browser workflow

## Admission (Build)

- `browser_snapshot`, `browser_take_screenshot`, and `browser_evaluate` are readable and may run before admission.
- `browser_tabs` with `action: "list"` is readable. `browser_tabs` `new`/`select` can open a URL and require `performance_admit` first, same as navigate/click/fill.
- `browser_navigate`, `browser_click`, `browser_mouse`, `browser_fill`, `browser_type`, `browser_press_key`, and `browser_scroll` require `performance_admit` first when Build mutating tools are gated.
- Do not always `browser_navigate` first with no admit.

## Happy path

1. `browser_tabs` with `action: "list"` if you need current tabs.
2. After admission when required, `browser_navigate` with the target URL (`newTab: true` only when a separate tab is required). Wait until the result reports the loaded `url`/`title` (not leftover `about:blank`). Localhost/127.0.0.1 reloads ignoring cache when already on that URL.
3. Visual SVG/HTML/artwork: `browser_take_screenshot` next. Interactive UI: `browser_snapshot`, then choose an element `ref` (buttons and visible canvas/video).
4. Call one interaction tool (`browser_click`, `browser_mouse`, `browser_fill`, `browser_type`, `browser_press_key`, `browser_scroll`).
5. Call `browser_snapshot` again before the next interaction. After a visual edit, re-navigate and screenshot again.

## Canvas / pointer lock / games

- Trusted input uses Electron `sendInputEvent`. Synthetic `el.click()` / fake `KeyboardEvent` are not used for click/press/mouse.
- Enter lock: click the enter control or canvas ref, then require `pointerLocked: true` in the tool result or snapshot before claiming look/move works. Click waits briefly for `pointerlockchange`.
- Look after lock: `browser_mouse` `look`/`move` with `movementX`/`movementY` relative deltas. Absolute coordinates alone will not turn a pointer-locked camera.
- WASD: `browser_press_key` with `KeyW`/`KeyA`/`KeyS`/`KeyD` and `holdMs` ≥ ~300. Arrow keys are not WASD.
- Tool `ok` alone is not acceptance. Prefer before/after screenshots plus `pointerLocked` / evaluated state. Do not mutate yaw/pitch via `browser_evaluate` to fake look.
- After navigate/reload, take a fresh snapshot before click — stale refs fail with `ref not found`.
- HTML app screenshots are full-page; only standalone SVG documents are content-cropped. Do not treat an inline icon crop as the game view.
- `browser_evaluate` is read-only probing. Do not dispatch input or read secrets with it.

## Local development

- Prefer `http://127.0.0.1` / `http://localhost` for local servers.
- **Port 5173 is reserved** for Metis Desktop's own Vite dev server. Never start preview or test servers on 5173 (no bare `vite` / `vite preview`, no `--port 5173`, no `python -m http.server 5173`). Use another port and pass it explicitly (e.g. `npx vite --port 4173`), then `browser_navigate` to that URL. Do not `browser_navigate` to `:5173`.
- For SVG/HTML artifacts in the workspace, pass the relative path to `browser_navigate` (for example `pelican_bike.svg`) instead of bash `open`.
- After file edits that affect the page, reload with `browser_navigate` before re-checking UI. The same `file://` path is reloaded; localhost same-URL navigate reloads ignoring cache. Do not assume the previous paint is current.
- If snapshot shows a blank or loading document, wait for navigate to finish, then screenshot (visual) or snapshot again (interactive).
- Do not hardcode the Inspector panel size into layouts. Full-page apps must use fluid viewport units and resize handlers so they still fill Chrome/Safari outside Metis.

## Verification

- Structural claims (button exists, form filled, route changed) → prove with snapshot fields (`url`, `title`, node list).
- Visual claims (layout, color, overlap, SVG drawing) → `browser_take_screenshot` after a completed navigate. Snapshot is not visual evidence for drawings.
- Gameplay claims (move, look, mine, place) → trusted click/press/mouse receipts (`pointerLocked`, `code`, `holdMs`) plus screenshots that show a state change.
