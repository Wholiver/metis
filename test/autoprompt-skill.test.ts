import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import {
	BUILTIN_AUTOPROMPT_DESCRIPTION,
	BUILTIN_AUTOPROMPT_SKILL,
	BUILTIN_SKILLS,
	formatSkillsForPrompt,
	getBuiltinAutopromptFilePath,
	loadSkills,
	loadSkillsFromDir,
} from "../src/core/skills.ts";

describe("autoprompt built-in skill & multi-agent orchestration (Bundle 5 / Feat 28, 30, 31)", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `metis-autoprompt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("should export BUILTIN_AUTOPROMPT_SKILL and have a valid physical SKILL.md file", () => {
		expect(BUILTIN_AUTOPROMPT_SKILL.name).toBe("autoprompt");
		expect(BUILTIN_AUTOPROMPT_SKILL.description).toBe(BUILTIN_AUTOPROMPT_DESCRIPTION);
		expect(BUILTIN_SKILLS).toContain(BUILTIN_AUTOPROMPT_SKILL);

		const physicalPath = getBuiltinAutopromptFilePath();
		expect(existsSync(physicalPath)).toBe(true);

		const content = readFileSync(physicalPath, "utf-8");
		expect(content).toContain("name: autoprompt");
		expect(content).toContain("coordinator");
		expect(content).toContain("planner");
		expect(content).toContain("implementer");
		expect(content).toContain("reviewer");
		expect(content).toContain("verifier");
		expect(content).toContain("Adaptive Workflow Tiers");
		expect(content).toContain("spawn_agent");
	});

	it("should automatically discover and load built-in autoprompt skill via ResourceLoader", async () => {
		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills, diagnostics } = loader.getSkills();
		const autoprompt = skills.find((s) => s.name === "autoprompt");

		expect(autoprompt).toBeDefined();
		expect(autoprompt!.name).toBe("autoprompt");
		expect(autoprompt!.description).toContain("Autonomous orchestration skill");
		expect(autoprompt!.sourceInfo.source).toBe("builtin");
	});

	it("should allow user-level ~/.metis/skills/autoprompt to override built-in autoprompt", async () => {
		const userSkillDir = join(agentDir, "skills", "autoprompt");
		mkdirSync(userSkillDir, { recursive: true });
		const userSkillPath = join(userSkillDir, "SKILL.md");
		writeFileSync(
			userSkillPath,
			`---\nname: autoprompt\ndescription: Custom user orchestration override\n---\nCustom user body`,
			"utf-8",
		);

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills } = loader.getSkills();
		const autoprompt = skills.find((s) => s.name === "autoprompt");

		expect(autoprompt).toBeDefined();
		expect(autoprompt!.description).toBe("Custom user orchestration override");
		expect(autoprompt!.filePath).toBe(userSkillPath);
		expect(autoprompt!.sourceInfo.scope).toBe("user");
	});

	it("should allow project-level .metis/skills/autoprompt to override user & built-in autoprompt", async () => {
		// Create user skill
		const userSkillDir = join(agentDir, "skills", "autoprompt");
		mkdirSync(userSkillDir, { recursive: true });
		writeFileSync(
			join(userSkillDir, "SKILL.md"),
			`---\nname: autoprompt\ndescription: User override\n---\nUser body`,
			"utf-8",
		);

		// Create project skill
		const projectSkillDir = join(cwd, ".metis", "skills", "autoprompt");
		mkdirSync(projectSkillDir, { recursive: true });
		const projectSkillPath = join(projectSkillDir, "SKILL.md");
		writeFileSync(
			projectSkillPath,
			`---\nname: autoprompt\ndescription: Project override\n---\nProject body`,
			"utf-8",
		);

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills } = loader.getSkills();
		const autoprompt = skills.find((s) => s.name === "autoprompt");

		expect(autoprompt).toBeDefined();
		expect(autoprompt!.description).toBe("Project override");
		expect(autoprompt!.filePath).toBe(projectSkillPath);
		expect(autoprompt!.sourceInfo.scope).toBe("project");
	});

	it("should respect noSkills: true in ResourceLoader and omit built-in skills", async () => {
		const loader = new DefaultResourceLoader({ cwd, agentDir, noSkills: true });
		await loader.reload();

		const { skills } = loader.getSkills();
		expect(skills).toHaveLength(0);
	});

	it("should format skills in XML for prompt without dumping full markdown body (Feat 30)", () => {
		const promptXml = formatSkillsForPrompt([BUILTIN_AUTOPROMPT_SKILL]);

		expect(promptXml).toContain("<available_skills>");
		expect(promptXml).toContain("<skill>");
		expect(promptXml).toContain("<name>autoprompt</name>");
		expect(promptXml).toContain(`<description>${BUILTIN_AUTOPROMPT_DESCRIPTION}</description>`);
		expect(promptXml).toContain(`<location>${BUILTIN_AUTOPROMPT_SKILL.filePath}</location>`);
		expect(promptXml).toContain("</skill>");
		expect(promptXml).toContain("</available_skills>");

		// Assert that full markdown instruction body is NOT injected directly in prompt XML
		expect(promptXml).not.toContain("Adaptive Workflow Tiers");
		expect(promptXml).not.toContain("Tier A: Lightweight");
	});

	it("should include dynamic feedback loops and backtracking in autoprompt skill definition", () => {
		const physicalPath = getBuiltinAutopromptFilePath();
		const content = readFileSync(physicalPath, "utf-8");

		expect(content).toContain("Dynamic Feedback Loops & Backtracking");
		expect(content).toContain("Review Failure Backtracking");
		expect(content).toContain("Verification Failure Backtracking");
		expect(content).toContain("CHANGES_REQUESTED");
		expect(content).toContain("Convergence Guardrails");
	});

	it("should support loadSkills with includeBuiltins: true", () => {
		const result = loadSkills({
			cwd,
			agentDir,
			includeBuiltins: true,
		});

		const autoprompt = result.skills.find((s) => s.name === "autoprompt");
		expect(autoprompt).toBeDefined();
		expect(autoprompt!.name).toBe("autoprompt");
	});
});
