import type { AgentTool } from "@earendil-works/metis-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

function passiveTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} test tool`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: `${name} executed` }] }),
	};
}

describe("AgentSession Subagent execution barrier", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("blocks every non-Subagent tool and disables tools after the launch batch", async () => {
		const harness = await createHarness({
			tools: [passiveTool("subagent"), passiveTool("log"), passiveTool("bash")],
			initialActiveToolNames: ["subagent", "log", "bash"],
		});
		harnesses.push(harness);
		const internals = harness.session as unknown as {
			_setSubagentRunning(jobId: string, running: boolean): void;
			_closeSubagentLaunchBatch(): void;
			_workingMemoryCheckpointDue: boolean;
			_createWorkingMemoryReminder(): unknown;
		};

		internals._setSubagentRunning("first1", true);
		expect(harness.session.getActiveToolNames()).toEqual(["subagent"]);
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "log-1", name: "log", arguments: {} },
			args: {},
		} as never)).toMatchObject({ block: true, reason: expect.stringContaining("create checkpoints") });
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "subagent-2", name: "subagent", arguments: {} },
			args: {},
		} as never)).toBeUndefined();

		internals._workingMemoryCheckpointDue = true;
		expect(internals._createWorkingMemoryReminder()).toBeUndefined();
		internals._closeSubagentLaunchBatch();
		expect(harness.session.getActiveToolNames()).toEqual([]);
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "subagent-late", name: "subagent", arguments: {} },
			args: {},
		} as never)).toMatchObject({ block: true });

		internals._setSubagentRunning("first1", false);
		expect(harness.session.getActiveToolNames()).toEqual(["subagent", "log", "bash"]);
	});

	it("delivers one combined result only after every Subagent returns", async () => {
		const harness = await createHarness({
			tools: [passiveTool("subagent"), passiveTool("log")],
			initialActiveToolNames: ["subagent", "log"],
		});
		harnesses.push(harness);
		const sendMessage = vi.spyOn(harness.session, "sendCustomMessage").mockResolvedValue(undefined);
		const internals = harness.session as unknown as {
			_setSubagentRunning(jobId: string, running: boolean): void;
			_closeSubagentLaunchBatch(): void;
			_queueSubagentResult(jobId: string, result: string): void;
		};

		internals._setSubagentRunning("first1", true);
		internals._setSubagentRunning("second", true);
		internals._closeSubagentLaunchBatch();
		internals._setSubagentRunning("first1", false);
		internals._queueSubagentResult("first1", "first result");
		expect(sendMessage).not.toHaveBeenCalled();

		internals._setSubagentRunning("second", false);
		internals._queueSubagentResult("second", "second result");
		expect(sendMessage).toHaveBeenCalledTimes(1);
		const [message, options] = sendMessage.mock.calls[0];
		expect(JSON.stringify(message)).toContain("[Subagent Job first1 finished]");
		expect(JSON.stringify(message)).toContain("[Subagent Job second finished]");
		expect(options).toMatchObject({ triggerTurn: true, deliverAs: "followUp" });
	});

	it("does not deliver an instant result before the launch batch closes", async () => {
		const harness = await createHarness({
			tools: [passiveTool("subagent"), passiveTool("log")],
			initialActiveToolNames: ["subagent", "log"],
		});
		harnesses.push(harness);
		const sendMessage = vi.spyOn(harness.session, "sendCustomMessage").mockResolvedValue(undefined);
		const internals = harness.session as unknown as {
			_setSubagentRunning(jobId: string, running: boolean): void;
			_closeSubagentLaunchBatch(): void;
			_queueSubagentResult(jobId: string, result: string): void;
		};

		internals._setSubagentRunning("instant", true);
		internals._setSubagentRunning("instant", false);
		internals._queueSubagentResult("instant", "fast result");
		expect(sendMessage).not.toHaveBeenCalled();

		internals._closeSubagentLaunchBatch();
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
});
