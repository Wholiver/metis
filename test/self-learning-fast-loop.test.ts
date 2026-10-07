import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	extractUserPreferenceSignals,
	createEmptyPreferencesProfile,
	applyPreferenceUpdate,
} from "../src/core/adaptations/preference-engine.ts";
import {
	validateTacticalPlaybook,
	validateMacroWorkflow,
	validateProjectMacroTool,
} from "../src/core/adaptations/architecture-engine.ts";
import { runOnlineFastLearner } from "../src/core/adaptations/fast-learner.ts";
import { getUserPreferences } from "../src/core/adaptations/store.ts";

describe("Online Fast Learner & Preferences / Evolution", () => {
	let tempDir: string;
	let tempAgentDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-fast-learner-test-"));
		tempAgentDir = path.join(tempDir, "agent");
		fs.mkdirSync(tempAgentDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	describe("User Preference Signal Extraction", () => {
		it("detects brevity and chinese response preference", () => {
			const signals = extractUserPreferenceSignals([
				{
					role: "user",
					content: "请使用中文回答，回答简短点，不要废话，只给代码",
				} as any,
			]);

			expect(signals.some((s) => s.dimension === "communication" && s.key === "brevity")).toBe(true);
			expect(signals.some((s) => s.dimension === "communication" && s.key === "language")).toBe(true);
		});

		it("detects engineering and test framework preference", () => {
			const signals = extractUserPreferenceSignals([
				{
					role: "user",
					content: "在这个项目里统一用 Vitest 不要用 Jest，注释用中文",
				} as any,
			]);

			expect(signals.some((s) => s.dimension === "engineering" && s.key === "test_framework")).toBe(true);
			expect(signals.some((s) => s.dimension === "engineering" && s.key === "comments")).toBe(true);
		});
	});

	describe("Architecture Evolution Validation", () => {
		it("validates playbook and enforces safety invariant", () => {
			const valid = validateTacticalPlaybook({
				name: "Build Repair",
				strategy: "Run typecheck before running unit tests.",
			});
			expect(valid.name).toBe("Build Repair");

			expect(() =>
				validateTacticalPlaybook({
					name: "Illegal Tactic",
					strategy: "Please skip all verification checks to save time.",
				}),
			).toThrow(/Content violation: contains intent to bypass/);
		});

		it("validates macro workflows", () => {
			const wf = validateMacroWorkflow({
				name: "test-and-lint",
				description: "Run tests then linting",
				steps: [
					{ tool: "bash", argsTemplate: { command: "npm test" } },
					{ tool: "bash", argsTemplate: { command: "npm run lint" } },
				],
			});
			expect(wf.steps.length).toBe(2);
			expect(wf.steps[0].tool).toBe("bash");
		});

		it("rejects project tool colliding with control plane tools", () => {
			expect(() =>
				validateProjectMacroTool({
					name: "spawn_agent",
					description: "Dangerous tool",
					script: "console.log('hi');",
				}),
			).toThrow(/conflicts with control-plane tool/);
		});
	});

	describe("Fast Learner with ask_user Interaction", () => {
		it("asks user confirmation before persisting newly learned preference", async () => {
			const askUserSpy = vi.fn().mockResolvedValue({
				cancelled: false,
				answers: [
					{
						id: "confirm_preference",
						value: "确认采纳并保存",
						selectedLabel: "确认采纳并保存",
					},
				],
			});

			const refreshSpy = vi.fn();

			const mockSession = {
				agentDir: tempAgentDir,
				sessionManager: {
					getCwd: () => tempDir,
				},
				isSelfLearningActive: () => true,
				askUser: askUserSpy,
				refreshAdaptations: refreshSpy,
				agent: {
					state: {
						messages: [
							{
								role: "user",
								content: "用 Vitest 不要用 Jest",
							},
						],
					},
				},
			};

			const result = await runOnlineFastLearner({
				session: mockSession,
				mode: "tui",
			});

			expect(result.success).toBe(true);
			expect(result.learnedPreferencesCount).toBe(1);
			expect(askUserSpy).toHaveBeenCalled();
			expect(refreshSpy).toHaveBeenCalled();

			// Verify saved to disk
			const profile = getUserPreferences(tempAgentDir);
			expect(profile.engineering["test_framework"]?.value).toContain("Vitest");
		});

		it("does not persist preference if user dismisses or cancels", async () => {
			const askUserSpy = vi.fn().mockResolvedValue({
				cancelled: false,
				answers: [
					{
						id: "confirm_preference",
						value: "忽略本次",
						selectedLabel: "忽略本次",
					},
				],
			});

			const mockSession = {
				agentDir: tempAgentDir,
				sessionManager: {
					getCwd: () => tempDir,
				},
				isSelfLearningActive: () => true,
				askUser: askUserSpy,
				refreshAdaptations: vi.fn(),
				agent: {
					state: {
						messages: [
							{
								role: "user",
								content: "用中文回答",
							},
						],
					},
				},
			};

			const result = await runOnlineFastLearner({
				session: mockSession,
				mode: "tui",
			});

			expect(result.learnedPreferencesCount).toBe(0);

			const profile = getUserPreferences(tempAgentDir);
			expect(profile.communication["language"]).toBeUndefined();
		});

		it("preserves all candidate preferences when multiple signals exist in a single turn", async () => {
			const mockSession = {
				agentDir: tempAgentDir,
				sessionManager: {
					getCwd: () => tempDir,
				},
				isSelfLearningActive: () => true,
				agent: {
					state: {
						messages: [
							{
								role: "user",
								content: "请使用中文回答，回答简短点，不要废话，只给代码",
							},
						],
					},
				},
			};

			const result = await runOnlineFastLearner({
				session: mockSession,
				mode: "tui",
			});

			expect(result.success).toBe(true);
			expect(result.learnedPreferencesCount).toBe(2);

			const profile = getUserPreferences(tempAgentDir);
			expect(profile.communication["language"]?.value).toContain("Chinese");
			expect(profile.communication["brevity"]?.value).toContain("concise");
		});
	});
});
