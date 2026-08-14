import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryCoordinator, resolveMemoryProjectIdentity, type MemoryCoordinatorOptions } from "../src/core/memory-coordinator.ts";

const roots: string[] = [];
function coordinator(overrides: Partial<MemoryCoordinatorOptions> = {}) {
	const root = mkdtempSync(join(tmpdir(), "metis-memory-"));
	roots.push(root);
	return new MemoryCoordinator({ agentDir: join(root, "agent"), cwd: root, trusted: () => true, settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2 }), ...overrides });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("MemoryCoordinator", () => {
	it("keeps advisory records scoped and never promotes them to privileged instructions", async () => {
		const memory = coordinator();
		memory.recordCheckpoint({ sessionId: "session-a", reason: "completed", timestamp: new Date().toISOString(), verification: ["npm test passes in this project"] });
		await memory.run(true);
		const records = memory.search("npm test");
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ scope: "project", kind: "procedure", status: "active" });
		const recalled = memory.searchAndTouch("npm test");
		expect(recalled[0]?.lastUsedAt).toBeTruthy();
	});

	it("requires explicit reset confirmation and supports deletion", async () => {
		const memory = coordinator();
		memory.recordCheckpoint({ sessionId: "session-a", reason: "error", timestamp: new Date().toISOString(), errors: ["fixture failure is reproducible"] });
		await memory.run(true);
		const [record] = memory.search("fixture");
		expect(() => memory.reset("no")).toThrow("RESET_MEMORY");
		expect(memory.forget(record.id)).toBe(true);
		expect(memory.search("fixture")).toEqual([]);
	});

	it("uses a stable project identity without leaking raw checkout paths", () => {
		const identity = resolveMemoryProjectIdentity(process.cwd());
		expect(identity.projectKey).toMatch(/^[a-f0-9]{20}$/);
		expect(identity.checkoutKey).toMatch(/^[a-f0-9]{20}$/);
	});

	it("records extraction fallback details and force-runs every pending job", async () => {
		const memory = coordinator({ extract: async () => ({ candidates: [], failureReason: "model unavailable" }) });
		for (let index = 0; index < 4; index += 1) {
			memory.recordCheckpoint({ sessionId: `session-${index}`, reason: "completed", timestamp: new Date().toISOString(), verification: [`command ${index} completed successfully`] });
		}
		const state = await memory.run(true);
		expect(state).toMatchObject({ pendingJobs: 0, lastRunProcessed: 4, lastRunAdded: 4, fallbackUsed: true, lastExtractionMethod: "fallback", modelFailureReason: "model unavailable" });
	});

	it("rejects low-confidence model candidates without falling back over valid model output", async () => {
		const memory = coordinator({ extract: async () => ({ candidates: [{ scope: "project", kind: "fact", content: "Uncertain project fact from model", confidence: 0.2 }] }) });
		memory.recordCheckpoint({ sessionId: "session-low", reason: "completed", timestamp: new Date().toISOString(), recentTurn: [{ role: "user", content: "temporary request" }] });
		const state = await memory.run(true);
		expect(state).toMatchObject({ lastRunProcessed: 1, lastRunAdded: 0, lastRunSkipped: 1, fallbackUsed: false, lastExtractionMethod: "model" });
	});

	it("supports repeated Chinese searches, scopes results, and enforces each result limit", async () => {
		const memory = coordinator({
			extract: async () => ({ candidates: [
				{ scope: "global", kind: "preference", content: "用户偏好使用中文输出说明", confidence: 0.95 },
				{ scope: "project", kind: "fact", content: "项目验证流程使用中文关键词", confidence: 0.9 },
				{ scope: "checkout", kind: "procedure", content: "当前分支验证流程包含中文检查", confidence: 0.9 },
			] }),
		});
		memory.recordCheckpoint({ sessionId: "session-cn", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);
		expect(memory.searchAndTouch("中文", 1)).toHaveLength(1);
		const refined = memory.searchAndTouch("验证 流程", 20);
		expect(refined).toHaveLength(2);
		expect(refined.every((record) => record.lastUsedAt)).toBe(true);
	});

	it("aborts an in-flight extraction without consuming its pending checkpoint", async () => {
		let observedAbort = false;
		const memory = coordinator({
			extract: async (_checkpoint, signal) => await new Promise((_, reject) => {
				signal?.addEventListener("abort", () => {
					observedAbort = true;
					reject(new Error("aborted"));
				}, { once: true });
			}),
		});
		memory.recordCheckpoint({ sessionId: "session-abort", reason: "completed", timestamp: new Date().toISOString() });
		const running = memory.run(true);
		await Promise.resolve();
		memory.abort();
		const state = await running;
		expect(observedAbort).toBe(true);
		expect(state).toMatchObject({ phase: "retry_wait", pendingJobs: 1 });
	});

	it("does not return records whose last use and update are outside TTL", async () => {
		const memory = coordinator({ settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2, maxUnusedDays: 1 }) });
		memory.recordCheckpoint({ sessionId: "session-old", reason: "completed", timestamp: new Date().toISOString(), verification: ["expired workflow command completed"] });
		await memory.run(true);
		(memory as any).db.prepare("UPDATE memory_records SET updated_at = ?, last_used_at = NULL").run(new Date(0).toISOString());
		expect(memory.search("expired workflow")).toEqual([]);
	});
});
