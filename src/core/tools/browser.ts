/**
 * Built-in browser_* tools for Metis Desktop Inspector.
 * Registered only when a BrowserHostClient is available (Desktop METIS_BROWSER_HOST).
 */

import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { BrowserHostClient, BrowserHostResult } from "../browser-host.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const BROWSER_GUIDELINE =
	"For Metis Desktop Inspector / 内置浏览器 preview and UI work, use browser_* tools after reading the metis-browser skill. Prefer browser_navigate for local SVG/HTML (path or file://). Never use bash open/Safari/Chrome/qlmanage as a substitute. Prefer browser_take_screenshot for visual SVG/HTML/layout checks; prefer snapshot when you need refs to click or fill. Refresh snapshot after every interaction.";

export interface BrowserToolOptions {
	host: BrowserHostClient;
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
	key: Type.String({ description: "Key name, e.g. Enter, Escape, Tab, ArrowDown" }),
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

const screenshotSchema = Type.Object({
	tabId: Type.Optional(Type.String()),
	fullPage: Type.Optional(Type.Boolean()),
});

export type BrowserNavigateInput = Static<typeof navigateSchema>;
export type BrowserTabsInput = Static<typeof tabsSchema>;
export type BrowserSnapshotInput = Static<typeof snapshotSchema>;
export type BrowserClickInput = Static<typeof clickSchema>;
export type BrowserFillInput = Static<typeof fillSchema>;
export type BrowserTypeInput = Static<typeof typeSchema>;
export type BrowserPressKeyInput = Static<typeof pressKeySchema>;
export type BrowserScrollInput = Static<typeof scrollSchema>;
export type BrowserScreenshotInput = Static<typeof screenshotSchema>;

export const BROWSER_TOOL_NAMES = [
	"browser_navigate",
	"browser_tabs",
	"browser_snapshot",
	"browser_click",
	"browser_fill",
	"browser_type",
	"browser_press_key",
	"browser_scroll",
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
				"Navigate the Metis Desktop Inspector built-in browser to a URL or local file (SVG/HTML). Opens or activates a browser tab. Prefer this over bash open/Safari/Chrome.",
			promptSnippet: "Navigate Inspector browser (URL or local file)",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: navigateSchema,
			execute: async (_id, input: BrowserNavigateInput, signal) =>
				run(host, { op: "navigate", url: input.url, newTab: input.newTab, tabId: input.tabId }, signal),
		},
		{
			name: "browser_tabs",
			label: "Browser tabs",
			description: "List, select, or create Inspector browser tabs.",
			promptSnippet: "Manage Inspector browser tabs",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: tabsSchema,
			execute: async (_id, input: BrowserTabsInput, signal) =>
				run(host, { op: "tabs", action: input.action, tabId: input.tabId, url: input.url }, signal),
		},
		{
			name: "browser_snapshot",
			label: "Browser snapshot",
			description: "Capture an accessibility/interactive snapshot with stable refs for subsequent clicks and fills.",
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
			description: "Click an element by ref from the latest browser_snapshot.",
			promptSnippet: "Click Inspector browser element",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: clickSchema,
			execute: async (_id, input: BrowserClickInput, signal) =>
				run(host, { op: "click", ref: input.ref, tabId: input.tabId }, signal),
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
			description: "Press a keyboard key in the Inspector browser.",
			promptSnippet: "Press key in Inspector browser",
			promptGuidelines: [BROWSER_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: pressKeySchema,
			execute: async (_id, input: BrowserPressKeyInput, signal) =>
				run(host, { op: "press_key", key: input.key, tabId: input.tabId }, signal),
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
			name: "browser_take_screenshot",
			label: "Browser screenshot",
			description: "Capture a screenshot of the Inspector browser. Prefer this for visual SVG/HTML/layout checks; prefer browser_snapshot when you need refs to click or fill.",
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
