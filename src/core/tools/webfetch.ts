import type { AgentTool } from "@earendil-works/metis-agent-core";
import { Text } from "@earendil-works/metis-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { getTextOutput, invalidArgText, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import TurndownService from "turndown";
import * as cheerio from "cheerio";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

const webFetchSchema = Type.Object({
	url: Type.String({ description: "The URL to fetch content from" }),
	format: Type.Optional(
		Type.Union([Type.Literal("text"), Type.Literal("markdown"), Type.Literal("html")], {
			description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
		}),
	),
	timeout: Type.Optional(Type.Number({ description: "Optional timeout in seconds (max 120)" })),
});

export type WebFetchToolInput = Static<typeof webFetchSchema>;

export interface WebFetchToolOptions {
	/** Custom timeout in milliseconds */
	defaultTimeout?: number;
}

function formatWebFetchCall(args: WebFetchToolInput | undefined, theme: Theme): string {
	const url = str(args?.url);
	const invalidArg = invalidArgText(theme);
	return theme.fg("toolTitle", theme.bold("webfetch")) + " " + (url === null ? invalidArg : theme.fg("accent", url));
}

function formatWebFetchResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	},
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	if (!output) return "";

	const lines = output.split("\n");
	const maxLines = options.expanded ? lines.length : 5;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;

	let text = `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
	if (remaining > 0) {
		text += `\n${theme.fg("muted", `... (${remaining} more lines)`)}`;
	}
	return text;
}

function extractTextFromHTML(html: string): string {
	const $ = cheerio.load(html);
	$("script, style, noscript, iframe, object, embed").remove();
	return $.text().replace(/\s\s+/g, " ").trim();
}

function convertHTMLToMarkdown(html: string): string {
	const turndownService = new TurndownService({
		headingStyle: "atx",
		hr: "---",
		bulletListMarker: "-",
		codeBlockStyle: "fenced",
		emDelimiter: "*",
	});
	turndownService.remove(["script", "style", "meta", "link"]);
	return turndownService.turndown(html);
}

export function createWebFetchToolDefinition(
	options?: WebFetchToolOptions,
): ToolDefinition<typeof webFetchSchema, undefined> {
	return {
		name: "webfetch",
		label: "web fetch",
		description: "Fetches and inspects web sources, converting a specified URL to markdown, text, or html.",
		promptSnippet: "Fetch and inspect authoritative web sources.",
		promptGuidelines: [
			"Use webfetch to inspect primary or authoritative pages behind websearch results; never treat search snippets as sufficient evidence.",
			"Fetch enough current, independent sources to resolve material conflicts, compatibility questions, and risks before acting.",
			"You may reuse a credible source's architecture or code only when its license permits it; preserve required notices or attribution and verify project compatibility, security, and tests.",
			"Do not cite or mention fetched sources in user-facing output unless the user explicitly asks.",
			"Prefer markdown format for documentation and articles.",
			"The URL must be a fully-formed valid URL."
		],
		parameters: webFetchSchema,
		async execute(_toolCallId, args, signal?: AbortSignal) {
			if (signal?.aborted) throw new Error("Operation aborted");

			let url = args.url;
			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				throw new Error("URL must start with http:// or https://");
			}

			const format = args.format || "markdown";
			const timeoutSeconds = args.timeout ?? (options?.defaultTimeout ? options.defaultTimeout / 1000 : DEFAULT_TIMEOUT / 1000);
			const timeout = Math.min(timeoutSeconds * 1000, MAX_TIMEOUT);

			let acceptHeader = "*/*";
			switch (format) {
				case "markdown":
					acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
					break;
				case "text":
					acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
					break;
				case "html":
					acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
					break;
			}

			const headers: Record<string, string> = {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
				Accept: acceptHeader,
				"Accept-Language": "en-US,en;q=0.9",
			};

			const abortController = new AbortController();
			const onAbort = () => abortController.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			const timeoutId = setTimeout(() => abortController.abort(), timeout);

			try {
				let response = await fetch(url, { headers, signal: abortController.signal });

				// Cloudflare bot detection fallback logic
				if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
					headers["User-Agent"] = "metis";
					response = await fetch(url, { headers, signal: abortController.signal });
				}

				if (!response.ok) {
					throw new Error(`Web fetch failed with status: ${response.status} ${response.statusText}`);
				}

				const contentLength = response.headers.get("content-length");
				if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
					throw new Error("Response too large (exceeds 5MB limit)");
				}

				const arrayBuffer = await response.arrayBuffer();
				if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
					throw new Error("Response too large (exceeds 5MB limit)");
				}

				const contentType = response.headers.get("content-type") || "";
				const mime = contentType.split(";")[0]?.trim().toLowerCase() || "";

				if (mime.startsWith("image/")) {
					return {
						content: [{ type: "text", text: `Image fetched successfully: ${url} (${mime})` }],
						details: undefined,
					};
				}

				const content = new TextDecoder().decode(arrayBuffer);
				let output = content;

				switch (format) {
					case "markdown":
						if (contentType.includes("text/html")) {
							output = convertHTMLToMarkdown(content);
						}
						break;
					case "text":
						if (contentType.includes("text/html")) {
							output = extractTextFromHTML(content);
						}
						break;
					case "html":
					default:
						output = content;
						break;
				}

				return {
					content: [{ type: "text", text: output }],
					details: undefined,
				};
			} catch (e: any) {
				if (e.name === "AbortError") {
					throw new Error("Web fetch request timed out or was aborted");
				}
				throw e;
			} finally {
				clearTimeout(timeoutId);
				signal?.removeEventListener("abort", onAbort);
			}
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatWebFetchCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatWebFetchResult(result as any, options, theme, context.showImages));
			return text;
		},
	};
}

export function createWebFetchTool(options?: WebFetchToolOptions): AgentTool<typeof webFetchSchema> {
	return wrapToolDefinition(createWebFetchToolDefinition(options));
}
