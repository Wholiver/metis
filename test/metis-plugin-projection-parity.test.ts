import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Projector } from "../packages/metis-plugin/src/projector.ts";
import { loadContracts } from "../packages/metis-plugin/src/contracts.ts";
import { BUILTIN_AGENTS } from "../src/core/agent-definition.ts";

function extractTomlPrompt(text: string): string {
	const m = text.match(/developer_instructions = '''([\s\S]*?)'''/);
	return m ? m[1].trim() : "";
}

function extractMdBody(text: string): string {
	const fm = text.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
	return (fm ? fm[1] : text).trim();
}

describe("Metis plugin projection parity with BUILTIN_AGENTS", () => {
	let outDir: string;

	beforeEach(() => {
		outDir = join(tmpdir(), `metis-proj-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(outDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(outDir, { recursive: true, force: true });
	});

	it("projects Codex/OpenCode/DeepSeek role prompts equal to rewritten BUILTIN_AGENTS", () => {
		const contracts = loadContracts();
		const projector = new Projector(contracts);
		const results = projector.projectAll(outDir);

		expect(Object.keys(results)).toEqual(expect.arrayContaining(["codex", "opencode", "deepseek"]));

		const byName = new Map(BUILTIN_AGENTS.map((a) => [a.name, a.systemPrompt.trim()]));

		for (const agent of BUILTIN_AGENTS) {
			const codexPath = join(outDir, "codex", "agents", `metis-${agent.name}.toml`);
			const ocPath = join(outDir, "opencode", "agents", `metis-${agent.name}.md`);
			const dsPath = join(outDir, "deepseek", "agents", `metis-${agent.name}.md`);
			expect(existsSync(codexPath), codexPath).toBe(true);
			expect(existsSync(ocPath), ocPath).toBe(true);
			expect(existsSync(dsPath), dsPath).toBe(true);

			const expected = byName.get(agent.name)!;
			expect(extractTomlPrompt(readFileSync(codexPath, "utf8"))).toBe(expected);
			expect(extractMdBody(readFileSync(ocPath, "utf8"))).toBe(expected);
			expect(extractMdBody(readFileSync(dsPath, "utf8"))).toBe(expected);
		}

		const skills = {
			codex: readFileSync(join(outDir, "codex", "skills", "metis", "SKILL.md"), "utf8"),
			opencode: readFileSync(join(outDir, "opencode", "skills", "metis", "SKILL.md"), "utf8"),
			deepseek: readFileSync(join(outDir, "deepseek", "skills", "metis", "SKILL.md"), "utf8"),
		};
		const opencodeCommand = readFileSync(join(outDir, "opencode", "commands", "metis.md"), "utf8");

		for (const [host, skill] of Object.entries(skills)) {
			expect(skill, host).toContain("T2");
			expect(skill, host).toContain("T3");
			expect(skill, host).toContain("depth-prober");
			expect(skill, host).toContain("ChildResult");
			expect(skill, host).not.toContain("self-learning");
			expect(skill, host).toContain("There is no default route");
			expect(skill, host).toContain("Author cannot check the exact version they wrote");
			expect(skill, host).toContain("metis-reviewer");
			expect(skill, host).toContain("metis-verifier");
			expect(skill, host).toContain("做一个鹈鹕骑自行车 svg");
			expect(skill, host).toContain("T1 + `frontend-build`");
			expect(skill, host).toContain("Route rule (ownership shape only)");
			expect(skill, host).toContain("Exactly one ownership surface → T1");
			expect(skill, host).toContain("≥2 surfaces that must run serially → T2");
			expect(skill, host).toContain("Root executes G2");
			expect(skill, host).toContain("root executes goal-check");
			expect(skill, host).toContain("non-overlapping owned paths");
			expect(skill, host).not.toContain("G2 via `scope-coordinator`");
			expect(skill, host).not.toMatch(/T3[\s\S]{0,200}dispatch `goal-checker`/);
			expect(skill, host).not.toContain("Jump directly to execution");
		}

		expect(skills.codex).toContain("activation: explicit-only");
		expect(skills.codex).toContain("allow-implicit-invocation: false");
		expect(skills.codex).toContain("metis-plugin activate codex");

		expect(skills.opencode).toContain("metis-plugin activate opencode");
		expect(skills.opencode).toContain("Loading a skill never creates or resumes a run");
		expect(opencodeCommand).toContain("metis-plugin activate opencode");
		expect(opencodeCommand).toContain("There is no default route");

		expect(skills.deepseek).toContain("metis-plugin activate deepseek");
		expect(skills.deepseek).toContain("Loading a skill never creates or resumes a run");

		const gates = readFileSync(join(outDir, "codex", "skills", "metis", "GATES.md"), "utf8");
		expect(gates).toMatch(/G2[\s\S]*\*\*Role\*\*: scope-coordinator/);
		expect(gates).toMatch(/G3\.5[\s\S]*\*\*Role\*\*: depth-prober/);
		expect(gates).toMatch(/G7[\s\S]*\*\*Role\*\*: juror/);
		expect(gates).toMatch(/sweep[\s\S]*\*\*Role\*\*: sweeper/);
		expect(gates).toMatch(/goal-check[\s\S]*\*\*Role\*\*: goal-checker/);
		expect(gates).toContain("root closes on T3");
		expect(gates).toContain("not in the spawn allowlist");

		const supervisor = readFileSync(join(outDir, "codex", "workflow", "supervisor.toml"), "utf8");
		expect(supervisor).toContain("depth_prober");
		expect(supervisor).toContain("goal_checker");
		expect(supervisor).toContain("sweeper");
		expect(supervisor).toContain("juror");
	});
});
