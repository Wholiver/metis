import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	AgentRegistry,
	BUILTIN_AGENTS,
	BUILTIN_COORDINATOR,
	BUILTIN_IMPLEMENTER,
	BUILTIN_PLANNER,
	BUILTIN_REVIEWER,
	BUILTIN_VERIFIER,
	formatAgentsForPrompt,
	loadAgents,
	loadAgentsFromDir,
	parseAgentDefinition,
	resolveAgentConfig,
	validateAgentDescription,
	validateAgentName,
	DefaultResourceLoader,
	getUserAgentsDir,
} from "../src/index.ts";

describe("AgentDefinition and Schema Validation (Bundle 1)", () => {
	it("validates agent names according to spec", () => {
		expect(validateAgentName("planner")).toEqual([]);
		expect(validateAgentName("code-reviewer_v2")).toEqual([]);
		expect(validateAgentName("agent123")).toEqual([]);

		// Invalid cases
		expect(validateAgentName("").length).toBeGreaterThan(0);
		expect(validateAgentName("Planner").length).toBeGreaterThan(0); // uppercase
		expect(validateAgentName("planner with spaces").length).toBeGreaterThan(0);
		expect(validateAgentName("-planner").length).toBeGreaterThan(0);
		expect(validateAgentName("planner-").length).toBeGreaterThan(0);
		expect(validateAgentName("plan--ner").length).toBeGreaterThan(0);
		expect(validateAgentName("a".repeat(65)).length).toBeGreaterThan(0);
	});

	it("validates agent description according to spec", () => {
		expect(validateAgentDescription("A helpful planner agent")).toEqual([]);
		expect(validateAgentDescription("").length).toBeGreaterThan(0);
		expect(validateAgentDescription(undefined).length).toBeGreaterThan(0);
		expect(validateAgentDescription("x".repeat(1025)).length).toBeGreaterThan(0);
	});

	it("parses valid agent definition with frontmatter", () => {
		const content = `---
name: custom-scout
description: Fast codebase researcher
tools: read, grep, find, ls
model: claude-sonnet-4-5
provider: anthropic
thinking: high
env:
  DEBUG: "1"
maxSpawnDepth: 3
---

You are a codebase scout. Search and summarize findings.
`;
		const result = parseAgentDefinition(content, "/fake/custom-scout.md", "user");
		expect(result.diagnostics).toEqual([]);
		expect(result.agent).not.toBeNull();
		expect(result.agent?.name).toBe("custom-scout");
		expect(result.agent?.description).toBe("Fast codebase researcher");
		expect(result.agent?.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(result.agent?.model).toBe("claude-sonnet-4-5");
		expect(result.agent?.provider).toBe("anthropic");
		expect(result.agent?.thinking).toBe("high");
		expect(result.agent?.env).toEqual({ DEBUG: "1" });
		expect(result.agent?.maxSpawnDepth).toBe(3);
		expect(result.agent?.systemPrompt).toBe("You are a codebase scout. Search and summarize findings.");
		expect(result.agent?.source).toBe("user");
	});

	it("handles array tools and disallowedTools in frontmatter", () => {
		const content = `---
name: worker
description: Executes tasks
tools:
  - read
  - write
  - bash
disallowedTools:
  - bash
---
Worker prompt.
`;
		const result = parseAgentDefinition(content, "/fake/worker.md", "project");
		expect(result.agent).not.toBeNull();
		expect(result.agent?.tools).toEqual(["read", "write", "bash"]);
		expect(result.agent?.disallowedTools).toEqual(["bash"]);
	});

	it("rejects invalid agent definition and reports diagnostics", () => {
		const content = `---
name: INVALID_NAME
description:
---
Body text.
`;
		const result = parseAgentDefinition(content, "/fake/invalid.md", "user");
		expect(result.agent).toBeNull();
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});
});

describe("Built-in Standard Roles & Specialized Personas (Feat 52 & Feat 27)", () => {
	it("contains standard builtin roles and specialized personas", () => {
		expect(BUILTIN_AGENTS.length).toBeGreaterThanOrEqual(5);
		const names = BUILTIN_AGENTS.map((a) => a.name);
		expect(names).toContain("coordinator");
		expect(names).toContain("planner");
		expect(names).toContain("implementer");
		expect(names).toContain("reviewer");
		expect(names).toContain("verifier");
	});

	it("coordinator role retains spawn_agent tool and delegation capabilities", () => {
		expect(BUILTIN_COORDINATOR.tools).toContain("spawn_agent");
		expect(BUILTIN_COORDINATOR.systemPrompt).toContain("planner");
		expect(BUILTIN_COORDINATOR.systemPrompt).toContain("implementer");
	});

	it("planner role has planning, reproduction, and inspection tools without mutating tools", () => {
		expect(BUILTIN_PLANNER.tools).toEqual(["read", "bash", "grep", "find", "ls", "performance_gate"]);
		expect(BUILTIN_PLANNER.tools).not.toContain("spawn_agent");
		expect(BUILTIN_PLANNER.tools).not.toContain("write");
		expect(BUILTIN_PLANNER.tools).not.toContain("edit");
		expect(BUILTIN_PLANNER.tools).toContain("bash");
	});

	it("implementer role has write and execution tools without spawn_agent", () => {
		expect(BUILTIN_IMPLEMENTER.tools).toContain("read");
		expect(BUILTIN_IMPLEMENTER.tools).toContain("write");
		expect(BUILTIN_IMPLEMENTER.tools).toContain("edit");
		expect(BUILTIN_IMPLEMENTER.tools).toContain("bash");
		expect(BUILTIN_IMPLEMENTER.tools).toContain("performance_gate");
		expect(BUILTIN_IMPLEMENTER.tools).not.toContain("spawn_agent");
	});

	it("reviewer role has read, bash, and inspection tools for review receipts", () => {
		expect(BUILTIN_REVIEWER.tools).toEqual(["read", "bash", "grep", "find", "ls", "performance_gate"]);
		expect(BUILTIN_REVIEWER.tools).not.toContain("spawn_agent");
		expect(BUILTIN_REVIEWER.tools).not.toContain("write");
		expect(BUILTIN_REVIEWER.tools).not.toContain("edit");
	});

	it("verifier role has runtime verification and inspection tools", () => {
		expect(BUILTIN_VERIFIER.tools).toEqual(["read", "bash", "grep", "find", "ls", "performance_gate"]);
		expect(BUILTIN_VERIFIER.tools).not.toContain("spawn_agent");
		expect(BUILTIN_VERIFIER.tools).not.toContain("write");
		expect(BUILTIN_VERIFIER.tools).not.toContain("edit");
	});
});

describe("Agent Loading and Precedence (Feat 2 & Feat 7)", () => {
	let tempDir: string;
	let userDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-agent-test-"));
		userDir = path.join(tempDir, "user", "agents");
		projectDir = path.join(tempDir, "project", ".metis", "agents");
		fs.mkdirSync(userDir, { recursive: true });
		fs.mkdirSync(projectDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads agents from directory", () => {
		fs.writeFileSync(
			path.join(userDir, "scout.md"),
			`---
name: scout
description: Fast codebase researcher
tools: read, grep
---
Scout prompt.
`,
		);

		const result = loadAgentsFromDir(userDir, "user");
		expect(result.agents.length).toBe(1);
		expect(result.agents[0].name).toBe("scout");
		expect(result.agents[0].source).toBe("user");
	});

	it("respects precedence: Project overrides User, User overrides Builtin", () => {
		// User overrides builtin planner
		fs.writeFileSync(
			path.join(userDir, "planner.md"),
			`---
name: planner
description: User custom planner
tools: read, grep
---
User planner prompt.
`,
		);

		// Project overrides coordinator
		fs.writeFileSync(
			path.join(projectDir, "coordinator.md"),
			`---
name: coordinator
description: Project custom coordinator
tools: spawn_agent, read
---
Project coordinator prompt.
`,
		);

		// Project also provides a unique project-worker
		fs.writeFileSync(
			path.join(projectDir, "project-worker.md"),
			`---
name: project-worker
description: Project specific worker
---
Project worker prompt.
`,
		);

		const { agents, diagnostics } = loadAgents({
			cwd: path.join(tempDir, "project"),
			agentDir: path.join(tempDir, "user"),
			includeBuiltins: true,
		});

		const registry = new AgentRegistry(agents, diagnostics);

		// Planner should be user's version
		const planner = registry.get("planner");
		expect(planner?.description).toBe("User custom planner");
		expect(planner?.source).toBe("user");

		// Coordinator should be project's version
		const coordinator = registry.get("coordinator");
		expect(coordinator?.description).toBe("Project custom coordinator");
		expect(coordinator?.source).toBe("project");

		// Implementer should still be builtin
		const implementer = registry.get("implementer");
		expect(implementer?.source).toBe("builtin");

		// Project-worker should exist
		expect(registry.has("project-worker")).toBe(true);

		// Collision diagnostics should record overrides
		expect(diagnostics.some((d) => d.type === "collision" && d.collision?.name === "planner")).toBe(true);
		expect(diagnostics.some((d) => d.type === "collision" && d.collision?.name === "coordinator")).toBe(true);
	});
});

