import { describe, expect, it } from "vitest";
import { SUBAGENT_COORDINATION_GUIDANCE, createSubagentToolDefinition } from "../src/core/tools/subagent.ts";

describe("subagent coordination guidance", () => {
	it("batches subagents planned at the same time without intervening output", () => {
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("issue all of those subagent tool calls consecutively");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("Do not place reasoning text, status text, or any other tool call between");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("after substantial intervening work or a long interval");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("Do not emit a user-facing launch count or waiting notice");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("end the turn without status text");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("strict synchronization barrier");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("until every running subagent has returned");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("whether their tasks are related or independent");
	});

	it("waits for every running Subagent without an independent-work exception", () => {
		const definition = createSubagentToolDefinition(process.cwd());

		expect(definition.description).toBe(SUBAGENT_COORDINATION_GUIDANCE);
		expect(definition.description).toContain("As soon as any subagent has started");
		expect(definition.description).toContain("There are no exceptions for separate work");
		expect(definition.description).toContain("Never repeat, duplicate, independently investigate, browse, search, verify, checkpoint, log");
		expect(definition.description).toContain("do not produce an interim answer");
		expect(definition.description).toContain("Do not emit waiting, acknowledgement, progress, or status-only messages");
	});
});
