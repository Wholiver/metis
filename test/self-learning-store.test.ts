import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AdaptationValidationError,
	getScopeDir,
	listAdaptations,
	RevisionConflictError,
	rollbackAdaptation,
	writeAdaptation,
} from "../src/core/adaptations/index.ts";

describe("Adaptation Store and Validation", () => {
	let tempAgentDir: string;
	let tempCwd: string;

	beforeEach(() => {
		tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-test-agent-"));
		tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "metis-test-cwd-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tempAgentDir, { recursive: true, force: true });
			fs.rmSync(tempCwd, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("rejects invalid adaptation names with path traversal or special chars", async () => {
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "../evil",
				content: "# Evil Skill",
			}),
		).rejects.toThrow(AdaptationValidationError);

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "evil/subpath",
				content: "# Evil Skill",
			}),
		).rejects.toThrow(AdaptationValidationError);

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "INVALID_UPPERCASE",
				content: "# Skill",
			}),
		).rejects.toThrow(AdaptationValidationError);
	});

	it("protects built-in performance role names from collision", async () => {
		for (const role of ["architect", "implementer", "reviewer", "verifier"]) {
			await expect(
				writeAdaptation({
					agentDir: tempAgentDir,
					cwd: tempCwd,
					scope: "user",
					kind: "role",
					name: role,
					content: "role description",
				}),
			).rejects.toThrow(AdaptationValidationError);
		}
	});

	it("protects user handwritten resources from collision", async () => {
		// Create a handwritten skill
		const handwrittenDir = path.join(tempAgentDir, "skills", "my-handwritten-skill");
		fs.mkdirSync(handwrittenDir, { recursive: true });
		fs.writeFileSync(path.join(handwrittenDir, "SKILL.md"), "User authored skill", "utf8");

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "my-handwritten-skill",
				content: "# Overwriting attempt",
			}),
		).rejects.toThrow(/collides with user-authored resource/);
	});

	it("enforces per-kind file size limits", async () => {
		const hugeContent = "x".repeat(10 * 1024); // 10KB (profile limit is 8KB)
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "profile",
				content: hugeContent,
			}),
		).rejects.toThrow(/exceeds limit/);
	});

	it("prevents architecture adaptation from hiding control-plane safety tools", async () => {
		const evilArch = JSON.stringify({
			hiddenTools: ["update_plan", "bash"],
		});

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "architecture",
				content: evilArch,
			}),
		).rejects.toThrow(/Cannot hide control plane tools: update_plan/);
	});

	it("validates workflow adaptation routeBias and extraChecks", async () => {
		const invalidRouteBias = JSON.stringify({
			routeBias: { implementer: "malicious-nonexistent-role" },
		});

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "workflow",
				content: invalidRouteBias,
			}),
		).rejects.toThrow(/routeBias target role 'malicious-nonexistent-role' is invalid/);

		const validWorkflow = JSON.stringify({
			extraChecks: [
				{ id: "lint", name: "Run Lint", command: "npm run lint", status: "active" },
			],
			routeBias: { architect: "lead" },
			verificationCommands: ["npm test"],
		});

		const res = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "workflow",
			content: validWorkflow,
		});
		expect(res.revision).toBe(1);
	});

	it("blocks project-level adaptation when project is not trusted", async () => {
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "project",
				kind: "profile",
				content: "project profile",
				projectTrusted: false,
			}),
		).rejects.toThrow(/Cannot load or apply project-level adaptations in an untrusted project/);
	});

	it("supports optimistic revision locking", async () => {
		const r1 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "profile v1",
		});
		expect(r1.revision).toBe(1);

		// Conflict if expectedRevision does not match current (1)
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "profile",
				content: "profile v2 conflict",
				expectedRevision: 0,
			}),
		).rejects.toThrow(RevisionConflictError);

		// Success if expectedRevision matches current (1)
		const r2 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "profile v2",
			expectedRevision: 1,
		});
		expect(r2.revision).toBe(2);
	});

	it("supports atomic rollback to previous revision or initial clean state", async () => {
		// Revision 1
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "Initial profile content",
		});

		// Revision 2
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "Updated profile content",
		});

		const profilePath = path.join(tempAgentDir, "adaptations", "profile.md");
		expect(fs.readFileSync(profilePath, "utf8")).toBe("Updated profile content");

		// Rollback to revision 1
		await rollbackAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			targetRevision: 1,
		});

		expect(fs.readFileSync(profilePath, "utf8")).toBe("Initial profile content");

		// Rollback to revision 0 (clean slate, deletes file)
		await rollbackAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			targetRevision: 0,
		});

		expect(fs.existsSync(profilePath)).toBe(false);
	});

	it("lists adaptations across user and project scopes", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "user profile",
		});

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "skill",
			name: "custom-skill",
			content: "---\nname: custom-skill\n---\nBody",
		});

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({ customGuidelines: ["Use pnpm"] }),
			projectTrusted: true,
		});

		const list = listAdaptations(tempAgentDir, tempCwd, { projectTrusted: true });
		expect(list).toHaveLength(3);
		expect(list.map((a) => a.id)).toEqual(
			expect.arrayContaining(["user:profile", "user:skill:custom-skill", "project:architecture"]),
		);
	});

	it("merges architecture guidelines and retains existing hiddenTools and preferredTools", async () => {
		// First write with guideline 1 and hiddenTools
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: [
					{ text: "Always use vitest", trigger: { command: "test" } },
				],
				hiddenTools: ["curl"],
				preferredTools: ["bash"],
			}),
			projectTrusted: true,
		});

		// Second write: update guideline 1 trigger, add guideline 2, omit hiddenTools
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: [
					{ text: "Always use vitest", trigger: { command: "pnpm test" } },
					{ text: "Always use pnpm", trigger: { command: "install" } },
				],
			}),
			projectTrusted: true,
		});

		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const archPath = path.join(projectDir, "architecture.json");
		const content = JSON.parse(fs.readFileSync(archPath, "utf8"));
		expect(content.customGuidelines).toHaveLength(2);
		expect(content.customGuidelines[0].text).toBe("Always use vitest");
		expect(content.customGuidelines[0].trigger.command).toBe("pnpm test");
		expect(content.customGuidelines[0].id).toBeTruthy();
		expect(content.customGuidelines[1].text).toBe("Always use pnpm");
		expect(content.customGuidelines[1].id).toBeTruthy();
		expect(content.hiddenTools).toEqual(["curl"]);
		expect(content.preferredTools).toEqual(["bash"]);
	});

	it("rejects object-form customGuidelines that do not specify any trigger", async () => {
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "project",
				kind: "architecture",
				content: JSON.stringify({
					customGuidelines: [{ text: "No trigger here" }],
				}),
				projectTrusted: true,
			}),
		).rejects.toThrow(/must specify at least one trigger field/);

		// Pure string guidelines are accepted
		const res = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: ["Always use pnpm"],
			}),
			projectTrusted: true,
		});
		expect(res.revision).toBe(1);
	});

	it("merges profile traits and does not create shadowed profile.md when profile.json exists", async () => {
		// Write initial profile JSON
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			name: "json",
			content: JSON.stringify({
				version: 2,
				traits: [
					{
						dimension: "coding_style",
						statement: "Use TypeScript and ESM",
						confidence: 0.8,
						evidence: ["ev1"],
						lastConfirmed: "2026-01-01",
						status: "active",
					},
				],
				followUpPredictions: [],
				updatedAt: new Date().toISOString(),
			}),
		});

		const profileJson = path.join(tempAgentDir, "adaptations", "profile.json");
		expect(fs.existsSync(profileJson)).toBe(true);

		// Write new trait with updated evidence
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: JSON.stringify({
				version: 2,
				traits: [
					{
						dimension: "coding_style",
						statement: "Use TypeScript and ESM",
						confidence: 0.95,
						evidence: ["ev2"],
						lastConfirmed: "2026-02-01",
						status: "active",
					},
					{
						dimension: "communication",
						statement: "Prefer bullet points",
						confidence: 0.9,
						evidence: ["ev3"],
						lastConfirmed: "2026-02-01",
						status: "active",
					},
				],
				followUpPredictions: [],
				updatedAt: new Date().toISOString(),
			}),
		});

		const data = JSON.parse(fs.readFileSync(profileJson, "utf8"));
		expect(data.traits).toHaveLength(2);
		const esmTrait = data.traits.find((t: any) => t.statement === "Use TypeScript and ESM");
		expect(esmTrait.confidence).toBe(0.95);
		expect(esmTrait.evidence).toEqual(["ev1", "ev2"]);

		// Now write plain text when profile.json exists: must merge into profile.json and NOT write profile.md
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "Always write comprehensive tests",
		});

		const profileMd = path.join(tempAgentDir, "adaptations", "profile.md");
		expect(fs.existsSync(profileMd)).toBe(false);

		const updatedData = JSON.parse(fs.readFileSync(profileJson, "utf8"));
		expect(updatedData.traits.some((t: any) => t.statement === "Always write comprehensive tests")).toBe(true);
		expect(updatedData.traits.some((t: any) => t.statement === "Use TypeScript and ESM")).toBe(true);
	});

	it("rejects skill write if new content is shorter and drops command flags or tokens", async () => {
		// Initial full skill
		const initialSkill = `---
name: deploy-tool
description: Deploy application to production
---

# Deploy Procedure
Run \`deploy --lang en CMS_STAMP nonce\` to complete deployment.
Ensure all flags are passed correctly.
`;
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "skill",
			name: "deploy-tool",
			content: initialSkill,
			projectTrusted: true,
		});

		// Shorter skill dropping --lang, CMS_STAMP, nonce
		const shorterSkill = `---
name: deploy-tool
description: Deploy application
---

Run deploy.
`;
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "project",
				kind: "skill",
				name: "deploy-tool",
				content: shorterSkill,
				projectTrusted: true,
			}),
		).rejects.toThrow(/drops command flag/);

		// Verify rejection is recorded in journal
		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const journalPath = path.join(projectDir, "journal.jsonl");
		const journalLines = fs.readFileSync(journalPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
		const rejectEntry = journalLines.find((e: any) => e.action === "reject");
		expect(rejectEntry).toBeDefined();
		expect(rejectEntry.reason).toContain("--lang");
	});

	it("normalizes skill name and updates existing skill in place instead of creating duplicates", async () => {
		// 1. Initial skill created with kebab-case: cms-publish-post
		const res1 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "skill",
			name: "cms-publish-post",
			content: `---\nname: cms-publish-post\ndescription: Publish post\n---\nRun \`node tools/cms.mjs publish --lang zh_Hans\``,
			projectTrusted: true,
		});
		expect(res1.revision).toBe(1);

		// 2. Next turn learner proposes cms_publish_post (with underscore)
		const res2 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "skill",
			name: "cms_publish_post",
			content: `---\nname: cms_publish_post\ndescription: Publish post updated\n---\nRun \`node tools/cms.mjs publish --lang zh_Hans --nonce 1234\``,
			projectTrusted: true,
			actor: "learner",
		});
		// Should update the existing skill to revision 2!
		expect(res2.revision).toBe(2);

		// Verify only ONE skill directory exists
		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const skillsDir = path.join(projectDir, "skills");
		const skillEntries = fs.readdirSync(skillsDir);
		expect(skillEntries).toHaveLength(1);
		expect(skillEntries[0]).toBe("cms-publish-post");

		// Content was updated in the original skill
		const content = fs.readFileSync(path.join(skillsDir, "cms-publish-post", "SKILL.md"), "utf8");
		expect(content).toContain("--nonce 1234");
	});

	it("updates existing skill when incoming skill has a different name but overlapping executable commands", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "skill",
			name: "cms-publish",
			content: `---\nname: cms-publish\ndescription: CMS publish procedure\n---\n\`\`\`bash\nnode tools/cms.mjs publish content/posts/test.md --lang en\n\`\`\``,
			projectTrusted: true,
		});

		// A differently named skill targeting the exact same command workflow
		const res = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "skill",
			name: "publish-articles-online",
			content: `---\nname: publish-articles-online\ndescription: Publish articles\n---\n\`\`\`bash\nnode tools/cms.mjs publish content/posts/test.md --lang en --seal\n\`\`\``,
			projectTrusted: true,
			actor: "learner",
		});

		expect(res.revision).toBe(2);

		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const skillsDir = path.join(projectDir, "skills");
		const skillEntries = fs.readdirSync(skillsDir);
		expect(skillEntries).toHaveLength(1);
		expect(skillEntries[0]).toBe("cms-publish");
	});

	it("filters out redundant command guidelines from architecture when covered by a skill", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "skill",
			name: "cms-publish-post",
			content: `---\nname: cms-publish-post\ndescription: Publish post\n---\n\`CMS_STAMP=abc node tools/cms.mjs publish --lang zh\``,
			projectTrusted: true,
		});

		// Learner attempts to write architecture guideline duplicating the command
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: [
					{
						text: "When publishing, run `CMS_STAMP=abc node tools/cms.mjs publish --lang zh`",
						trigger: { regex: "publish" },
					},
					{
						text: "Always use pnpm instead of npm",
						trigger: { command: "npm" },
					},
				],
			}),
			projectTrusted: true,
			actor: "learner",
		});

		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const arch = JSON.parse(fs.readFileSync(path.join(projectDir, "architecture.json"), "utf8"));
		// Redundant CMS command rule was filtered out, coding convention was preserved!
		expect(arch.customGuidelines).toHaveLength(1);
		expect(arch.customGuidelines[0].text).toContain("Always use pnpm instead of npm");
	});

	it("consolidateDuplicateAdaptations unifies historical duplicates and cleans up architecture", async () => {
		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const skillsDir = path.join(projectDir, "skills");
		fs.mkdirSync(path.join(skillsDir, "cms_publish_post"), { recursive: true });
		fs.mkdirSync(path.join(skillsDir, "cms-publish-post"), { recursive: true });

		fs.writeFileSync(
			path.join(skillsDir, "cms_publish_post", "SKILL.md"),
			`---\nname: cms_publish_post\ndescription: Guide with flags\n---\n\`CMS_STAMP=abc node tools/cms.mjs publish --lang zh_Hans --nonce 123\`\n`,
		);
		fs.writeFileSync(
			path.join(skillsDir, "cms-publish-post", "SKILL.md"),
			`---\nname: cms-publish-post\ndescription: Short guide\n---\n\`CMS_STAMP=abc node tools/cms.mjs publish\`\n`,
		);

		fs.writeFileSync(
			path.join(projectDir, "architecture.json"),
			JSON.stringify({
				customGuidelines: [
					{
						text: "Run `CMS_STAMP=abc node tools/cms.mjs publish`",
						trigger: { regex: "publish" },
					},
				],
			}),
		);

		const { consolidateDuplicateAdaptations } = await import("../src/core/adaptations/store.ts");
		const result = consolidateDuplicateAdaptations(projectDir);

		expect(result.mergedSkills).toBe(1);
		expect(result.cleanedGuidelines).toBe(1);

		const remaining = fs.readdirSync(skillsDir);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]).toBe("cms-publish-post");

		const consolidatedContent = fs.readFileSync(path.join(skillsDir, "cms-publish-post", "SKILL.md"), "utf8");
		expect(consolidatedContent).toContain("--lang zh_Hans --nonce 123");

		expect(fs.existsSync(path.join(projectDir, "architecture.json"))).toBe(false);
	});

	it("merges similar user profile traits in-place and keeps richer statement", async () => {
		// First trait
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: JSON.stringify({
				version: 2,
				traits: [
					{
						dimension: "communication",
						statement: "用户主要使用中文",
						confidence: 0.8,
						evidence: ["Observed turn 1"],
						lastConfirmed: "2026-09-01T00:00:00Z",
						status: "active",
					},
				],
				followUpPredictions: [],
			}),
		});

		// Second near-duplicate trait with slightly different wording & higher confidence & userStated
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: JSON.stringify({
				version: 2,
				traits: [
					{
						dimension: "communication",
						statement: "用户主要使用中文进行交互",
						confidence: 0.95,
						evidence: ["Observed turn 2"],
						lastConfirmed: "2026-09-02T00:00:00Z",
						status: "active",
						userStated: true,
					},
				],
				followUpPredictions: [],
			}),
		});

		const userDir = getScopeDir(tempAgentDir, tempCwd, "user");
		const profile = JSON.parse(fs.readFileSync(path.join(userDir, "profile.json"), "utf8"));
		// Must not produce 2 separate traits! Must update in-place!
		expect(profile.traits).toHaveLength(1);
		expect(profile.traits[0].statement).toBe("用户主要使用中文进行交互");
		expect(profile.traits[0].confidence).toBe(0.95);
		expect(profile.traits[0].userStated).toBe(true);
		expect(profile.traits[0].evidence).toEqual(["Observed turn 1", "Observed turn 2"]);
	});

	it("normalizes follow-up prediction trigger patterns and merges support count", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: JSON.stringify({
				version: 2,
				traits: [],
				followUpPredictions: [
					{
						triggerPattern: "git commit",
						prediction: "Run tests before commit",
						supportCount: 2,
						confidence: 0.7,
					},
				],
			}),
		});

		// Write prediction with whitespace / casing difference
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: JSON.stringify({
				version: 2,
				traits: [],
				followUpPredictions: [
					{
						triggerPattern: "  GIT   commit  ",
						prediction: "Run vitest tests before commit",
						supportCount: 1,
						confidence: 0.85,
					},
				],
			}),
		});

		const userDir = getScopeDir(tempAgentDir, tempCwd, "user");
		const profile = JSON.parse(fs.readFileSync(path.join(userDir, "profile.json"), "utf8"));
		expect(profile.followUpPredictions).toHaveLength(1);
		expect(profile.followUpPredictions[0].confidence).toBe(0.85);
		expect(profile.followUpPredictions[0].supportCount).toBeGreaterThanOrEqual(3);
	});

	it("merges similar architecture guidelines in-place and preserves stable ID", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: [
					{
						id: "guideline-pnpm",
						text: "Always use pnpm instead of npm",
						trigger: { command: "npm" },
					},
				],
			}),
			projectTrusted: true,
		});

		// Incoming guideline with similar text without ID
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({
				customGuidelines: [
					{
						text: "Prefer using pnpm over npm in this repo",
						trigger: { command: "npm" },
					},
				],
			}),
			projectTrusted: true,
		});

		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const arch = JSON.parse(fs.readFileSync(path.join(projectDir, "architecture.json"), "utf8"));
		expect(arch.customGuidelines).toHaveLength(1);
		expect(arch.customGuidelines[0].id).toBe("guideline-pnpm");
	});

	it("resolves variant role names to existing role file and updates in-place", async () => {
		// First write with kebab-case
		const r1 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "role",
			name: "frontend-tester",
			content: "# Frontend Tester Role v1",
			projectTrusted: true,
		});
		expect(r1.revision).toBe(1);

		// Second write with snake_case
		const r2 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "role",
			name: "frontend_tester",
			content: "# Frontend Tester Role v2 updated",
			projectTrusted: true,
		});
		expect(r2.revision).toBe(2);

		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const rolesDir = path.join(projectDir, "roles");
		const files = fs.readdirSync(rolesDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toBe("frontend-tester.md");
		expect(fs.readFileSync(path.join(rolesDir, "frontend-tester.md"), "utf8")).toBe("# Frontend Tester Role v2 updated");
	});

	it("resolves variant workflow proposal names and duplicate check commands in-place", async () => {
		const p1 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "proposal",
			name: "lint-check",
			content: JSON.stringify({
				name: "lint-check",
				command: "npm run lint",
				extraChecks: [{ id: "lint", name: "Lint Check", command: "npm run lint" }],
			}),
			projectTrusted: true,
		});
		expect(p1.revision).toBe(1);

		// Proposal with snake_case and same command
		const p2 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "proposal",
			name: "lint_check",
			content: JSON.stringify({
				name: "lint-check",
				command: "npm run lint --fix",
				extraChecks: [{ id: "lint", name: "Lint Check", command: "npm run lint --fix" }],
			}),
			projectTrusted: true,
		});
		expect(p2.revision).toBe(2);

		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const propDir = path.join(projectDir, "workflow-proposals");
		const files = fs.readdirSync(propDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toBe("lint-check.json");
	});

	it("deduplicates workflow extraChecks by command and ensures unique string arrays", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "workflow",
			content: JSON.stringify({
				extraChecks: [
					{ id: "check-1", name: "Run Lint", command: "npm run lint" },
				],
				verificationCommands: ["npm test", "npm run lint"],
				userAddenda: ["Always test thoroughly"],
				doneCriteria: ["All tests pass"],
			}),
			projectTrusted: true,
		});

		// Update with duplicate command under different id, and duplicate strings in arrays
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "workflow",
			content: JSON.stringify({
				extraChecks: [
					{ id: "check-lint-alt", name: "Linting", command: "npm run lint" },
					{ id: "check-typecheck", name: "Typecheck", command: "npm run typecheck" },
				],
				verificationCommands: ["npm test", "npm run typecheck"],
				userAddenda: ["Always test thoroughly", "Check build"],
				doneCriteria: ["All tests pass"],
			}),
			projectTrusted: true,
		});

		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		const wf = JSON.parse(fs.readFileSync(path.join(projectDir, "workflow.json"), "utf8"));
		// check-1 was updated with new name; check-lint-alt was not added as duplicate!
		expect(wf.extraChecks).toHaveLength(2);
		expect(wf.verificationCommands).toEqual(["npm test", "npm run lint", "npm run typecheck"]);
		expect(wf.userAddenda).toEqual(["Always test thoroughly", "Check build"]);
		expect(wf.doneCriteria).toEqual(["All tests pass"]);
	});

	it("consolidates duplicate profile traits, guidelines, roles, and proposals in consolidateDuplicateAdaptations", async () => {
		const projectDir = getScopeDir(tempAgentDir, tempCwd, "project");
		fs.mkdirSync(projectDir, { recursive: true });

		// Seed duplicate profile traits in profile.json
		fs.writeFileSync(
			path.join(projectDir, "profile.json"),
			JSON.stringify({
				version: 2,
				traits: [
					{ dimension: "communication", statement: "用户偏好表格呈现", confidence: 0.8, evidence: [] },
					{ dimension: "communication", statement: "偏好表格呈现", confidence: 0.9, evidence: [] },
				],
				followUpPredictions: [
					{ triggerPattern: "npm test", prediction: "check logs", confidence: 0.6 },
					{ triggerPattern: "npm   test", prediction: "check logs", confidence: 0.7 },
				],
			}),
		);

		// Seed duplicate role files in roles/
		const rolesDir = path.join(projectDir, "roles");
		fs.mkdirSync(rolesDir, { recursive: true });
		fs.writeFileSync(path.join(rolesDir, "code_reviewer.md"), "# Code Reviewer (short)");
		fs.writeFileSync(path.join(rolesDir, "code-reviewer.md"), "# Code Reviewer (comprehensive with guidelines)");

		// Seed duplicate proposals in workflow-proposals/
		const propDir = path.join(projectDir, "workflow-proposals");
		fs.mkdirSync(propDir, { recursive: true });
		fs.writeFileSync(path.join(propDir, "build_check.json"), JSON.stringify({ name: "build-check", command: "npm run build" }));
		fs.writeFileSync(path.join(propDir, "build-check.json"), JSON.stringify({ name: "build-check", command: "npm run build" }));

		const { consolidateDuplicateAdaptations } = await import("../src/core/adaptations/store.ts");
		const res = consolidateDuplicateAdaptations(projectDir);

		expect(res.mergedTraits).toBe(1);
		expect(res.mergedRoles).toBe(1);
		expect(res.mergedProposals).toBe(1);

		const profile = JSON.parse(fs.readFileSync(path.join(projectDir, "profile.json"), "utf8"));
		expect(profile.traits).toHaveLength(1);
		expect(profile.followUpPredictions).toHaveLength(1);

		const roleFiles = fs.readdirSync(rolesDir);
		expect(roleFiles).toEqual(["code-reviewer.md"]);

		const propFiles = fs.readdirSync(propDir);
		expect(propFiles).toEqual(["build-check.json"]);
	});
});