describe("AgentRegistry (Feat 7)", () => {
	it("supports registration, lookup, case-insensitivity, and XML prompt formatting", () => {
		const registry = new AgentRegistry(BUILTIN_AGENTS);

		expect(registry.has("PLANNER")).toBe(true);
		expect(registry.get("Planner")?.name).toBe("planner");
		expect(registry.getAll().length).toBeGreaterThanOrEqual(5);

		const xml = registry.toPromptXml();
		expect(xml).toContain("<available_agents>");
		expect(xml).toContain("<name>coordinator</name>");
		expect(xml).toContain("<name>planner</name>");
		expect(xml).toContain("<tools>read, write, bash, edit, grep, find, ls, performance_gate</tools>");
		expect(xml).toContain("</available_agents>");
	});
});

describe("Configuration Inheritance and Overrides (Feat 11 & Feat 26)", () => {
	it("resolves model, provider, and thinking: Agent > Parent > Global", () => {
		const agent: typeof BUILTIN_PLANNER = {
			...BUILTIN_PLANNER,
			model: "agent-model",
			thinking: "high",
		};

		// 1. Agent specifies model and thinking -> agent takes precedence
		const resolved1 = resolveAgentConfig({
			agent,
			parentConfig: { model: "parent-model", provider: "parent-provider", thinking: "low" },
			globalConfig: { model: "global-model", provider: "global-provider", thinking: "off" },
		});
		expect(resolved1.model).toBe("agent-model");
		expect(resolved1.provider).toBe("parent-provider"); // inherited from parent
		expect(resolved1.thinking).toBe("high");

		// 2. Agent doesn't specify -> parent takes precedence
		const agentWithoutModel: typeof BUILTIN_PLANNER = {
			...BUILTIN_PLANNER,
			model: undefined,
			provider: undefined,
			thinking: undefined,
		};
		const resolved2 = resolveAgentConfig({
			agent: agentWithoutModel,
			parentConfig: { model: "parent-model", provider: "parent-provider", thinking: "medium" },
			globalConfig: { model: "global-model", provider: "global-provider", thinking: "off" },
		});
		expect(resolved2.model).toBe("parent-model");
		expect(resolved2.provider).toBe("parent-provider");
		expect(resolved2.thinking).toBe("medium");

		// 3. Neither agent nor parent specifies -> fallback to global
		const resolved3 = resolveAgentConfig({
			agent: agentWithoutModel,
			parentConfig: undefined,
			globalConfig: { model: "global-model", provider: "global-provider", thinking: "minimal" },
		});
		expect(resolved3.model).toBe("global-model");
		expect(resolved3.provider).toBe("global-provider");
		expect(resolved3.thinking).toBe("minimal");
	});

	it("strictly converges tool permissions (child cannot escalate privileges)", () => {
		// Agent wants: read, write, bash, edit
		const agent = BUILTIN_IMPLEMENTER;

		// Parent only allows read and grep
		const resolved = resolveAgentConfig({
			agent,
			parentConfig: {
				tools: ["read", "grep"],
			},
		});

		// Intersection: ["read"] (since implementer has read, write, edit, bash, grep, find, ls -> intersection is read, grep)
		expect(resolved.tools).toEqual(["read", "grep"]);
		expect(resolved.tools).not.toContain("bash");
		expect(resolved.tools).not.toContain("write");
	});

	it("filters out disallowedTools", () => {
		const agent: typeof BUILTIN_IMPLEMENTER = {
			...BUILTIN_IMPLEMENTER,
			disallowedTools: ["bash", "edit"],
		};

		const resolved = resolveAgentConfig({
			agent,
			parentConfig: {
				tools: ["read", "write", "edit", "bash"],
			},
		});

		expect(resolved.tools).toEqual(["read", "write"]);
		expect(resolved.tools).not.toContain("bash");
		expect(resolved.tools).not.toContain("edit");
	});

	it("merges environment variables from parent and agent", () => {
		const agent: typeof BUILTIN_PLANNER = {
			...BUILTIN_PLANNER,
			env: { AGENT_VAR: "agent_value", SHARED_VAR: "agent_override" },
		};

		const resolved = resolveAgentConfig({
			agent,
			parentConfig: {
				env: { PARENT_VAR: "parent_value", SHARED_VAR: "parent_value" },
			},
		});

		expect(resolved.env).toEqual({
			PARENT_VAR: "parent_value",
			SHARED_VAR: "agent_override",
			AGENT_VAR: "agent_value",
		});
	});
});

