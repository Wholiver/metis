/**
 * Built-in browser_* tools for Metis Desktop Inspector.
 * Registered only when a BrowserHostClient is available (Desktop METIS_BROWSER_HOST).
 */

import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { BrowserHostClient, BrowserHostResult } from "../browser-host.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

/** Desktop Vite dev server port — agents must not preview/test here. */
export const RESERVED_DESKTOP_VITE_PORT = 5173;

export const RESERVED_PREVIEW_PORT_REJECTION =
	`Port ${RESERVED_DESKTOP_VITE_PORT} is reserved for Metis Desktop Vite. Do not navigate the Inspector browser to :${RESERVED_DESKTOP_VITE_PORT}, and do not start local preview/test servers on ${RESERVED_DESKTOP_VITE_PORT} — use another port (e.g. --port 4173).`;

const BROWSER_GUIDELINE =
	`For Metis Desktop Inspector / 内置浏览器 preview and UI work, use browser_* tools after reading the metis-browser skill. Mutating browser_* (navigate, tabs new/select, click, mouse, fill, type, press, scroll) run after performance_admit in Build. browser_snapshot, browser_take_screenshot, and browser_evaluate are readable and may run before admit. Never use bash open/Safari/Chrome/qlmanage as a substitute. Prefer screenshot for visual SVG/HTML/layout checks; prefer snapshot when you need refs to click or fill. Tool ok is not gameplay proof — check pointerLocked / holdMs / screenshot evidence. Refresh snapshot after every interaction. Do not start preview/test servers on port ${RESERVED_DESKTOP_VITE_PORT} (reserved for Desktop Vite) and do not browser_navigate to :${RESERVED_DESKTOP_VITE_PORT} — use another port (e.g. --port 4173).`;

export interface BrowserToolOptions {
	host: BrowserHostClient;
}

/**
 * True when the navigate/tabs target uses the Desktop-reserved Vite port (5173).
 * file://, about:blank, and path-only workspace files are never reserved.
 */
export function isReservedPreviewPortUrl(raw: string): boolean {
	const input = String(raw || "").trim();
	if (!input || input === "about:blank") return false;
	const port = String(RESERVED_DESKTOP_VITE_PORT);
	// Require :// (or http/https/file/about) so "localhost:5173" is not treated as scheme "localhost:".
	const hasRealScheme = /^(https?|file|about):/i.test(input) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input);
	try {
		if (hasRealScheme) {
			const url = new URL(input);
			if (url.protocol === "file:" || url.protocol === "about:") return false;
			return url.port === port;
		}
		const asHttp = new URL(`http://${input}`);
		return asHttp.port === port;
	} catch {
		return new RegExp(String.raw`:(?:${port})(?:\/|$|\?|#)`).test(input);
	}
}

function formatResult(result: BrowserHostResult): {
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
	details: BrowserHostResult;
} {
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	if (!result.ok) {
		content.push({ type: "text", text: result.error || "Browser command failed" });
		return { content, details: result };
	}
	const lines: string[] = [];
	if (result.tabId) lines.push(`tabId: ${result.tabId}`);
	if (result.url) lines.push(`url: ${result.url}`);
	if (result.title) lines.push(`title: ${result.title}`);
	if (result.key != null) lines.push(`key: ${result.key}`);
	if (result.code != null) lines.push(`code: ${result.code}`);
	if (result.keyCode != null) lines.push(`keyCode: ${result.keyCode}`);
	if (result.holdMs != null) lines.push(`holdMs: ${result.holdMs}`);
	if (result.x != null && result.y != null) lines.push(`point: ${result.x},${result.y}`);
	if (result.movementX != null || result.movementY != null) {
		lines.push(`movement: ${result.movementX ?? 0},${result.movementY ?? 0}`);
	}
	if (result.button) lines.push(`button: ${result.button}`);
	if (result.action) lines.push(`action: ${result.action}`);
	if (result.pointerLocked != null) lines.push(`pointerLocked: ${result.pointerLocked}`);
	if (result.pointerLockTag) lines.push(`pointerLockTag: ${result.pointerLockTag}`);
	if (result.viewportWidth != null && result.viewportHeight != null) {
		lines.push(`viewport: ${result.viewportWidth}x${result.viewportHeight}`);
	}
	if (result.resultText != null) {
		lines.push(`result: ${result.resultText}`);
	} else if (result.result !== undefined) {
		try {
			lines.push(`result: ${JSON.stringify(result.result)}`);
		} catch {
			lines.push(`result: ${String(result.result)}`);
		}
	}
	if (result.tabs) {
		lines.push("tabs:");
		for (const tab of result.tabs) {
			lines.push(`- ${tab.active ? "*" : " "} ${tab.id} ${tab.title || "(untitled)"} ${tab.url}`);
		}
	}
	if (result.snapshot) {
		lines.push("snapshot:");
		lines.push(result.snapshot);
	}
	if (lines.length > 0) {
		content.push({ type: "text", text: lines.join("\n") });
	} else {
		content.push({ type: "text", text: "ok" });
	}
	if (result.screenshotBase64) {
		content.push({
			type: "image",
			data: result.screenshotBase64,
			mimeType: result.mimeType || "image/png",
		});
	}
	return { content, details: result };
}

