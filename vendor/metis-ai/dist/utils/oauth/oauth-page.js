const SUCCESS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="36" fill="#22c55e"/><path d="M20.5 36.5 31.5 47.5 52.5 25.5" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ERROR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="36" fill="#ef4444"/><path d="m24 24 24 24M48 24 24 48" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>`;
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function renderPage(options) {
    const title = escapeHtml(options.title);
    const heading = escapeHtml(options.heading);
    const message = escapeHtml(options.message);
    const details = options.details ? escapeHtml(options.details) : undefined;
    const icon = options.icon;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --text: #fafafa;
      --text-dim: #a1a1aa;
      --page-bg: #09090b;
      --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--font-sans);
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo {
      width: 72px;
      height: 72px;
      display: block;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      color: var(--text);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: var(--text-dim);
      font-size: 15px;
    }
    .details {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <main>
    <div class="logo">${icon}</div>
    <h1>${heading}</h1>
    <p>${message}</p>
    ${details ? `<div class="details">${details}</div>` : ""}
  </main>
</body>
</html>`;
}
export function oauthSuccessHtml(message) {
    return renderPage({
        title: "Authentication successful",
        heading: "Authentication successful",
        message,
        icon: SUCCESS_SVG,
    });
}
export function oauthErrorHtml(message, details) {
    return renderPage({
        title: "Authentication failed",
        heading: "Authentication failed",
        message,
        details,
        icon: ERROR_SVG,
    });
}
//# sourceMappingURL=oauth-page.js.map
