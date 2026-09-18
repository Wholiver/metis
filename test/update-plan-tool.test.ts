import { describe, expect, it } from "vitest";
import { createReadPlanToolDefinition } from "../src/core/tools/read-plan.ts";
import { createUpdatePlanToolDefinition, prepareUpdatePlanArguments } from "../src/core/tools/update-plan.ts";

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

	it("asks the model to keep the checklist current through completion", () => {
		const tool = createUpdatePlanToolDefinition();
		expect(tool.description).toContain("Call again whenever a step starts or finishes");
		expect(tool.promptSnippet).toContain("Keep the session execution checklist current");
		expect(tool.promptGuidelines).toEqual(expect.arrayContaining([
			expect.stringContaining("do not wait until the whole task ends"),
			expect.stringContaining("pending, in_progress, or completed"),
			expect.stringContaining("same language as the user's latest message"),
		]));
		expect(tool.prepareArguments).toBe(prepareUpdatePlanArguments);
	});

	it("warns when every checklist step is completed while a Performance run is still active", async () => {
		const tool = createUpdatePlanToolDefinition({
			unfinishedRunWarning: () => "FALSE_COMPLETION_BLOCKED: the Performance run is still active.",
		});
		const result = await tool.execute("call", {
			plan: [{ step: "draw svg", status: "completed" }],
		}, undefined, undefined, {} as never);
		expect(result.content[0]).toEqual({
			type: "text",
			text: "Plan state updated for this session.\nFALSE_COMPLETION_BLOCKED: the Performance run is still active.",
		});
	});

	it("canonicalizes status aliases before schema validation so checkmarks persist", async () => {
		let stored: { plan: Array<{ step: string; status: string }> } | undefined;
		const tool = createUpdatePlanToolDefinition({ onUpdate: (plan) => (stored = plan) });
		const raw = {
			explanation: "SVG 文件创建并验证通过，正在内置浏览器中打开并截屏确认动效",
			plan: [
				{ step: "设计并编写 SVG", status: "done" },
				{ status: "complete", step: "独立验证 SVG XML" },
				{ step: "在内置浏览器中打开并截屏", status: "in-progress" },
			],
		};
		const prepared = tool.prepareArguments!(raw) as typeof raw;
		expect(prepared.plan.map((item) => item.status)).toEqual(["completed", "completed", "in_progress"]);
		await tool.execute("call", prepared as never, undefined, undefined, {} as never);
		expect(stored?.plan.map((item) => item.status)).toEqual(["completed", "completed", "in_progress"]);
	});

	it("passes through canonical statuses and non-object input unchanged", () => {
		const canonical = { plan: [{ step: "keep", status: "pending" }] };
		expect(prepareUpdatePlanArguments(canonical)).toBe(canonical);
		expect(prepareUpdatePlanArguments(null)).toBe(null);
		expect(prepareUpdatePlanArguments("garbage")).toBe("garbage");
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

