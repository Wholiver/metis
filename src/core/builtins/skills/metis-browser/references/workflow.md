# Browser workflow

## Happy path

1. `browser_tabs` with `action: "list"` if you need current tabs.
2. `browser_navigate` with the target URL (`newTab: true` only when a separate tab is required).
3. Wait for the tool result, then `browser_snapshot`.
4. Choose an element `ref` from the snapshot.
5. Call one interaction tool (`browser_click`, `browser_fill`, `browser_type`, `browser_press_key`, `browser_scroll`).
6. Call `browser_snapshot` again before the next interaction.

## Local development

- Prefer `http://127.0.0.1` / `http://localhost` for local servers.
- For SVG/HTML artifacts in the workspace, pass the relative path to `browser_navigate` (for example `pelican_bike.svg`) instead of bash `open`.
- After file edits that affect the page, reload before re-checking UI.
- If snapshot shows a blank or loading document, wait briefly and snapshot again (or re-navigate).

## Verification

- Structural claims (button exists, form filled, route changed) → prove with snapshot fields (`url`, `title`, node list).
- Visual claims (layout, color, overlap) → screenshot may help, but prefer repeatable DOM/tests for final evidence.
