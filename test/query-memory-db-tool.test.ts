import { describe, expect, it } from "vitest";
import { createQueryMemoryDbToolDefinition } from "../src/core/tools/query-memory-db.ts";

describe("query_memory_db tool", () => {
	it("executes read-only SQL queries and returns formatted JSON rows", async () => {
		const calls: Array<{ sql: string; params: any[] }> = [];
		const definition = createQueryMemoryDbToolDefinition({
			query: (sql, params) => {
				calls.push({ sql, params: params ?? [] });
				return [{ id: "mem-1", category: "tech_stack", content: "SQLite memory" }];
			},
		});

		expect(definition.capabilities).toEqual({ effect: "read", parallelSafe: false });
		const result = await definition.execute("call-1", {
			sql: "SELECT id, category, content FROM memory_records WHERE category = ?",
			params: ["tech_stack"],
		}, undefined, undefined, undefined as any);

		expect(calls).toEqual([{
			sql: "SELECT id, category, content FROM memory_records WHERE category = ?",
			params: ["tech_stack"],
		}]);
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain("Query returned 1 row");
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain("SQLite memory");
	});

	it("returns informative message when query returns 0 rows", async () => {
		const definition = createQueryMemoryDbToolDefinition({
			query: () => [],
		});
		const result = await definition.execute("call-empty", {
			sql: "SELECT * FROM memory_records WHERE scope = 'unknown'",
		}, undefined, undefined, undefined as any);
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toBe("No matching records found.");
	});

	it("validates that sql parameter is required", async () => {
		const definition = createQueryMemoryDbToolDefinition();
		await expect(definition.execute("call-err", { sql: "  " }, undefined, undefined, undefined as any)).rejects.toThrow("sql parameter is required");
	});
});

