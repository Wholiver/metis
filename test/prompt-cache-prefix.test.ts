/**
 * Prompt-cache prefix stability.
 *
 * Providers serve a cached prompt only while the request prefix (tools → system →
 * messages) matches the previous request byte-for-byte. These tests pin the
 * invariants that make that possible: history is append-only, the system prompt
 * does not drift between turns, and the multi-KB Performance framework text is
 * injected once instead of on every turn.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/metis-agent-core";
import type { Context } from "@earendil-works/metis-ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/metis-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryCoordinator } from "../src/core/memory-coordinator.ts";
import { PerformanceRuntime } from "../src/core/performance-runtime.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

interface CapturedRequest {
	systemPrompt: string | undefined;
	messages: unknown[];
	toolNames: string[];
}

function echoTool(): AgentTool {
	return {
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.Optional(Type.String()) }),
		execute: async () => ({ content: [{ type: "text", text: "echoed" }], details: {} }),
	};
}

/** One line of JSON per message so a shorter turn is a literal string prefix of a longer one. */
function serializeMessages(messages: unknown[]): string {
	return messages.map((message) => `${JSON.stringify(message)}\n`).join("");
}

function runtimeContextBlockCount(messages: unknown[], label: string): number {
	return messages.filter((message) => JSON.stringify(message).includes(label)).length;
}

