import type { AgentTool } from "@earendil-works/metis-agent-core";
import { Text } from "@earendil-works/metis-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { getTextOutput, invalidArgText, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const EXA_URL = process.env.EXA_API_KEY
	? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
	: "https://mcp.exa.ai/mcp";
export const PARALLEL_URL = "https://search.parallel.ai/mcp";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Websearch query" }),
	numResults: Type.Optional(
		Type.Number({
			description: "Number of search results to return (default: 8)",
		}),
	),
	livecrawl: Type.Optional(
		Type.Union([Type.Literal("fallback"), Type.Literal("preferred")], {
			description:
				"Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
		}),
	),
	type: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("deep")], {
			description:
				"Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
		}),
	),
	contextMaxCharacters: Type.Optional(
		Type.Number({
			description: "Maximum characters for context string optimized for LLMs (default: 10000)",
		}),
	),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

export interface WebSearchToolOptions {
	/** Provide a custom endpoint URL. Default: uses EXA_API_KEY env variable to construct Exa MCP endpoint */
	endpointUrl?: string;
	/** Force specific provider identifier for logging */
	provider?: "exa" | "parallel";
}

function formatWebSearchCall(args: WebSearchToolInput | undefined, theme: Theme): string {
	const query = str(args?.query);
	const invalidArg = invalidArgText(theme);
	return (
		theme.fg("toolTitle", theme.bold("websearch")) + " " + (query === null ? invalidArg : theme.fg("accent", query))
	);
}

function formatWebSearchResult(
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

// Parses JSON-RPC response from MCP endpoint
async function parseResponse(response: Response): Promise<string | undefined> {
	const body = await response.text();
	const trimmed = body.trim();

	const parsePayload = (payload: string): string | undefined => {
		try {
			const data = JSON.parse(payload);
			if (data && data.result && Array.isArray(data.result.content)) {
				const item = data.result.content.find((i: any) => typeof i.text === "string");
				return item?.text;
			}
		} catch {
			return undefined;
		}
		return undefined;
	};

	if (trimmed.startsWith("{")) {
		const direct = parsePayload(trimmed);
		if (direct) return direct;
	}

	// Try extracting from Server-Sent Events format (data: {...})
	for (const line of trimmed.split("\n")) {
		if (line.startsWith("data: ")) {
			const data = parsePayload(line.substring(6));
			if (data) return data;
		}
	}

	return undefined;
}

export function createWebSearchToolDefinition(
	options?: WebSearchToolOptions,
): ToolDefinition<typeof webSearchSchema, undefined> {
	return {
		name: "websearch",
		label: "web search",
		description: "Search the web when current or external information can improve answer accuracy.",
		promptSnippet: "Prefer web search when current or external evidence may improve accuracy.",
		promptGuidelines: [
			"Prefer websearch when it can materially improve accuracy. If uncertain whether the available context is sufficient, lean toward one focused search.",
			"Use websearch when the user requests research, verification, sources, or links; when facts may be current or time-sensitive; when external documentation, dependency behavior, security guidance, or unfamiliar niche knowledge matters; and for high-stakes claims.",
			"Do not search when the task is fully answerable from supplied or local repository content, or is only deterministic calculation, direct transformation, rewriting, translation, summarization, or a simple edit that needs no external facts.",
			"Start with one focused query. Add complementary queries only when the first search leaves a material evidence gap, reveals conflicting claims, or the task's risk warrants cross-checking.",
			"Prioritize official documentation, specifications, maintainer repositories, release notes, standards bodies, and reputable academic or security research; treat unverified posts only as leads.",
			"Use webfetch only when a result's primary or authoritative source page must be inspected to resolve a material detail, freshness question, or conflict.",
			"Do not cite or mention research sources in user-facing output unless the user explicitly asks.",
		],
		parameters: webSearchSchema,
		async execute(_toolCallId, args, signal?: AbortSignal) {
			if (signal?.aborted) throw new Error("Operation aborted");

			let url = options?.endpointUrl || EXA_URL;
			let isParallel = false;
			const provider = options?.provider || (process.env.metis_WEBSEARCH_PROVIDER === "parallel" ? "parallel" : "exa");

			if (provider === "parallel" && !options?.endpointUrl) {
				url = PARALLEL_URL;
				isParallel = true;
			}

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			};

			if (isParallel && process.env.PARALLEL_API_KEY) {
				headers["Authorization"] = `Bearer ${process.env.PARALLEL_API_KEY}`;
			}

			let methodArgs: any = {
				query: args.query,
				numResults: args.numResults || 8,
				livecrawl: args.livecrawl || "fallback",
				type: args.type || "auto",
				contextMaxCharacters: args.contextMaxCharacters,
			};

			let toolName = "web_search_exa";

			if (isParallel) {
				toolName = "web_search";
				methodArgs = {
					objective: args.query,
					search_queries: [args.query],
				};
			}

			const payload = {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: toolName,
					arguments: methodArgs,
				},
			};

			const abortController = new AbortController();
			const onAbort = () => abortController.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			// Set a 25-second timeout as in the original implementation
			const timeoutId = setTimeout(() => abortController.abort(), 25000);

			try {
				const response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(payload),
					signal: abortController.signal,
				});

				if (!response.ok) {
					throw new Error(`Web search failed with status: ${response.status} ${response.statusText}`);
				}

				const resultText = await parseResponse(response);
				if (!resultText) {
					return {
						content: [{ type: "text", text: "No search results found. Please try a different query." }],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: resultText }],
					details: undefined,
				};
			} catch (e: any) {
				if (e.name === "AbortError") {
					throw new Error("Web search request timed out or was aborted");
				}
				throw e;
			} finally {
				clearTimeout(timeoutId);
				signal?.removeEventListener("abort", onAbort);
			}
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatWebSearchCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatWebSearchResult(result as any, options, theme, context.showImages));
			return text;
		},
	};
}

export function createWebSearchTool(options?: WebSearchToolOptions): AgentTool<typeof webSearchSchema> {
	return wrapToolDefinition(createWebSearchToolDefinition(options));
}
