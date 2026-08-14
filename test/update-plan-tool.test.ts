import { describe, expect, it } from "vitest";
import { createReadPlanToolDefinition } from "../src/core/tools/read-plan.ts";
import { createUpdatePlanToolDefinition } from "../src/core/tools/update-plan.ts";

describe("update_plan tool", () => {
	it("stores plan state through the session callback without touching workspace files", async () => {
		let stored: { explanation?: string; plan: Array<{ step: string; status: string }> } | undefined;
		const tool = createUpdatePlanToolDefinition({ onUpdate: (plan) => (stored = plan) });
		const result = await tool.execute("call", {
			explanation: "Investigating runtime",
			plan: [{ step: "inspect runtime", status: "in_progress" }],
		}, undefined, undefined, {} as never);
		expect(stored).toMatchObject({ explanation: "Investigating runtime", plan: [{ step: "inspect runtime", status: "in_progress" }] });
		expect(result.content[0]).toEqual({ type: "text", text: "Plan state updated for this session." });
	});

	it("rejects multiple active steps", async () => {
		const tool = createUpdatePlanToolDefinition();
		await expect(tool.execute("call", {
			plan: [
				{ step: "first", status: "in_progress" },
				{ step: "second", status: "in_progress" },
			],
		}, undefined, undefined, {} as never)).rejects.toThrow("at most one in_progress");
	});
});

describe("read_plan tool", () => {
	it("returns the durable proposal together with the latest execution progress", async () => {
		const tool = createReadPlanToolDefinition();
		const branch = [
			{ type: "custom", customType: "workflow_proposal", data: { markdown: "# Proposal\nShip it", revision: 1, updatedAt: "proposal" } },
			{ type: "custom", customType: "workflow_plan", data: { plan: [{ step: "Implement", status: "in_progress" }, { step: "Verify", status: "pending" }], updatedAt: "progress" } },
		];
		const result = await tool.execute("call", {}, undefined, undefined, {
			sessionManager: { getBranch: () => branch },
		} as never);
		expect(result.content[0]).toEqual({ type: "text", text: "# Proposal\nShip it" });
		expect(result.content[1]).toMatchObject({ type: "text" });
		expect(result.content[1]?.text).toContain("Current execution checklist");
		expect(result.content[1]?.text).toContain("(in_progress) Implement");
	});
});