async function run(
	host: BrowserHostClient,
	command: Parameters<BrowserHostClient["execute"]>[0],
	signal?: AbortSignal,
) {
	const result = await host.execute(command, signal);
	return formatResult(result);
}

const navigateSchema = Type.Object({
	url: Type.String({
		description:
			"http(s) URL, about:blank, file:// URL, or a workspace-relative/absolute file path (e.g. pelican.svg) to open in Inspector browser",
	}),
	newTab: Type.Optional(Type.Boolean({ description: "Open in a new Inspector browser tab" })),
	tabId: Type.Optional(Type.String({ description: "Existing Inspector browser tab id" })),
});

const tabsSchema = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("select"), Type.Literal("new")]),
	tabId: Type.Optional(Type.String({ description: "Required for select" })),
	url: Type.Optional(Type.String({ description: "Optional URL when action is new" })),
});

const snapshotSchema = Type.Object({
	tabId: Type.Optional(Type.String()),
	interactive: Type.Optional(Type.Boolean({ description: "Prefer interactive controls only (default true)" })),
});

const clickSchema = Type.Object({
	ref: Type.String({ description: "Element ref from the latest browser_snapshot" }),
	tabId: Type.Optional(Type.String()),
});

const mouseSchema = Type.Object({
	action: Type.Union([
		Type.Literal("move"),
		Type.Literal("look"),
		Type.Literal("down"),
		Type.Literal("up"),
		Type.Literal("click"),
		Type.Literal("drag"),
		Type.Literal("wheel"),
	]),
	x: Type.Optional(Type.Number({ description: "CSS-pixel x (viewport). Optional when ref or movementX/Y is set." })),
	y: Type.Optional(Type.Number({ description: "CSS-pixel y (viewport). Optional when ref or movementX/Y is set." })),
	endX: Type.Optional(Type.Number({ description: "Drag end x (or use movementX/Y)" })),
	endY: Type.Optional(Type.Number({ description: "Drag end y (or use movementX/Y)" })),
	deltaX: Type.Optional(Type.Number({ description: "Wheel deltaX" })),
	deltaY: Type.Optional(Type.Number({ description: "Wheel deltaY" })),
	movementX: Type.Optional(
		Type.Number({
			description:
				"Relative look delta X for pointer-lock FPS cameras (preferred over absolute x/y once locked). Also usable for drag.",
		}),
	),
	movementY: Type.Optional(
		Type.Number({
			description: "Relative look delta Y for pointer-lock FPS cameras / drag.",
		}),
	),
	ref: Type.Optional(Type.String({ description: "Optional snapshot ref — uses element center when x/y omitted" })),
	button: Type.Optional(
		Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")], {
			description: "Mouse button (default left)",
		}),
	),
	tabId: Type.Optional(Type.String()),
});

const fillSchema = Type.Object({
	ref: Type.String({ description: "Element ref from the latest browser_snapshot" }),
	value: Type.String({ description: "Value to set on the input/textarea" }),
	tabId: Type.Optional(Type.String()),
});

const typeSchema = Type.Object({
	text: Type.String({ description: "Text to type" }),
	ref: Type.Optional(Type.String({ description: "Optional focused element ref" })),
	submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing" })),
	tabId: Type.Optional(Type.String()),
});

