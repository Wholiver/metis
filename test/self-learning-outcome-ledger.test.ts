import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	adaptationId,
	recordAdaptationEffect,
	recordAdaptationRuntimeError,
	recordRunOutcome,
	recordRecurringCorrection,
	retireExtraCheck,
	updateExtraCheckStatus,
} from "../src/core/adaptations/ledger.ts";
import {
	writeAdaptation,
	listAdaptations,
	getOutcomeLedger,
	getScopeDir,
} from "../src/core/adaptations/store.ts";

describe("Self-Learning Outcome Ledger & Feedback Tracking", () => {
	let tempDir: string;
	let tempAgentDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-ledger-test-"));
		tempAgentDir = path.join(tempDir, "agent");
		fs.mkdirSync(tempAgentDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("records run outcomes and populates adaptation stats in listAdaptations", async () => {
		// Create an adaptation
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "profile",
			content: "Project coding preferences.",
		});

		const adaptationId = "project:profile";

		// Record a successful run
		recordRunOutcome({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			outcome: "success",
			activeAdaptationIds: [adaptationId],
		});

		let adaptations = listAdaptations(tempAgentDir, tempDir);
		let profile = adaptations.find((a) => a.id === adaptationId);
		expect(profile?.appliedCount).toBe(1);
		expect(profile?.lastOutcome).toBe("success");

		// Record a failed run
		recordRunOutcome({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			outcome: "failure",
			activeAdaptationIds: [adaptationId],
		});

		adaptations = listAdaptations(tempAgentDir, tempDir);
		profile = adaptations.find((a) => a.id === adaptationId);
		expect(profile?.appliedCount).toBe(2);
		expect(profile?.lastOutcome).toBe("failure");
	});

	it("detects recurring corrections and triggers rewrite after 2 recurrences", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({ hiddenTools: ["ls"] }),
		});

		const adaptationId = "project:architecture";

		// 1st correction: recurredCount = 1, not yet rewriting
		const res1 = recordRecurringCorrection({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			activeAdaptationIds: [adaptationId],
		});
		expect(res1.needsRewriteIds).toEqual([]);

		// 2nd correction: recurredCount = 2, triggers rewrite!
		const res2 = recordRecurringCorrection({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			activeAdaptationIds: [adaptationId],
		});
		expect(res2.needsRewriteIds).toContain(adaptationId);

		const adaptations = listAdaptations(tempAgentDir, tempDir);
		const arch = adaptations.find((a) => a.id === adaptationId);
		expect(arch?.recurredCorrections).toBe(2);
	});

	it("retires an extraCheck from workflow.json", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "workflow",
			content: JSON.stringify({
				extraChecks: [
					{ id: "check-lint", name: "Lint Check", command: "pnpm lint", status: "active" },
					{ id: "check-test", name: "Test Check", command: "pnpm test", status: "active" },
				],
			}),
		});

		const res = await retireExtraCheck({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			checkId: "check-lint",
		});

		expect(res.success).toBe(true);
		expect(res.found).toBe(true);

		// Verify workflow.json now has check-lint as retired
		const projectDir = path.join(tempAgentDir, "adaptations", "projects");
		const projectKey = fs.readdirSync(projectDir)[0]!;
		const wfPath = path.join(projectDir, projectKey, "workflow.json");
		const content = JSON.parse(fs.readFileSync(wfPath, "utf8"));
		const lintCheck = content.extraChecks.find((c: any) => c.id === "check-lint");
		expect(lintCheck.status).toBe("retired");
	});

	it("updates extraCheck status to pending on environment failure and lists pending checks", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "workflow",
			content: JSON.stringify({
				extraChecks: [
					{ id: "check-broken-env", name: "Broken Tool Check", command: "nonexistent-cmd", status: "active" },
				],
			}),
		});

		// Mark pending due to environment failure
		const updated = updateExtraCheckStatus({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			checkId: "check-broken-env",
			status: "pending",
		});
		expect(updated).toBe(true);

		// listAdaptations exposes pendingChecks
		const adaptations = listAdaptations(tempAgentDir, tempDir);
		const wf = adaptations.find((a) => a.kind === "workflow");
		expect(wf?.pendingChecks).toContain("Broken Tool Check");
	});

	it("generates unified adaptationId across scopes, kinds, and names", () => {
		expect(adaptationId("project", "skill", "git-helper")).toBe("project:skill:git-helper");
		expect(adaptationId("user", "architecture")).toBe("user:architecture");
		expect(adaptationId("user", "architecture", "guideline-1")).toBe("user:architecture:guideline-1");
		expect(adaptationId("project", "tool", "my_tool")).toBe("project:tool:my_tool");
		expect(adaptationId("project", "profile")).toBe("project:profile");
	});

	it("automatically rolls back a tool adaptation after 2 runtime errors using 3-part adaptationId", async () => {
		// Write a tool adaptation
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "tool",
			name: "test_tool",
			content: "export default function() {}",
			actor: "user",
		});

		const toolAdaptId = adaptationId("project", "tool", "test_tool");
		expect(toolAdaptId).toBe("project:tool:test_tool");

		// 1st runtime error: hurt = 1, rolledBack = false
		const res1 = await recordAdaptationRuntimeError({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			adaptationId: toolAdaptId,
			error: new Error("Tool runtime crashed once"),
		});
		expect(res1.rolledBack).toBe(false);

		// 2nd runtime error: hurt = 2, rolledBack = true
		const res2 = await recordAdaptationRuntimeError({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			adaptationId: toolAdaptId,
			error: new Error("Tool runtime crashed twice"),
		});
		expect(res2.rolledBack).toBe(true);

		// Verify tool was rolled back (removed since initial revision was 1 with prevRevision 0)
		const adaptations = listAdaptations(tempAgentDir, tempDir);
		expect(adaptations.some((a) => a.kind === "tool" && a.name === "test_tool")).toBe(false);
	});

	it("marks skill and architecture adaptations as retired on 2 hurts without deleting files", async () => {
		// 1. Skill
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "skill",
			name: "flaky-skill",
			content: "---\nname: flaky-skill\ndescription: Test skill\n---\nRun flaky task.",
			actor: "learner",
		});
		const skillAdaptId = adaptationId("project", "skill", "flaky-skill");

		// 1st hurt
		const s1 = recordAdaptationEffect({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			effect: "hurt",
			activeAdaptationIds: [skillAdaptId],
		});
		expect(s1.status).toBe("trial");
		expect(s1.hurt).toBe(1);

		// 2nd hurt: retired!
		const s2 = recordAdaptationEffect({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			effect: "hurt",
			activeAdaptationIds: [skillAdaptId],
		});
		expect(s2.status).toBe("retired");
		expect(s2.retired).toBe(true);

		// Verify skill file is NOT deleted on disk
		const scopeDir = getScopeDir(tempAgentDir, tempDir, "project");
		const skillPath = path.join(scopeDir, "skills", "flaky-skill", "SKILL.md");
		expect(fs.existsSync(skillPath)).toBe(true);

		// 2. Architecture
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: [
					{ id: "bad-rule", text: "Don't run linter", trigger: { command: "lint" } },
				],
			}),
		});
		const archGuidelineId = adaptationId("project", "architecture", "bad-rule");

		// 1st hurt
		recordAdaptationEffect({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			effect: "hurt",
			activeAdaptationIds: [archGuidelineId],
		});

		// 2nd hurt
		const a2 = recordAdaptationEffect({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			effect: "hurt",
			activeAdaptationIds: [archGuidelineId],
		});
		expect(a2.status).toBe("retired");

		// Verify architecture.json still exists on disk
		const archPath = path.join(scopeDir, "architecture.json");
		expect(fs.existsSync(archPath)).toBe(true);

		// listAdaptations reports status as retired
		const adaptations = listAdaptations(tempAgentDir, tempDir);
		const retiredSkill = adaptations.find((a) => a.id === skillAdaptId);
		expect(retiredSkill?.status).toBe("retired");
	});
});
