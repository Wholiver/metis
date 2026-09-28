import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_PLANE_TOOLS, PROTECTED_BUILTIN_ROLES } from "../src/core/adaptations/types.ts";
import { getEffectiveArchitecture, getEffectiveProfile } from "../src/core/adaptations/effective.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { Extension, ExtensionRuntime } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { BUILTIN_SKILLS, loadSkills } from "../src/core/skills.ts";
import { loadAgents } from "../src/core/agent-definition.ts";

describe("Self-Learning Runtime Wiring & Safety", () => {
	let tempDir: string;
	let tempAgentDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-sl-runtime-"));
		tempAgentDir = path.join(tempDir, "agent");
		fs.mkdirSync(tempAgentDir, { recursive: true });
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	function createMockExtension(options: {
		id: string;
		source?: string;
		onToolCall?: (event: any, ctx: any) => Promise<any> | any;
		onToolResult?: (event: any, ctx: any) => Promise<any> | any;
		onBeforeStep?: (event: any, ctx: any) => Promise<any> | any;
	}): Extension {
		const handlers = new Map<string, any[]>();
		if (options.onToolCall) {
			handlers.set("tool_call", [options.onToolCall]);
		}
		if (options.onToolResult) {
			handlers.set("tool_result", [options.onToolResult]);
		}
		if (options.onBeforeStep) {
			handlers.set("before_step", [options.onBeforeStep]);
		}

		return {
			id: options.id,
			name: options.id,
			version: "1.0.0",
			description: "test extension",
			path: path.join(tempDir, options.id),
			sourceInfo: options.source ? ({ source: options.source } as any) : undefined,
			handlers,
			tools: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};
	}

	describe("ExtensionRunner Safety Guards", () => {
		it("never allows adaptation extensions to intercept or modify control plane tools", async () => {
			const adaptationToolCallSpy = vi.fn().mockReturnValue({ block: true, reason: "intercepted" });
			const normalToolCallSpy = vi.fn().mockReturnValue(undefined);

			const adaptationExt = createMockExtension({
				id: "adaptation-hook",
				source: "adaptation",
				onToolCall: adaptationToolCallSpy,
			});

			const normalExt = createMockExtension({
				id: "normal-hook",
				source: "user",
				onToolCall: normalToolCallSpy,
			});

			const runner = new ExtensionRunner(
				[adaptationExt, normalExt],
				{} as ExtensionRuntime,
				tempDir,
				sessionManager,
				modelRegistry,
			);

			// Test every control plane tool
			for (const cpTool of CONTROL_PLANE_TOOLS) {
				const result = await runner.emitToolCall({
					type: "tool_call",
					toolName: cpTool,
					input: { foo: "bar" },
				});

				expect(adaptationToolCallSpy).not.toHaveBeenCalled();
				expect(normalToolCallSpy).toHaveBeenCalledWith(
					expect.objectContaining({ toolName: cpTool }),
					expect.anything(),
				);
				expect(result?.block).toBeFalsy();
				normalToolCallSpy.mockClear();
			}

			// Non-control-plane tool CAN be intercepted by adaptation
			const regularResult = await runner.emitToolCall({
				type: "tool_call",
				toolName: "bash",
				input: { command: "ls" },
			});
			expect(adaptationToolCallSpy).toHaveBeenCalled();
			expect(regularResult?.block).toBe(true);
		});

		it("never allows adaptation extensions to intercept tool results for control plane tools", async () => {
			const adaptationToolResultSpy = vi.fn().mockReturnValue({ content: "tampered" });
			const normalToolResultSpy = vi.fn().mockReturnValue(undefined);

			const adaptationExt = createMockExtension({
				id: "adaptation-hook",
				source: "adaptation",
				onToolResult: adaptationToolResultSpy,
			});

			const normalExt = createMockExtension({
				id: "normal-hook",
				source: "user",
				onToolResult: normalToolResultSpy,
			});

			const runner = new ExtensionRunner(
				[adaptationExt, normalExt],
				{} as ExtensionRuntime,
				tempDir,
				sessionManager,
				modelRegistry,
			);

			for (const cpTool of CONTROL_PLANE_TOOLS) {
				const result = await runner.emitToolResult({
					type: "tool_result",
					toolName: cpTool,
					content: "original result",
				});

				expect(adaptationToolResultSpy).not.toHaveBeenCalled();
				expect(normalToolResultSpy).toHaveBeenCalled();
				expect(result?.content).toBeUndefined(); // untampered
				normalToolResultSpy.mockClear();
			}

			// Non-control-plane tool result CAN be handled by adaptation
			const regularResult = await runner.emitToolResult({
				type: "tool_result",
				toolName: "bash",
				content: "original bash result",
			});
			expect(adaptationToolResultSpy).toHaveBeenCalled();
			expect(regularResult?.content).toBe("tampered");
		});

		it("completely suppresses adaptation hooks when performance run is active", async () => {
			const adaptationToolCallSpy = vi.fn().mockReturnValue({ block: true });
			const adaptationBeforeStepSpy = vi.fn().mockReturnValue(undefined);
			const normalToolCallSpy = vi.fn().mockReturnValue(undefined);

			const adaptationExt = createMockExtension({
				id: "adaptation-hook",
				source: "adaptation",
				onToolCall: adaptationToolCallSpy,
				onBeforeStep: adaptationBeforeStepSpy,
			});

			const normalExt = createMockExtension({
				id: "normal-hook",
				source: "user",
				onToolCall: normalToolCallSpy,
			});

			const runner = new ExtensionRunner(
				[adaptationExt, normalExt],
				{} as ExtensionRuntime,
				tempDir,
				sessionManager,
				modelRegistry,
			);

			runner.isPerformanceRunActive = () => true;

			// Even for non-control-plane tools, adaptation is suppressed during performance run
			await runner.emitToolCall({
				type: "tool_call",
				toolName: "bash",
				input: { command: "ls" },
			});
			expect(adaptationToolCallSpy).not.toHaveBeenCalled();
			expect(normalToolCallSpy).toHaveBeenCalled();

			await runner.emit({
				type: "before_step",
			} as any);
			expect(adaptationBeforeStepSpy).not.toHaveBeenCalled();
		});
	});

	describe("Architecture & Profile Wiring", () => {
		it("strips control plane tools from hiddenTools in effective architecture", () => {
			const userAdaptations = path.join(tempAgentDir, "adaptations");
			fs.mkdirSync(userAdaptations, { recursive: true });
			fs.writeFileSync(
				path.join(userAdaptations, "architecture.json"),
				JSON.stringify({
					hiddenTools: ["bash", "performance_admit", "update_plan", "spawn_agent"],
					customGuidelines: ["Always prefer typescript."],
				}),
				"utf8",
			);

			const effective = getEffectiveArchitecture({
				cwd: tempDir,
				agentDir: tempAgentDir,
				isProjectTrusted: true,
			});

			expect(effective).toBeDefined();
			// CONTROL_PLANE_TOOLS must be removed
			expect(effective?.hiddenTools).toEqual(["bash"]);
			expect(effective?.customGuidelines).toEqual(["Always prefer typescript."]);
		});

		it("merges user and project profile.md", () => {
			const userAdaptations = path.join(tempAgentDir, "adaptations");
			fs.mkdirSync(userAdaptations, { recursive: true });
			fs.writeFileSync(path.join(userAdaptations, "profile.md"), "User prefers concise replies.", "utf8");

			const effective = getEffectiveProfile({
				cwd: tempDir,
				agentDir: tempAgentDir,
				isProjectTrusted: true,
			});

			expect(effective).toBe("User prefers concise replies.");
		});
	});

	describe("Skill & Role Precedence", () => {
		it("ensures custom handwritten skills strictly take precedence over adaptation skills", () => {
			// Built-in skills dir
			const builtinSkillsDir = path.join(tempDir, "builtin-skills");
			fs.mkdirSync(builtinSkillsDir, { recursive: true });
			fs.writeFileSync(
				path.join(builtinSkillsDir, "test-skill.md"),
				"---\nname: test-skill\ndescription: Builtin skill\n---\nBuiltin prompt",
				"utf8",
			);

			// Adaptation skills
			const adaptationSkillDir = path.join(tempDir, "adaptation-skills");
			fs.mkdirSync(adaptationSkillDir, { recursive: true });
			// If there are built-in skills, test adaptation overrides builtin
			const builtinSkillName = BUILTIN_SKILLS[0]?.name ?? "test-skill";
			const adaptSkillFile = path.join(adaptationSkillDir, `${builtinSkillName}.md`);
			fs.writeFileSync(
				adaptSkillFile,
				`---\nname: ${builtinSkillName}\ndescription: Adaptation skill\n---\nAdaptation prompt`,
				"utf8",
			);

			// First check: adaptation overrides built-in
			let res = loadSkills({
				cwd: tempDir,
				includeBuiltins: true,
				adaptationSkillPaths: [adaptSkillFile],
			});
			let foundSkill = res.skills.find((s) => s.name === builtinSkillName);
			expect(foundSkill?.description).toBe("Adaptation skill");

			// Now add handwritten custom skill
			const customSkillsDir = path.join(tempDir, "custom-skills");
			fs.mkdirSync(customSkillsDir, { recursive: true });
			const customSkillFile = path.join(customSkillsDir, `${builtinSkillName}.md`);
			fs.writeFileSync(
				customSkillFile,
				`---\nname: ${builtinSkillName}\ndescription: Handwritten custom skill\n---\nCustom prompt`,
				"utf8",
			);

			res = loadSkills({
				cwd: tempDir,
				includeBuiltins: true,
				skillPaths: [customSkillFile],
				adaptationSkillPaths: [adaptSkillFile],
			});
			foundSkill = res.skills.find((s) => s.name === builtinSkillName);
			expect(foundSkill?.description).toBe("Handwritten custom skill");
		});

		it("protects built-in core roles from adaptation overwrite and respects handwritten precedence", () => {
			// Adaptation trying to override protected role "implementer" and custom role "helper"
			const adaptationRoleDir = path.join(tempDir, "adaptation-roles");
			fs.mkdirSync(adaptationRoleDir, { recursive: true });
			const adaptImplementer = path.join(adaptationRoleDir, "implementer.md");
			fs.writeFileSync(adaptImplementer, "---\nname: implementer\ndescription: Evil implementer\n---\nEvil prompt", "utf8");
			const adaptHelper = path.join(adaptationRoleDir, "helper.md");
			fs.writeFileSync(adaptHelper, "---\nname: helper\ndescription: Learned helper\n---\nLearned helper prompt", "utf8");

			// Protected roles must stay intact
			for (const protectedRole of PROTECTED_BUILTIN_ROLES) {
				expect(["lead", "architect", "implementer", "reviewer", "verifier"]).toContain(protectedRole);
			}

			const { agents } = loadAgents({
				cwd: tempDir,
				agentDir: tempAgentDir,
				adaptationAgentPaths: [adaptImplementer, adaptHelper],
			});

			// implementer should NOT be the evil one
			const implementerRole = agents.find((a) => a.name === "implementer");
			expect(implementerRole?.description).not.toBe("Evil implementer");

			// helper (non-protected) is loaded from adaptation
			const helperRole = agents.find((a) => a.name === "helper");
			expect(helperRole?.description).toBe("Learned helper");
		});
	});
});
