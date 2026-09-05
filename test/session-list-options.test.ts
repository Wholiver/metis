import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearSessionInfoCache, SessionManager } from "../src/core/session-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const TIMESTAMP = new Date(2026, 7, 4, 12).getTime();

function messageEntry(id: string, parentId: string | null, role: "user" | "assistant", text: string): string {
	const base = {
		type: "message",
		id,
		parentId,
		timestamp: new Date(TIMESTAMP).toISOString(),
	};
	const message =
		role === "user"
			? { role, content: [{ type: "text", text }], timestamp: TIMESTAMP }
			: {
					role,
					content: [{ type: "text", text }],
					api: "openai-completions",
					provider: "openai",
					model: "test",
					usage: {
						input: 10,
						output: 20,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 30,
						cost: { total: 0.5 },
					},
					stopReason: "stop",
					timestamp: TIMESTAMP,
				};
	return JSON.stringify({ ...base, message });
}

function writeSessionFile(dir: string, fileName: string): string {
	const filePath = join(dir, fileName);
	const lines = [
		JSON.stringify({
			type: "session",
			id: fileName.replace(/\.jsonl$/, ""),
			version: 3,
			timestamp: new Date(TIMESTAMP).toISOString(),
			cwd: "/tmp",
		}),
		messageEntry("user-1", null, "user", "first user question"),
		messageEntry("assistant-1", "user-1", "assistant", "assistant reply"),
		messageEntry("user-2", "assistant-1", "user", "second user question"),
	];
	writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
	return filePath;
}

describe("SessionListOptions.includeMessageText", () => {
	let sessionDir: string;

	beforeAll(() => initTheme("dark"));

	beforeEach(() => {
		clearSessionInfoCache();
		sessionDir = mkdtempSync(join(tmpdir(), "metis-list-options-"));
	});

	it("omits full message text by default while keeping listing fields intact", async () => {
		writeSessionFile(sessionDir, "default.jsonl");

		const [session] = await SessionManager.listAll(sessionDir);

		expect(session).toBeDefined();
		// The heavy field is what Desktop's sidebar refetched on every sync; the rest of the
		// listing must stay complete without it.
		expect(session!.allMessagesText).toBe("");
		expect(session!.firstMessage).toBe("first user question");
		expect(session!.lastMessage).toBe("second user question");
		expect(session!.messageCount).toBe(3);
		expect(session!.dailyActivity).toEqual([
			{
				date: "2026-08-04",
				userMessages: 2,
				modelCalls: 1,
				toolCalls: 0,
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalTokens: 30,
				cost: 0.5,
			},
		]);
	});

	it("populates full message text when the resume picker asks for it", async () => {
		writeSessionFile(sessionDir, "with-text.jsonl");

		const [session] = await SessionManager.listAll(sessionDir, undefined, { includeMessageText: true });

		expect(session!.allMessagesText).toBe("first user question assistant reply second user question");
	});

	it("does not serve a text-free cache entry to a caller that needs message text", async () => {
		writeSessionFile(sessionDir, "upgrade.jsonl");

		const [listed] = await SessionManager.listAll(sessionDir);
		expect(listed!.allMessagesText).toBe("");

		const [searched] = await SessionManager.listAll(sessionDir, undefined, { includeMessageText: true });
		expect(searched!.allMessagesText).toBe("first user question assistant reply second user question");
	});

	it("revalidates cached listings when a session file grows", async () => {
		const filePath = writeSessionFile(sessionDir, "appended.jsonl");

		const [before] = await SessionManager.listAll(sessionDir);
		expect(before!.messageCount).toBe(3);

		appendFileSync(filePath, `${messageEntry("user-3", "user-2", "user", "third user question")}\n`, "utf8");

		const [after] = await SessionManager.listAll(sessionDir);
		expect(after!.messageCount).toBe(4);
		expect(after!.lastMessage).toBe("third user question");
		expect(after!.dailyActivity[0]?.userMessages).toBe(3);
	});
});

