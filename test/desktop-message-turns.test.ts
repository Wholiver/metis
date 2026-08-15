import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { analyzeAssistantTurn, getSubagentProgress, getRunningSubagentCount, getRunningSubagentIds, getSubagentToolCalls, shouldQueueDesktopMessage, getAssistantContentLayout, getAssistantWorkLayout, shouldHideAssistantWorkHeader, getAssistantTurnDuration, extractProposedPlan, reconcileAssistantFinalDivider, isSubagentLaunchNotice, mergeStreamingMessage, classifyDesktopActivityEvent } = require("../desktop/renderer/message-turns.js") as {
	analyzeAssistantTurn: (message: unknown, messages: unknown[], isStreaming: boolean) => {
		hasCoT: boolean;
		hasRunningSubagent: boolean;
		isFinalAssistant: boolean;
		isIntermediate: boolean;
		hasFinalResponse: boolean;
		shouldCollapse: boolean;
	};
	getSubagentProgress: (part: unknown, messages: unknown[]) => { jobId: string; state: "running" | "completed" | "failed"; durationMs?: number };
	getRunningSubagentCount: (messages: unknown[]) => number;
	getRunningSubagentIds: (messages: unknown[], reportedJobIds?: unknown[]) => string[];
	getSubagentToolCalls: (messages: unknown[]) => Array<{ jobId: string; part: unknown }>;
	shouldQueueDesktopMessage: (messages: unknown[], isStreaming: boolean) => boolean;
	getAssistantContentLayout: (message: unknown, isFinalAssistant: boolean, isStreaming?: boolean) => {
		cotParts: unknown[];
		finalResponsePart?: unknown;
	};
	getAssistantWorkLayout: (message: unknown, messages: unknown[], isFinalAssistant: boolean, isStreaming?: boolean) => {
		workItems: unknown[];
		finalResponsePart?: unknown;
	};
	extractProposedPlan: (text: unknown) => { before: string; plan: string; after: string } | undefined;
	isSubagentLaunchNotice: (text: unknown) => boolean;
	shouldHideAssistantWorkHeader: (message: unknown, messages: unknown[]) => boolean;
	getAssistantTurnDuration: (message: unknown, messages: unknown[], timings: Record<string, unknown>, options?: { active?: boolean; now?: number }) => number | undefined;
	reconcileAssistantFinalDivider: (body: unknown, shouldRender: boolean, beforeNode?: unknown) => unknown;
	mergeStreamingMessage: (previous: any, incoming: any) => any;
	classifyDesktopActivityEvent: (event: { type: string; willRetry?: boolean }) => "active" | "complete" | "unchanged";
};

