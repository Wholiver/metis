import type { AgentTool } from "@earendil-works/metis-agent-core";
import { type Static, Type } from "typebox";
import type { MemoryRecordSummary } from "../memory-coordinator.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const searchMemorySchema = Type.Object({
	query: Type.String({ minLength: 1, description: "Keywords describing the durable preference, project fact, procedure, or prior failure to recall." }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 6, description: "Maximum records returned by this search. Defaults to 6." })),
});

export type SearchMemoryToolInput = Static<typeof searchMemorySchema>;

export interface SearchMemoryToolOptions {
	search?: (query: string, limit: number) => MemoryRecordSummary[];
}

export function normalizeSearchMemoryInput(input: SearchMemoryToolInput): { query: string; limit: number } {
	const query = String(input.query ?? "").trim();
	if (!query) throw new Error("query must not be empty");
	const limit = input.limit ?? 6;
	if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be an integer from 1 to 20");
	return { query, limit };
}

export function createSearchMemoryToolDefinition(options?: SearchMemoryToolOptions): ToolDefinition<typeof searchMemorySchema> {
	return {
		name: "search_memory",
		label: "Search memory",
		description: "Search durable cross-session memory when prior user preferences, verified project facts or procedures, or known failures may help. Refine the query and call again as often as needed; do not call mechanically for every task.",
		promptSnippet: "Search durable memory on demand",
		promptGuidelines: ["Use search_memory proactively when prior durable knowledge may affect the task. Rewrite or narrow the query and search again when needed; do not call it mechanically on every turn."],
		capabilities: { effect: "read", parallelSafe: false },
		parameters: searchMemorySchema,
		async execute(_toolCallId, input, signal) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const { query, limit } = normalizeSearchMemoryInput(input);
			const records = options?.search?.(query, limit) ?? [];
			return {
				content: [{ type: "text", text: records.length ? JSON.stringify(records, null, 2) : "No matching durable memories found." }],
				details: { query, limit, records },
			};
		},
	};
}

export function createSearchMemoryTool(options?: SearchMemoryToolOptions): AgentTool<typeof searchMemorySchema> {
	return wrapToolDefinition(createSearchMemoryToolDefinition(options));
}
