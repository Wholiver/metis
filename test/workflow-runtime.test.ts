import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/metis-agent-core";
import { buildInstructionStack, summarizeInstructionStack } from "../src/core/system-prompt.ts";
import { WorkflowRuntime, WorkflowToolError, extractProposedPlan, getLatestWorkflowProposal, getToolCapabilities, resolveWorkflowPlan, resolveWorkflowProposal } from "../src/core/workflow-runtime.ts";
import { validateAskUserRequest, validateAskUserResponse } from "../src/core/ask-user.ts";
import type { ToolDefinition } from "../src/core/extensions/types.ts";

const readTool = { name: "read" } as AgentTool;

describe("WorkflowRuntime", () => {
	it("freezes model-visible step inputs and rotates context windows on semantic changes", () => {
		const runtime = new WorkflowRuntime();
		const instructions = buildInstructionStack({ cwd: "/workspace", selectedTools: ["read"] });
		const first = runtime.freeze({
			turnId: 0,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "build",
			instructions,
			messages: [],
			tools: [readTool],
		});
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.instructions)).toBe(true);
		expect(Object.isFrozen(first.tools[0]!)).toBe(true);
		expect(first.dispatcher).toBeDefined();
		expect(first.toolNames).toEqual(["read"]);

		const second = runtime.freeze({
			turnId: 1,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "plan",
			instructions,
			messages: [],
			tools: [readTool],
		});
		expect(second.contextWindowId).not.toBe(first.contextWindowId);
	});

	it("keeps snapshot content immutable after source state changes", () => {
		const runtime = new WorkflowRuntime();
		const messages = [{ role: "user", content: [{ type: "text", text: "before" }], timestamp: 1 }] as any;
		const tools = [{ name: "read", description: "before" }] as AgentTool[];
		const snapshot = runtime.freeze({
			turnId: 0,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "build",
			instructions: buildInstructionStack({ cwd: "/workspace", selectedTools: ["read"] }),
			messages,
			tools,
		});
		messages[0].content[0].text = "after";
		(tools[0] as any).description = "after";
		expect((snapshot.messages[0] as any).content[0].text).toBe("before");
		expect((snapshot.tools[0] as any).description).toBe("before");
	});

	it("rotates semantic context when thinking, messages, or tool schema changes", () => {
		const runtime = new WorkflowRuntime();
		const instructions = buildInstructionStack({ cwd: "/workspace", selectedTools: ["read"] });
		const tool = { name: "read", description: "before", parameters: { type: "object" } } as AgentTool;
		const first = runtime.freeze({
			turnId: 0,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "build",
			instructions,
			messages: [{ role: "user", content: "before" }] as any,
			tools: [tool],
		});
		const second = runtime.freeze({
			turnId: 1,
			model: undefined,
			thinkingLevel: "low",
			collaborationMode: "build",
			instructions,
			messages: [{ role: "user", content: "after" }] as any,
			tools: [{ ...tool, parameters: { type: "object", properties: { path: { type: "string" } } } }],
		});
		expect(second.semanticHash).not.toBe(first.semanticHash);
		expect(second.contextWindowId).not.toBe(first.contextWindowId);
	});

	it("dispatches safe reads concurrently and serializes write/mixed calls", async () => {
		const runtime = new WorkflowRuntime();
		const snapshot = runtime.freeze({
			turnId: 0,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "build",
			instructions: buildInstructionStack({ cwd: "/workspace", selectedTools: ["read", "write"] }),
			messages: [],
			tools: [{ name: "read" }, { name: "write" }] as AgentTool[],
		});
		const readDefinition = { name: "read", capabilities: { effect: "read", parallelSafe: true } } as ToolDefinition;
		const writeDefinition = { name: "write", capabilities: { effect: "write", parallelSafe: false } } as ToolDefinition;
		const started: string[] = [];
		let releaseReads!: () => void;
		const readsReleased = new Promise<void>((resolve) => (releaseReads = resolve));
		const read = (id: string) => runtime.dispatchTool(id, "read", readDefinition, undefined, async () => {
			started.push(id);
			await readsReleased;
			return id;
		});
		const firstRead = read("read-1");
		const secondRead = read("read-2");
		await Promise.resolve();
		expect(started).toEqual(["read-1", "read-2"]);
		releaseReads();
		await Promise.all([firstRead, secondRead]);

		const writes: string[] = [];
		let releaseFirstWrite!: () => void;
		const firstWriteDone = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
		const firstWrite = runtime.dispatchTool("write-1", "write", writeDefinition, undefined, async () => {
			writes.push("start-1");
			await firstWriteDone;
			writes.push("end-1");
			return undefined;
		});
		const secondWrite = runtime.dispatchTool("write-2", "write", writeDefinition, undefined, async () => {
			writes.push("start-2");
			return undefined;
		});
		await Promise.resolve();
		expect(writes).toEqual(["start-1"]);
		releaseFirstWrite();
		await Promise.all([firstWrite, secondWrite]);
		expect(writes).toEqual(["start-1", "end-1", "start-2"]);
		expect(snapshot.id).toBeDefined();
	});

	it("cancels queued calls independently and classifies tool failures", async () => {
		const runtime = new WorkflowRuntime();
		const writeDefinition = { name: "write", capabilities: { effect: "write", parallelSafe: false } } as ToolDefinition;
		runtime.freeze({
			turnId: 0,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "build",
			instructions: buildInstructionStack({ cwd: "/workspace", selectedTools: ["write"] }),
			messages: [],
			tools: [{ name: "write" }] as AgentTool[],
		});

		let releaseFirst!: () => void;
		const first = runtime.dispatchTool("write-active", "write", writeDefinition, undefined, async () => {
			await new Promise<void>((resolve) => (releaseFirst = resolve));
		});
		const secondAbort = new AbortController();
		const queued = runtime.dispatchTool("write-queued", "write", writeDefinition, secondAbort.signal, async () => undefined);
		secondAbort.abort();
		await expect(queued).rejects.toMatchObject({ name: "WorkflowToolError", kind: "aborted" });
		releaseFirst();
		await first;

		await expect(runtime.dispatchTool("recoverable", "write", writeDefinition, undefined, async () => {
			throw new Error("retry me");
		})).rejects.toMatchObject({ name: "WorkflowToolError", kind: "recoverable" });
		await expect(runtime.dispatchTool("terminal", "write", writeDefinition, undefined, async () => {
			throw Object.assign(new Error("stop"), { terminate: true });
		})).rejects.toMatchObject({ name: "WorkflowToolError", kind: "terminal" });
		expect(WorkflowToolError).toBeDefined();
	});

	it("enforces read-only Plan mode including unknown extension tools", () => {
		const runtime = new WorkflowRuntime();
		const extensionTool: ToolDefinition = {
			name: "unknown_extension_tool",
			label: "Unknown",
			description: "Unknown effect",
			parameters: Type.Object({}),
			execute: async () => ({ content: [] }),
		};
		expect(runtime.canDispatchTool("read", undefined, "plan")).toBe(true);
		expect(runtime.canDispatchTool("write", undefined, "plan")).toBe(false);
		expect(runtime.canDispatchTool("bash", undefined, "plan")).toBe(false);
		expect(runtime.canDispatchTool("update_plan", undefined, "plan")).toBe(false);
		expect(runtime.canDispatchTool(extensionTool.name, extensionTool, "plan")).toBe(false);
		expect(runtime.canDispatchTool("write", undefined, "build")).toBe(true);
		expect(runtime.canDispatchTool("update_plan", undefined, "build")).toBe(true);
		expect(getToolCapabilities(undefined, "bash").effect).toBe("mixed");
		expect(getToolCapabilities(undefined, "update_plan").effect).toBe("write");
	});

	it("keeps ask_user exclusive while preserving proposal artifacts outside model context", async () => {
		const runtime = new WorkflowRuntime();
		const ask = { name: "ask_user", capabilities: { effect: "read", parallelSafe: false } } as ToolDefinition;
		runtime.freeze({
			turnId: 0, model: undefined, thinkingLevel: "off", collaborationMode: "plan",
			instructions: buildInstructionStack({ cwd: "/workspace", selectedTools: ["ask_user"] }),
			messages: [], tools: [{ name: "ask_user" }] as AgentTool[],
		});
		let release!: () => void;
		const blocker = new Promise<void>((resolve) => (release = resolve));
		const starts: string[] = [];
		const first = runtime.dispatchTool("ask-1", "ask_user", ask, undefined, async () => {
			starts.push("first"); await blocker;
		});
		const second = runtime.dispatchTool("ask-2", "ask_user", ask, undefined, async () => { starts.push("second"); });
		await Promise.resolve();
		expect(starts).toEqual(["first"]);
		release();
		await Promise.all([first, second]);
		expect(starts).toEqual(["first", "second"]);
		const markdown = "intro\n<proposed_plan>\n# Summary\nShip it\n</proposed_plan>";
		expect(extractProposedPlan(markdown)).toBe("# Summary\nShip it");
		expect(extractProposedPlan("<proposed_plan>x</proposed_plan><proposed_plan>y</proposed_plan>")).toBeUndefined();
		expect(extractProposedPlan("<proposed_plan>x</proposed_plan><proposed_plan>unfinished")).toBeUndefined();
		expect(getLatestWorkflowProposal([{ type: "custom", customType: "workflow_proposal", data: { markdown: "new", revision: 2, updatedAt: "now" } }])).toMatchObject({ markdown: "new", revision: 2 });
	});

	it("validates structured ask_user questions", () => {
		const request = { requestId: "request", toolCallId: "tool", questions: [{ id: "scope", header: "Scope", question: "Which scope?", options: [{ label: "A", description: "A", recommended: true }, { label: "B", description: "B" }] }] };
		expect(validateAskUserRequest(request)).toBeUndefined();
		expect(validateAskUserRequest({ questions: [{ id: "same", header: "A", question: "A" }, { id: "same", header: "B", question: "B" }] })).toContain("unique");
		expect(validateAskUserRequest({ questions: [{ id: "scope", header: "Scope", question: "Scope?", options: [{ label: "Same", description: "A" }, { label: "Same", description: "B" }] }] })).toContain("option labels");
		expect(validateAskUserResponse(request, { cancelled: false, answers: [{ id: "scope", value: "A", selectedLabel: "A" }] })).toBeUndefined();
		expect(validateAskUserResponse(request, { cancelled: true, answers: [{ id: "scope", value: "A" }] })).toContain("must not contain");
		expect(validateAskUserResponse(request, { cancelled: false, answers: [] })).toContain("exactly once");
		expect(validateAskUserResponse(request, { cancelled: false, answers: [{ id: "scope", value: "" }] })).toContain("non-empty");
		expect(validateAskUserResponse(request, { cancelled: false, answers: [{ id: "other", value: "A" }] })?.toLowerCase()).toContain("unknown");
		expect(validateAskUserResponse(request, { cancelled: false, answers: [{ id: "scope", value: "B", selectedLabel: "A" }] })).toContain("match");
	});

	it("resolves persisted proposal first and lazily recovers legacy assistant plans", () => {
		const legacy = { type: "message", id: "assistant-1", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "assistant", content: "<proposed_plan>\n# Summary\nLegacy\n</proposed_plan>" } };
		expect(resolveWorkflowProposal([legacy])).toMatchObject({ markdown: "# Summary\nLegacy", revision: 1, sourceMessageId: "assistant-1" });
		expect(resolveWorkflowProposal([legacy, { type: "custom", customType: "workflow_proposal", data: { markdown: "# Summary\nCurrent", revision: 3, updatedAt: "now", sourceMessageId: "assistant-3" } }])).toMatchObject({ markdown: "# Summary\nCurrent", revision: 3 });
	});

	it("resolves the latest structured execution checklist independently from the proposal", () => {
		const entries = [
			{ type: "custom", customType: "workflow_plan", data: { plan: [{ step: "Old", status: "completed" }], updatedAt: "old" } },
			{ type: "custom", customType: "workflow_proposal", data: { markdown: "# Proposal", revision: 2, updatedAt: "proposal" } },
			{ type: "custom", customType: "workflow_plan", data: { explanation: "Current work", plan: [{ step: "Implement", status: "in_progress" }, { step: "Verify", status: "pending" }], updatedAt: "current" } },
		];
		expect(resolveWorkflowPlan(entries)).toEqual({
			explanation: "Current work",
			plan: [{ step: "Implement", status: "in_progress" }, { step: "Verify", status: "pending" }],
			updatedAt: "current",
			legacyMarkdown: undefined,
		});
	});

	it("hard-rejects a forced update_plan dispatch in Plan snapshots", async () => {
		const runtime = new WorkflowRuntime();
		const snapshot = runtime.freeze({
			turnId: 0,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "plan",
			instructions: buildInstructionStack({ cwd: "/workspace", selectedTools: ["update_plan"] }),
			messages: [],
			tools: [{ name: "update_plan" }] as AgentTool[],
		});
		runtime.bindToolCall("forced", snapshot);
		await expect(runtime.dispatchTool("forced", "update_plan", undefined, undefined, async () => undefined))
			.rejects.toMatchObject({ name: "WorkflowToolError", kind: "terminal" });
	});

	it("enforces read_plan then update_plan before proposal implementation tools", async () => {
		const runtime = new WorkflowRuntime();
		runtime.freeze({
			turnId: 0,
			model: undefined,
			thinkingLevel: "off",
			collaborationMode: "build",
			instructions: buildInstructionStack({ cwd: "/workspace", selectedTools: ["read_plan", "update_plan", "write"] }),
			messages: [],
			tools: [{ name: "read_plan" }, { name: "update_plan" }, { name: "write" }] as AgentTool[],
		});
		const phases: string[] = [];
		runtime.beginProposalExecution("task-1", (phase) => phases.push(phase));
		await expect(runtime.dispatchTool("early-write", "write", undefined, undefined, async () => undefined))
			.rejects.toMatchObject({ kind: "recoverable" });

		const calls: string[] = [];
		await Promise.all([
			runtime.dispatchTool("read", "read_plan", undefined, undefined, async () => { calls.push("read"); }),
			runtime.dispatchTool("plan", "update_plan", undefined, undefined, async () => { calls.push("plan"); }),
			runtime.dispatchTool("write", "write", undefined, undefined, async () => { calls.push("write"); }),
		]);
		expect(calls).toEqual(["read", "plan", "write"]);
		expect(phases).toEqual(["reading_proposal", "creating_checklist", "active"]);
		expect(runtime.proposalExecutionState).toEqual({ taskId: "task-1", phase: "active" });
	});

	it("treats a workflow plan reset as authoritative over an older completed task", () => {
		expect(resolveWorkflowPlan([
			{ type: "custom", customType: "workflow_plan", data: { plan: [{ step: "Old", status: "completed" }], updatedAt: "old" } },
			{ type: "custom", customType: "workflow_plan_reset", data: { updatedAt: "new" } },
		])).toBeUndefined();
	});

	it("exposes content-free instruction provenance", () => {
		const stack = buildInstructionStack({
			cwd: "/workspace",
			developerInstructions: ["Keep source text private"],
			selectedTools: ["read"],
		});
		const sources = summarizeInstructionStack(stack);
		expect(sources).toEqual(expect.arrayContaining([
			expect.objectContaining({ channel: "base", source: "metis", trust: "builtin" }),
			expect.objectContaining({ channel: "developer", source: "configured", trust: "global" }),
		]));
		expect(sources.find((source) => source.source === "tool registry")).toBeUndefined();
		expect(JSON.stringify(sources)).not.toContain("Keep source text private");
	});
});

