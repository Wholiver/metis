import { writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionHeader } from "../src/core/session-manager.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createSessionFile(path: string): void {
	const header: SessionHeader = {
		type: "session",
		id: "test-session",
		version: 3,
		timestamp: new Date(0).toISOString(),
		cwd: "/tmp",
	};
	writeFileSync(path, `${JSON.stringify(header)}\n`, "utf8");

	// SessionManager only persists once it has seen at least one assistant message.
	// Add a minimal assistant entry so subsequent appends are persisted.
	const mgr = SessionManager.open(path);
	mgr.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "hi" }],
		api: "openai-completions",
		provider: "openai",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	});
}

describe("SessionInfo.modified", () => {
	beforeAll(() => initTheme("dark"));

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uses last user/assistant message timestamp instead of file mtime", async () => {
		const filePath = join(tmpdir(), `metis-session-${Date.now()}-modified.jsonl`);
		createSessionFile(filePath);

		const before = await stat(filePath);
		// Ensure the file mtime can differ from our message timestamp even on coarse filesystems.
		await new Promise((r) => setTimeout(r, 10));

		const mgr = SessionManager.open(filePath);
		const msgTime = Date.now();
		mgr.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "later" }],
			api: "openai-completions",
			provider: "openai",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: msgTime,
		});

		const sessions = await SessionManager.list("/tmp", dirname(filePath));
		const s = sessions.find((x) => x.path === filePath);
		expect(s).toBeDefined();
		expect(s!.modified.getTime()).toBe(msgTime);
		expect(s!.modified.getTime()).not.toBe(before.mtime.getTime());
	});

	it("collects daily user activity and assistant token usage in one listing pass", async () => {
		const filePath = join(tmpdir(), `metis-session-${Date.now()}-daily-activity.jsonl`);
		const timestamp = new Date(2026, 7, 4, 12).getTime();
		const date = "2026-08-04";
		writeFileSync(filePath, `${[
			{ type: "session", id: "daily-session", version: 3, timestamp: new Date(timestamp).toISOString(), cwd: "/tmp" },
			{ type: "message", id: "user", parentId: null, timestamp: new Date(timestamp).toISOString(), message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp } },
			{ type: "message", id: "assistant", parentId: "user", timestamp: new Date(timestamp).toISOString(), message: {
				role: "assistant", content: [{ type: "text", text: "done" }, { type: "toolCall", id: "call-1", name: "read", arguments: {} }], api: "openai-completions", provider: "openai", model: "test",
				usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 1, totalTokens: 36, cost: { total: 0.25 } },
				stopReason: "stop", timestamp,
			} },
		].map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

		const sessions = await SessionManager.list("/tmp", dirname(filePath));
		const activity = sessions.find((item) => item.path === filePath)?.dailyActivity;

		expect(activity).toEqual([{
			date,
			userMessages: 1,
			modelCalls: 1,
			toolCalls: 1,
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 1,
			totalTokens: 36,
			cost: 0.25,
		}]);
	});
});
