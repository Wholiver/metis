import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_MAX_LEARNED_SKILLS,
	getLearnedSkillNames,
	getLearnedSkillsSummary,
	getOutcomeLedger,
	getScopeDir,
	readJournal,
	recordAdaptationEffect,
	retireSkill,
	rollbackAdaptation,
	selectLowestValueSkill,
	writeAdaptation,
} from "../src/core/adaptations/index.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { discoverAdaptationResources } from "../src/core/adaptations/effective.ts";

describe("Self-Learning Skill Limit and Eviction", () => {
	let tempAgentDir: string;
	let tempCwd: string;

	beforeEach(() => {
		tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-test-skill-limit-agent-"));
		tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "metis-test-skill-limit-cwd-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tempAgentDir, { recursive: true, force: true });
			fs.rmSync(tempCwd, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("defaults maxLearnedSkills to 30 and supports updates in SettingsManager", () => {
		const settingsManager = SettingsManager.create(tempCwd, tempAgentDir);
		expect(settingsManager.getMaxLearnedSkills()).toBe(30);
		expect(DEFAULT_MAX_LEARNED_SKILLS).toBe(30);

		settingsManager.setMaxLearnedSkills(15);
		expect(settingsManager.getMaxLearnedSkills()).toBe(15);
		expect(settingsManager.getSelfLearningSettings().maxLearnedSkills).toBe(15);

		// Clamp test: minimum is 1
		settingsManager.setMaxLearnedSkills(0);
		expect(settingsManager.getMaxLearnedSkills()).toBe(1);
	});

	it("retires a skill safely by archiving, snapshotting, and updating journal & ledger", async () => {
		const scope = "user";
		const scopeDir = getScopeDir(tempAgentDir, tempCwd, scope);

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "legacy-build",
			content: "---\nname: legacy-build\ndescription: Legacy build script\n---\n# legacy build\nrun old build\n",
		});

		expect(getLearnedSkillNames(scopeDir)).toContain("legacy-build");

		const retired = retireSkill({
			scopeDir,
			scope,
			name: "legacy-build",
			reason: "Superceded by modern build workflow",
		});
		expect(retired).toBe(true);

		// Active skills directory should no longer contain legacy-build
		expect(getLearnedSkillNames(scopeDir)).not.toContain("legacy-build");
		expect(fs.existsSync(path.join(scopeDir, "skills", "legacy-build"))).toBe(false);

		// Archive directory should hold the skill
		const archivedFile = path.join(scopeDir, "archive", "skills", "legacy-build", "SKILL.md");
		expect(fs.existsSync(archivedFile)).toBe(true);

		// Journal should record retire action with reason
		const journal = readJournal(scopeDir);
		const retireEntry = journal.find((e) => e.kind === "skill" && e.name === "legacy-build" && e.action === "retire");
		expect(retireEntry).toBeDefined();
		expect(retireEntry?.reason).toBe("Superceded by modern build workflow");
		expect(retireEntry?.snapshotId).toBeDefined();

		// Outcome ledger should record status as retired
		const ledger = getOutcomeLedger(scopeDir);
		expect(ledger.perAdaptationStats?.[`${scope}:skill:legacy-build`]?.status).toBe("retired");
	});

	it("retires obsolete skill when model explicitly specifies replaces in writeAdaptation", async () => {
		const scope = "project";
		const scopeDir = getScopeDir(tempAgentDir, tempCwd, scope);

		// 1. Initial skill
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "old-deploy",
			content: "---\nname: old-deploy\ndescription: Old deployment procedure\n---\n# old deploy\n",
		});

		// 2. New skill that replaces old-deploy
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "new-deploy",
			replaces: "old-deploy",
			content: "---\nname: new-deploy\ndescription: Modern containerized deployment\n---\n# new deploy\n",
		});

		const activeSkills = getLearnedSkillNames(scopeDir);
		expect(activeSkills).toContain("new-deploy");
		expect(activeSkills).not.toContain("old-deploy");
		expect(fs.existsSync(path.join(scopeDir, "archive", "skills", "old-deploy"))).toBe(true);
	});

	it("enforces capacity limit by auto-evicting the lowest-value skill when limit is reached", async () => {
		const scope = "user";
		const scopeDir = getScopeDir(tempAgentDir, tempCwd, scope);
		const maxSkills = 3;

		// Create 3 initial skills
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "skill-one",
			content: "---\nname: skill-one\ndescription: Skill 1\n---\n# skill 1\n",
			maxLearnedSkills: maxSkills,
		});
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "skill-two",
			content: "---\nname: skill-two\ndescription: Skill 2\n---\n# skill 2\n",
			maxLearnedSkills: maxSkills,
		});
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "skill-three",
			content: "---\nname: skill-three\ndescription: Skill 3\n---\n# skill 3\n",
			maxLearnedSkills: maxSkills,
		});

		expect(getLearnedSkillNames(scopeDir).length).toBe(3);

		// Record negative outcome on skill-two (making it hurt/low value)
		recordAdaptationEffect({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			effect: "hurt",
			activeAdaptationIds: [`${scope}:skill:skill-two`],
		});
		recordAdaptationEffect({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			effect: "hurt",
			activeAdaptationIds: [`${scope}:skill:skill-two`],
		});

		// Verify selectLowestValueSkill picks skill-two
		const lowest = selectLowestValueSkill(scopeDir, scope);
		expect(lowest).toBe("skill-two");

		// Now add a 4th skill without replaces
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "skill-four",
			content: "---\nname: skill-four\ndescription: Skill 4\n---\n# skill 4\n",
			maxLearnedSkills: maxSkills,
		});

		const currentSkills = getLearnedSkillNames(scopeDir);
		// Capacity should strictly stay at 3!
		expect(currentSkills.length).toBe(3);
		expect(currentSkills).toContain("skill-four");
		expect(currentSkills).toContain("skill-one");
		expect(currentSkills).toContain("skill-three");
		expect(currentSkills).not.toContain("skill-two");

		// skill-two should be archived
		expect(fs.existsSync(path.join(scopeDir, "archive", "skills", "skill-two", "SKILL.md"))).toBe(true);

		const journal = readJournal(scopeDir);
		const evictEntry = journal.find((e) => e.kind === "skill" && e.name === "skill-two" && e.action === "retire");
		expect(evictEntry).toBeDefined();
		expect(evictEntry?.reason).toContain("Auto-evicted to stay within 3 skills limit");
	});

	it("does not evict when updating an existing skill in place at capacity", async () => {
		const scope = "user";
		const scopeDir = getScopeDir(tempAgentDir, tempCwd, scope);
		const maxSkills = 2;

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "lint-fix",
			content: "---\nname: lint-fix\ndescription: Run linting\n---\n# lint\npnpm lint\n",
			maxLearnedSkills: maxSkills,
		});
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "test-run",
			content: "---\nname: test-run\ndescription: Run tests\n---\n# test\npnpm test\n",
			maxLearnedSkills: maxSkills,
		});

		expect(getLearnedSkillNames(scopeDir).length).toBe(2);

		// Update lint-fix in place with new instructions
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "lint-fix",
			content: "---\nname: lint-fix\ndescription: Run linting with auto-fix\n---\n# lint\npnpm lint --fix\n",
			maxLearnedSkills: maxSkills,
		});

		const activeSkills = getLearnedSkillNames(scopeDir);
		expect(activeSkills.length).toBe(2);
		expect(activeSkills).toEqual(expect.arrayContaining(["lint-fix", "test-run"]));
	});

	it("excludes archived skills from discoverAdaptationResources and getLearnedSkillsSummary", async () => {
		const scope = "user";
		const scopeDir = getScopeDir(tempAgentDir, tempCwd, scope);

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "active-skill",
			content: "---\nname: active-skill\ndescription: Active procedure\n---\n# active\n",
		});
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "retire-me",
			content: "---\nname: retire-me\ndescription: Retired procedure\n---\n# retire\n",
		});

		retireSkill({
			scopeDir,
			scope,
			name: "retire-me",
			reason: "No longer needed",
		});

		const resources = discoverAdaptationResources({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			isProjectTrusted: true,
		});
		const skillPaths = resources.skillPaths;
		expect(skillPaths.some((p) => p.includes("active-skill"))).toBe(true);
		expect(skillPaths.some((p) => p.includes("retire-me"))).toBe(false);

		const summaries = getLearnedSkillsSummary(scopeDir, scope);
		expect(summaries.some((s) => s.name === "active-skill")).toBe(true);
		expect(summaries.some((s) => s.name === "retire-me")).toBe(false);
	});

	it("supports rolling back a retired skill", async () => {
		const scope = "user";
		const scopeDir = getScopeDir(tempAgentDir, tempCwd, scope);

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "revive-skill",
			content: "---\nname: revive-skill\ndescription: Revivable procedure\n---\n# revive\necho 123\n",
		});

		retireSkill({
			scopeDir,
			scope,
			name: "revive-skill",
			reason: "Temporary retirement",
		});

		expect(getLearnedSkillNames(scopeDir)).not.toContain("revive-skill");

		// Rollback to revision 1 (initial write)
		await rollbackAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "revive-skill",
			targetRevision: 1,
		});

		expect(getLearnedSkillNames(scopeDir)).toContain("revive-skill");
		const restoredContent = fs.readFileSync(path.join(scopeDir, "skills", "revive-skill", "SKILL.md"), "utf8");
		expect(restoredContent).toContain("echo 123");
	});

	it("runIdleLearner passes capacity constraints to prompt and applies replaces proposal", async () => {
		const scope = "user";
		const scopeDir = getScopeDir(tempAgentDir, tempCwd, scope);

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			kind: "skill",
			name: "outdated-build",
			content: "---\nname: outdated-build\ndescription: Old procedure\n---\n# old\n",
		});

		let capturedSystemPrompt = "";
		let capturedUserPrompt = "";

		const completeText = async ({ systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string }) => {
			capturedSystemPrompt = systemPrompt;
			capturedUserPrompt = userPrompt;
			return JSON.stringify([
				{
					scope: "user",
					kind: "skill",
					name: "modern-build",
					replaces: "outdated-build",
					content: "---\nname: modern-build\ndescription: Modern build flow\n---\n# modern\npnpm build\n",
					reason: "Upgraded build script to modern toolchain",
				},
			]);
		};

		const messages: any[] = [
			{ role: "user", content: "Please run the build script" },
			{
				role: "assistant",
				content: [{ type: "text", text: "The build failed with error" }],
			},
			{ role: "user", content: "不对，请用 pnpm build 而不是 npm build" },
		];

		const { runIdleLearner } = await import("../src/core/adaptations/learner.ts");
		const result = await runIdleLearner({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope,
			completeText,
			messages,
			mode: "tui",
			maxLearnedSkills: 5,
		});

		expect(result.ran).toBe(true);
		expect(capturedSystemPrompt).toContain("CAPACITY CONSTRAINT: Learned skills capacity limit is 5");
		expect(capturedSystemPrompt).toContain('"replaces":');
		expect(capturedUserPrompt).toContain("Existing Learned Skills (1/5):");
		expect(capturedUserPrompt).toContain("outdated-build");

		// The new skill should be active, and outdated-build should be retired
		const activeSkills = getLearnedSkillNames(scopeDir);
		expect(activeSkills).toContain("modern-build");
		expect(activeSkills).not.toContain("outdated-build");
		expect(fs.existsSync(path.join(scopeDir, "archive", "skills", "outdated-build", "SKILL.md"))).toBe(true);
	});
});
