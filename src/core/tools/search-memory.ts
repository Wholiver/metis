import type { AgentTool } from "@earendil-works/metis-agent-core";
import { type Static, Type } from "typebox";
import type { MemoryCategory, MemoryRecordSummary, MemoryScope, MemorySearchOptions } from "../memory-coordinator.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const searchMemorySchema = Type.Object({
	query: Type.Optional(Type.String({ description: "English keywords describing the durable preference, project fact, procedure, or prior failure to recall." })),
	category: Type.Optional(Type.Union([
		Type.Literal("tech_stack"),
		Type.Literal("architecture_patterns"),
		Type.Literal("project_conventions"),
		Type.Literal("domain_knowledge"),
		Type.Literal("workflows_and_commands"),
		Type.Literal("known_failures_and_fixes"),
		Type.Literal("deployment_and_infra"),
		Type.Literal("user_preferences"),
	], { description: "Optional category to filter records by ('tech_stack' | 'architecture_patterns' | 'project_conventions' | 'domain_knowledge' | 'workflows_and_commands' | 'known_failures_and_fixes' | 'deployment_and_infra' | 'user_preferences')." })),
	scope: Type.Optional(Type.Union([
		Type.Literal("global"),
		Type.Literal("project"),
		Type.Literal("checkout"),
	], { description: "Optional scope to filter records by ('global' | 'project' | 'checkout')." })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 6, description: "Maximum records returned by this search. Defaults to 6." })),
});

export type SearchMemoryToolInput = Static<typeof searchMemorySchema>;

export interface SearchMemoryToolOptions {
	search?: (query?: string, limit?: number, filterOptions?: MemorySearchOptions) => MemoryRecordSummary[];
}

export function normalizeSearchMemoryInput(input: SearchMemoryToolInput): { query?: string; category?: MemoryCategory; scope?: MemoryScope; limit: number } {
	const query = typeof input.query === "string" && input.query.trim().length > 0 ? input.query.trim() : undefined;
	const category = input.category as MemoryCategory | undefined;
	const scope = input.scope as MemoryScope | undefined;
	const limit = input.limit ?? 6;
	if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be an integer from 1 to 20");
	return { query, category, scope, limit };
}

export function createSearchMemoryToolDefinition(options?: SearchMemoryToolOptions): ToolDefinition<typeof searchMemorySchema> {
	return {
		name: "search_memory",
		label: "Search memory",
		description: "Search durable cross-session memory when prior user preferences, verified project facts or procedures, or known failures may help. Search queries should use English keywords. Supports keyword search and category filtering ('tech_stack', 'known_failures_and_fixes', 'project_conventions', etc.).",
		promptSnippet: "Search durable memory on demand",
		promptGuidelines: [
			"Use search_memory proactively when prior durable knowledge may affect the task. Always formulate search queries in English keywords since memory records are stored in English. You can filter by category ('tech_stack', 'architecture_patterns', 'project_conventions', 'domain_knowledge', 'workflows_and_commands', 'known_failures_and_fixes', 'deployment_and_infra', 'user_preferences') to drill down into specific areas.",
		],
		capabilities: { effect: "read", parallelSafe: false },
		parameters: searchMemorySchema,
		async execute(_toolCallId, input, signal) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const { query, category, scope, limit } = normalizeSearchMemoryInput(input);
			const records = options?.search?.(query, limit, { category, scope }) ?? [];
			let text = "";
			if (records.length === 0) {
				text = "No matching durable memories found.";
			} else {
				text = `Found ${records.length} durable memory record${records.length > 1 ? "s" : ""}:\n` +
					records.map((r) => `- [ID: \`${r.id.slice(0, 8)}\`] **[${r.category ?? r.kind}]** (${r.scope}): ${r.content}`).join("\n");
			}
			return {
				content: [{ type: "text", text }],
				details: { query, category, scope, limit, records },
			};
		},
	};
}

export function createSearchMemoryTool(options?: SearchMemoryToolOptions): AgentTool<typeof searchMemorySchema> {
	return wrapToolDefinition(createSearchMemoryToolDefinition(options));
}
