import { describe, expect, it } from "vitest";
import { createSearchMemoryToolDefinition, normalizeSearchMemoryInput } from "../src/core/tools/search-memory.ts";

describe("search_memory tool", () => {
	it("is a sequential read tool and defaults each search to six records", async () => {
		const calls: Array<{ query?: string; limit: number; filterOptions?: any }> = [];
		const definition = createSearchMemoryToolDefinition({
			search: (query, limit, filterOptions) => {
				calls.push({ query, limit, filterOptions });
				return [{ id: "memory-12345678", scope: "project", category: "tech_stack", kind: "fact", content: "Metis uses SQLite memory", status: "active", sourceSessionIds: ["session"], updatedAt: new Date(0).toISOString() }];
			},
		});
		expect(definition.capabilities).toEqual({ effect: "read", parallelSafe: false });
		const result = await definition.execute("call", { query: " SQLite memory " }, undefined, undefined, undefined as any);
		expect(calls).toEqual([{ query: "SQLite memory", limit: 6, filterOptions: { category: undefined, scope: undefined } }]);
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain("Found 1 durable memory record");
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain("[ID: `memory-1`]");
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain("**[tech_stack]**");

		for (let index = 0; index < 4; index += 1) {
			await definition.execute(`call-${index}`, { query: `follow-up ${index}`, limit: 1 }, undefined, undefined, undefined as any);
		}
		expect(calls).toHaveLength(5);
	});

	it("supports category and scope filtering without query", async () => {
		const calls: Array<any> = [];
		const definition = createSearchMemoryToolDefinition({
			search: (query, limit, filterOptions) => {
				calls.push({ query, limit, filterOptions });
				return [
					{ id: "mem-bug1", scope: "project", category: "known_failures_and_fixes", kind: "failure", content: "EISDIR error when reading directory", status: "active", sourceSessionIds: ["session"], updatedAt: new Date(0).toISOString() },
				];
			},
		});
		const result = await definition.execute("call-cat", { category: "known_failures_and_fixes", scope: "project" }, undefined, undefined, undefined as any);
		expect(calls[0]).toEqual({ query: undefined, limit: 6, filterOptions: { category: "known_failures_and_fixes", scope: "project" } });
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain("**[known_failures_and_fixes]**");
	});

	it("validates limits outside 1 through 20", () => {
		expect(() => normalizeSearchMemoryInput({ query: "fact", limit: 21 })).toThrow("1 to 20");
		expect(() => normalizeSearchMemoryInput({ query: "fact", limit: 0 })).toThrow("1 to 20");
	});
});
