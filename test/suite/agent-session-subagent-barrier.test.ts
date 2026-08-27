import type { AgentTool } from "@earendil-works/metis-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/metis-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

function passiveTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} test tool`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: `${name} executed` }], details: {} }),
	};
}

type SubagentInternals = {
	_setSubagentRunning(jobId: string, running: boolean): void;
	_closeSubagentLaunchBatch(): void;
	_queueSubagentResult(jobId: string, result: string): void;
	_workingMemoryCheckpointDue: boolean;
	_createWorkingMemoryReminder(): unknown;
};

describe("AgentSession Subagent execution pause", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("blocks tools during launch pause and releases them on the first completed result", async () => {
		const harness = await createHarness({
			tools: [passiveTool("subagent"), passiveTool("log"), passiveTool("bash")],
			initialActiveToolNames: ["subagent", "log", "bash"],
		});
		harnesses.push(harness);
		const internals = harness.session as unknown as SubagentInternals;
		let releaseDelivery: (() => void) | undefined;
		vi.spyOn(harness.session, "sendCustomMessage").mockImplementation(
			() => new Promise<void>((resolve) => {
				releaseDelivery = resolve;
			}),
		);

		internals._setSubagentRunning("first1", true);
		internals._setSubagentRunning("second", true);
		// The advertised tool list must not change: tools are the first segment of the
		// provider's cached request prefix, so narrowing it mid-wave used to invalidate
		// the system prompt and every message behind it. Only `beforeToolCall` gates.
		expect(harness.session.getActiveToolNames()).toEqual(["subagent", "log", "bash"]);
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "log-1", name: "log", arguments: {} },
			args: {},
		} as never)).toMatchObject({ block: true, reason: expect.stringContaining("launch pause") });
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "subagent-2", name: "subagent", arguments: {} },
			args: {},
		} as never)).toBeUndefined();

		internals._closeSubagentLaunchBatch();
		expect(harness.session.getActiveToolNames()).toEqual(["subagent", "log", "bash"]);
		// With the batch closed and Subagents still running, every tool is blocked at
		// dispatch time — including the launcher, which can no longer extend the batch.
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "subagent-3", name: "subagent", arguments: {} },
			args: {},
		} as never)).toMatchObject({ block: true });

		internals._setSubagentRunning("first1", false);
		internals._queueSubagentResult("first1", "first result");
		expect(harness.session.getRunningSubagentIds()).toEqual(["second"]);
		expect(harness.session.getActiveToolNames()).toEqual(["subagent", "log", "bash"]);
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "bash-1", name: "bash", arguments: {} },
			args: {},
		} as never)).toBeUndefined();

		releaseDelivery?.();
		await vi.waitFor(() => expect(harness.session.getRunningSubagentIds()).toEqual(["second"]));
	});

	it("serializes completed results into separate model turns in completion order", async () => {
		const harness = await createHarness({
			tools: [passiveTool("subagent"), passiveTool("log")],
			initialActiveToolNames: ["subagent", "log"],
		});
		harnesses.push(harness);
		const internals = harness.session as unknown as SubagentInternals;
		harness.setResponses([fauxAssistantMessage("visible first"), fauxAssistantMessage("visible second")]);

		internals._setSubagentRunning("first1", true);
		internals._setSubagentRunning("second", true);
		internals._closeSubagentLaunchBatch();
		internals._setSubagentRunning("first1", false);
		internals._queueSubagentResult("first1", "first result");
		internals._setSubagentRunning("second", false);
		internals._queueSubagentResult("second", "second result");

		await vi.waitFor(() => expect(harness.getPendingResponseCount()).toBe(0));
		await harness.session.agent.waitForIdle();

		const results = harness.session.messages.filter(
			(message) => message.role === "custom" && message.customType === "subagent_result",
		);
		expect(results).toHaveLength(2);
		expect(JSON.stringify(results[0])).toContain("[Subagent Job first1 finished]");
		expect(JSON.stringify(results[0])).not.toContain("[Subagent Job second finished]");
		expect(JSON.stringify(results[0])).toContain("First emit a brief user-visible update");
		expect(JSON.stringify(results[1])).toContain("[Subagent Job second finished]");
		expect(getAssistantTexts(harness)).toEqual(["visible first", "visible second"]);
	});

	it("ends a pure Subagent batch without another model call or automatic log", async () => {
		let internals: SubagentInternals;
		const launched: string[] = [];
		let logRuns = 0;
		const subagentTool: AgentTool = {
			name: "subagent",
			label: "subagent",
			description: "test Subagent",
			parameters: Type.Object({ task: Type.String() }),
			executionMode: "sequential",
			execute: async (toolCallId, params) => {
				launched.push((params as { task: string }).task);
				internals._setSubagentRunning(toolCallId, true);
				return { content: [{ type: "text", text: "started" }], details: {}, terminate: true };
			},
		};
		const logTool: AgentTool = {
			...passiveTool("log"),
			execute: async () => {
				logRuns++;
				return { content: [{ type: "text", text: "logged" }], details: {} };
			},
		};
		const harness = await createHarness({
			tools: [subagentTool, logTool],
			initialActiveToolNames: ["subagent", "log"],
		});
		harnesses.push(harness);
		internals = harness.session as unknown as SubagentInternals;
		internals._workingMemoryCheckpointDue = true;
		harness.setResponses([
			fauxAssistantMessage([
				fauxToolCall("subagent", { task: "first" }),
				fauxToolCall("log", {}),
				fauxToolCall("subagent", { task: "second" }),
			], { stopReason: "toolUse" }),
			fauxAssistantMessage("unexpected continuation"),
		]);

		await harness.session.prompt("launch");

		expect(launched).toEqual(["first", "second"]);
		expect(logRuns).toBe(0);
		expect(harness.getPendingResponseCount()).toBe(1);
		expect(getAssistantTexts(harness)).toEqual([""]);
		expect(harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
		// The turn ends because the launcher returns `terminate: true`, not because the
		// tool list was emptied — so the next turn's prefix still matches this one's.
		expect(harness.session.getActiveToolNames()).toEqual(["subagent", "log"]);
	});

	it("buffers an instant result until the launch batch closes", async () => {
		const harness = await createHarness({
			tools: [passiveTool("subagent"), passiveTool("log")],
			initialActiveToolNames: ["subagent", "log"],
		});
		harnesses.push(harness);
		const sendMessage = vi.spyOn(harness.session, "sendCustomMessage").mockResolvedValue(undefined);
		const internals = harness.session as unknown as SubagentInternals;

		internals._setSubagentRunning("instant", true);
		internals._setSubagentRunning("instant", false);
		internals._queueSubagentResult("instant", "fast result");
		expect(sendMessage).not.toHaveBeenCalled();

		internals._closeSubagentLaunchBatch();
		await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
	});

	it("aborts running subagents and emits subagent_status 0 on session.abort()", async () => {
		const harness = await createHarness({
			tools: [passiveTool("subagent"), passiveTool("log")],
			initialActiveToolNames: ["subagent", "log"],
		});
		harnesses.push(harness);
		const internals = harness.session as unknown as SubagentInternals;

		internals._setSubagentRunning("sub-1", true);
		internals._setSubagentRunning("sub-2", true);
		expect(harness.session.getRunningSubagentCount()).toBe(2);

		const events: any[] = [];
		harness.session.subscribe((ev) => events.push(ev));

		await harness.session.abort();

		expect(harness.session.getRunningSubagentCount()).toBe(0);
		expect(harness.session.getRunningSubagentIds()).toEqual([]);
		expect(events.some((ev) => ev.type === "subagent_status" && ev.runningCount === 0)).toBe(true);
	});
});

