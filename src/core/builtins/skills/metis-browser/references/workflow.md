# Browser workflow

## Happy path

1. `browser_tabs` with `action: "list"` if you need current tabs.
2. `browser_navigate` with the target URL (`newTab: true` only when a separate tab is required). Wait until the result reports the loaded `url`/`title` (not leftover `about:blank`).
3. Visual SVG/HTML/artwork: `browser_take_screenshot` next. Interactive UI: `browser_snapshot`, then choose an element `ref`.
4. Call one interaction tool (`browser_click`, `browser_fill`, `browser_type`, `browser_press_key`, `browser_scroll`).
5. Call `browser_snapshot` again before the next interaction. After a visual edit, re-navigate and screenshot again.

## Local development

- Prefer `http://127.0.0.1` / `http://localhost` for local servers.
- For SVG/HTML artifacts in the workspace, pass the relative path to `browser_navigate` (for example `pelican_bike.svg`) instead of bash `open`.
- After file edits that affect the page, reload with `browser_navigate` before re-checking UI. The same `file://` path is reloaded; do not assume the previous paint is current.
- If snapshot shows a blank or loading document, wait for navigate to finish, then screenshot (visual) or snapshot again (interactive).

## Verification

- Structural claims (button exists, form filled, route changed) → prove with snapshot fields (`url`, `title`, node list).
- Visual claims (layout, color, overlap, SVG drawing) → `browser_take_screenshot` after a completed navigate. Snapshot is not visual evidence for drawings.
