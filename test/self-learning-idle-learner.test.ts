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

	it("detects communication style: consecutive Chinese messages produce communication_style signal", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "请帮我分析一下这个模块的架构" },
			{ role: "assistant", content: [{ type: "text", text: "好的，这是模块架构分析..." }] },
			{ role: "user", content: "请列出核心数据结构" },
		];
		const res = detectLearningSignals({ messages });
		expect(res.hasSignal).toBe(true);
		expect(res.signals.some((s) => s.type === "communication_style" && s.detail === "用户主要使用中文")).toBe(true);
	});

	it("detects communication style: single English message does not produce communication_style signal", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Please analyze the architecture of this module." },
		];
		const res = detectLearningSignals({ messages });
		expect(res.signals.some((s) => s.type === "communication_style")).toBe(false);
	});

	it("detects communication style: format preference for table or bullets", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Please output the comparison in a table." },
		];
		const res = detectLearningSignals({ messages });
		expect(res.hasSignal).toBe(true);
		expect(res.signals.some((s) => s.type === "communication_style" && s.detail.includes("表格"))).toBe(true);
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

		const arrayContent: AgentMessage[] = [
			{ role: "assistant", content: [{ type: "text", text: "Used npm." }] },
			{ role: "user", content: [{ type: "text", text: "不对，以后请用 pnpm test" }] },
		];
		const res4 = detectLearningSignals({ messages: arrayContent });
		expect(res4.hasSignal).toBe(true);
		expect(res4.signals.some((s) => s.type === "correction" && s.detail.includes("pnpm"))).toBe(true);

		const repeatedFailure: AgentMessage[] = [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "npm test" } }],
			},
			{ role: "toolResult", toolCallId: "bash-1", toolName: "bash", isError: true, content: [{ type: "text", text: "fail" }] },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "bash-2", name: "bash", arguments: { command: "npm test --watch" } }],
			},
			{ role: "toolResult", toolCallId: "bash-2", toolName: "bash", isError: true, content: [{ type: "text", text: "fail" }] },
		] as AgentMessage[];
		const res5 = detectLearningSignals({ messages: repeatedFailure });
		expect(res5.signals.some((s) => s.type === "command_failure" && s.detail.includes("npm"))).toBe(true);
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
			dailyCallBudget: 1,
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
			dailyCallBudget: 1,
		});
		expect(res2.ran).toBe(false);
		expect(res2.reason).toBe("daily_model_call_quota_exceeded");
		// Model was NOT called again
		expect(completeSpy).toHaveBeenCalledTimes(1);
	});

	it("allows learning calls without arbitrary daily cap by default", async () => {
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
		const mockModel = { id: "test-model-cap", complete: completeSpy } as any;
		const capDir = path.join(tempDir, "idle-cap-scope");
		fs.mkdirSync(capDir, { recursive: true });

		// 4 calls all succeed without arbitrary cap
		for (let i = 0; i < 4; i++) {
			const res = await runIdleLearner({
				agentDir: tempAgentDir,
				cwd: capDir,
				scope: "user",
				model: mockModel,
				messages,
				mode: "tui",
			});
			expect(res.ran).toBe(true);
		}
		expect(completeSpy).toHaveBeenCalledTimes(4);
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

	it("calls the registry completion path when the model has no complete method", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Run tests" },
			{ role: "assistant", content: [{ type: "text", text: "Ran tests" }] },
			{ role: "user", content: "不对，要用 vitest" },
		];
		const completeText = vi.fn().mockResolvedValue(JSON.stringify([
			{ scope: "user", kind: "profile", content: "Use vitest.", reason: "correction" },
		]));
		const registryCwd = path.join(tempDir, "registry-scope");
		fs.mkdirSync(registryCwd, { recursive: true });
		const result = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: registryCwd,
			scope: "user",
			model: { id: "registry-model" } as any,
			completeText,
			messages,
			mode: "tui",
		});
		expect(completeText).toHaveBeenCalledTimes(1);
		expect(result.ran).toBe(true);
		expect(result.appliedCount).toBe(1);
	});

	it("does not consume the daily quota when no completion path exists", async () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Run tests" },
			{ role: "assistant", content: [{ type: "text", text: "Ran tests" }] },
			{ role: "user", content: "不对，要用 vitest" },
		];
		const unsupported = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: path.join(tempDir, "quota-scope"),
			scope: "project",
			model: { id: "no-complete" } as any,
			messages,
			mode: "tui",
		});
		expect(unsupported.reason).toBe("model_completion_unsupported");

		const completeText = vi.fn().mockResolvedValue("[]");
		const later = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: path.join(tempDir, "quota-scope"),
			scope: "project",
			model: { id: "no-complete" } as any,
			completeText,
			messages,
			mode: "tui",
		});
		expect(completeText).toHaveBeenCalledTimes(1);
		expect(later.ran).toBe(true);
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

		it("learns from the previous session file when the live session has no user text", async () => {
			const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-learner-sessions-"));
			const currentFile = path.join(sessionsDir, "current.jsonl");
			const previousFile = path.join(sessionsDir, "previous.jsonl");
			fs.writeFileSync(currentFile, "");
			const previous = [
				{ type: "session", id: "prev", cwd: tempDir },
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "Run tests" }] } },
				{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Used npm." }] } },
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "不对，以后请用 pnpm test" }] } },
			];
			fs.writeFileSync(previousFile, previous.map((entry) => JSON.stringify(entry)).join("\n"));
			const complete = vi.fn().mockResolvedValue(JSON.stringify([
				{ scope: "project", kind: "profile", content: "Use pnpm test.", reason: "correction" },
			]));
			const projectCwd = path.join(tempDir, "previous-project");
			fs.mkdirSync(projectCwd, { recursive: true });
			const session = createMockSession({
				sessionFile: currentFile,
				sessionManager: {
					isPersistent: () => true,
					getCwd: () => projectCwd,
					getSessionFile: () => currentFile,
				},
				agent: { state: { messages: [] } },
				model: { id: "test-model", complete },
			});

			const result = await scheduleIdleLearning({ session, mode: "server" });
			expect(complete).toHaveBeenCalledTimes(1);
			expect(result?.ran).toBe(true);
			expect(result?.appliedCount).toBe(1);
			fs.rmSync(sessionsDir, { recursive: true, force: true });
		});

		it("does not re-learn from unchanged previous session file even if adaptations directory was deleted", async () => {
			const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-learner-sessions-"));
			const currentFile = path.join(sessionsDir, "current.jsonl");
			const previousFile = path.join(sessionsDir, "previous.jsonl");
			fs.writeFileSync(currentFile, "");
			const previous = [
				{ type: "session", id: "prev", cwd: tempDir },
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "Run tests" }] } },
				{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Used npm." }] } },
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "不对，以后请用 pnpm test" }] } },
			];
			fs.writeFileSync(previousFile, previous.map((entry) => JSON.stringify(entry)).join("\n"));
			const complete = vi.fn().mockResolvedValue(JSON.stringify([
				{ scope: "project", kind: "profile", content: "Use pnpm test.", reason: "correction" },
			]));
			const projectCwd = path.join(tempDir, "previous-project");
			fs.mkdirSync(projectCwd, { recursive: true });
			const session = createMockSession({
				sessionFile: currentFile,
				sessionManager: {
					isPersistent: () => true,
					getCwd: () => projectCwd,
					getSessionFile: () => currentFile,
				},
				agent: { state: { messages: [] } },
				model: { id: "test-model", complete },
			});

			// First run learns from previous session
			const result1 = await scheduleIdleLearning({ session, mode: "server" });
			expect(complete).toHaveBeenCalledTimes(1);
			expect(result1?.ran).toBe(true);

			// Now user deletes the entire adaptations directory (simulating manual delete of ~/.metis/agent/adaptations)
			const projectScopeDir = path.join(tempAgentDir, "adaptations");
			if (fs.existsSync(projectScopeDir)) {
				fs.rmSync(projectScopeDir, { recursive: true, force: true });
			}

			// Restart/re-run: live session is still empty, adaptations are gone
			complete.mockClear();
			const result2 = await scheduleIdleLearning({ session, mode: "server" });
			// MUST NOT re-learn from the unchanged previous session!
			expect(complete).not.toHaveBeenCalled();
			expect(result2).toBeUndefined();

			// Now simulate user having a new conversation in that old session (file mtime updates)
			const updatedPrevious = [
				...previous,
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "错了，还是用 yarn test" }] } },
			];
			// Wait 25ms so mtime is strictly greater
			await new Promise((resolve) => setTimeout(resolve, 25));
			fs.writeFileSync(previousFile, updatedPrevious.map((entry) => JSON.stringify(entry)).join("\n"));

			complete.mockClear();
			const result3 = await scheduleIdleLearning({ session, mode: "server" });
			// Now it SHOULD learn because previous session has changed!
			expect(complete).toHaveBeenCalledTimes(1);
			expect(result3?.ran).toBe(true);

			fs.rmSync(sessionsDir, { recursive: true, force: true });
		});
	});
});