const pressKeySchema = Type.Object({
	key: Type.String({
		description:
			"Key name or code, e.g. w, KeyW, Enter, Escape, Tab, ArrowLeft, Space, Shift. Prefer KeyW/KeyA/KeyS/KeyD for games, not Arrow keys.",
	}),
	holdMs: Type.Optional(
		Type.Number({
			description: "Hold duration in ms before keyUp (default 50). Use 200–800 for WASD movement checks.",
		}),
	),
	tabId: Type.Optional(Type.String()),
});

const scrollSchema = Type.Object({
	direction: Type.Union([
		Type.Literal("up"),
		Type.Literal("down"),
		Type.Literal("left"),
		Type.Literal("right"),
	]),
	amount: Type.Optional(Type.Number({ description: "Scroll pixels (default 600)" })),
	ref: Type.Optional(Type.String({ description: "Optional element to scroll into view first" })),
	tabId: Type.Optional(Type.String()),
});

const evaluateSchema = Type.Object({
	expression: Type.String({
		description:
			"JavaScript expression to evaluate in the page (read-only probing). Do not use to fake keyboard/mouse or read cookies/passwords.",
	}),
	tabId: Type.Optional(Type.String()),
});

const screenshotSchema = Type.Object({
	tabId: Type.Optional(Type.String()),
	fullPage: Type.Optional(Type.Boolean()),
});

export type BrowserNavigateInput = Static<typeof navigateSchema>;
export type BrowserTabsInput = Static<typeof tabsSchema>;
export type BrowserSnapshotInput = Static<typeof snapshotSchema>;
export type BrowserClickInput = Static<typeof clickSchema>;
export type BrowserMouseInput = Static<typeof mouseSchema>;
export type BrowserFillInput = Static<typeof fillSchema>;
export type BrowserTypeInput = Static<typeof typeSchema>;
export type BrowserPressKeyInput = Static<typeof pressKeySchema>;
export type BrowserScrollInput = Static<typeof scrollSchema>;
export type BrowserEvaluateInput = Static<typeof evaluateSchema>;
export type BrowserScreenshotInput = Static<typeof screenshotSchema>;

