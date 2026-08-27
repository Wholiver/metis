import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import {
	BUILTIN_SKILLS,
	formatSkillsForPrompt,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
} from "../src/core/skills.ts";

describe("Skills System & Progressive Disclosure", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `metis-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("should allow user-level ~/.metis/skills/custom-skill to load via ResourceLoader", async () => {
		const userSkillDir = join(agentDir, "skills", "custom-skill");
		mkdirSync(userSkillDir, { recursive: true });
		const userSkillPath = join(userSkillDir, "SKILL.md");
		writeFileSync(
			userSkillPath,
			`---\nname: custom-skill\ndescription: Custom user orchestration skill\n---\nCustom user body`,
			"utf-8",
		);

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills } = loader.getSkills();
		const skill = skills.find((s) => s.name === "custom-skill");

		expect(skill).toBeDefined();
		expect(skill!.description).toBe("Custom user orchestration skill");
		expect(skill!.filePath).toBe(userSkillPath);
		expect(skill!.sourceInfo.scope).toBe("user");
	});

	it("should allow project-level .metis/skills to override user skills", async () => {
		// Create user skill
		const userSkillDir = join(agentDir, "skills", "shared-skill");
		mkdirSync(userSkillDir, { recursive: true });
		writeFileSync(
			join(userSkillDir, "SKILL.md"),
			`---\nname: shared-skill\ndescription: User override\n---\nUser body`,
			"utf-8",
		);

		// Create project skill
		const projectSkillDir = join(cwd, ".metis", "skills", "shared-skill");
		mkdirSync(projectSkillDir, { recursive: true });
		const projectSkillPath = join(projectSkillDir, "SKILL.md");
		writeFileSync(
			projectSkillPath,
			`---\nname: shared-skill\ndescription: Project override\n---\nProject body`,
			"utf-8",
		);

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills } = loader.getSkills();
		const skill = skills.find((s) => s.name === "shared-skill");

		expect(skill).toBeDefined();
		expect(skill!.description).toBe("Project override");
		expect(skill!.filePath).toBe(projectSkillPath);
		expect(skill!.sourceInfo.scope).toBe("project");
	});

	it("should respect noSkills: true in ResourceLoader and omit skills", async () => {
		const loader = new DefaultResourceLoader({ cwd, agentDir, noSkills: true });
		await loader.reload();

		const { skills } = loader.getSkills();
		expect(skills).toHaveLength(0);
	});

	it("should format skills in XML for prompt without dumping full markdown body", () => {
		const sampleSkill: Skill = {
			name: "sample-skill",
			description: "A sample skill description",
			filePath: "/path/to/SKILL.md",
			baseDir: "/path/to",
			sourceInfo: { source: "builtin", scope: "user" },
		};

		const promptXml = formatSkillsForPrompt([sampleSkill]);

		expect(promptXml).toContain("<available_skills>");
		expect(promptXml).toContain("<skill>");
		expect(promptXml).toContain("<name>sample-skill</name>");
		expect(promptXml).toContain("<description>A sample skill description</description>");
		expect(promptXml).toContain("<location>/path/to/SKILL.md</location>");
		expect(promptXml).toContain("</skill>");
		expect(promptXml).toContain("</available_skills>");
	});
});