describe("Self-learning recall and skill documents", () => {
	it("wraps a bare skill procedure so it can be loaded", async () => {
		const { ensureSkillDocument, writeAdaptation } = await import("../src/core/adaptations/store.ts");
		const wrapped = ensureSkillDocument("cms_publish_workflow", "Run the publish command with zh_Hans.");
		expect(wrapped).toContain("name: cms_publish_workflow");
		expect(wrapped).toContain("description:");
		expect(wrapped).toContain("zh_Hans");

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-skill-doc-"));
		const agentDir = path.join(tempDir, "agent");
		await writeAdaptation({
			agentDir,
			cwd: tempDir,
			scope: "user",
			kind: "skill",
			name: "cms_publish_workflow",
			content: "Run the publish command with zh_Hans.",
			actor: "learner",
		});
		const written = fs.readFileSync(path.join(agentDir, "adaptations", "skills", "cms_publish_workflow", "SKILL.md"), "utf8");
		expect(written.startsWith("---\n")).toBe(true);
		expect(written).toContain("description:");
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("recalls a publish guideline for a publish request and not a cleanup guideline", async () => {
		const { guidelineMatchesPrompt } = await import("../src/core/adaptations/architecture-schema.ts");
		const cleanup = { text: "clear both markdown and html", trigger: { regex: "清空|重置" } };
		const publish = { text: "use CMS_STAMP and zh_Hans", trigger: { regex: "发布|publish" } };
		expect(guidelineMatchesPrompt(cleanup, "发布一个你好 Metis")).toBe(false);
		expect(guidelineMatchesPrompt(publish, "发布一个你好 Metis")).toBe(true);
		expect(guidelineMatchesPrompt("Always format with prettier", "发布一个你好 Metis")).toBe(true);
		expect(guidelineMatchesPrompt({ text: "untagged object" }, "发布一个你好 Metis")).toBe(false);
	});

	it("matches a skill description written in the user's words", async () => {
		const { skillMatchesPrompt } = await import("../src/core/adaptations/effective.ts");
		const description = "在这个博客项目里发布文章。用户说发布、随笔时使用。";
		expect(skillMatchesPrompt(description, "随笔阿发布一个文章")).toBe(true);
		expect(skillMatchesPrompt(description, "今天天气怎么样")).toBe(false);
	});

	it("does not treat a completed performance run or a tool error as a user correction", async () => {
		const { isUserStatedCorrection, turnSucceededForAdaptation } = await import("../src/core/adaptations/ledger.ts");
		expect(turnSucceededForAdaptation({
			errorOccurred: false,
			errorCount: 2,
			performanceStatus: "completed",
		})).toBe(true);
		expect(turnSucceededForAdaptation({
			errorOccurred: false,
			errorCount: 1,
		})).toBe(false);
		expect(isUserStatedCorrection([{ type: "command_failure" }])).toBe(false);
		expect(isUserStatedCorrection([{ type: "correction" }])).toBe(true);
	});

	it("recalls guidelines based on command, error text, errorPattern, and intent triggers", async () => {
		const { guidelineMatchesPrompt } = await import("../src/core/adaptations/architecture-schema.ts");
		const commandGuideline = {
			text: "Use verbose flag for npm test",
			trigger: { command: "npm test" },
		};
		expect(guidelineMatchesPrompt(commandGuideline, "npm test --watch")).toBe(true);
		expect(guidelineMatchesPrompt(commandGuideline, "pnpm build")).toBe(false);

		const errorGuideline = {
			text: "Increase timeout on network error",
			trigger: { error: "ETIMEDOUT" },
		};
		expect(guidelineMatchesPrompt(errorGuideline, "connect ETIMEDOUT 127.0.0.1")).toBe(true);
		expect(guidelineMatchesPrompt(errorGuideline, "connect ECONNREFUSED 127.0.0.1")).toBe(false);

		// Error regex pattern
		const patternGuideline = {
			text: "Retry on socket hang up",
			trigger: { errorPattern: "socket hang up|ECONNRESET" },
		};
		expect(guidelineMatchesPrompt(patternGuideline, "fetch failed: ECONNRESET")).toBe(true);
		expect(guidelineMatchesPrompt(patternGuideline, "file not found")).toBe(false);
	});

	it("parses multiline skill descriptions via parseFrontmatter", async () => {
		const { parseFrontmatter } = await import("../src/utils/frontmatter.ts");
		const skillContent = `---
name: multiline_skill
description: >
  This is a multiline skill description
  that spans multiple lines and contains details.
---
Skill body here.`;
		const { frontmatter } = parseFrontmatter<{ description?: string }>(skillContent);
		expect(frontmatter.description).toContain("This is a multiline skill description");
		expect(frontmatter.description).toContain("that spans multiple lines and contains details.");
	});
});

describe("Turn Learner Prompts & Watermark Quota Refunds", () => {
	let tempDir: string;
	let tempAgentDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-turn-learner-test-"));
		tempAgentDir = path.join(tempDir, "agent");
		fs.mkdirSync(tempAgentDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("passes recoveryPairs and commandFingerprints to runTurnLearner model prompt", async () => {
		const { runTurnLearner } = await import("../src/core/adaptations/learner.ts");
		let capturedUserPrompt = "";
		let capturedSystemPrompt = "";
		const completeText = vi.fn().mockImplementation(async ({ systemPrompt, userPrompt }) => {
			capturedSystemPrompt = systemPrompt;
			capturedUserPrompt = userPrompt;
			return JSON.stringify([]);
		});

		const messages: AgentMessage[] = [
			{ role: "user", content: "Run the task" },
			{ role: "assistant", content: [{ type: "text", text: "Task done" }] },
		];

		const res = await runTurnLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			completeText,
			messages,
			toolCallsCount: 2,
			hadRecovery: true,
			recoveryPairs: [
				{ failedCommand: "npm test --broken", recoveredCommand: "npm test --fixed" },
			],
			commandFingerprints: [
				{ command: "npm test --fixed", exitCode: 0 },
			],
			mode: "tui",
		});

		expect(res.ran).toBe(true);
		expect(completeText).toHaveBeenCalledTimes(1);
		expect(capturedUserPrompt).toContain("Recovery Pairs (failed -> recovered command):");
		expect(capturedUserPrompt).toContain("Failed: npm test --broken");
		expect(capturedUserPrompt).toContain("Recovered: npm test --fixed");
		expect(capturedUserPrompt).toContain("Successful Command Fingerprints:");
		expect(capturedUserPrompt).toContain("npm test --fixed");
		expect(capturedSystemPrompt).toContain("Copy the exact full command that actually succeeded");
	});

	it("refunds callsCount and advances watermarkTimestamp on model failure or bad JSON", async () => {
		const { runTurnLearner, getLearnerState } = await import("../src/core/adaptations/learner.ts");
		const { getScopeDir } = await import("../src/core/adaptations/store.ts");
		const scopeDir = getScopeDir(tempAgentDir, tempDir, "project");

		const messages: AgentMessage[] = [
			{ role: "user", content: "Fix the bug" },
			{ role: "assistant", content: [{ type: "text", text: "Fixed" }] },
			{ role: "user", content: "不对，请重新处理" },
		];

		// 1. Model failure
		const failingComplete = vi.fn().mockRejectedValue(new Error("API rate limit"));
		const res1 = await runTurnLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			completeText: failingComplete,
			messages,
			toolCallsCount: 1,
			mode: "tui",
		});
		expect(res1.ran).toBe(false);
		expect(res1.reason).toContain("model_call_failed");
		let state = getLearnerState(scopeDir);
		expect(state.callsCount).toBe(0);
		expect(state.turnCallsCount).toBe(0);
		expect(state.watermarkTimestamp).toBeGreaterThan(0);

		// 2. Bad JSON
		const badJsonComplete = vi.fn().mockResolvedValue("This is not valid JSON at all!");
		const res2 = await runTurnLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			completeText: badJsonComplete,
			messages,
			toolCallsCount: 1,
			mode: "tui",
		});
		expect(res2.ran).toBe(true);
		expect(res2.appliedCount).toBe(0);
		expect(res2.reason).toBe("invalid_model_json_output");
		state = getLearnerState(scopeDir);
		expect(state.callsCount).toBe(0);
		expect(state.turnCallsCount).toBe(0);
		expect(state.watermarkTimestamp).toBeGreaterThan(0);
	});

	it("instructs the model not to create a second similar named adaptation", async () => {
		const { runTurnLearner } = await import("../src/core/adaptations/learner.ts");
		let capturedSystemPrompt = "";
		const completeText = vi.fn().mockImplementation(async ({ systemPrompt }) => {
			capturedSystemPrompt = systemPrompt;
			return JSON.stringify([]);
		});

		await runTurnLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			completeText,
			messages: [
				{ role: "user", content: "发布文章" },
				{ role: "assistant", content: [{ type: "text", text: "done" }] },
				{ role: "user", content: "不对，请重新处理" },
			],
			toolCallsCount: 1,
			mode: "tui",
		});

		expect(capturedSystemPrompt).toContain("Never create a second skill/role/proposal that does the same job");
		expect(capturedSystemPrompt).toContain("Do not emit two near-duplicate guidelines or skills");
	});

	it("injects existing active adaptations into userPrompt and drops redundant architecture rules", async () => {
		const { runTurnLearner } = await import("../src/core/adaptations/learner.ts");
		const { writeAdaptation } = await import("../src/core/adaptations/store.ts");

		// Seed an existing skill
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "skill",
			name: "cms-publish-post",
			content: `---\nname: cms-publish-post\ndescription: Publish articles using CMS\n---\n\`CMS_STAMP=abc node tools/cms.mjs publish\``,
			projectTrusted: true,
		});

		let capturedUserPrompt = "";
		let capturedSystemPrompt = "";

		// Model attempts to return BOTH a skill update and an architecture guideline with the same command
		const completeText = vi.fn().mockImplementation(async ({ systemPrompt, userPrompt }) => {
			capturedSystemPrompt = systemPrompt;
			capturedUserPrompt = userPrompt;
			return JSON.stringify([
				{
					scope: "project",
					kind: "skill",
					name: "cms-publish-post",
					content: `---\nname: cms-publish-post\ndescription: Updated publish guide\n---\n\`CMS_STAMP=abc node tools/cms.mjs publish --lang zh_Hans\``,
					reason: "update existing skill",
				},
				{
					scope: "project",
					kind: "architecture",
					content: JSON.stringify({
						customGuidelines: [
							{
								text: "When asked to publish, run `CMS_STAMP=abc node tools/cms.mjs publish --lang zh_Hans`",
								trigger: { regex: "publish" },
							},
						],
					}),
					reason: "duplicate guideline",
				},
			]);
		});

		const res = await runTurnLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			completeText,
			messages: [
				{ role: "user", content: "发布文章" },
				{ role: "assistant", content: [{ type: "text", text: "done" }] },
				{ role: "user", content: "不对，请加上 --lang zh_Hans" },
			],
			toolCallsCount: 1,
			mode: "tui",
		});

		expect(res.ran).toBe(true);
		expect(res.appliedCount).toBe(1); // Only the skill was applied! The duplicate architecture guideline was dropped!

		// Verify existing adaptations were injected into userPrompt
		expect(capturedUserPrompt).toContain("Existing Active Adaptations");
		expect(capturedUserPrompt).toContain("cms-publish-post");
		expect(capturedUserPrompt).toContain("Publish articles using CMS");

		// Verify system prompt instructs to check existing adaptations and maintain separation
		expect(capturedSystemPrompt).toContain("CHECK EXISTING ADAPTATIONS FIRST");
		expect(capturedSystemPrompt).toContain("OPERATIONAL COMMANDS MUST BE SKILLS");
	});

	it("injects profile traits and architecture guidelines into userPrompt and filters duplicate profile writes", async () => {
		const { runTurnLearner } = await import("../src/core/adaptations/learner.ts");
		const { writeAdaptation } = await import("../src/core/adaptations/store.ts");

		// Seed user profile
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "profile",
			content: JSON.stringify({
				version: 2,
				traits: [
					{
						dimension: "communication",
						statement: "用户主要使用中文",
						confidence: 0.9,
						evidence: [],
						status: "active",
					},
				],
			}),
			projectTrusted: true,
		});

		// Seed architecture guideline
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: [
					{
						id: "guideline-pnpm-only",
						text: "Always use pnpm instead of npm",
						trigger: { command: "npm" },
					},
				],
			}),
			projectTrusted: true,
		});

		let capturedUserPrompt = "";
		let capturedSystemPrompt = "";

		// Model attempts to propose identical profile trait that already exists with high confidence
		const completeText = vi.fn().mockImplementation(async ({ systemPrompt, userPrompt }) => {
			capturedSystemPrompt = systemPrompt;
			capturedUserPrompt = userPrompt;
			return JSON.stringify([
				{
					scope: "project",
					kind: "profile",
					content: "用户主要使用中文",
					reason: "redundant profile trait",
				},
			]);
		});

		const res = await runTurnLearner({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			completeText,
			messages: [
				{ role: "user", content: "请用中文回答" },
				{ role: "assistant", content: [{ type: "text", text: "好的" }] },
				{ role: "user", content: "不对，请重新生成" },
			],
			toolCallsCount: 1,
			mode: "tui",
		});

		expect(res.ran).toBe(true);
		// Redundant profile proposal was dropped by the guard!
		expect(res.appliedCount).toBe(0);

		// Verify existing profile trait and architecture guideline were detailed in userPrompt
		expect(capturedUserPrompt).toContain("用户主要使用中文");
		expect(capturedUserPrompt).toContain("Always use pnpm instead of npm");
		expect(capturedUserPrompt).toContain("guideline-pnpm-only");

		// Verify instructions in system prompt
		expect(capturedSystemPrompt).toContain("PROFILE TRAITS DEDUPLICATION");
		expect(capturedSystemPrompt).toContain("ARCHITECTURE GUIDELINES DEDUPLICATION");
	});
});