describe("desktop assistant turn grouping", () => {
	it("extracts a completed proposed plan without changing surrounding response text", () => {
		expect(extractProposedPlan("Intro\n<proposed_plan>\n- Inspect\n- Fix\n</proposed_plan>\nDone")).toEqual({
			before: "Intro",
			plan: "- Inspect\n- Fix",
			after: "Done",
		});
		expect(extractProposedPlan("<proposed_plan>still streaming")).toBeUndefined();
	});

	it("preserves an emitted tool call when a partial reasoning snapshot omits it", () => {
		const toolCall = { type: "toolCall", id: "tool-call-1", name: "read", arguments: { path: "a.ts" } };
		const previous = { role: "assistant", timestamp: 10, content: [
			{ type: "thinking", thinking: "Inspecting" },
			toolCall,
		] };
		const incoming = { role: "assistant", timestamp: 10, content: [
			{ type: "thinking", thinking: "Inspecting more" },
		] };

		expect(mergeStreamingMessage(previous, incoming).content).toEqual([
			incoming.content[0],
			toolCall,
		]);
	});

	it("keeps work active across message boundaries and retrying agent ends", () => {
		expect(classifyDesktopActivityEvent({ type: "message_end" })).toBe("unchanged");
		expect(classifyDesktopActivityEvent({ type: "tool_execution_end" })).toBe("active");
		expect(classifyDesktopActivityEvent({ type: "agent_end", willRetry: true })).toBe("active");
		expect(classifyDesktopActivityEvent({ type: "agent_end", willRetry: false })).toBe("complete");
	});

	it("keeps empty parts from shifting CoT DOM layout", () => {
		const waiting = { type: "text", text: "Waiting for subagent result." };
		const toolCall = { type: "toolCall", id: "tool-call-kqpvqh", name: "subagent" };
		const message = { role: "assistant", content: [
			{ type: "thinking", thinking: "" },
			waiting,
			toolCall,
			{ type: "text", text: "" },
		] };

		expect(getAssistantContentLayout(message, true)).toEqual({
			cotParts: [waiting],
			finalResponsePart: undefined,
		});
	});

	it("deduplicates stale divider paths and places one directly above final response", () => {
		const removed: string[] = [];
		const finalResponse = { name: "final" };
		const firstDivider = { name: "first", nextSibling: undefined, remove: () => removed.push("first") };
		const duplicateDivider = { name: "duplicate", remove: () => removed.push("duplicate") };
		const cotDivider = { remove: () => removed.push("cot") };
		const cotContainer = { classList: { remove: (name: string) => removed.push(name) } };
		let insertion: unknown[] = [];
		const body = {
			querySelectorAll: (selector: string) => {
				if (selector === ".cot-divider") return [cotDivider];
				if (selector === ".cot-container.has-final-response") return [cotContainer];
				if (selector === ":scope > .turn-final-divider") return [firstDivider, duplicateDivider];
				return [];
			},
			ownerDocument: { createElement: () => ({ className: "", remove: () => undefined }) },
			insertBefore: (node: unknown, before: unknown) => { insertion = [node, before]; },
		};

		reconcileAssistantFinalDivider(body, true, finalResponse);

		expect(removed).toEqual(["cot", "has-final-response", "duplicate"]);
		expect(insertion).toEqual([firstDivider, finalResponse]);
	});

	it("removes every stale divider when message is not final response", () => {
		const removed: string[] = [];
		const divider = { remove: () => removed.push("direct") };
		const body = {
			querySelectorAll: (selector: string) => selector === ":scope > .turn-final-divider" ? [divider] : [],
		};

		reconcileAssistantFinalDivider(body, false);

		expect(removed).toEqual(["direct"]);
	});

	it("creates one divider for a clean final-response body", () => {
		const finalResponse = { name: "final" };
		const created = { className: "", nextSibling: undefined };
		let insertion: unknown[] = [];
		const body = {
			querySelectorAll: () => [],
			ownerDocument: { createElement: () => created },
			insertBefore: (node: unknown, before: unknown) => { insertion = [node, before]; },
		};

		expect(reconcileAssistantFinalDivider(body, true, finalResponse)).toBe(created);
		expect(created.className).toBe("turn-final-divider");
		expect(insertion).toEqual([created, finalResponse]);
	});

	it("selects only non-empty text after tool calls as the final response", () => {
		const toolCall = { type: "toolCall", id: "tool-call-log001", name: "log" };
		const answer = { type: "text", text: "Final answer" };
		const message = { role: "assistant", content: [
			{ type: "thinking", thinking: "Working" },
			toolCall,
			answer,
			{ type: "text", text: "" },
		] };

		expect(getAssistantContentLayout(message, true)).toEqual({
			cotParts: [message.content[0], toolCall],
			finalResponsePart: answer,
		});
	});

	it("keeps streaming text in Thoughts until the agent completes", () => {
		const status = { type: "text", text: "I found the issue and will fix it." };
		const message = { role: "assistant", content: [status] };
		const messages = [{ role: "user", content: "fix it" }, message];

		expect(analyzeAssistantTurn(message, messages, true)).toMatchObject({
			hasFinalResponse: false,
			shouldCollapse: false,
		});
		expect(getAssistantContentLayout(message, true, true)).toEqual({
			cotParts: [status],
			finalResponsePart: undefined,
		});
		expect(getAssistantWorkLayout(message, messages, true, true)).toEqual({
			workItems: [status],
			finalResponsePart: undefined,
		});
		expect(getAssistantContentLayout(message, true, false)).toEqual({
			cotParts: [],
			finalResponsePart: status,
		});
	});

	it("preserves Plan progress text between tool calls in CLI order", () => {
		const inspect = { type: "text", text: "先检查项目入口和现有文档结构。" };
		const firstTool = { type: "toolCall", id: "tool-call-read-1", name: "read" };
		const evidence = { type: "text", text: "入口已经确认，接下来核对测试和发布路径。" };
		const secondTool = { type: "toolCall", id: "tool-call-read-2", name: "read" };
		const plan = { type: "text", text: "<proposed_plan>\n## Summary\n同步文档。\n</proposed_plan>" };
		const message = { role: "assistant", content: [inspect, firstTool, evidence, secondTool, plan] };

		expect(getAssistantWorkLayout(message, [message], true)).toEqual({
			workItems: [inspect, firstTool, evidence, secondTool],
			finalResponsePart: plan,
		});
	});

	it("keeps legacy streaming string content out of the final-response layout", () => {
		const message = { role: "assistant", content: "Checking the workspace before editing." };

		expect(getAssistantWorkLayout(message, [message], true, true)).toEqual({
			workItems: [{ type: "text", text: message.content }],
			finalResponsePart: undefined,
		});
	});

	it("omits Subagent tool calls from Thinking and collects them for the composer dock", () => {
		const thinking = { type: "thinking", thinking: "Delegating" };
		const toolCall = { type: "toolCall", id: "tool-call-kqpvqh", name: "subagent", arguments: { title: "Research" } };
		const message = { role: "assistant", content: [thinking, toolCall] };

		expect(getAssistantContentLayout(message, false)).toEqual({
			cotParts: [thinking],
			finalResponsePart: undefined,
		});
		expect(getSubagentToolCalls([message])).toEqual([{ jobId: "kqpvqh", part: toolCall }]);
	});

	it("adds a Subagent card at launch and updates its state at the original call position", () => {
		const thinking = { type: "thinking", thinking: "Delegating" };
		const toolCall = { type: "toolCall", id: "tool-call-kqpvqh", name: "subagent", arguments: { title: "Research" } };
		const message = { role: "assistant", content: [thinking, toolCall] };
		expect(getAssistantWorkLayout(message, [message], false)).toEqual({
			workItems: [thinking, {
				type: "subagentCard",
				part: toolCall,
				progress: { jobId: "kqpvqh", state: "running" },
			}],
			finalResponsePart: undefined,
		});

		const messages = [message, { role: "custom", customType: "subagent_result", content: "[Subagent Job kqpvqh finished]\n\nDone" }];
		expect(getAssistantWorkLayout(message, messages, false)).toEqual({
			workItems: [thinking, {
				type: "subagentCard",
				part: toolCall,
				progress: { jobId: "kqpvqh", state: "completed" },
			}],
			finalResponsePart: undefined,
		});
	});

	it("filters redundant Subagent launch notices now represented by the UI", () => {
		expect(isSubagentLaunchNotice("已启动 2 个 Subagent，正在等待它们返回结果。")).toBe(true);
		expect(isSubagentLaunchNotice("Started 2 Subagents; waiting for their results.")).toBe(true);
		expect(isSubagentLaunchNotice("Subagent results are ready.")).toBe(false);
	});

	it("shows one Worked header across Subagent-separated reasoning chunks", () => {
		const firstReasoning = { role: "assistant", content: [{ type: "thinking", thinking: "Delegating" }] };
		const subagentLaunch = { role: "assistant", content: [{ type: "toolCall", id: "tool-call-kqpvqh", name: "subagent" }] };
		const acknowledgement = { role: "assistant", content: [{ type: "text", text: "Waiting" }] };
		const resumedReasoning = { role: "assistant", content: [{ type: "thinking", thinking: "Synthesizing" }] };
		const messages = [{ role: "user", content: "news" }, firstReasoning, subagentLaunch, acknowledgement, resumedReasoning];

		expect(shouldHideAssistantWorkHeader(firstReasoning, messages)).toBe(false);
		expect(shouldHideAssistantWorkHeader(resumedReasoning, messages)).toBe(true);
		expect(shouldHideAssistantWorkHeader(subagentLaunch, messages)).toBe(true);
	});

	it("restores full turn duration from persisted assistant completion time", () => {
		const user = { role: "user", content: "news", timestamp: 1_000 };
		const delegated = { role: "assistant", content: [{ type: "thinking", thinking: "Delegating" }], timestamp: 2_000 };
		const resumed = { role: "assistant", content: [{ type: "text", text: "Final" }], timestamp: 7_000 };
		const messages = [user, delegated, { role: "custom", customType: "subagent_result", timestamp: 6_000 }, resumed];

		expect(getAssistantTurnDuration(delegated, messages, {
			"7000": { completedAt: 9_500 },
		})).toBe(8.5);
	});

	it("keeps the full turn timer running while a Subagent is active", () => {
		const user = { role: "user", content: "news", timestamp: 1_000 };
		const delegated = { role: "assistant", content: [{ type: "thinking", thinking: "Delegating" }], timestamp: 2_000 };
		const messages = [user, delegated];

		expect(getAssistantTurnDuration(delegated, messages, {}, { active: true, now: 11_200 })).toBe(10.2);
	});

	it("collapses completed subagent work while keeping final response separate", () => {
		const reasoning = { role: "assistant", content: [{ type: "thinking", thinking: "spawn agent" }, { type: "toolCall", id: "tool-call-kqpvqh", name: "subagent" }] };
		const waiting = { role: "assistant", content: [{ type: "text", text: "Waiting for subagent." }] };
		const resumed = { role: "assistant", content: [{ type: "thinking", thinking: "subagent returned" }] };
		const final = { role: "assistant", content: [{ type: "text", text: "Final news summary" }] };
		const messages = [
			{ role: "user", content: "news" },
			reasoning,
			{ role: "toolResult", toolCallId: "tool-call-kqpvqh" },
			waiting,
			{ role: "custom", customType: "subagent_result", content: "[Subagent Job kqpvqh finished]\n\nDone" },
			resumed,
			final,
		];

		expect(analyzeAssistantTurn(reasoning, messages, false)).toMatchObject({ hasCoT: true, isIntermediate: true, shouldCollapse: true });
		expect(analyzeAssistantTurn(waiting, messages, false)).toMatchObject({ hasCoT: true, isIntermediate: true, shouldCollapse: true });
		expect(analyzeAssistantTurn(final, messages, false)).toMatchObject({ hasCoT: true, isFinalAssistant: true, shouldCollapse: true });
	});

	it("recognizes a historical string message as final response after tool work", () => {
		const work = { role: "assistant", content: [{ type: "toolCall", id: "tool-call-log001", name: "log" }] };
		const final = { role: "assistant", content: "Final answer" };
		const messages = [{ role: "user", content: "question" }, work, final];

		expect(analyzeAssistantTurn(work, messages, false)).toMatchObject({ hasCoT: true, isIntermediate: true });
		expect(analyzeAssistantTurn(final, messages, false)).toMatchObject({
			hasCoT: true,
			hasFinalResponse: true,
			isFinalAssistant: true,
		});
	});

	it("keeps same-message tool work and final response in separate layout regions", () => {
		const toolCall = { type: "toolCall", id: "tool-call-log001", name: "log" };
		const finalResponse = { type: "text", text: "Final answer" };
		const message = { role: "assistant", content: [toolCall, finalResponse] };
		const messages = [{ role: "user", content: "question" }, message];

		expect(analyzeAssistantTurn(message, messages, false)).toMatchObject({ hasCoT: true, isFinalAssistant: true });
		expect(getAssistantWorkLayout(message, messages, true)).toEqual({
			workItems: [toolCall],
			finalResponsePart: finalResponse,
		});
	});

	it.each(["openai", "anthropic", "google"])("collapses %s thinking content after completion", (provider) => {
		const reasoning = {
			role: "assistant",
			provider,
			content: [{ type: "thinking", thinking: `${provider} reasoning` }],
		};
		const final = { role: "assistant", provider, content: [{ type: "text", text: "Final answer" }] };
		const messages = [{ role: "user", content: "question" }, reasoning, final];

		expect(analyzeAssistantTurn(reasoning, messages, false)).toMatchObject({
			hasCoT: true,
			shouldCollapse: true,
		});
	});

	it("keeps current work expanded while streaming", () => {
		const working = { role: "assistant", content: [{ type: "thinking", thinking: "working" }, { type: "text", text: "status" }] };
		const messages = [{ role: "user", content: "task" }, working];

		expect(analyzeAssistantTurn(working, messages, true).shouldCollapse).toBe(false);
	});

	it("keeps a completed plan final while the next turn streams", () => {
		const plan = {
			role: "assistant",
			content: [{ type: "text", text: "<proposed_plan>\n- Implement\n</proposed_plan>" }],
		};
		const messages = [
			{ role: "user", content: "make a plan" },
			plan,
			{ role: "user", content: "process it" },
			{ role: "assistant", content: [{ type: "thinking", thinking: "working" }] },
		];

		expect(analyzeAssistantTurn(plan, messages, true)).toMatchObject({
			hasFinalResponse: true,
			isCurrentTurn: false,
			isFinalAssistant: true,
		});
	});

	it("keeps background Subagent work active between agent turns", () => {
		const launch = { role: "assistant", content: [{ type: "toolCall", id: "tool-call-kqpvqh", name: "subagent" }] };
		const waiting = { role: "assistant", content: [{ type: "text", text: "Waiting for subagent." }] };
		const messages = [
			{ role: "user", content: "task" },
			launch,
			{ role: "toolResult", toolCallId: "tool-call-kqpvqh", content: "started" },
			waiting,
		];

		expect(analyzeAssistantTurn(launch, messages, false)).toMatchObject({ hasRunningSubagent: true, shouldCollapse: false });
	});

	it("does not collapse turns without reasoning or tools", () => {
		const final = { role: "assistant", content: [{ type: "text", text: "answer" }] };
		const messages = [{ role: "user", content: "question" }, final];

		expect(analyzeAssistantTurn(final, messages, false)).toMatchObject({ hasCoT: false, shouldCollapse: false });
	});

	it("keeps the last substantive assistant as final when a trailing placeholder is empty", () => {
		const reasoning = { role: "assistant", content: [{ type: "thinking", thinking: "Summarizing" }] };
		const final = { role: "assistant", content: [{ type: "text", text: "Final answer" }] };
		const placeholder = { role: "assistant", content: [] };
		const messages = [{ role: "user", content: "question" }, reasoning, final, placeholder];

		expect(analyzeAssistantTurn(final, messages, false)).toMatchObject({
			hasFinalResponse: true,
			isFinalAssistant: true,
			shouldCollapse: true,
		});
		expect(analyzeAssistantTurn(placeholder, messages, false).isFinalAssistant).toBe(false);
	});
});

