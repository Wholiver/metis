/**
 * Desktop Inspector browser host: localhost HTTP control plane for Metis Server browser_* tools.
 * Keeps CDP/webview control in Electron main; Server calls POST /browser/command.
 */

const http = require("node:http");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { BROWSER_FIT_VIEWPORT_SCRIPT, computeFitZoomScale } = require("./browser-fit.cjs");

const SNAPSHOT_SCRIPT = String.raw`(() => {
  const interactiveOnly = true;
  const selector = interactiveOnly
    ? 'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="combobox"], [role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"]), canvas, video'
    : 'body *';
  const elements = Array.from(document.querySelectorAll(selector)).filter((el) => {
    if (!(el instanceof HTMLElement) && !(el instanceof HTMLCanvasElement) && !(typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement)) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }).slice(0, 200);
  document.querySelectorAll('[data-metis-ref]').forEach((el) => el.removeAttribute('data-metis-ref'));
  const nodes = elements.map((el, index) => {
    const ref = 'e' + index;
    el.setAttribute('data-metis-ref', ref);
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return {
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      name: text || undefined,
      value: typeof el.value === 'string' ? el.value.slice(0, 80) : undefined,
      href: el.tagName === 'A' ? el.href : undefined,
      box: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  });
  const lockEl = document.pointerLockElement;
  return {
    url: location.href,
    title: document.title,
    nodes,
    pointerLocked: Boolean(lockEl),
    pointerLockTag: lockEl ? lockEl.tagName.toLowerCase() : null,
    viewportWidth: Math.round(window.innerWidth || 0),
    viewportHeight: Math.round(window.innerHeight || 0),
  };
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

const GUEST_LOAD_TIMEOUT_MS = 12_000;
const SCREENSHOT_TIMEOUT_MS = 8_000;
const PAINT_WAIT_TIMEOUT_MS = 2_000;
/**
 * Crop only standalone SVG documents (svg:root or body with a single svg child).
 * Never crop the first inline HUD/icon svg inside an HTML app.
 */
const SVG_CROP_SCRIPT = String.raw`(() => {
  const root = document.documentElement;
  if (!root) return null;
  const isSvgRoot = root.tagName && root.tagName.toLowerCase() === 'svg';
  let svg = null;
  if (isSvgRoot) {
    svg = root;
  } else if (document.body) {
    const kids = Array.from(document.body.children).filter((el) => {
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      return tag && tag !== 'script' && tag !== 'style' && tag !== 'link' && tag !== 'meta';
    });
    if (kids.length === 1 && kids[0].tagName.toLowerCase() === 'svg') {
      svg = kids[0];
    }
  }
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const base = svg.viewBox && svg.viewBox.baseVal;
  let viewBox = null;
  if (base && Number(base.width) > 0 && Number(base.height) > 0) {
    viewBox = { width: Number(base.width), height: Number(base.height) };
  } else {
    const attr = svg.getAttribute('viewBox');
    if (attr) {
      const parts = attr.trim().split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
        viewBox = { width: parts[2], height: parts[3] };
      }
    }
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewBox, standalone: true };
})()`;

function isStubFn(fn) {
	return typeof fn === "function" && Boolean(fn.mock || fn._isMockFunction);
}

function canSubscribeGuestLoad(guest) {
	return typeof guest?.once === "function" && typeof guest?.removeListener === "function" && !isStubFn(guest.once);
}

function withTimeout(promise, timeoutMs, message) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		Promise.resolve(promise).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function displayUrl(url) {
	try {
		const parsed = new URL(String(url || ""));
		if (parsed.searchParams.has("metisReload")) {
			parsed.searchParams.delete("metisReload");
			return parsed.href;
		}
	} catch {
		// keep original
	}
	return String(url || "");
}

function withFileReloadToken(url) {
	const parsed = new URL(url);
	parsed.searchParams.set("metisReload", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	return parsed.href;
}

function resolveLoadUrl(targetUrl) {
	if (!isFileUrl(targetUrl)) return targetUrl;
	return withFileReloadToken(targetUrl);
}

/**
 * Crop black letterboxing created by SVG viewBox + width/height 100% inside a taller webview.
 */
function computeSvgContentRect(viewport, viewBox) {
	const x = Number(viewport?.x);
	const y = Number(viewport?.y);
	const width = Number(viewport?.width);
	const height = Number(viewport?.height);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 8 || height < 8) return null;
	const originX = Number.isFinite(x) ? x : 0;
	const originY = Number.isFinite(y) ? y : 0;
	const vbW = Number(viewBox?.width);
	const vbH = Number(viewBox?.height);
	let outX = originX;
	let outY = originY;
	let outW = width;
	let outH = height;
	if (Number.isFinite(vbW) && Number.isFinite(vbH) && vbW > 0 && vbH > 0) {
		const vbAspect = vbW / vbH;
		const elAspect = width / height;
		if (elAspect > vbAspect + 0.02) {
			outW = height * vbAspect;
			outX = originX + (width - outW) / 2;
		} else if (vbAspect > elAspect + 0.02) {
			outH = width / vbAspect;
			outY = originY + (height - outH) / 2;
		}
	}
	return {
		x: Math.max(0, Math.round(outX)),
		y: Math.max(0, Math.round(outY)),
		width: Math.max(1, Math.round(outW)),
		height: Math.max(1, Math.round(outH)),
	};
}

/** Keep crop rectangles inside the guest CSS viewport so capturePage does not throw. */
function clampCropRectToGuest(rect, guest) {
	if (!rect) return null;
	let maxW = 0;
	let maxH = 0;
	try {
		if (typeof guest?.getSize === "function") {
			const size = guest.getSize();
			maxW = Number(size?.width) || Number(Array.isArray(size) ? size[0] : 0) || 0;
			maxH = Number(size?.height) || Number(Array.isArray(size) ? size[1] : 0) || 0;
		}
	} catch {
		maxW = 0;
		maxH = 0;
	}
	if (!(maxW > 0 && maxH > 0)) return rect;
	const x = Math.max(0, Math.min(Math.round(Number(rect.x) || 0), maxW - 1));
	const y = Math.max(0, Math.min(Math.round(Number(rect.y) || 0), maxH - 1));
	const width = Math.max(1, Math.min(Math.round(Number(rect.width) || 0), maxW - x));
	const height = Math.max(1, Math.min(Math.round(Number(rect.height) || 0), maxH - y));
	if (width < 8 || height < 8) return null;
	return { x, y, width, height };
}

const SCREENSHOT_TIMEOUT_MESSAGE =
	"Screenshot timed out after 8s. browser_navigate the same deliverable file again, then retry browser_take_screenshot. Do not create an HTML wrapper page for a preview failure.";

async function waitForTwoAnimationFrames(guest) {
	if (typeof guest?.executeJavaScript !== "function") return;
	try {
		await withTimeout(
			guest.executeJavaScript(
				"new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
				true,
			),
			PAINT_WAIT_TIMEOUT_MS,
			"Timed out waiting for Inspector browser paint",
		);
	} catch {
		// Paint wait is best-effort; screenshots still proceed.
	}
}

async function waitForGuestLoad(guest, timeoutMs = GUEST_LOAD_TIMEOUT_MS) {
	if (!canSubscribeGuestLoad(guest)) {
		await waitForTwoAnimationFrames(guest);
		return;
	}
	await new Promise((resolve) => {
		let settled = false;
		const done = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			guest.removeListener("did-finish-load", onFinish);
			guest.removeListener("did-fail-load", onFail);
			resolve();
		};
		const onFinish = () => done();
		const onFail = (_event, _code, _desc, _url, isMainFrame) => {
			if (isMainFrame === false) return;
			done();
		};
		const timer = setTimeout(done, timeoutMs);
		guest.once("did-finish-load", onFinish);
		guest.once("did-fail-load", onFail);
	});
	await waitForTwoAnimationFrames(guest);
}

function guestIsLoading(guest) {
	try {
		return typeof guest?.isLoading === "function" ? Boolean(guest.isLoading()) : false;
	} catch {
		return false;
	}
}

function guestCurrentZoom(guest) {
	try {
		if (typeof guest?.getZoomFactor === "function") {
			const value = Number(guest.getZoomFactor());
			return Number.isFinite(value) ? value : null;
		}
	} catch {
		// destroyed / stub
	}
	return null;
}

async function applyFitViewport(guest) {
	if (typeof guest?.executeJavaScript !== "function") return null;
	try {
		const result = await withTimeout(
			guest.executeJavaScript(BROWSER_FIT_VIEWPORT_SCRIPT, true),
			PAINT_WAIT_TIMEOUT_MS,
			"Timed out fitting Inspector browser viewport",
		);
		const zoomFactor = computeFitZoomScale(
			Number(result?.contentWidth) || 0,
			Number(result?.contentHeight) || 0,
			Number(result?.viewportWidth) || 0,
			Number(result?.viewportHeight) || 0,
		);
		const applied =
			typeof result?.zoomFactor === "number" && Number.isFinite(result.zoomFactor)
				? Math.max(0.05, Math.min(1, result.zoomFactor))
				: zoomFactor;
		try {
			if (typeof guest.setVisualZoomLevelLimits === "function") {
				guest.setVisualZoomLevelLimits(1, 1);
			}
			const current = guestCurrentZoom(guest);
			if (current == null || Math.abs(current - applied) >= 0.01) {
				if (typeof guest.setZoomFactor === "function") {
					guest.setZoomFactor(applied);
				}
			}
		} catch {
			// Zoom APIs may be unavailable on destroyed guests.
		}
		return { ...(result && typeof result === "object" ? result : {}), zoomFactor: applied };
	} catch {
		return null;
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isLocalDevHostname(hostname) {
	const host = String(hostname || "").toLowerCase();
	return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function isLocalDevUrl(value) {
	try {
		const url = new URL(String(value || ""));
		return (url.protocol === "http:" || url.protocol === "https:") && isLocalDevHostname(url.hostname);
	} catch {
		return false;
	}
}

/**
 * Map user/agent key names to Electron sendInputEvent keyCode + DOM code.
 * Electron keyCode uses "W", "Left", "Space", etc.
 */
function resolveKeyboardKey(raw) {
	const input = String(raw || "").trim();
	if (!input) return { error: "key required" };

	const codeLetter = /^Key([A-Za-z])$/i.exec(input);
	if (codeLetter) {
		const letter = codeLetter[1].toUpperCase();
		return { key: letter.toLowerCase(), code: `Key${letter}`, keyCode: letter };
	}
	const codeDigit = /^Digit([0-9])$/i.exec(input);
	if (codeDigit) {
		return { key: codeDigit[1], code: `Digit${codeDigit[1]}`, keyCode: codeDigit[1] };
	}

	const aliases = {
		enter: { key: "Enter", code: "Enter", keyCode: "Enter" },
		return: { key: "Enter", code: "Enter", keyCode: "Enter" },
		escape: { key: "Escape", code: "Escape", keyCode: "Escape" },
		esc: { key: "Escape", code: "Escape", keyCode: "Escape" },
		tab: { key: "Tab", code: "Tab", keyCode: "Tab" },
		space: { key: " ", code: "Space", keyCode: "Space" },
		" ": { key: " ", code: "Space", keyCode: "Space" },
		arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: "Left" },
		left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: "Left" },
		arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: "Right" },
		right: { key: "ArrowRight", code: "ArrowRight", keyCode: "Right" },
		arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: "Up" },
		up: { key: "ArrowUp", code: "ArrowUp", keyCode: "Up" },
		arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: "Down" },
		down: { key: "ArrowDown", code: "ArrowDown", keyCode: "Down" },
		shift: { key: "Shift", code: "ShiftLeft", keyCode: "Shift" },
		shiftleft: { key: "Shift", code: "ShiftLeft", keyCode: "Shift" },
		shiftright: { key: "Shift", code: "ShiftRight", keyCode: "Shift" },
		control: { key: "Control", code: "ControlLeft", keyCode: "Control" },
		controlleft: { key: "Control", code: "ControlLeft", keyCode: "Control" },
		controlright: { key: "Control", code: "ControlRight", keyCode: "Control" },
		ctrl: { key: "Control", code: "ControlLeft", keyCode: "Control" },
		alt: { key: "Alt", code: "AltLeft", keyCode: "Alt" },
		meta: { key: "Meta", code: "MetaLeft", keyCode: "Meta" },
		backspace: { key: "Backspace", code: "Backspace", keyCode: "Backspace" },
		delete: { key: "Delete", code: "Delete", keyCode: "Delete" },
	};
	const lower = input.toLowerCase();
	if (aliases[lower]) return aliases[lower];

	if (/^[A-Za-z]$/.test(input)) {
		const letter = input.toUpperCase();
		return { key: letter.toLowerCase(), code: `Key${letter}`, keyCode: letter };
	}
	if (/^[0-9]$/.test(input)) {
		return { key: input, code: `Digit${input}`, keyCode: input };
	}
	const fKey = /^F([1-9]|1[0-2])$/i.exec(input);
	if (fKey) {
		const name = `F${fKey[1]}`;
		return { key: name, code: name, keyCode: name };
	}

	return { key: input, code: input, keyCode: input };
}

function getSendInputEvent(guest) {
	if (typeof guest?.sendInputEvent === "function") {
		return (event) => guest.sendInputEvent(event);
	}
	if (typeof guest?.webContents?.sendInputEvent === "function") {
		return (event) => guest.webContents.sendInputEvent(event);
	}
	return null;
}

function mouseButtonName(raw) {
	const value = String(raw || "left").toLowerCase();
	if (value === "right" || value === "middle") return value;
	return "left";
}

async function navigateGuest(guest, loadUrl) {
	const targetDisplay = displayUrl(loadUrl);
	let alreadyThere = false;
	try {
		const liveRaw = typeof guest?.getURL === "function" ? String(guest.getURL() || "") : "";
		const liveDisplay = displayUrl(liveRaw);
		const forcedReload = (() => {
			try {
				return new URL(loadUrl).searchParams.has("metisReload");
			} catch {
				return String(loadUrl || "").includes("metisReload=");
			}
		})();
		alreadyThere =
			!guestIsLoading(guest)
			&& !forcedReload
			&& Boolean(liveDisplay)
			&& (liveRaw === loadUrl || liveDisplay === targetDisplay);
	} catch {
		alreadyThere = false;
	}

	// Localhost/127.0.0.1: always reloadIgnoringCache so code edits are visible without ?bust=.
	if (alreadyThere && isLocalDevUrl(targetDisplay || loadUrl)) {
		const pendingLoad = canSubscribeGuestLoad(guest) ? waitForGuestLoad(guest) : undefined;
		try {
			if (typeof guest.reloadIgnoringCache === "function") {
				guest.reloadIgnoringCache();
			} else if (typeof guest.reload === "function") {
				guest.reload();
			} else if (typeof guest.loadURL === "function") {
				await guest.loadURL(loadUrl);
			}
		} catch {
			// Fall through to fit + paint wait.
		}
		if (pendingLoad) {
			await pendingLoad;
		} else {
			await waitForTwoAnimationFrames(guest);
		}
		await applyFitViewport(guest);
		await waitForTwoAnimationFrames(guest);
		return;
	}

	if (alreadyThere) {
		await applyFitViewport(guest);
		await waitForTwoAnimationFrames(guest);
		return;
	}

	const pendingLoad = canSubscribeGuestLoad(guest) ? waitForGuestLoad(guest) : undefined;
	try {
		if (typeof guest.loadURL === "function") {
			await guest.loadURL(loadUrl);
		}
	} catch {
		// Renderer may already be navigating via tab state; wait for load below.
	}
	if (pendingLoad) {
		await pendingLoad;
	} else {
		await waitForTwoAnimationFrames(guest);
	}
	await applyFitViewport(guest);
	await waitForTwoAnimationFrames(guest);
}

/**
 * Shrink Retina capturePage bitmaps to CSS-pixel size before toPNG().
 * Synchronous PNG encode of 2x/3x frames stalls the Desktop main process.
 */
function encodeScreenshotPng(image, guest) {
	if (!image || typeof image.toPNG !== "function") {
		return Buffer.alloc(0);
	}
	let sized = image;
	try {
		const size =
			typeof image.getSize === "function"
				? image.getSize()
				: null;
		const bitmapW = Number(size?.width) || 0;
		const bitmapH = Number(size?.height) || 0;
		let cssW = 0;
		let cssH = 0;
		if (typeof guest?.getSize === "function") {
			const guestSize = guest.getSize();
			cssW = Number(guestSize?.width) || Number(Array.isArray(guestSize) ? guestSize[0] : 0) || 0;
			cssH = Number(guestSize?.height) || Number(Array.isArray(guestSize) ? guestSize[1] : 0) || 0;
		}
		if (
			bitmapW > 0
			&& bitmapH > 0
			&& cssW > 0
			&& cssH > 0
			&& (bitmapW > cssW + 1 || bitmapH > cssH + 1)
			&& typeof image.resize === "function"
		) {
			sized = image.resize({ width: Math.round(cssW), height: Math.round(cssH), quality: "better" });
		}
	} catch {
		sized = image;
	}
	return Buffer.from(sized.toPNG());
}

function guestPageMeta(guest, fallback = {}) {
	const rawUrl = (typeof guest.getURL === "function" && guest.getURL()) || fallback.url || "";
	const title = (typeof guest.getTitle === "function" && guest.getTitle()) || fallback.title || "Browser";
	return {
		url: displayUrl(rawUrl) || fallback.url || "",
		title: title || "Browser",
	};
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
	let busyCount = 0;
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

	function notifyHostBusy() {
		try {
			sendToRenderer("browser:host-busy", { busy: busyCount > 0 });
		} catch {
			// Renderer window may not exist yet in tests or early startup.
		}
	}

	function tracksBrowserControl(command) {
		if (command.op === "tabs" && (command.action === "list" || command.action === "select")) {
			return false;
		}
		return true;
	}

	async function ensureBrowserTab({ url, newTab, tabId }) {
		const targetUrl = url || "about:blank";
		const loadUrl = resolveLoadUrl(targetUrl);
		if (!newTab) {
			const existingId = resolveTabId(tabId);
			if (existingId) {
				const meta = tabs.get(existingId);
				const guest = meta ? guestsById.get(meta.webContentsId) : undefined;
				if (guest && !guest.isDestroyed?.()) {
					activeTabId = existingId;
					sendToRenderer("browser:host-select-tab", { tabId: existingId });
					sendToRenderer("browser:host-ensure-tab", {
						requestId: `nav-${Date.now()}`,
						url: loadUrl,
						newTab: false,
						tabId: existingId,
					});
					await navigateGuest(guest, loadUrl);
					const page = guestPageMeta(guest, { url: targetUrl, title: meta.title });
					meta.url = page.url;
					meta.title = page.title;
					return {
						ok: true,
						tabId: existingId,
						url: page.url,
						title: page.title,
					};
				}
			}
		}

		const requestId = `br-${Date.now()}-${nextSyntheticId++}`;
		sendToRenderer("browser:host-ensure-tab", {
			requestId,
			url: loadUrl,
			newTab: Boolean(newTab),
			tabId: tabId || undefined,
		});
		const bound = await waitForBind(tabId || "*", 20_000);
		activeTabId = bound.tabId;
		const guest = guestsById.get(bound.webContentsId);
		if (guest && !guest.isDestroyed?.()) {
			await navigateGuest(guest, loadUrl);
		}
		const meta = tabs.get(bound.tabId);
		const page = guest ? guestPageMeta(guest, { url: targetUrl, title: meta?.title }) : { url: targetUrl, title: meta?.title || "Browser" };
		if (meta) {
			meta.url = page.url;
			meta.title = page.title;
		}
		return {
			ok: true,
			tabId: bound.tabId,
			url: page.url,
			title: page.title,
		};
	}

	async function runPageScript(guest, script) {
		return guest.executeJavaScript(script, true);
	}

	async function readPageState(guest) {
		try {
			return await runPageScript(
				guest,
				`(() => ({
          url: location.href,
          title: document.title,
          pointerLocked: Boolean(document.pointerLockElement),
          pointerLockTag: document.pointerLockElement
            ? document.pointerLockElement.tagName.toLowerCase()
            : null,
        }))()`,
			);
		} catch {
			return { url: undefined, title: undefined, pointerLocked: false, pointerLockTag: null };
		}
	}

	async function resolveRefCenter(guest, ref) {
		const selector = JSON.stringify(`[data-metis-ref="${String(ref || "")}"]`);
		return runPageScript(
			guest,
			`(() => {
        const el = document.querySelector(${selector});
        if (!el) return { ok: false, error: 'ref not found' };
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
        if (typeof el.focus === 'function') {
          try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
        }
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) {
          return { ok: false, error: 'ref has zero-size box' };
        }
        return {
          ok: true,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          tag: el.tagName.toLowerCase(),
          url: location.href,
          title: document.title,
        };
      })()`,
		);
	}

	async function sendTrustedMouse(guest, events) {
		const send = getSendInputEvent(guest);
		if (!send) {
			return { ok: false, error: "webview sendInputEvent is unavailable" };
		}
		try {
			if (typeof guest.focus === "function") guest.focus();
		} catch {
			// focus is best-effort
		}
		try {
			for (const event of events) {
				send(event);
				if (event.type === "mouseDown" || event.type === "mouseUp" || event.type === "mouseMove") {
					await sleep(8);
				}
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	async function waitForPointerLockState(guest, { timeoutMs = 600, preferLocked = true } = {}) {
		const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
		let state = await readPageState(guest);
		if (preferLocked && state.pointerLocked) return state;
		if (!preferLocked && !state.pointerLocked) return state;
		while (Date.now() < deadline) {
			await sleep(40);
			state = await readPageState(guest);
			if (preferLocked && state.pointerLocked) return state;
			if (!preferLocked && !state.pointerLocked) return state;
		}
		return state;
	}

	async function resolveMouseAim(guest, command) {
		let x = command.x != null ? Number(command.x) : NaN;
		let y = command.y != null ? Number(command.y) : NaN;
		if (command.ref && (!Number.isFinite(x) || !Number.isFinite(y))) {
			const center = await resolveRefCenter(guest, command.ref);
			if (!center?.ok) {
				return { error: center?.error || "ref not found" };
			}
			x = center.x;
			y = center.y;
		}
		const movementX = command.movementX != null ? Number(command.movementX) : NaN;
		const movementY = command.movementY != null ? Number(command.movementY) : NaN;
		const hasRelative = Number.isFinite(movementX) || Number.isFinite(movementY);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			if (hasRelative) {
				const viewport = await runPageScript(
					guest,
					`(() => ({
            w: Math.round(window.innerWidth || 0),
            h: Math.round(window.innerHeight || 0),
          }))()`,
				);
				x = Math.round((Number(viewport?.w) || 800) / 2);
				y = Math.round((Number(viewport?.h) || 600) / 2);
			}
		}
		return {
			x,
			y,
			movementX: Number.isFinite(movementX) ? Math.round(movementX) : 0,
			movementY: Number.isFinite(movementY) ? Math.round(movementY) : 0,
			hasRelative,
		};
	}

	async function trustedClickAt(guest, x, y, button = "left") {
		const bx = Math.round(Number(x));
		const by = Math.round(Number(y));
		if (!Number.isFinite(bx) || !Number.isFinite(by)) {
			return { ok: false, error: "x and y coordinates required" };
		}
		const btn = mouseButtonName(button);
		const before = await readPageState(guest);
		const sent = await sendTrustedMouse(guest, [
			{ type: "mouseMove", x: bx, y: by },
			{ type: "mouseDown", x: bx, y: by, button: btn, clickCount: 1 },
			{ type: "mouseUp", x: bx, y: by, button: btn, clickCount: 1 },
		]);
		if (!sent.ok) return sent;
		// requestPointerLock is async; wait briefly so receipts reflect the lock.
		const state = await waitForPointerLockState(guest, {
			timeoutMs: before.pointerLocked ? 120 : 700,
			preferLocked: true,
		});
		return {
			ok: true,
			x: bx,
			y: by,
			button: btn,
			url: state.url,
			title: state.title,
			pointerLocked: Boolean(state.pointerLocked),
			pointerLockTag: state.pointerLockTag || null,
		};
	}

	async function handleCommand(command) {
		if (!command || typeof command !== "object" || typeof command.op !== "string") {
			return { ok: false, error: "Invalid browser command" };
		}

		const tracksControl = tracksBrowserControl(command);
		if (tracksControl) {
			busyCount += 1;
			notifyHostBusy();
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
							node.box
								? `box=${node.box.x},${node.box.y},${node.box.width}x${node.box.height}`
								: null,
						].filter(Boolean);
						lines.push(bits.join(" "));
					}
					lines.push(`pointerLocked: ${Boolean(data.pointerLocked)}`);
					if (data.pointerLockTag) lines.push(`pointerLockTag: ${data.pointerLockTag}`);
					if (data.viewportWidth != null && data.viewportHeight != null) {
						lines.push(`viewport: ${data.viewportWidth}x${data.viewportHeight}`);
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
						pointerLocked: Boolean(data.pointerLocked),
						pointerLockTag: data.pointerLockTag || null,
						viewportWidth: data.viewportWidth,
						viewportHeight: data.viewportHeight,
					};
				}
				case "click": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const center = await resolveRefCenter(resolved.guest, command.ref);
					if (!center?.ok) {
						return { ok: false, error: center?.error || "click failed", tabId: resolved.tabId };
					}
					const clicked = await trustedClickAt(resolved.guest, center.x, center.y, "left");
					if (!clicked.ok) {
						return { ok: false, error: clicked.error || "click failed", tabId: resolved.tabId };
					}
					return {
						ok: true,
						tabId: resolved.tabId,
						url: clicked.url,
						title: clicked.title,
						x: clicked.x,
						y: clicked.y,
						pointerLocked: clicked.pointerLocked,
						pointerLockTag: clicked.pointerLockTag,
					};
				}
				case "mouse": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const action = String(command.action || "click").toLowerCase();
					const button = mouseButtonName(command.button);
					const aim = await resolveMouseAim(resolved.guest, command);
					if (aim.error) {
						return { ok: false, error: aim.error, tabId: resolved.tabId };
					}
					let x = aim.x;
					let y = aim.y;
					const movementX = aim.movementX;
					const movementY = aim.movementY;
					const hasRelative = aim.hasRelative;

					if (action === "click") {
						if (!Number.isFinite(x) || !Number.isFinite(y)) {
							return { ok: false, error: "x/y or ref required for mouse click", tabId: resolved.tabId };
						}
						const clicked = await trustedClickAt(resolved.guest, x, y, button);
						if (!clicked.ok) {
							return { ok: false, error: clicked.error || "mouse click failed", tabId: resolved.tabId };
						}
						return {
							ok: true,
							tabId: resolved.tabId,
							url: clicked.url,
							title: clicked.title,
							x: clicked.x,
							y: clicked.y,
							button: clicked.button,
							pointerLocked: clicked.pointerLocked,
							pointerLockTag: clicked.pointerLockTag,
						};
					}

					if (!Number.isFinite(x) || !Number.isFinite(y)) {
						return {
							ok: false,
							error: "x/y, ref, or movementX/movementY required for mouse action",
							tabId: resolved.tabId,
						};
					}
					const bx = Math.round(x);
					const by = Math.round(y);
					/** @type {Array<object>} */
					const events = [];
					if (action === "move" || action === "look") {
						// FPS / pointer-lock look needs movementX/Y deltas, not only absolute x/y.
						const moveEvent = { type: "mouseMove", x: bx, y: by };
						if (hasRelative) {
							moveEvent.movementX = movementX;
							moveEvent.movementY = movementY;
						}
						events.push(moveEvent);
					} else if (action === "down") {
						events.push(
							{ type: "mouseMove", x: bx, y: by },
							{ type: "mouseDown", x: bx, y: by, button, clickCount: 1 },
						);
					} else if (action === "up") {
						events.push({ type: "mouseUp", x: bx, y: by, button, clickCount: 1 });
					} else if (action === "drag") {
						let endX = Math.round(Number(command.endX));
						let endY = Math.round(Number(command.endY));
						if ((!Number.isFinite(endX) || !Number.isFinite(endY)) && hasRelative) {
							endX = bx + movementX;
							endY = by + movementY;
						}
						if (!Number.isFinite(endX) || !Number.isFinite(endY)) {
							return {
								ok: false,
								error: "endX/endY or movementX/movementY required for drag",
								tabId: resolved.tabId,
							};
						}
						events.push(
							{ type: "mouseMove", x: bx, y: by },
							{ type: "mouseDown", x: bx, y: by, button, clickCount: 1 },
							{
								type: "mouseMove",
								x: endX,
								y: endY,
								movementX: endX - bx,
								movementY: endY - by,
							},
							{ type: "mouseUp", x: endX, y: endY, button, clickCount: 1 },
						);
					} else if (action === "wheel") {
						const deltaX = Number(command.deltaX) || 0;
						const deltaY = Number(command.deltaY) || 0;
						events.push({
							type: "mouseWheel",
							x: bx,
							y: by,
							deltaX,
							deltaY,
							hasPreciseScrollingDeltas: true,
							canScroll: true,
						});
					} else {
						return { ok: false, error: `Unsupported mouse action: ${action}`, tabId: resolved.tabId };
					}
					const sent = await sendTrustedMouse(resolved.guest, events);
					if (!sent.ok) {
						return { ok: false, error: sent.error || "mouse failed", tabId: resolved.tabId };
					}
					await sleep(20);
					const state = await readPageState(resolved.guest);
					return {
						ok: true,
						tabId: resolved.tabId,
						url: state.url,
						title: state.title,
						x: bx,
						y: by,
						movementX: hasRelative ? movementX : undefined,
						movementY: hasRelative ? movementY : undefined,
						button,
						action,
						pointerLocked: Boolean(state.pointerLocked),
						pointerLockTag: state.pointerLockTag || null,
					};
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
              return { ok: true, url: location.href, title: document.title, needsSubmit: ${submit} };
            })()`,
					);
					if (!result?.ok) return { ok: false, error: result?.error || "type failed", tabId: resolved.tabId };
					if (submit) {
						const send = getSendInputEvent(resolved.guest);
						if (send) {
							try {
								send({ type: "keyDown", keyCode: "Enter" });
								await sleep(20);
								send({ type: "keyUp", keyCode: "Enter" });
							} catch {
								// fall through — text was already inserted
							}
						}
					}
					return { ok: true, tabId: resolved.tabId, url: result.url, title: result.title };
				}
				case "press_key": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const mapped = resolveKeyboardKey(command.key);
					if (mapped.error) {
						return { ok: false, error: mapped.error, tabId: resolved.tabId };
					}
					const send = getSendInputEvent(resolved.guest);
					if (!send) {
						return {
							ok: false,
							error: "webview sendInputEvent is unavailable",
							tabId: resolved.tabId,
						};
					}
					const holdMsRaw = Number(command.holdMs);
					const holdMs = Number.isFinite(holdMsRaw)
						? Math.max(0, Math.min(10_000, Math.round(holdMsRaw)))
						: 50;
					try {
						if (typeof resolved.guest.focus === "function") resolved.guest.focus();
					} catch {
						// best-effort
					}
					try {
						send({ type: "keyDown", keyCode: mapped.keyCode });
						if (holdMs > 0) await sleep(holdMs);
						send({ type: "keyUp", keyCode: mapped.keyCode });
					} catch (error) {
						return {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
							tabId: resolved.tabId,
						};
					}
					await sleep(20);
					const state = await readPageState(resolved.guest);
					return {
						ok: true,
						tabId: resolved.tabId,
						url: state.url,
						title: state.title,
						key: mapped.key,
						code: mapped.code,
						keyCode: mapped.keyCode,
						holdMs,
						pointerLocked: Boolean(state.pointerLocked),
						pointerLockTag: state.pointerLockTag || null,
					};
				}
				case "scroll": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const amount = Number(command.amount) > 0 ? Number(command.amount) : 600;
					const direction = String(command.direction || "down");
					const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
					const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;

					// Aim at ref center when provided; otherwise viewport mid.
					// (10,10) often misses the scrollable region.
					let aimX = NaN;
					let aimY = NaN;
					if (command.ref) {
						const center = await resolveRefCenter(resolved.guest, command.ref);
						if (center?.ok) {
							aimX = Number(center.x);
							aimY = Number(center.y);
						}
					}
					const before = await runPageScript(
						resolved.guest,
						`(() => ({
              x: window.scrollX || 0,
              y: window.scrollY || 0,
              w: Math.round(window.innerWidth || 0),
              h: Math.round(window.innerHeight || 0),
            }))()`,
					);
					if (!Number.isFinite(aimX) || !Number.isFinite(aimY)) {
						aimX = Math.round((Number(before?.w) || 800) / 2);
						aimY = Math.round((Number(before?.h) || 600) / 2);
					}

					// Keep both paths: trusted mouseWheel (games / custom listeners) +
					// window.scrollBy fallback when the viewport did not move.
					let wheeled = false;
					const send = getSendInputEvent(resolved.guest);
					if (send) {
						try {
							if (typeof resolved.guest.focus === "function") resolved.guest.focus();
							send({
								type: "mouseWheel",
								x: aimX,
								y: aimY,
								deltaX: dx,
								deltaY: dy,
								hasPreciseScrollingDeltas: true,
								canScroll: true,
							});
							wheeled = true;
						} catch {
							// fall through to scrollBy
						}
					}
					if (wheeled) await sleep(20);

					const after = wheeled
						? await runPageScript(
								resolved.guest,
								`(() => ({ x: window.scrollX || 0, y: window.scrollY || 0 }))()`,
							)
						: null;
					const moved =
						Boolean(after) &&
						(Number(after.x) !== Number(before?.x) || Number(after.y) !== Number(before?.y));
					if (!moved) {
						await runPageScript(
							resolved.guest,
							`(() => { window.scrollBy(${dx}, ${dy}); return true; })()`,
						);
					}

					const state = await readPageState(resolved.guest);
					return { ok: true, tabId: resolved.tabId, url: state.url, title: state.title };
				}
				case "evaluate": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					const expression = String(command.expression || "").trim();
					if (!expression) {
						return { ok: false, error: "expression required", tabId: resolved.tabId };
					}
					const exprJson = JSON.stringify(expression);
					const evaluated = await runPageScript(
						resolved.guest,
						`(() => {
              let value;
              try {
                value = (0, eval)(${exprJson});
              } catch (error) {
                return {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                  url: location.href,
                  title: document.title,
                  pointerLocked: Boolean(document.pointerLockElement),
                };
              }
              let resultText;
              try {
                resultText = JSON.stringify(value);
              } catch {
                resultText = JSON.stringify(String(value));
              }
              if (resultText == null) resultText = 'null';
              if (resultText.length > 8000) {
                resultText = resultText.slice(0, 8000) + '…';
              }
              return {
                ok: true,
                resultText,
                url: location.href,
                title: document.title,
                pointerLocked: Boolean(document.pointerLockElement),
                pointerLockTag: document.pointerLockElement
                  ? document.pointerLockElement.tagName.toLowerCase()
                  : null,
              };
            })()`,
					);
					if (!evaluated?.ok) {
						return {
							ok: false,
							error: evaluated?.error || "evaluate failed",
							tabId: resolved.tabId,
							url: evaluated?.url,
							title: evaluated?.title,
						};
					}
					let parsed = null;
					try {
						parsed = JSON.parse(evaluated.resultText);
					} catch {
						parsed = evaluated.resultText;
					}
					return {
						ok: true,
						tabId: resolved.tabId,
						url: evaluated.url,
						title: evaluated.title,
						result: parsed,
						resultText: evaluated.resultText,
						pointerLocked: Boolean(evaluated.pointerLocked),
						pointerLockTag: evaluated.pointerLockTag || null,
					};
				}
				case "screenshot": {
					const resolved = getGuest(command.tabId);
					if (resolved.error) return { ok: false, error: resolved.error };
					await applyFitViewport(resolved.guest);
					await waitForTwoAnimationFrames(resolved.guest);
					let cropRect = null;
					try {
						const info = await withTimeout(
							runPageScript(resolved.guest, SVG_CROP_SCRIPT),
							PAINT_WAIT_TIMEOUT_MS,
							"Timed out measuring Inspector SVG bounds",
						);
						if (info && info.standalone) {
							cropRect = clampCropRectToGuest(
								computeSvgContentRect(info, info?.viewBox),
								resolved.guest,
							);
						}
					} catch {
						cropRect = null;
					}
					const captureOnce = (rect) =>
						withTimeout(
							rect ? resolved.guest.capturePage(rect) : resolved.guest.capturePage(),
							SCREENSHOT_TIMEOUT_MS,
							SCREENSHOT_TIMEOUT_MESSAGE,
						);
					let image;
					try {
						image = await captureOnce(cropRect);
					} catch (firstError) {
						// Cropped capture can throw (e.g. UnknownVizError) or time out; retry full-frame.
						try {
							image = await captureOnce(null);
						} catch (secondError) {
							const page = guestPageMeta(resolved.guest, resolved.meta);
							const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
							const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
							return {
								ok: false,
								error: `${secondMessage} Preview failed twice (first: ${firstMessage}). Stay on the deliverable file; browser_navigate it again and retry screenshot. Do not create an HTML wrapper page solely because screenshot failed.`,
								tabId: resolved.tabId,
								url: page.url,
								title: page.title,
							};
						}
					}
					const png = encodeScreenshotPng(image, resolved.guest);
					const page = guestPageMeta(resolved.guest, resolved.meta);
					if (resolved.meta) {
						resolved.meta.url = page.url;
						resolved.meta.title = page.title;
					}
					return {
						ok: true,
						tabId: resolved.tabId,
						url: page.url,
						title: page.title,
						screenshotBase64: Buffer.from(png).toString("base64"),
						mimeType: "image/png",
					};
				}
				default:
					return { ok: false, error: `Unsupported browser op: ${command.op}` };
			}
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		} finally {
			if (tracksControl) {
				busyCount = Math.max(0, busyCount - 1);
				notifyHostBusy();
			}
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
	isLocalDevUrl,
	resolveNavigateUrl,
	resolveKeyboardKey,
	computeSvgContentRect,
	clampCropRectToGuest,
	displayUrl,
	BROWSER_FIT_VIEWPORT_SCRIPT,
	applyFitViewport,
	computeFitZoomScale,
};
