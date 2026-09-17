/**
 * Desktop Inspector browser host: localhost HTTP control plane for Metis Server browser_* tools.
 * Keeps CDP/webview control in Electron main; Server calls POST /browser/command.
 */

const http = require("node:http");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SNAPSHOT_SCRIPT = String.raw`(() => {
  const interactiveOnly = true;
  const selector = interactiveOnly
    ? 'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="combobox"], [role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"])'
    : 'body *';
  const elements = Array.from(document.querySelectorAll(selector)).filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }).slice(0, 200);
  document.querySelectorAll('[data-metis-ref]').forEach((el) => el.removeAttribute('data-metis-ref'));
  const nodes = elements.map((el, index) => {
    const ref = 'e' + index;
    el.setAttribute('data-metis-ref', ref);
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return {
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      name: text || undefined,
      value: typeof el.value === 'string' ? el.value.slice(0, 80) : undefined,
      href: el.tagName === 'A' ? el.href : undefined,
    };
  });
  return { url: location.href, title: document.title, nodes };
})()`;

function isHttpUrl(value) {
	try {
		const url = new URL(String(value || ""));
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function isFileUrl(value) {
	try {
		const url = new URL(String(value || ""));
		return url.protocol === "file:";
	} catch {
		return false;
	}
}

function isAllowedBrowserUrl(value) {
	return value === "about:blank" || isHttpUrl(value) || isFileUrl(value);
}

/**
 * Resolve navigate targets: http(s), about:blank, file://, or workspace-relative / absolute paths.
 */
function resolveNavigateUrl(raw, workspaceRoot) {
	const input = String(raw || "").trim();
	if (!input) return { error: "URL or file path required" };
	if (input === "about:blank") return { url: "about:blank" };
	if (isHttpUrl(input) || isFileUrl(input)) return { url: input };

	const root = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();
	const absolute = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
	try {
		if (!fs.existsSync(absolute)) {
			return { error: `File not found: ${absolute}` };
		}
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
	return { url: pathToFileURL(absolute).href, filePath: absolute };
}

function createBrowserHostController(options = {}) {
	const getMainWindow = typeof options.getMainWindow === "function" ? options.getMainWindow : () => undefined;
	const getWorkspaceRoot =
		typeof options.getWorkspaceRoot === "function" ? options.getWorkspaceRoot : () => process.cwd();
	const token = options.token || randomBytes(24).toString("hex");
	/** @type {Map<string, { webContentsId: number, url: string, title: string }>} */
	const tabs = new Map();
	/** @type {Map<number, Electron.WebContents>} */
	const guestsById = new Map();
	/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
	const pendingBinds = new Map();
	let activeTabId = null;
	let server = null;
	let baseUrl = "";
	let nextSyntheticId = 1;

	function registerGuest(guest) {
		if (!guest || typeof guest.id !== "number") return;
		guestsById.set(guest.id, guest);
		guest.once?.("destroyed", () => {
			guestsById.delete(guest.id);
			for (const [tabId, meta] of tabs.entries()) {
				if (meta.webContentsId === guest.id) {
					tabs.delete(tabId);
					if (activeTabId === tabId) activeTabId = tabs.keys().next().value ?? null;
				}
			}
		});
	}

	function bindTab(tabId, webContentsId, meta = {}) {
		const id = String(tabId || "");
		const wcId = Number(webContentsId);
		if (!id || !Number.isFinite(wcId)) return { ok: false, error: "tabId and webContentsId required" };
		const guest = guestsById.get(wcId);
		tabs.set(id, {
			webContentsId: wcId,
			url: meta.url || guest?.getURL?.() || "",
			title: meta.title || guest?.getTitle?.() || "Browser",
		});
		activeTabId = id;
		const pending = pendingBinds.get(id) || pendingBinds.get("*");
		if (pending) {
			clearTimeout(pending.timer);
			pendingBinds.delete(id);
			pendingBinds.delete("*");
			pending.resolve({ tabId: id, webContentsId: wcId });
		}
		return { ok: true, tabId: id, webContentsId: wcId };
	}

	function waitForBind(tabIdHint, timeoutMs = 15_000) {
		const key = tabIdHint || "*";
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pendingBinds.delete(key);
				reject(new Error("Timed out waiting for Inspector browser webview"));
			}, timeoutMs);
			pendingBinds.set(key, { resolve, reject, timer });
		});
	}

	function listTabs() {
		return Array.from(tabs.entries()).map(([id, meta]) => ({
			id,
			url: meta.url || "",
			title: meta.title || "Browser",
			active: id === activeTabId,
		}));
	}

	function resolveTabId(requested) {
		if (requested && tabs.has(requested)) return requested;
		if (activeTabId && tabs.has(activeTabId)) return activeTabId;
		const first = tabs.keys().next();
		return first.done ? null : first.value;
	}

	function getGuest(tabId) {
		const id = resolveTabId(tabId);
		if (!id) return { error: "No Inspector browser tab is open" };
		const meta = tabs.get(id);
		const guest = meta ? guestsById.get(meta.webContentsId) : undefined;
		if (!guest || guest.isDestroyed?.()) {
			return { error: `Browser tab ${id} has no active webview` };
		}
		return { tabId: id, guest, meta };
	}

	function sendToRenderer(channel, payload) {
		const win = getMainWindow();
		if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) {
			throw new Error("Desktop window is not available");
		}
		win.webContents.send(channel, payload);
	}

	async function ensureBrowserTab({ url, newTab, tabId }) {
		const targetUrl = url || "about:blank";
		if (!newTab) {
			const existingId = resolveTabId(tabId);
			if (existingId) {
				const meta = tabs.get(existingId);
				const guest = meta ? guestsById.get(meta.webContentsId) : undefined;
				if (guest && !guest.isDestroyed?.()) {
					activeTabId = existingId;
					sendToRenderer("browser:host-select-tab", { tabId: existingId });
					if (targetUrl && targetUrl !== "about:blank") {
						sendToRenderer("browser:host-ensure-tab", {
							requestId: `nav-${Date.now()}`,
							url: targetUrl,
							newTab: false,
							tabId: existingId,
						});
						try {
							await guest.loadURL(targetUrl);
						} catch {
							// Renderer may already navigate via tab state.
						}
						meta.url = targetUrl;
					}
					return {
						ok: true,
						tabId: existingId,
						url: meta.url || targetUrl,
						title: meta.title || "Browser",
					};
				}
			}
		}

		const requestId = `br-${Date.now()}-${nextSyntheticId++}`;
		sendToRenderer("browser:host-ensure-tab", {
			requestId,
			url: targetUrl === "about:blank" ? "" : targetUrl,
			newTab: Boolean(newTab),
			tabId: tabId || undefined,
		});
		const bound = await waitForBind(tabId || "*", 20_000);
		activeTabId = bound.tabId;
		if (targetUrl && targetUrl !== "about:blank") {
			const guest = guestsById.get(bound.webContentsId);
			if (guest && !guest.isDestroyed()) {
				try {
					await guest.loadURL(targetUrl);
				} catch {
					// Renderer may already have started navigation via tab state.
				}
			}
		}
		const meta = tabs.get(bound.tabId);
		return {
			ok: true,
			tabId: bound.tabId,
			url: meta?.url || targetUrl,
			title: meta?.title || "Browser",
		};
	}

	async function runPageScript(guest, script) {
		return guest.executeJavaScript(script, true);
	}

	async function handleCommand(command) {
		if (!command || typeof command !== "object" || typeof command.op !== "string") {
			return { ok: false, error: "Invalid browser command" };
		}

		try {
			switch (command.op) {
				case "navigate": {
					const resolvedUrl = resolveNavigateUrl(command.url, getWorkspaceRoot());
					if (resolvedUrl.error) {
						return { ok: false, error: resolvedUrl.error };
					}
					if (!isAllowedBrowserUrl(resolvedUrl.url)) {
						return { ok: false, error: "Only http(s), file://, or about:blank targets are allowed" };
					}
					return await ensureBrowserTab({
						url: resolvedUrl.url,
						newTab: command.newTab,
						tabId: command.tabId,
					});
				}
				case "tabs": {
					if (command.action === "list") {
						return { ok: true, tabs: listTabs(), tabId: activeTabId || undefined };
					}
					if (command.action === "new") {
						return await ensureBrowserTab({ url: command.url || "about:blank", newTab: true });
					}
					if (command.action === "select") {
						if (!command.tabId || !tabs.has(command.tabId)) {
							return { ok: false, error: "Unknown tabId" };
						}
						activeTabId = command.tabId;
						sendToRenderer("browser:host-select-tab", { tabId: command.tabId });
						const meta = tabs.get(command.tabId);
						return { ok: true, tabId: command.tabId, url: meta?.url, title: meta?.title, tabs: listTabs() };
					}
					return { ok: false, error: "Unsupported tabs action" };
				}
				case "snapshot": {
					let resolved = getGuest(command.tabId);
					if (resolved.error) {
						await ensureBrowserTab({ url: "about:blank", newTab: false });
						resolved = getGuest(command.tabId);
					}
					if (resolved.error) return { ok: false, error: resolved.error };
					const data = await runPageScript(resolved.guest, SNAPSHOT_SCRIPT);
					const lines = [`url: ${data.url}`, `title: ${data.title}`, "nodes:"];
					for (const node of data.nodes || []) {
						const bits = [
							`[${node.ref}]`,
							node.tag,
							node.role ? `role=${node.role}` : null,
							node.type ? `type=${node.type}` : null,
							node.name ? `"${node.name}"` : null,
							node.value != null && node.value !== "" ? `value="${node.value}"` : null,
							node.href ? node.href : null,
						].filter(Boolean);
						lines.push(bits.join(" "));
					}
					const meta = tabs.get(resolved.tabId);
					if (meta) {
						meta.url = data.url || meta.url;
						meta.title = data.title || meta.title;
					}
					return {
						ok: true,
						tabId: resolved.tabId,
						url: data.url,
						title: data.title,
						snapshot: lines.join("\n"),
					};
				}
				case "click": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const selector = JSON.stringify(`[data-metis-ref="${String(command.ref || "")}"]`);
					const result = await runPageScript(
						resolved.guest,
						`(() => {
              const el = document.querySelector(${selector});
              if (!el) return { ok: false, error: 'ref not found' };
              el.click();
              return { ok: true, url: location.href, title: document.title };
            })()`,
					);
					if (!result?.ok) return { ok: false, error: result?.error || "click failed", tabId: resolved.tabId };
					return { ok: true, tabId: resolved.tabId, url: result.url, title: result.title };
				}
				case "fill": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const selector = JSON.stringify(`[data-metis-ref="${String(command.ref || "")}"]`);
					const value = JSON.stringify(String(command.value ?? ""));
					const result = await runPageScript(
						resolved.guest,
						`(() => {
              const el = document.querySelector(${selector});
              if (!el) return { ok: false, error: 'ref not found' };
              el.focus();
              if ('value' in el) {
                el.value = ${value};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                el.textContent = ${value};
              }
              return { ok: true, url: location.href, title: document.title };
            })()`,
					);
					if (!result?.ok) return { ok: false, error: result?.error || "fill failed", tabId: resolved.tabId };
					return { ok: true, tabId: resolved.tabId, url: result.url, title: result.title };
				}
				case "type": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const selector = command.ref
						? JSON.stringify(`[data-metis-ref="${String(command.ref)}"]`)
						: "null";
					const text = JSON.stringify(String(command.text ?? ""));
					const submit = Boolean(command.submit);
					const result = await runPageScript(
						resolved.guest,
						`(() => {
              const el = ${selector} ? document.querySelector(${selector}) : document.activeElement;
              if (!el) return { ok: false, error: 'no target element' };
              el.focus();
              if ('value' in el) {
                el.value = (el.value || '') + ${text};
                el.dispatchEvent(new Event('input', { bubbles: true }));
              } else if (el.isContentEditable) {
                el.textContent = (el.textContent || '') + ${text};
              }
              if (${submit}) {
                const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
                el.dispatchEvent(enter);
              }
              return { ok: true, url: location.href, title: document.title };
            })()`,
					);
					if (!result?.ok) return { ok: false, error: result?.error || "type failed", tabId: resolved.tabId };
					return { ok: true, tabId: resolved.tabId, url: result.url, title: result.title };
				}
				case "press_key": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const key = JSON.stringify(String(command.key || ""));
					const result = await runPageScript(
						resolved.guest,
						`(() => {
              const target = document.activeElement || document.body;
              const eventInit = { key: ${key}, code: ${key}, bubbles: true, cancelable: true };
              target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
              target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
              return { ok: true, url: location.href, title: document.title };
            })()`,
					);
					return { ok: true, tabId: resolved.tabId, url: result?.url, title: result?.title };
				}
				case "scroll": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const amount = Number(command.amount) > 0 ? Number(command.amount) : 600;
					const direction = JSON.stringify(String(command.direction || "down"));
					const selector = command.ref
						? JSON.stringify(`[data-metis-ref="${String(command.ref)}"]`)
						: "null";
					const result = await runPageScript(
						resolved.guest,
						`(() => {
              const el = ${selector} ? document.querySelector(${selector}) : null;
              if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
              const dir = ${direction};
              const amt = ${amount};
              const dx = dir === 'left' ? -amt : dir === 'right' ? amt : 0;
              const dy = dir === 'up' ? -amt : dir === 'down' ? amt : 0;
              window.scrollBy(dx, dy);
              return { ok: true, url: location.href, title: document.title };
            })()`,
					);
					return { ok: true, tabId: resolved.tabId, url: result?.url, title: result?.title };
				}
				case "screenshot": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const image = await resolved.guest.capturePage();
					const png = image.toPNG();
					return {
						ok: true,
						tabId: resolved.tabId,
						url: resolved.meta?.url || resolved.guest.getURL?.(),
						title: resolved.meta?.title || resolved.guest.getTitle?.(),
						screenshotBase64: Buffer.from(png).toString("base64"),
						mimeType: "image/png",
					};
				}
				default:
					return { ok: false, error: `Unsupported browser op: ${command.op}` };
			}
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	function start() {
		if (server) return Promise.resolve({ baseUrl, token });
		return new Promise((resolve, reject) => {
			server = http.createServer(async (req, res) => {
				const respond = (status, body) => {
					const payload = JSON.stringify(body);
					res.writeHead(status, {
						"content-type": "application/json; charset=utf-8",
						"content-length": Buffer.byteLength(payload),
					});
					res.end(payload);
				};
				try {
					if (req.socket.remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
						respond(403, { ok: false, error: "Forbidden" });
						return;
					}
					if (req.method === "GET" && req.url === "/health") {
						respond(200, { ok: true });
						return;
					}
					if (req.method !== "POST" || req.url !== "/browser/command") {
						respond(404, { ok: false, error: "Not found" });
						return;
					}
					const provided = req.headers["x-metis-browser-token"];
					if (provided !== token) {
						respond(401, { ok: false, error: "Unauthorized" });
						return;
					}
					const chunks = [];
					for await (const chunk of req) chunks.push(chunk);
					const raw = Buffer.concat(chunks).toString("utf8");
					let command;
					try {
						command = raw ? JSON.parse(raw) : null;
					} catch {
						respond(400, { ok: false, error: "Invalid JSON" });
						return;
					}
					const result = await handleCommand(command);
					respond(result.ok ? 200 : 400, result);
				} catch (error) {
					respond(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
				}
			});
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				baseUrl = `http://127.0.0.1:${address.port}`;
				resolve({ baseUrl, token });
			});
			server.on("error", reject);
		});
	}

	function stop() {
		if (!server) return;
		try {
			server.close();
		} catch {}
		server = null;
		baseUrl = "";
	}

	function updateTabMeta(tabId, patch = {}) {
		const meta = tabs.get(String(tabId || ""));
		if (!meta) return;
		if (typeof patch.url === "string") meta.url = patch.url;
		if (typeof patch.title === "string") meta.title = patch.title;
	}

	return {
		start,
		stop,
		get token() {
			return token;
		},
		get baseUrl() {
			return baseUrl;
		},
		registerGuest,
		bindTab,
		updateTabMeta,
		handleCommand,
		listTabs,
	};
}

module.exports = {
	createBrowserHostController,
	isHttpUrl,
	isFileUrl,
	isAllowedBrowserUrl,
	resolveNavigateUrl,
};
