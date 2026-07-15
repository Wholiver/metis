import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/metis-agent-core";
import { fauxAssistantMessage } from "@earendil-works/metis-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./suite/harness.ts";

type WorkingMemorySessionInternals = {
	_handleAgentEvent: (event: unknown) => Promise<void>;
	_refreshCurrentWorkingMemory: () => void;
	_workingMemoryNeedsRefresh: boolean;
};

describe("AgentSession working memory", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function create(settings?: { workingMemory?: { enabled?: boolean; checkpointInterval?: number } }) {
		const harness = await createHarness({ settings });
		harnesses.push(harness);
		return harness;
	}

	async function recordToolCall(
		harness: Harness,
		name: string,
		args: Record<string, unknown> = {},
		isError = false,
	): Promise<void> {
		await harness.session.agent.afterToolCall?.({
			toolCall: { id: `call-${name}`, name, arguments: args },
			args,
			result: { content: [{ type: "text", text: isError ? "failed" : "ok" }], details: undefined },
			isError,
		} as any);
	}

	async function prepare(harness: Harness, messages: AgentMessage[] = []) {
		return harness.session.agent.prepareNextTurnWithContext?.({
			context: {
				systemPrompt: harness.session.agent.state.systemPrompt,
				messages,
				tools: harness.session.agent.state.tools,
			},
		} as any);
	}

	function reminders(messages: readonly AgentMessage[] | undefined): AgentMessage[] {
		return (messages ?? []).filter(
			(message) => message.role === "custom" && message.customType === "working_memory_reminder",
		);
	}

	it("adds a transient reminder on the configured non-log tool-call boundary", async () => {
		const harness = await create({ workingMemory: { checkpointInterval: 8 } });

		for (let index = 0; index < 7; index++) await recordToolCall(harness, "read");
		expect(reminders((await prepare(harness))?.context.messages)).toHaveLength(0);

		await recordToolCall(harness, "bash");
		const prepared = await prepare(harness);
		const reminder = reminders(prepared?.context.messages);
		expect(reminder).toHaveLength(1);
		expect(getMessageText(reminder[0])).toContain("8 non-log tool calls");
	});

	it("resets after a successful write but not after read", async () => {
		const harness = await create({ workingMemory: { checkpointInterval: 2 } });

		await recordToolCall(harness, "read");
		await recordToolCall(harness, "bash");
		await recordToolCall(harness, "log", { action: "read" });
		expect(reminders((await prepare(harness))?.context.messages)).toHaveLength(1);

		await recordToolCall(harness, "log", { action: "checkpoint", content: "state" });
		expect(reminders((await prepare(harness))?.context.messages)).toHaveLength(0);
	});

	it("adds an immediate material-error reminder and does not duplicate it", async () => {
		const harness = await create({ workingMemory: { checkpointInterval: 8 } });
		await recordToolCall(harness, "bash", {}, true);

		const first = await prepare(harness);
		const firstReminders = reminders(first?.context.messages);
		expect(firstReminders).toHaveLength(1);
		expect(getMessageText(firstReminders[0])).toContain("diagnose it first");
		expect(getMessageText(firstReminders[0])).toContain("expected negative-test failures");

		const second = await prepare(harness, first?.context.messages ?? []);
		expect(reminders(second?.context.messages)).toHaveLength(0);

		for (let index = 0; index < 7; index++) await recordToolCall(harness, "read");
		expect(reminders((await prepare(harness))?.context.messages)).toHaveLength(1);
	});

	it("keeps reminders out of session persistence", async () => {
		const harness = await create({ workingMemory: { checkpointInterval: 1 } });
		const entriesBefore = harness.sessionManager.getEntries().length;

		await recordToolCall(harness, "read");
		const prepared = await prepare(harness);

		expect(reminders(prepared?.context.messages)).toHaveLength(1);
		expect(harness.sessionManager.getEntries()).toHaveLength(entriesBefore);
		expect(reminders(harness.session.messages)).toHaveLength(0);
	});

	it("injects latest checkpoint and subsequent errors on initial or resumed refresh", async () => {
		const harness = await create();
		const sessionId = harness.sessionManager.getSessionId();
		mkdirSync(join(harness.tempDir, ".temp"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, ".temp", `${sessionId}_log.md`),
			[
				"## [2026-01-01 10:00] Checkpoint",
				"Goal: resume task",
				"## [2026-01-01 10:01] Error",
				"Residual risk: none",
			].join("\n"),
		);
		const internals = harness.session as unknown as WorkingMemorySessionInternals;
		const entriesBefore = harness.sessionManager.getEntries().length;

		expect(internals._workingMemoryNeedsRefresh).toBe(true);
		internals._refreshCurrentWorkingMemory();

		const recovered = harness.session.messages.filter(
			(message) => message.role === "custom" && message.customType === "working_memory",
		);
		expect(recovered).toHaveLength(1);
		expect(getMessageText(recovered[0])).toContain("Goal: resume task");
		expect(getMessageText(recovered[0])).toContain("Residual risk: none");
		expect(recovered[0]).toMatchObject({ display: false });
		expect(harness.sessionManager.getEntries()).toHaveLength(entriesBefore);
	});

	it("marks working memory for refresh after an interrupted response", async () => {
		const harness = await create();
		const internals = harness.session as unknown as WorkingMemorySessionInternals;
		internals._refreshCurrentWorkingMemory();
		expect(internals._workingMemoryNeedsRefresh).toBe(false);
		const model = harness.getModel();
		const assistant = {
			...fauxAssistantMessage("interrupted"),
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "aborted" as const,
		};

		await internals._handleAgentEvent({ type: "message_end", message: assistant });

		expect(internals._workingMemoryNeedsRefresh).toBe(true);
	});

	it("can disable working-memory reminders and recovery", async () => {
		const harness = await create({ workingMemory: { enabled: false, checkpointInterval: 1 } });
		await recordToolCall(harness, "read");

		expect(reminders((await prepare(harness))?.context.messages)).toHaveLength(0);
	});
});
