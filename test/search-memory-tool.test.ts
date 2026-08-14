import { describe, expect, it } from "vitest";
import { createSearchMemoryToolDefinition, normalizeSearchMemoryInput } from "../src/core/tools/search-memory.ts";

describe("search_memory tool", () => {
	it("is a sequential read tool and defaults each search to six records", async () => {
		const calls: Array<{ query: string; limit: number }> = [];
		const definition = createSearchMemoryToolDefinition({
			search: (query, limit) => {
				calls.push({ query, limit });
				return [{ id: "memory-1", scope: "project", kind: "fact", content: "Metis uses SQLite memory", status: "active", sourceSessionIds: ["session"], updatedAt: new Date(0).toISOString() }];
			},
		});
		expect(definition.capabilities).toEqual({ effect: "read", parallelSafe: false });
		const result = await definition.execute("call", { query: " SQLite memory " }, undefined, undefined, undefined as any);
		expect(calls).toEqual([{ query: "SQLite memory", limit: 6 }]);
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain("memory-1");
		for (let index = 0; index < 4; index += 1) {
			await definition.execute(`call-${index}`, { query: `follow-up ${index}`, limit: 1 }, undefined, undefined, undefined as any);
		}
		expect(calls).toHaveLength(5);
	});

	it("rejects empty queries and limits outside 1 through 20", () => {
		expect(() => normalizeSearchMemoryInput({ query: " " })).toThrow("query must not be empty");
		expect(() => normalizeSearchMemoryInput({ query: "fact", limit: 21 })).toThrow("1 to 20");
	});
});