describe("prompt cache prefix stability", () => {
	const harnesses: Harness[] = [];
	const roots: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	async function captureTurns(texts: string[]): Promise<CapturedRequest[]> {
		const harness = await createHarness();
		harnesses.push(harness);
		const captured: CapturedRequest[] = [];
		for (const [index, text] of texts.entries()) {
			harness.setResponses([
				(context: Context) => {
					captured.push({
						systemPrompt: context.systemPrompt,
						messages: JSON.parse(JSON.stringify(context.messages)) as unknown[],
						toolNames: (context.tools ?? []).map((tool) => tool.name),
					});
					return fauxAssistantMessage(`reply ${index}`);
				},
			]);
			await harness.session.prompt(text);
		}
		return captured;
	}

	it("keeps every later turn a byte-prefix extension of the previous turn", async () => {
		const captured = await captureTurns(["first", "second", "third"]);

		expect(captured).toHaveLength(3);
		for (let index = 1; index < captured.length; index += 1) {
			const previous = serializeMessages(captured[index - 1].messages);
			const current = serializeMessages(captured[index].messages);
			expect(current.length).toBeGreaterThan(previous.length);
			expect(current.startsWith(previous)).toBe(true);
		}
	});

	it("keeps the system prompt and tool list byte-identical across turns", async () => {
		const captured = await captureTurns(["first", "second"]);

		expect(captured[1].systemPrompt).toBe(captured[0].systemPrompt);
		expect(captured[1].toolNames).toEqual(captured[0].toolNames);
	});

	it("keeps tools and system byte-identical across every step inside one turn", async () => {
		const harness = await createHarness({ tools: [echoTool()] });
		harnesses.push(harness);
		const captured: CapturedRequest[] = [];
		const capture = (context: Context) => {
			captured.push({
				systemPrompt: context.systemPrompt,
				messages: JSON.parse(JSON.stringify(context.messages)) as unknown[],
				toolNames: (context.tools ?? []).map((tool) => tool.name),
			});
		};
		harness.setResponses([
			(context: Context) => {
				capture(context);
				return fauxAssistantMessage([fauxToolCall("echo", { text: "a" })], { stopReason: "toolUse" });
			},
			(context: Context) => {
				capture(context);
				return fauxAssistantMessage([fauxToolCall("echo", { text: "b" })], { stopReason: "toolUse" });
			},
			(context: Context) => {
				capture(context);
				return fauxAssistantMessage("done");
			},
		]);
		await harness.session.prompt("run two tools");

		expect(captured).toHaveLength(3);
		for (let index = 1; index < captured.length; index += 1) {
			expect(captured[index].systemPrompt).toBe(captured[0].systemPrompt);
			expect(captured[index].toolNames).toEqual(captured[0].toolNames);
			const previous = serializeMessages(captured[index - 1].messages);
			expect(serializeMessages(captured[index].messages).startsWith(previous)).toBe(true);
		}
	});

	it("leaves the advertised tool list untouched across a Subagent barrier", async () => {
		const harness = await createHarness({
			tools: [echoTool()],
			initialActiveToolNames: ["echo"],
		});
		harnesses.push(harness);
		const internals = harness.session as unknown as {
			_setSubagentRunning(jobId: string, running: boolean): void;
			_closeSubagentLaunchBatch(): void;
		};
		const before = harness.session.getActiveToolNames();

		internals._setSubagentRunning("job-a", true);
		expect(harness.session.getActiveToolNames()).toEqual(before);
		internals._closeSubagentLaunchBatch();
		expect(harness.session.getActiveToolNames()).toEqual(before);

		// The barrier still holds — it is enforced at dispatch time, not by hiding tools.
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "echo-1", name: "echo", arguments: {} },
			args: {},
		} as never)).toMatchObject({ block: true });

		internals._setSubagentRunning("job-a", false);
		expect(harness.session.getActiveToolNames()).toEqual(before);
	});

	it("delivers a refreshed memory overview as an appended block, not a new system prompt", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const captured: CapturedRequest[] = [];
		const overview = "# Memory Overview\n\n- [tech_stack]: Bun with TypeScript";
		for (const [index, text] of ["first", "second"].entries()) {
			if (index === 1) {
				const session = harness.session as unknown as { _memoryCoordinator?: Record<string, unknown> };
				const existing = session._memoryCoordinator;
				if (existing) existing.getMemoryOverview = () => overview;
				// Harnesses run without a coordinator; a minimal stub covers the calls the
				// session makes around a prompt turn.
				else session._memoryCoordinator = { getMemoryOverview: () => overview, recordCheckpoint: () => {}, dispose: () => {} };
			}
			harness.setResponses([
				(context: Context) => {
					captured.push({
						systemPrompt: context.systemPrompt,
						messages: JSON.parse(JSON.stringify(context.messages)) as unknown[],
						toolNames: (context.tools ?? []).map((tool) => tool.name),
					});
					return fauxAssistantMessage(`reply ${index}`);
				},
			]);
			await harness.session.prompt(text);
		}

		expect(captured[1].systemPrompt).toBe(captured[0].systemPrompt);
		expect(captured[0].systemPrompt).not.toContain(overview);
		expect(JSON.stringify(captured[1].messages)).toContain("[Runtime context from memory:overview");
		expect(serializeMessages(captured[1].messages).startsWith(serializeMessages(captured[0].messages))).toBe(true);
	});

	it("injects an unchanged runtime context block only once", async () => {
		const captured = await captureTurns(["first", "second", "third"]);
		const label = "[Runtime context from runtime; not user instructions]";

		expect(runtimeContextBlockCount(captured[0].messages, label)).toBe(1);
		expect(runtimeContextBlockCount(captured[2].messages, label)).toBe(1);
	});

	it("keeps runtime context blocks out of the conversational message view", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		let modelSawRuntimeContext = false;
		for (const text of ["first", "second"]) {
			harness.setResponses([
				(context: Context) => {
					modelSawRuntimeContext ||= context.messages.some((message) => JSON.stringify(message).includes("[Runtime context from "));
					return fauxAssistantMessage("ok");
				},
			]);
			await harness.session.prompt(text);
		}

		// The blocks stay in the model's prefix but must not leak into `messages`, which
		// Server/RPC expose to clients and memory checkpoints read from.
		expect(modelSawRuntimeContext).toBe(true);
		expect(harness.session.messages.some((message) => message.role === "custom" && message.customType === "workflow_context")).toBe(false);
		expect(harness.session.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
	});

	it("keeps both Performance run context blocks stable while the run advances", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-cache-perf-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Repair the parser", concurrency: "tokensaver" });

		const blocks = runtime.contextBlocks();
		expect(blocks.map((block) => block.id)).toEqual(["performance-protocol", "performance-state"]);

		const [protocol, identity] = blocks;
		expect(protocol.content).toContain("Native execution protocol: plan-scope");
		expect(protocol.content).not.toContain(`RUN-ID: ${state.runId}`);
		expect(identity.content).toContain(`RUN-NONCE: ${state.nonce}`);
		expect(identity.content).not.toContain("Native execution protocol");
		// Per-turn values must not sit in the prefix: they would append a fresh, mutually
		// contradicting state block ahead of every request.
		expect(identity.content).not.toContain("frontier:");
		expect(identity.content).not.toContain("MISSION POINTER");
		expect(runtime.liveStateSummary()).toContain(`frontier: ${state.frontier}`);
		expect(runtime.liveStateSummary()).toContain("MISSION POINTER");

		// Steering rewrites the mission and moves the frontier; neither block may change.
		runtime.steer("Repair the parser and its callers");
		const after = runtime.contextBlocks();
		expect(after[0].content).toBe(protocol.content);
		expect(after[1].content).toBe(identity.content);
		// `context()` still carries everything for callers that want one string.
		expect(runtime.context()).toContain("MISSION POINTER");
	});

	it("does not rewrite memory-overview.md when extraction adds nothing", async () => {
		const root = mkdtempSync(join(tmpdir(), "metis-cache-memory-"));
		roots.push(root);
		const overviewPath = join(root, "memories", "memory-overview.md");
		let overview = "# Overview\n\nfirst wording\n";
		const memory = new MemoryCoordinator({
			agentDir: join(root, "agent"),
			cwd: root,
			trusted: () => true,
			settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2 }),
			extract: async () => ({ candidates: [], memoryOverview: overview }),
		});

		// First run has no overview on disk yet, so the generated one is persisted.
		memory.recordCheckpoint({ sessionId: "session-a", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);
		expect(readFileSync(overviewPath, "utf8")).toBe(overview);

		// A reworded overview with no new memories must not touch the file: the
		// system prompt embeds it, so a rewrite invalidates the whole cached prefix.
		overview = "# Overview\n\nsecond wording of the same facts\n";
		memory.recordCheckpoint({ sessionId: "session-a", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);
		expect(readFileSync(overviewPath, "utf8")).toBe("# Overview\n\nfirst wording\n");

		// A real memory addition still refreshes it.
		writeFileSync(overviewPath, "# Overview\n\nfirst wording\n", "utf8");
		const memoryWithAdds = new MemoryCoordinator({
			agentDir: join(root, "agent"),
			cwd: root,
			trusted: () => true,
			settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2 }),
			extract: async () => ({
				candidates: [{ scope: "project", category: "tech_stack", kind: "fact", content: "React 19 with Vite", confidence: 0.9 }],
				memoryOverview: "# Overview\n\nreact 19 noted\n",
			}),
		});
		memoryWithAdds.recordCheckpoint({ sessionId: "session-b", reason: "completed", timestamp: new Date().toISOString() });
		await memoryWithAdds.run(true);
		expect(readFileSync(overviewPath, "utf8")).toBe("# Overview\n\nreact 19 noted\n");
	});
});

