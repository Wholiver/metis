import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	detectLearningSignals,
	runIdleLearner,
	sanitizeConversationForLearner,
	scheduleIdleLearning,
} from "../src/core/adaptations/learner.ts";
import type { AgentMessage } from "../src/core/agent-session-services.ts";

describe("Self-Learning Idle Learner", () => {
	let tempDir: string;
	let tempAgentDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-learner-test-"));
		tempAgentDir = path.join(tempDir, "agent");
		fs.mkdirSync(tempAgentDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns no_signals and zero model calls when no correction or failure is present", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Please read the readme." },
			{
				role: "assistant",
				content: [{ type: "text", text: "Here is the readme content." }],
			},
			{ role: "user", content: "Thank you, that looks great." },
		];

		const completeSpy = vi.fn();
		const mockModel = {
			id: "test-model",
			provider: "test",
			complete: completeSpy,
		} as any;

		const result = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			model: mockModel,
			messages,
			mode: "tui",
		});

		expect(result.ran).toBe(false);
		expect(result.reason).toBe("no_signals");
		expect(completeSpy).not.toHaveBeenCalled();
	});

	it("detects Chinese and English correction signals and repeated command failures", () => {
		const messagesWithChinese: AgentMessage[] = [
			{ role: "user", content: "Run tests" },
			{ role: "assistant", content: [{ type: "text", text: "Ran tests with npm test" }] },
			{ role: "user", content: "不对，以后请用 pnpm test 而不是 npm test" },
		];

		const res1 = detectLearningSignals({ messages: messagesWithChinese });
		expect(res1.hasSignal).toBe(true);
		expect(res1.signals.some((s) => s.type === "correction")).toBe(true);

		const messagesWithEnglish: AgentMessage[] = [
			{ role: "user", content: "Create an icon" },
			{ role: "assistant", content: [{ type: "text", text: "Created icon" }] },
			{ role: "user", content: "don't use raster images, always use SVG instead" },
		];

		const res2 = detectLearningSignals({ messages: messagesWithEnglish });
		expect(res2.hasSignal).toBe(true);
		expect(res2.signals.some((s) => s.type === "correction")).toBe(true);

		// Pending checks signal
		const res3 = detectLearningSignals({
			messages: [],
			pendingChecks: ["run-e2e-browser"],
		});
		expect(res3.hasSignal).toBe(true);
		expect(res3.signals.some((s) => s.type === "pending_check")).toBe(true);
	});

	it("sanitizes conversation text and strictly caps output under 6000 tokens", () => {
		const messages: AgentMessage[] = [
			{
				role: "user",
				content: "Please build the project.",
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Building project now..." },
					{ type: "tool_use", id: "t1", name: "bash", input: { command: "npm run build" } },
				],
			},
		];

		const sanitized = sanitizeConversationForLearner(messages);
		expect(sanitized).toContain("User: Please build the project.");
		expect(sanitized).toContain("Assistant: Building project now... [Used tool: bash]");
		expect(sanitized.length).toBeLessThanOrEqual(24000);

		// Huge message test
		const hugeMessages: AgentMessage[] = [
			{ role: "user", content: "A".repeat(40000) },
		];
		const sanitizedHuge = sanitizeConversationForLearner(hugeMessages);
		expect(sanitizedHuge.length).toBeLessThanOrEqual(24000);
		expect(sanitizedHuge).toContain("[earlier context truncated]");
	});

	it("skips non-interactive print and json modes", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Run tests" },
			{ role: "assistant", content: [{ type: "text", text: "Ran tests" }] },
			{ role: "user", content: "不对，必须用 vitest" },
		];

		const completeSpy = vi.fn();
		const mockModel = { id: "test-model", complete: completeSpy } as any;

		const printResult = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			model: mockModel,
			messages,
			mode: "print",
		});
		expect(printResult.ran).toBe(false);
		expect(printResult.reason).toBe("skipped_non_interactive_mode");
		expect(completeSpy).not.toHaveBeenCalled();

		const jsonResult = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			model: mockModel,
			messages,
			mode: "json",
		});
		expect(jsonResult.ran).toBe(false);
		expect(jsonResult.reason).toBe("skipped_non_interactive_mode");
		expect(completeSpy).not.toHaveBeenCalled();
	});

	it("strictly enforces daily call quota (rejects second call on same day)", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Run tests" },
			{ role: "assistant", content: [{ type: "text", text: "Ran tests" }] },
			{ role: "user", content: "不对，要用 vitest" },
		];

		const completeSpy = vi.fn().mockResolvedValue(
			JSON.stringify([
				{
					scope: "user",
					kind: "profile",
					content: "Always use vitest.",
					reason: "User specified vitest preference",
				},
			]),
		);
		const mockModel = { id: "test-model", complete: completeSpy } as any;

		// First call succeeds
		const res1 = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "user",
			model: mockModel,
			messages,
			mode: "tui",
		});
		expect(res1.ran).toBe(true);
		expect(res1.appliedCount).toBe(1);
		expect(completeSpy).toHaveBeenCalledTimes(1);

		// Second call on same day is rejected by daily quota
		const res2 = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "user",
			model: mockModel,
			messages,
			mode: "tui",
		});
		expect(res2.ran).toBe(false);
		expect(res2.reason).toBe("daily_model_call_quota_exceeded");
		// Model was NOT called again
		expect(completeSpy).toHaveBeenCalledTimes(1);
	});

	it("strictly rejects code products (tools, hooks) from model output and preserves existing extraChecks", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Check code" },
			{ role: "assistant", content: [{ type: "text", text: "Checked" }] },
			{ role: "user", content: "以后请每次都检查类型" },
		];

		// Model attempts to output a hook, a tool, and a valid profile
		const modelProposals = [
			{
				scope: "project",
				kind: "hook",
				name: "malicious-hook",
				content: "export default {}",
				reason: "automated hook",
			},
			{
				scope: "project",
				kind: "tool",
				name: "malicious-tool",
				content: "export default {}",
				reason: "automated tool",
			},
			{
				scope: "project",
				kind: "profile",
				content: "Always run typecheck.",
				reason: "User requested typecheck preference",
			},
		];

		const mockModel = {
			id: "test-model",
			complete: vi.fn().mockResolvedValue(JSON.stringify(modelProposals)),
		} as any;

		const result = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			model: mockModel,
			messages,
			mode: "tui",
		});

		expect(result.ran).toBe(true);
		expect(result.appliedCount).toBe(1); // Only the profile was applied!

		// Verify hooks and tools were NOT written
		const projectHooksDir = path.join(tempAgentDir, "adaptations", "projects");
		const allFiles = fs.existsSync(projectHooksDir)
			? fs.readdirSync(projectHooksDir, { recursive: true }).map(String)
			: [];

		expect(allFiles.some((f) => f.includes("malicious-hook"))).toBe(false);
		expect(allFiles.some((f) => f.includes("malicious-tool"))).toBe(false);
	});

	describe("scheduleIdleLearning", () => {
		function createMockSession(overrides: Partial<any> = {}) {
			return {
				isSelfLearningActive: () => true,
				isPersistent: () => true,
				sessionManager: {
					isPersistent: () => true,
					getCwd: () => tempDir,
					getSessionFile: () => path.join(tempDir, "session.json"),
				},
				sessionFile: path.join(tempDir, "session.json"),
				agentDir: tempAgentDir,
				model: { id: "test-model" } as any,
				agent: {
					state: {
						messages: [] as AgentMessage[],
					},
				},
				settingsManager: {
					isProjectTrusted: () => true,
				},
				refreshAdaptations: vi.fn().mockResolvedValue(undefined),
				...overrides,
			};
		}

		it("immediately returns undefined for print and json modes", () => {
			const session = createMockSession();

			const printResult = scheduleIdleLearning({ session, mode: "print" });
			expect(printResult).toBeUndefined();

			const jsonResult = scheduleIdleLearning({ session, mode: "json" });
			expect(jsonResult).toBeUndefined();
		});

		it("immediately returns undefined when isSelfLearningActive returns false", () => {
			const session = createMockSession({
				isSelfLearningActive: () => false,
			});

			const result = scheduleIdleLearning({ session, mode: "tui" });
			expect(result).toBeUndefined();
		});

		it("immediately returns undefined when session is non-persistent", () => {
			// 1. isPersistent() method returns false
			const session1 = createMockSession({
				isPersistent: () => false,
			});
			expect(scheduleIdleLearning({ session: session1, mode: "tui" })).toBeUndefined();

			// 2. sessionManager.isPersistent() returns false and no isPersistent method
			const session2 = createMockSession({
				isPersistent: undefined,
				sessionManager: {
					isPersistent: () => false,
					getCwd: () => tempDir,
				},
				sessionFile: undefined,
			});
			expect(scheduleIdleLearning({ session: session2, mode: "tui" })).toBeUndefined();
		});

		it("executes idle learning when active and persistent in tui and server modes", async () => {
			const refreshSpy = vi.fn().mockResolvedValue(undefined);
			const session = createMockSession({
				refreshAdaptations: refreshSpy,
				agent: {
					state: {
						messages: [
							{ role: "user", content: "Run test" },
							{ role: "assistant", content: [{ type: "text", text: "done" }] },
							{ role: "user", content: "不对，请改用 vitest" },
						],
					},
				},
				model: {
					id: "test-model",
					complete: vi.fn().mockResolvedValue(
						JSON.stringify([
							{
								scope: "project",
								kind: "profile",
								content: "Use vitest",
								reason: "User correction",
							},
						]),
					),
				} as any,
			});

			const promise = scheduleIdleLearning({ session, mode: "tui" });
			expect(promise).toBeDefined();

			const result = await promise;
			expect(result?.ran).toBe(true);
			expect(result?.appliedCount).toBe(1);
			expect(refreshSpy).toHaveBeenCalledWith({ action: "learned", kind: "adaptation" });
		});
	});
});
