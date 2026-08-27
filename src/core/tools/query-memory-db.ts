import type { AgentTool } from "@earendil-works/metis-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const queryMemoryDbSchema = Type.Object({
	sql: Type.String({
		description:
			"Read-only SQL query to execute against the SQLite memory database (~/.metis/memories/state.sqlite). Only SELECT, WITH, PRAGMA, and EXPLAIN statements are permitted.",
	}),
	params: Type.Optional(
		Type.Array(Type.Union([Type.String(), Type.Number(), Type.Null()]), {
			description: "Optional positional parameters for the parameterized SQL query.",
		}),
	),
});

export type QueryMemoryDbToolInput = Static<typeof queryMemoryDbSchema>;

export interface QueryMemoryDbToolOptions {
	query?: (sql: string, params?: Array<string | number | null | undefined>) => Array<Record<string, unknown>>;
}

export function createQueryMemoryDbToolDefinition(options?: QueryMemoryDbToolOptions): ToolDefinition<typeof queryMemoryDbSchema> {
	return {
		name: "query_memory_db",
		label: "Query memory DB",
		description:
			"Execute direct read-only SQL SELECT queries against the durable cross-session SQLite memory database (~/.metis/memories/state.sqlite). Use this tool to inspect structured memories, filter by category/scope, search FTS5 full-text index, or query jobs/metadata.\n\nDatabase Schema:\n- memory_records(id TEXT PRIMARY KEY, scope TEXT ['global'|'project'|'checkout'], project_key TEXT, checkout_key TEXT, category TEXT ['tech_stack'|'architecture_patterns'|'project_conventions'|'domain_knowledge'|'workflows_and_commands'|'known_failures_and_fixes'|'deployment_and_infra'|'user_preferences'], kind TEXT ['preference'|'fact'|'procedure'|'failure'], content TEXT, status TEXT ['active'|'stale'|'conflicted'], sources TEXT, created_at TEXT, updated_at TEXT, last_used_at TEXT)\n- memory_fts USING fts5(id UNINDEXED, content)\n- memory_jobs(id TEXT PRIMARY KEY, session_id TEXT, checkpoint TEXT, status TEXT ['pending'|'retry'|'done'], due_at INTEGER, attempts INTEGER, error TEXT, semantic_hash TEXT, created_at TEXT, updated_at TEXT)\n- memory_meta(key TEXT PRIMARY KEY, value TEXT)\n\nExample Queries:\n- `SELECT id, category, kind, content FROM memory_records WHERE status = 'active' AND (scope = 'global' OR project_key = ?) ORDER BY updated_at DESC LIMIT 10;`\n- `SELECT r.id, r.category, r.content FROM memory_fts f JOIN memory_records r ON r.id = f.id WHERE f.memory_fts MATCH 'docker' AND r.status = 'active' LIMIT 5;`",
		promptSnippet: "Execute read-only SQL query on memory database",
		promptGuidelines: [
			"When you need prior knowledge, conventions, or project rules, first inspect ~/.metis/memories/memory-map.md (using read) to see the memory index and range distribution, then use query_memory_db with targeted SQL SELECT queries (e.g. filtering by category or matching memory_fts) to retrieve specific durable records from SQLite.",
		],
		capabilities: { effect: "read", parallelSafe: false },
		parameters: queryMemoryDbSchema,
		async execute(_toolCallId, input, signal) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const sql = input.sql?.trim();
			if (!sql) throw new Error("sql parameter is required");
			const params = input.params ?? [];
			const rows = options?.query?.(sql, params) ?? [];
			let text = "";
			if (rows.length === 0) {
				text = "No matching records found.";
			} else {
				text = `Query returned ${rows.length} row${rows.length > 1 ? "s" : ""}:\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``;
			}
			return {
				content: [{ type: "text", text }],
				details: { sql, params, rows },
			};
		},
	};
}

export function createQueryMemoryDbTool(options?: QueryMemoryDbToolOptions): AgentTool<typeof queryMemoryDbSchema> {
	return wrapToolDefinition(createQueryMemoryDbToolDefinition(options));
}