export const BROWSER_TOOL_NAMES = [
	"browser_navigate",
	"browser_tabs",
	"browser_snapshot",
	"browser_click",
	"browser_mouse",
	"browser_fill",
	"browser_type",
	"browser_press_key",
	"browser_scroll",
	"browser_evaluate",
	"browser_take_screenshot",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

export function createBrowserToolDefinitions(options: BrowserToolOptions): ToolDefinition[] {
	const { host } = options;
	return [
		{
			name: "browser_navigate",
			label: "Browser navigate",
			description:
				"Navigate the Metis Desktop Inspector built-in browser to a URL or local file (SVG/HTML). Opens or activates a browser tab. Prefer this over bash open/Safari/Chrome. Localhost/127.0.0.1 reloads ignoring cache when already open.",
			promptSnippet: "Navigate Inspector browser (URL or local file)",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: navigateSchema,
			execute: async (_id, input: BrowserNavigateInput, signal) => {
				if (isReservedPreviewPortUrl(input.url)) {
					return formatResult({ ok: false, error: RESERVED_PREVIEW_PORT_REJECTION });
				}
				return run(host, { op: "navigate", url: input.url, newTab: input.newTab, tabId: input.tabId }, signal);
			},
		},
		{
			name: "browser_tabs",
			label: "Browser tabs",
			description: "List, select, or create Inspector browser tabs.",
			promptSnippet: "Manage Inspector browser tabs",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: tabsSchema,
			execute: async (_id, input: BrowserTabsInput, signal) => {
				if (input.url && isReservedPreviewPortUrl(input.url)) {
					return formatResult({ ok: false, error: RESERVED_PREVIEW_PORT_REJECTION });
				}
				return run(host, { op: "tabs", action: input.action, tabId: input.tabId, url: input.url }, signal);
			},
		},
		{
			name: "browser_snapshot",
			label: "Browser snapshot",
			description:
				"Capture an accessibility/interactive snapshot with stable refs (includes visible canvas/video), plus pointerLocked and viewport size.",
			promptSnippet: "Snapshot Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "read", parallelSafe: false },
			parameters: snapshotSchema,
			execute: async (_id, input: BrowserSnapshotInput, signal) =>
				run(host, { op: "snapshot", tabId: input.tabId, interactive: input.interactive }, signal),
		},
		{
			name: "browser_click",
			label: "Browser click",
			description:
				"Trusted left-click at the center of a snapshot ref (sendInputEvent). Required for pointer lock / canvas games — returns pointerLocked.",
			promptSnippet: "Click Inspector browser element",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: clickSchema,
			execute: async (_id, input: BrowserClickInput, signal) =>
				run(host, { op: "click", ref: input.ref, tabId: input.tabId }, signal),
		},
		{
			name: "browser_mouse",
			label: "Browser mouse",
			description:
				"Trusted mouse move/look/down/up/click/drag/wheel via sendInputEvent. For FPS look after pointer lock, use action move|look with movementX/movementY (not only absolute x/y). Coordinates or snapshot ref center for clicks.",
			promptSnippet: "Mouse in Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: mouseSchema,
			execute: async (_id, input: BrowserMouseInput, signal) =>
				run(
					host,
					{
						op: "mouse",
						action: input.action,
						x: input.x,
						y: input.y,
						endX: input.endX,
						endY: input.endY,
						deltaX: input.deltaX,
						deltaY: input.deltaY,
						movementX: input.movementX,
						movementY: input.movementY,
						ref: input.ref,
						button: input.button,
						tabId: input.tabId,
					},
					signal,
				),
		},
		{
			name: "browser_fill",
			label: "Browser fill",
			description: "Set the value of an input/textarea by snapshot ref.",
			promptSnippet: "Fill Inspector browser field",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: fillSchema,
			execute: async (_id, input: BrowserFillInput, signal) =>
				run(host, { op: "fill", ref: input.ref, value: input.value, tabId: input.tabId }, signal),
		},
		{
			name: "browser_type",
			label: "Browser type",
			description: "Type text into the focused element or a snapshot ref.",
			promptSnippet: "Type in Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: typeSchema,
			execute: async (_id, input: BrowserTypeInput, signal) =>
				run(
					host,
					{ op: "type", text: input.text, ref: input.ref, submit: input.submit, tabId: input.tabId },
					signal,
				),
		},
		{
			name: "browser_press_key",
			label: "Browser press key",
			description:
				"Trusted keyDown/keyUp via sendInputEvent (holdMs supported). Use KeyW/KeyA/KeyS/KeyD for WASD — Arrow keys are not WASD. Result reports code and holdMs.",
			promptSnippet: "Press key in Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: pressKeySchema,
			execute: async (_id, input: BrowserPressKeyInput, signal) =>
				run(host, { op: "press_key", key: input.key, holdMs: input.holdMs, tabId: input.tabId }, signal),
		},
		{
			name: "browser_scroll",
			label: "Browser scroll",
			description: "Scroll the page or an element in the Inspector browser.",
			promptSnippet: "Scroll Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: scrollSchema,
			execute: async (_id, input: BrowserScrollInput, signal) =>
				run(
					host,
					{
						op: "scroll",
						direction: input.direction,
						amount: input.amount,
						ref: input.ref,
						tabId: input.tabId,
					},
					signal,
				),
		},
		{
			name: "browser_evaluate",
			label: "Browser evaluate",
			description:
				"Evaluate a read-only JavaScript expression in the page (e.g. document.pointerLockElement). Do not fake input or read secrets.",
			promptSnippet: "Evaluate expression in Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "read", parallelSafe: false },
			parameters: evaluateSchema,
			execute: async (_id, input: BrowserEvaluateInput, signal) =>
				run(host, { op: "evaluate", expression: input.expression, tabId: input.tabId }, signal),
		},
		{
			name: "browser_take_screenshot",
			label: "Browser screenshot",
			description:
				"Capture a screenshot of the Inspector browser (full page for HTML apps; crops only standalone SVG documents). Prefer this for visual SVG/HTML/layout checks; prefer browser_snapshot when you need refs to click or fill.",
			promptSnippet: "Screenshot Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "read", parallelSafe: false },
			parameters: screenshotSchema,
			execute: async (_id, input: BrowserScreenshotInput, signal) =>
				run(host, { op: "screenshot", tabId: input.tabId, fullPage: input.fullPage }, signal),
		},
	];
}

export function createBrowserTools(options: BrowserToolOptions) {
	return createBrowserToolDefinitions(options).map((definition) => wrapToolDefinition(definition));
}