describe("ResourceLoader Agent Integration", () => {
	let tempDir: string;
	let userDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-res-loader-test-"));
		userDir = path.join(tempDir, "user");
		projectDir = path.join(tempDir, "project");
		fs.mkdirSync(path.join(userDir, "agents"), { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".metis", "agents"), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads agents through DefaultResourceLoader and exposes AgentRegistry", async () => {
		fs.writeFileSync(
			path.join(projectDir, ".metis", "agents", "custom.md"),
			`---
name: custom
description: A custom project agent
tools: read, grep
---
Custom prompt.
`,
		);

		const loader = new DefaultResourceLoader({
			cwd: projectDir,
			agentDir: userDir,
		});

		await loader.reload();

		const { agents } = loader.getAgents();
		const registry = loader.getAgentRegistry();

		expect(agents.length).toBe(BUILTIN_AGENTS.length + 1); // builtins + 1 custom
		expect(registry.has("custom")).toBe(true);
		expect(registry.get("custom")?.description).toBe("A custom project agent");
		expect(registry.has("planner")).toBe(true);
	});

	it("supports noAgents option", async () => {
		const loader = new DefaultResourceLoader({
			cwd: projectDir,
			agentDir: userDir,
			noAgents: true,
		});

		await loader.reload();

		const { agents } = loader.getAgents();
		expect(agents.length).toBe(0);
	});
});