describe("desktop subagent progress", () => {
	it("stays running after the background launch tool result", () => {
		const part = { id: "tool-call-kqpvqh", name: "subagent" };
		const messages = [{ role: "toolResult", toolCallId: part.id, content: "Subagent Job kqpvqh started" }];

		expect(getSubagentProgress(part, messages)).toEqual({ jobId: "kqpvqh", state: "running" });
	});

	it("completes only when the matching subagent result arrives", () => {
		const part = { id: "tool-call-kqpvqh", name: "subagent" };
		const messages = [
			{ role: "toolResult", toolCallId: part.id, content: "Subagent Job kqpvqh started" },
			{ role: "custom", customType: "subagent_result", content: [{ type: "text", text: "[Subagent Job kqpvqh finished]\n\nDone" }] },
		];

		expect(getSubagentProgress(part, messages)).toEqual({ jobId: "kqpvqh", state: "completed" });
	});

	it("reports completed Subagent duration when message timestamps are available", () => {
		const part = { type: "toolCall", id: "tool-call-kqpvqh", name: "subagent" };
		const messages = [
			{ role: "assistant", timestamp: "2026-08-09T08:00:00.000Z", content: [part] },
			{ role: "custom", customType: "subagent_result", timestamp: "2026-08-09T08:00:03.450Z", content: "[Subagent Job kqpvqh finished]\n\nDone" },
		];

		expect(getSubagentProgress(part, messages)).toEqual({ jobId: "kqpvqh", state: "completed", durationMs: 3_450 });
	});

	it("reports launch failures", () => {
		const part = { id: "tool-call-kqpvqh", name: "subagent" };
		const messages = [{ role: "toolResult", toolCallId: part.id, isError: true, content: "spawn failed" }];

		expect(getSubagentProgress(part, messages)).toEqual({ jobId: "kqpvqh", state: "failed" });
	});

	it("counts distinct running subagents", () => {
		const messages = [
			{ role: "assistant", content: [
				{ type: "toolCall", id: "tool-call-first1", name: "subagent" },
				{ type: "toolCall", id: "tool-call-second", name: "subagent" },
			] },
			{ role: "custom", customType: "subagent_result", content: "[Subagent Job first1 finished]\n\nDone" },
		];

		expect(getRunningSubagentCount(messages)).toBe(1);
	});

	it("derives running Subagents from messages when session status is missing", () => {
		const messages = [{ role: "assistant", content: [
			{ type: "toolCall", id: "tool-call-first1", name: "subagent" },
			{ type: "toolCall", id: "tool-call-second", name: "subagent" },
		] }];

		expect(getRunningSubagentIds(messages, [])).toEqual(["first1", "second"]);
	});

	it("shows reported Subagents before their tool call message arrives", () => {
		expect(getRunningSubagentIds([], ["early1"])).toEqual(["early1"]);
	});

	it("removes completed Subagents even when session status is stale", () => {
		const messages = [
			{ role: "assistant", content: [
				{ type: "toolCall", id: "tool-call-first1", name: "subagent" },
				{ type: "toolCall", id: "tool-call-second", name: "subagent" },
			] },
			{ role: "custom", customType: "subagent_result", content: "[Subagent Job first1 finished]\n\nDone" },
		];

		expect(getRunningSubagentIds(messages, ["first1", "second"])).toEqual(["second"]);
	});

	it("queues desktop messages while streaming or while a subagent is running", () => {
		const running = [{ role: "assistant", content: [{ type: "toolCall", id: "tool-call-kqpvqh", name: "subagent" }] }];
		const completed = [...running, { role: "custom", customType: "subagent_result", content: "[Subagent Job kqpvqh finished]\n\nDone" }];

		expect(shouldQueueDesktopMessage(running, false)).toBe(true);
		expect(shouldQueueDesktopMessage(completed, false)).toBe(false);
		expect(shouldQueueDesktopMessage([], true)).toBe(true);
	});

	it("tracks native spawn_agent sync completion with structured result payload", () => {
		const part = { type: "toolCall", id: "tool-call-spwn01", name: "spawn_agent", arguments: { agent: "planner", task: "Plan architecture", mode: "sync" } };
		const launchMessage = { role: "assistant", timestamp: "2026-08-15T00:00:00.000Z", content: [part] };
		const resultPayload = JSON.stringify({
			status: "success",
			agent: "planner",
			agentId: "planner-abc123",
			result: "Architecture plan generated",
		});
		const resultMessage = { role: "toolResult", toolCallId: part.id, timestamp: "2026-08-15T00:00:02.500Z", content: [{ type: "text", text: resultPayload }] };
		const messages = [launchMessage, resultMessage];

		expect(getSubagentProgress(part, messages)).toEqual({
			jobId: "spwn01",
			state: "completed",
			durationMs: 2500,
		});
	});

	it("tracks native spawn_agent sync error payload as failed", () => {
		const part = { type: "toolCall", id: "tool-call-spwn02", name: "spawn_agent", arguments: { agent: "implementer", task: "Write code", mode: "sync" } };
		const launchMessage = { role: "assistant", timestamp: "2026-08-15T00:00:00.000Z", content: [part] };
		const resultPayload = JSON.stringify({
			status: "error",
			agent: "implementer",
			error: "Task exceeded max depth",
		});
		const resultMessage = { role: "toolResult", toolCallId: part.id, timestamp: "2026-08-15T00:00:01.000Z", content: [{ type: "text", text: resultPayload }] };
		const messages = [launchMessage, resultMessage];

		expect(getSubagentProgress(part, messages)).toEqual({
			jobId: "spwn02",
			state: "failed",
			durationMs: 1000,
		});
	});

	it("keeps turn open when spawn_agent is actively running in background", () => {
		const launch = {
			role: "assistant",
			content: [{
				type: "toolCall",
				id: "tool-call-bg0001",
				name: "spawn_agent",
				arguments: { agent: "verifier", task: "Run test matrix", mode: "async" },
			}],
		};
		const startedResult = {
			role: "toolResult",
			toolCallId: "tool-call-bg0001",
			content: JSON.stringify({ status: "started", agent: "verifier" }),
		};
		const intermediateText = { role: "assistant", content: [{ type: "text", text: "Verifier subagent launched." }] };
		const messages = [
			{ role: "user", content: "Test the build" },
			launch,
			startedResult,
			intermediateText,
		];

		expect(analyzeAssistantTurn(launch, messages, false)).toMatchObject({
			hasRunningSubagent: true,
			shouldCollapse: false,
		});
	});
});
