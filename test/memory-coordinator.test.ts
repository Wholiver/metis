import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryCoordinator, resolveMemoryProjectIdentity, type MemoryCandidate, type MemoryCoordinatorOptions } from "../src/core/memory-coordinator.ts";

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
		let waitForAbort = false;
		const memory = coordinator({
			extract: async (_checkpoint, signal) => waitForAbort ? await new Promise((_, reject) => {
				signal?.addEventListener("abort", () => {
					observedAbort = true;
					reject(new Error("aborted"));
				}, { once: true });
			}) : [{ scope: "project", kind: "fact", content: "Previously extracted durable fact", confidence: 0.9 }],
		});
		memory.recordCheckpoint({ sessionId: "session-before-abort", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);
		expect(memory.getState()).toMatchObject({ lastRunProcessed: 1, lastRunAdded: 1 });

		waitForAbort = true;
		memory.recordCheckpoint({ sessionId: "session-abort", reason: "completed", timestamp: new Date().toISOString() });
		const running = memory.run(true);
		await Promise.resolve();
		memory.abort();
		await expect(running).rejects.toThrow("aborted");
		const state = memory.getState();
		expect(observedAbort).toBe(true);
		expect(state).toMatchObject({ phase: "retry_wait", pendingJobs: 1, lastRunProcessed: 0, lastRunAdded: 0, lastRunSkipped: 0, lastExtractionMethod: "none", fallbackUsed: false, error: "aborted" });
	});

	it("rejects a duplicate manual run instead of reporting stale success", async () => {
		let release: (() => void) | undefined;
		const memory = coordinator({ extract: async () => await new Promise<MemoryCandidate[]>((resolve) => { release = () => resolve([]); }) });
		memory.recordCheckpoint({ sessionId: "session-running", reason: "completed", timestamp: new Date().toISOString() });
		const running = memory.run(true);
		await Promise.resolve();
		await expect(memory.run(true)).rejects.toThrow("already running");
		release?.();
		await running;
	});

	it("does not return records whose last use and update are outside TTL", async () => {
		const memory = coordinator({ settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2, maxUnusedDays: 1 }) });
		memory.recordCheckpoint({ sessionId: "session-old", reason: "completed", timestamp: new Date().toISOString(), verification: ["expired workflow command completed"] });
		await memory.run(true);
		(memory as any).db.prepare("UPDATE memory_records SET updated_at = ?, last_used_at = NULL").run(new Date(0).toISOString());
		expect(memory.search("expired workflow")).toEqual([]);
	});

	it("merges superseded records and consolidates source sessions", async () => {
		const memory = coordinator({
			extract: async () => ({
				candidates: [
					{ scope: "project", category: "tech_stack", kind: "fact", content: "Initial project fact about Node version", confidence: 0.9 },
				],
			}),
		});
		memory.recordCheckpoint({ sessionId: "session-1", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);
		const [initial] = memory.search("Node version");
		expect(initial).toBeTruthy();
		expect(initial.sourceSessionIds).toEqual(["session-1"]);
		expect(initial.category).toBe("tech_stack");

		// Second run: model provides supersedes
		const memory2 = coordinator({
			extract: async () => ({
				candidates: [
					{
						scope: "project",
						category: "tech_stack",
						kind: "fact",
						content: "Refined project fact with Node 22+ and package details",
						confidence: 0.95,
						supersedes: [initial.id],
					},
				],
			}),
		});
		// Reuse db path from first coordinator
		(memory2 as any).db = (memory as any).db;
		(memory2 as any).root = (memory as any).root;
		memory2.recordCheckpoint({ sessionId: "session-2", reason: "completed", timestamp: new Date().toISOString() });
		await memory2.run(true);

		const searchOld = memory2.search("Initial project fact");
		expect(searchOld).toEqual([]);

		const [updated] = memory2.search("Refined project fact");
		expect(updated).toBeTruthy();
		expect(updated.sourceSessionIds).toContain("session-1");
		expect(updated.sourceSessionIds).toContain("session-2");
		expect(updated.category).toBe("tech_stack");
	});

	it("supports search and searchAndTouch filtering by category and scope", async () => {
		const memory = coordinator({
			extract: async () => ({
				candidates: [
					{ scope: "global", category: "user_preferences", kind: "preference", content: "Always use concise responses", confidence: 0.95 },
					{ scope: "project", category: "tech_stack", kind: "fact", content: "TypeScript with Vitest for testing", confidence: 0.9 },
					{ scope: "project", category: "known_failures_and_fixes", kind: "failure", content: "ENOENT when package.json is missing", confidence: 0.9 },
				],
			}),
		});
		memory.recordCheckpoint({ sessionId: "session-filter", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);

		// Category filter without query
		const bugRecords = memory.search(undefined, 6, { category: "known_failures_and_fixes" });
		expect(bugRecords).toHaveLength(1);
		expect(bugRecords[0].content).toContain("ENOENT");

		// Scope filter with category
		const globalRecords = memory.search(undefined, 6, { scope: "global", category: "user_preferences" });
		expect(globalRecords).toHaveLength(1);
		expect(globalRecords[0].content).toContain("concise responses");

		// Touch updates lastUsedAt
		const touched = memory.searchAndTouch("Vitest", 6, { category: "tech_stack" });
		expect(touched).toHaveLength(1);
		expect(touched[0].lastUsedAt).toBeTruthy();
	});

	it("cleans up legacy markdown views on initialization and does not generate them during run", async () => {
		const root = mkdtempSync(join(tmpdir(), "metis-memory-views-"));
		roots.push(root);
		const memoryDir = join(root, "memories");
		mkdirSync(join(memoryDir, "projects", "proj1"), { recursive: true });
		writeFileSync(join(memoryDir, "MEMORY.md"), "# Old memory\n");
		writeFileSync(join(memoryDir, "memory_summary.md"), "# Old summary\n");
		writeFileSync(join(memoryDir, "projects", "proj1", "MEMORY.md"), "# Project memory\n");

		const memory = new MemoryCoordinator({
			agentDir: join(root, "agent"),
			cwd: root,
			trusted: () => true,
			settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2 }),
		});

		// Check that legacy markdown views are removed on startup
		expect(existsSync(join(memoryDir, "MEMORY.md"))).toBe(false);
		expect(existsSync(join(memoryDir, "memory_summary.md"))).toBe(false);
		expect(existsSync(join(memoryDir, "projects"))).toBe(false);

		// Record and run extraction
		memory.recordCheckpoint({ sessionId: "session-view", reason: "completed", timestamp: new Date().toISOString(), verification: ["build passes"] });
		await memory.run(true);

		// Ensure markdown views are not created after run
		expect(existsSync(join(memoryDir, "MEMORY.md"))).toBe(false);
		expect(existsSync(join(memoryDir, "memory_summary.md"))).toBe(false);
		expect(existsSync(join(memoryDir, "projects"))).toBe(false);
	});

	it("saves updated memory-map.md from model extraction, passes existing map, and deletes it on reset", async () => {
		const root = mkdtempSync(join(tmpdir(), "metis-memory-map-"));
		roots.push(root);
		const memoryDir = join(root, "memories");
		let passedExistingMap: string | undefined;

		const memory = new MemoryCoordinator({
			agentDir: join(root, "agent"),
			cwd: root,
			trusted: () => true,
			settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2 }),
			extract: async (_checkpoint, _signal, existingMemoryMap) => {
				passedExistingMap = existingMemoryMap;
				return {
					candidates: [{ scope: "project", category: "tech_stack", kind: "fact", content: "React 19 with Vite", confidence: 0.9 }],
					memoryMap: "# Memory Map\n\n## Projects\n- **[tech_stack]**: React 19",
				};
			},
		});

		memory.recordCheckpoint({ sessionId: "session-map-1", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);

		const mapFile = join(memoryDir, "memory-map.md");
		expect(existsSync(mapFile)).toBe(true);
		expect(passedExistingMap).toBeUndefined();

		// Second run: verify previous memory-map.md is passed to extract
		memory.recordCheckpoint({ sessionId: "session-map-2", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);
		expect(passedExistingMap).toContain("# Memory Map");

		// Reset clears memory-map.md
		memory.reset("RESET_MEMORY");
		expect(existsSync(mapFile)).toBe(false);
	});

	it("saves updated memory-overview.md from model extraction, passes existing overview, supports getMemoryOverview, and deletes it on reset", async () => {
		const root = mkdtempSync(join(tmpdir(), "metis-memory-overview-"));
		roots.push(root);
		const memoryDir = join(root, "memories");
		let passedExistingOverview: string | undefined;

		const memory = new MemoryCoordinator({
			agentDir: join(root, "agent"),
			cwd: root,
			trusted: () => true,
			settings: () => ({ minRolloutIdleHours: 1, maxRolloutsPerSweep: 2 }),
			extract: async (_checkpoint, _signal, _existingMemoryMap, existingMemoryOverview) => {
				passedExistingOverview = existingMemoryOverview;
				return {
					candidates: [{ scope: "project", category: "tech_stack", kind: "fact", content: "Vue 3 with Pinia", confidence: 0.95 }],
					memoryOverview: "# Memory Overview\n\n- [tech_stack]: Vue 3 + Pinia",
				};
			},
		});

		expect(memory.getMemoryOverview()).toBeUndefined();

		memory.recordCheckpoint({ sessionId: "session-overview-1", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);

		const overviewFile = join(memoryDir, "memory-overview.md");
		expect(existsSync(overviewFile)).toBe(true);
		expect(passedExistingOverview).toBeUndefined();
		expect(memory.getMemoryOverview()).toBe("# Memory Overview\n\n- [tech_stack]: Vue 3 + Pinia");

		// Second run: verify previous memory-overview.md is passed to extract
		memory.recordCheckpoint({ sessionId: "session-overview-2", reason: "completed", timestamp: new Date().toISOString() });
		await memory.run(true);
		expect(passedExistingOverview).toContain("# Memory Overview\n\n- [tech_stack]: Vue 3 + Pinia");

		// Reset clears memory-overview.md and getMemoryOverview returns undefined
		memory.reset("RESET_MEMORY");
		expect(existsSync(overviewFile)).toBe(false);
		expect(memory.getMemoryOverview()).toBeUndefined();
	});

	it("executes read-only SQL queries and blocks mutating statements", async () => {
		const memory = coordinator();
		memory.recordCheckpoint({
			sessionId: "session-sql",
			reason: "completed",
			timestamp: new Date().toISOString(),
			verification: ["npm test passes with vitest"],
		});
		await memory.run(true);

		// Valid SELECT
		const rows = memory.query("SELECT id, scope, category, kind, content FROM memory_records WHERE status = 'active'");
		expect(rows).toHaveLength(1);
		expect(rows[0].content).toContain("npm test");

		// FTS5 join query
		const ftsRows = memory.query("SELECT r.id, r.content FROM memory_fts f JOIN memory_records r ON r.id = f.id WHERE f.memory_fts MATCH 'vitest'");
		expect(ftsRows).toHaveLength(1);

		// Parameterized query
		const paramRows = memory.query("SELECT id, category FROM memory_records WHERE category = ?", ["workflows_and_commands"]);
		expect(paramRows).toHaveLength(1);

		// Disallows mutating statements
		expect(() => memory.query("DELETE FROM memory_records")).toThrow(/Only read-only queries/i);
		expect(() => memory.query("DROP TABLE memory_records")).toThrow(/Only read-only queries/i);
		expect(() => memory.query("INSERT INTO memory_meta VALUES ('k', 'v')")).toThrow(/Only read-only queries/i);
		expect(() => memory.query("SELECT 1; DELETE FROM memory_records;")).toThrow(/mutating operations/i);
		expect(() => memory.query("   ")).toThrow(/empty/i);
	});

	it("emits real-time extraction progress updates across checkpoints", async () => {
		const memory = coordinator();
		for (let i = 0; i < 3; i++) {
			memory.recordCheckpoint({
				sessionId: `session-progress-${i}`,
				reason: "completed",
				timestamp: new Date().toISOString(),
				verification: [`procedure verified #${i}`],
			});
		}

		const progressSnapshots: Array<{ total?: number; processed?: number; pending: number }> = [];
		memory.on((event) => {
			if (event.type === "memory_state_changed" && event.state.phase === "extracting") {
				progressSnapshots.push({
					total: event.state.extractingTotal,
					processed: event.state.extractingProcessed,
					pending: event.state.pendingJobs,
				});
			}
		});

		await memory.run(true);

		expect(progressSnapshots.length).toBeGreaterThanOrEqual(3);
		expect(progressSnapshots[0]).toMatchObject({ total: 3, processed: 0, pending: 3 });
		expect(progressSnapshots[progressSnapshots.length - 1]).toMatchObject({ total: 3, processed: 3, pending: 0 });
	});

	it("processes checkpoints concurrently with multiple workers", async () => {
		let maxConcurrent = 0;
		let currentRunning = 0;

		const memory = coordinator({
			extract: async (_checkpoint, _signal) => {
				currentRunning += 1;
				maxConcurrent = Math.max(maxConcurrent, currentRunning);
				await new Promise((resolve) => setTimeout(resolve, 20));
				currentRunning -= 1;
				return [{ scope: "project", kind: "fact", content: "Extracted parallel fact content", confidence: 0.9 }];
			},
		});

		for (let i = 0; i < 8; i++) {
			memory.recordCheckpoint({
				sessionId: `session-concurrent-${i}`,
				reason: "completed",
				timestamp: new Date().toISOString(),
				verification: [`procedure verified #${i}`],
			});
		}

		const state = await memory.run(true);
		expect(state.pendingJobs).toBe(0);
		expect(state.lastRunProcessed).toBe(8);
		expect(maxConcurrent).toBeGreaterThan(1);
		expect(maxConcurrent).toBeLessThanOrEqual(4);
	});

	it("aborts unstarted concurrent jobs when extraction is aborted", async () => {
		let callCount = 0;
		const memory = coordinator({
			extract: async (_checkpoint, signal) => {
				callCount += 1;
				await new Promise((resolve, reject) => {
					const timer = setTimeout(resolve, 100);
					signal?.addEventListener("abort", () => {
						clearTimeout(timer);
						reject(new Error("aborted"));
					});
				});
				return [{ scope: "project", kind: "fact", content: "Should not finish all", confidence: 0.9 }];
			},
		});

		for (let i = 0; i < 10; i++) {
			memory.recordCheckpoint({
				sessionId: `session-fail-${i}`,
				reason: "completed",
				timestamp: new Date().toISOString(),
				verification: [`fail test checkpoint #${i}`],
			});
		}

		const running = memory.run(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		memory.abort();
		await expect(running).rejects.toThrow("aborted");
		const state = memory.getState();
		expect(state.phase).toBe("retry_wait");
		expect(state.pendingJobs).toBeGreaterThan(0);
	});
});

