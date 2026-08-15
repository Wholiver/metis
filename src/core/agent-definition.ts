import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Type, type Static } from "typebox";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

/** Max agent name length */
export const MAX_AGENT_NAME_LENGTH = 64;

/** Max agent description length */
export const MAX_AGENT_DESCRIPTION_LENGTH = 1024;

/** Thinking levels supported */
export const ThinkingLevelSchema = Type.Union([
	Type.Literal("off"),
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
]);

export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;

/** TypeBox schema for agent frontmatter */
export const AgentFrontmatterSchema = Type.Object({
	name: Type.String({
		description: "Unique identifier for the agent (lowercase letters, numbers, hyphens, underscores)",
		maxLength: MAX_AGENT_NAME_LENGTH,
	}),
	description: Type.String({
		description: "Brief summary of what the agent does and when to delegate to it",
		maxLength: MAX_AGENT_DESCRIPTION_LENGTH,
	}),
	tools: Type.Optional(
		Type.Union([
			Type.Array(Type.String()),
			Type.String({ description: "Comma-separated list of allowed tool names" }),
		]),
	),
	disallowedTools: Type.Optional(
		Type.Union([
			Type.Array(Type.String()),
			Type.String({ description: "Comma-separated list of disallowed tool names" }),
		]),
	),
	model: Type.Optional(Type.String({ description: "Specific model to use for this agent" })),
	provider: Type.Optional(Type.String({ description: "Specific provider to use for this agent" })),
	thinking: Type.Optional(ThinkingLevelSchema),
	env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Environment variables for the agent" })),
	maxSpawnDepth: Type.Optional(Type.Number({ description: "Maximum recursive spawn depth for this agent" })),
});

export type AgentFrontmatter = Static<typeof AgentFrontmatterSchema>;

export type AgentScope = "builtin" | "user" | "project" | "temporary" | "path";

/** Full structured Agent definition in memory */
export interface AgentDefinition {
	name: string;
	description: string;
	tools?: string[];
	disallowedTools?: string[];
	model?: string;
	provider?: string;
	thinking?: ThinkingLevel;
	env?: Record<string, string>;
	maxSpawnDepth?: number;
	systemPrompt: string;
	source: AgentScope;
	filePath: string;
	sourceInfo: SourceInfo;
}

export interface AgentDiscoveryResult {
	agents: AgentDefinition[];
	diagnostics: ResourceDiagnostic[];
}

/** Built-in Standard 5 Roles (Feat 52 & Feat 27) */
export const BUILTIN_COORDINATOR: AgentDefinition = {
	name: "coordinator",
	description:
		"Orchestrates complex multi-step tasks by breaking them down and delegating to specialist subagents (planner, implementer, reviewer, verifier).",
	tools: ["spawn_agent", "read", "grep", "find", "ls"],
	systemPrompt: [
		"You are a task coordinator and orchestrator. Your primary role is to understand user objectives, coordinate subagents (planner, implementer, reviewer, verifier), and ensure high-quality execution.",
		"",
		"Key responsibilities:",
		"1. Analyze complex requests and determine the appropriate subagent delegation workflow (adaptive tiers).",
		"2. Delegate planning to the `planner` agent before making non-trivial changes.",
		"3. Delegate implementation to the `implementer` agent with clear goals and constraints.",
		"4. Delegate review to the `reviewer` agent and verification to the `verifier` agent.",
		"5. Dynamic Feedback Loops & Backtracking:",
		"   - If `reviewer` issues `CHANGES_REQUESTED`, do not finish. Backtrack to `implementer` (or `planner` for architectural flaws) with the specific review findings to fix the issues.",
		"   - If `verifier` reports test failures or build errors, backtrack to `implementer` with the failure logs to resolve the errors, then re-verify until passing.",
		"6. Synthesize findings across all steps and deliver evidence-based final outcomes clearly to the user.",
	].join("\n"),
	source: "builtin",
	filePath: "<builtin:coordinator>",
	sourceInfo: createSyntheticSourceInfo("<builtin:coordinator>", { source: "builtin", scope: "user" }),
};

export const BUILTIN_PLANNER: AgentDefinition = {
	name: "planner",
	description:
		"Analyzes context, codebase structure, and requirements to generate concrete, actionable implementation plans without modifying files.",
	tools: ["read", "grep", "find", "ls"],
	systemPrompt: [
		"You are a planning specialist. You analyze requirements, inspect codebase structure, and produce a clear, phased implementation plan.",
		"",
		"You must NOT make any changes. Only read, analyze, and plan.",
		"If invoked to re-plan after a review rejection or unexpected blocker, analyze the root cause and provide an updated strategy.",
		"",
		"Output format:",
		"## Goal",
		"One sentence summary of the goal.",
		"",
		"## Findings & Context",
		"Key files, functions, and architecture observed.",
		"",
		"## Phased Plan",
		"Numbered, actionable steps with specific file paths and changes.",
		"",
		"## Risks & Edge Cases",
		"Potential failure modes or edge cases to address.",
	].join("\n"),
	source: "builtin",
	filePath: "<builtin:planner>",
	sourceInfo: createSyntheticSourceInfo("<builtin:planner>", { source: "builtin", scope: "user" }),
};

export const BUILTIN_IMPLEMENTER: AgentDefinition = {
	name: "implementer",
	description: "Executes code changes, edits files, and runs terminal commands according to the implementation plan.",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
	systemPrompt: [
		"You are an implementation specialist. You execute code changes, write files, edit existing files, and run commands precisely as planned.",
		"",
		"Guidelines:",
		"1. Follow existing patterns, types, and style in the codebase.",
		"2. Make minimal, focused changes strictly relevant to the task.",
		"3. If provided with review feedback or test failure logs from previous attempts, address all reported issues directly.",
		"4. Verify changes compile and do not introduce syntax or lint errors.",
	].join("\n"),
	source: "builtin",
	filePath: "<builtin:implementer>",
	sourceInfo: createSyntheticSourceInfo("<builtin:implementer>", { source: "builtin", scope: "user" }),
};

export const BUILTIN_REVIEWER: AgentDefinition = {
	name: "reviewer",
	description: "Performs code reviews, diff inspections, safety checks, and architectural adherence audits.",
	tools: ["read", "grep", "find", "ls"],
	systemPrompt: [
		"You are a code review and quality audit specialist. You inspect diffs and code modifications to identify bugs, regressions, security risks, or style violations.",
		"",
		"You must NOT make any modifications directly.",
		"",
		"Output format:",
		"## Review Summary",
		"Overview of the quality and safety of the changes.",
		"",
		"## Findings",
		"- Issue: [Description of issue, file location, severity: High/Medium/Low]",
		"- Recommendation: [Concrete, actionable suggestion for the implementer to fix]",
		"",
		"## Verdict",
		"APPROVED | CHANGES_REQUESTED",
	].join("\n"),
	source: "builtin",
	filePath: "<builtin:reviewer>",
	sourceInfo: createSyntheticSourceInfo("<builtin:reviewer>", { source: "builtin", scope: "user" }),
};

export const BUILTIN_VERIFIER: AgentDefinition = {
	name: "verifier",
	description:
		"Executes test suites, linters, build scripts, and end-to-end verification to confirm acceptance criteria are met.",
	tools: ["bash", "read", "grep", "find", "ls"],
	systemPrompt: [
		"You are a test and verification specialist. You run automated test suites, type checks, build commands, and verify acceptance criteria.",
		"",
		"Guidelines:",
		"1. Run relevant automated test suites and verify exit codes.",
		"2. Check for edge cases, regression failures, and unhandled errors.",
		"3. Report clear pass/fail status with exact test output, failing test names, and error logs so implementer can fix any issues.",
	].join("\n"),
	source: "builtin",
	filePath: "<builtin:verifier>",
	sourceInfo: createSyntheticSourceInfo("<builtin:verifier>", { source: "builtin", scope: "user" }),
};

export const BUILTIN_AGENTS: AgentDefinition[] = [
	BUILTIN_COORDINATOR,
	BUILTIN_PLANNER,
	BUILTIN_IMPLEMENTER,
	BUILTIN_REVIEWER,
	BUILTIN_VERIFIER,
];

/** Validate agent name */
export function validateAgentName(name: string): string[] {
	const errors: string[] = [];
	if (!name || name.trim() === "") {
		errors.push("Agent name is required");
		return errors;
	}

	if (name.length > MAX_AGENT_NAME_LENGTH) {
		errors.push(`Agent name exceeds ${MAX_AGENT_NAME_LENGTH} characters (${name.length})`);
	}

	if (!/^[a-z0-9_-]+$/.test(name)) {
		errors.push("Agent name must only contain lowercase alphanumeric characters, hyphens, and underscores");
	}

	if (/^[-_]|[-_]$/.test(name)) {
		errors.push("Agent name must not start or end with a hyphen or underscore");
	}

	if (/[-_]{2}/.test(name)) {
		errors.push("Agent name must not contain consecutive hyphens or underscores");
	}

	return errors;
}

/** Validate agent description */
export function validateAgentDescription(description: string | undefined): string[] {
	const errors: string[] = [];
	if (!description || description.trim() === "") {
		errors.push("Agent description is required");
		return errors;
	}

	if (description.length > MAX_AGENT_DESCRIPTION_LENGTH) {
		errors.push(`Agent description exceeds ${MAX_AGENT_DESCRIPTION_LENGTH} characters (${description.length})`);
	}

	return errors;
}

function parseStringList(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		return value.map((v) => String(v).trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
	}
	return undefined;
}

function parseEnvRecord(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
			result[k] = String(v);
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function isValidThinking(value: unknown): value is ThinkingLevel {
	return (
		typeof value === "string" &&
		["off", "minimal", "low", "medium", "high", "xhigh"].includes(value.toLowerCase())
	);
}

function createAgentSourceInfo(filePath: string, baseDir: string, source: AgentScope): SourceInfo {
	switch (source) {
		case "user":
			return createSyntheticSourceInfo(filePath, { source: "local", scope: "user", baseDir });
		case "project":
			return createSyntheticSourceInfo(filePath, { source: "local", scope: "project", baseDir });
		case "builtin":
			return createSyntheticSourceInfo(filePath, { source: "builtin", scope: "user", baseDir });
		case "path":
			return createSyntheticSourceInfo(filePath, { source: "local", baseDir });
		default:
			return createSyntheticSourceInfo(filePath, { source: "local", scope: "temporary", baseDir });
	}
}

/** Parse an Agent markdown definition file */
export function parseAgentDefinition(
	rawContent: string,
	filePath: string,
	source: AgentScope,
): { agent: AgentDefinition | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];

	try {
		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(rawContent);

		const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : basename(filePath).replace(/\.md$/, "").trim();
		const nameErrors = validateAgentName(name);
		for (const err of nameErrors) {
			diagnostics.push({ type: "warning", message: err, path: filePath });
		}

		const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : undefined;
		const descErrors = validateAgentDescription(description);
		for (const err of descErrors) {
			diagnostics.push({ type: "warning", message: err, path: filePath });
		}

		if (nameErrors.length > 0 || !description) {
			return { agent: null, diagnostics };
		}

		const tools = parseStringList(frontmatter.tools);
		const disallowedTools = parseStringList(frontmatter.disallowedTools ?? frontmatter["disallowed-tools"]);
		const model = typeof frontmatter.model === "string" && frontmatter.model.trim() ? frontmatter.model.trim() : undefined;
		const provider =
			typeof frontmatter.provider === "string" && frontmatter.provider.trim() ? frontmatter.provider.trim() : undefined;

		let thinking: ThinkingLevel | undefined;
		if (frontmatter.thinking !== undefined) {
			if (isValidThinking(frontmatter.thinking)) {
				thinking = frontmatter.thinking.toLowerCase() as ThinkingLevel;
			} else {
				diagnostics.push({
					type: "warning",
					message: `Invalid thinking level "${frontmatter.thinking}". Allowed: off, minimal, low, medium, high, max`,
					path: filePath,
				});
			}
		}

		const env = parseEnvRecord(frontmatter.env);
		let maxSpawnDepth: number | undefined;
		if (frontmatter.maxSpawnDepth !== undefined || frontmatter["max-spawn-depth"] !== undefined) {
			const depthVal = Number(frontmatter.maxSpawnDepth ?? frontmatter["max-spawn-depth"]);
			if (Number.isInteger(depthVal) && depthVal >= 0) {
				maxSpawnDepth = depthVal;
			} else {
				diagnostics.push({
					type: "warning",
					message: `Invalid maxSpawnDepth "${frontmatter.maxSpawnDepth}". Must be a non-negative integer`,
					path: filePath,
				});
			}
		}

		const agentDir = dirname(filePath);

		const agent: AgentDefinition = {
			name,
			description,
			tools: tools && tools.length > 0 ? tools : undefined,
			disallowedTools: disallowedTools && disallowedTools.length > 0 ? disallowedTools : undefined,
			model,
			provider,
			thinking,
			env,
			maxSpawnDepth,
			systemPrompt: body.trim(),
			source,
			filePath,
			sourceInfo: createAgentSourceInfo(filePath, agentDir, source),
		};

		return { agent, diagnostics };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to parse agent definition file";
		diagnostics.push({ type: "error", message, path: filePath });
		return { agent: null, diagnostics };
	}
}

/** Load agents from a single directory */
export function loadAgentsFromDir(dir: string, source: AgentScope): AgentDiscoveryResult {
	const agents: AgentDefinition[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) {
		return { agents, diagnostics };
	}

	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to read agent directory";
		diagnostics.push({ type: "warning", message, path: dir });
		return { agents, diagnostics };
	}

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (!entry.name.endsWith(".md")) continue;

		const fullPath = join(dir, entry.name);
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			try {
				isFile = statSync(fullPath).isFile();
			} catch {
				continue;
			}
		}
		if (!isFile) continue;

		let content: string;
		try {
			content = readFileSync(fullPath, "utf-8");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to read agent file";
			diagnostics.push({ type: "warning", message, path: fullPath });
			continue;
		}

		const result = parseAgentDefinition(content, fullPath, source);
		diagnostics.push(...result.diagnostics);
		if (result.agent) {
			agents.push(result.agent);
		}
	}

	return { agents, diagnostics };
}

export interface LoadAgentsOptions {
	cwd: string;
	agentDir?: string;
	agentPaths?: string[];
	includeBuiltins?: boolean;
}

/**
 * Load agents from built-in, user, project, and explicit paths.
 * Precedence order: Explicit paths > Project (.metis/agents) > User (~/.metis/agents & ~/.metis/agent/agents) > Builtin
 */
export function loadAgents(options: LoadAgentsOptions): AgentDiscoveryResult {
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(options.agentDir ?? getAgentDir());
	const includeBuiltins = options.includeBuiltins ?? true;
	const explicitPaths = options.agentPaths ?? [];

	const agentMap = new Map<string, AgentDefinition>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function addAgent(agent: AgentDefinition) {
		const realPath = agent.filePath.startsWith("<") ? agent.filePath : canonicalizePath(agent.filePath);
		if (realPathSet.has(realPath)) {
			return;
		}

		const existing = agentMap.get(agent.name);
		if (existing) {
			collisionDiagnostics.push({
				type: "collision",
				message: `Agent name "${agent.name}" collision: ${agent.filePath} overrides ${existing.filePath}`,
				path: agent.filePath,
				collision: {
					resourceType: "agent" as unknown as "skill",
					name: agent.name,
					winnerPath: agent.filePath,
					loserPath: existing.filePath,
				},
			});
		}

		agentMap.set(agent.name, agent);
		realPathSet.add(realPath);
	}

	// 1. Built-in standard agents (lowest priority)
	if (includeBuiltins) {
		for (const agent of BUILTIN_AGENTS) {
			addAgent(agent);
		}
	}

	// 2. User level agents (~/.metis/agent/agents and ~/.metis/agents)
	const userDirs = [
		join(resolvedAgentDir, "agents"),
		join(dirname(resolvedAgentDir), "agents"),
	];
	for (const uDir of userDirs) {
		const userResult = loadAgentsFromDir(uDir, "user");
		allDiagnostics.push(...userResult.diagnostics);
		for (const agent of userResult.agents) {
			addAgent(agent);
		}
	}

	// 3. Project level agents (.metis/agents)
	const projectDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "agents");
	const projectResult = loadAgentsFromDir(projectDir, "project");
	allDiagnostics.push(...projectResult.diagnostics);
	for (const agent of projectResult.agents) {
		addAgent(agent);
	}

	// 4. Explicit agent paths
	for (const rawPath of explicitPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "Agent path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			if (stats.isDirectory()) {
				const dirResult = loadAgentsFromDir(resolvedPath, "path");
				allDiagnostics.push(...dirResult.diagnostics);
				for (const agent of dirResult.agents) {
					addAgent(agent);
				}
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const content = readFileSync(resolvedPath, "utf-8");
				const fileResult = parseAgentDefinition(content, resolvedPath, "path");
				allDiagnostics.push(...fileResult.diagnostics);
				if (fileResult.agent) {
					addAgent(fileResult.agent);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "Agent path is not a markdown file or directory", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to load agent path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		agents: Array.from(agentMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}

/**
 * Format available agents for inclusion in an orchestrator prompt (XML format)
 */
export function formatAgentsForPrompt(agents: AgentDefinition[]): string {
	if (agents.length === 0) return "";

	const lines = [
		"\n\nAvailable Named Agents: Delegate tasks to specialist subagents by name using spawn_agent.",
		"<available_agents>",
	];

	for (const agent of agents) {
		lines.push("  <agent>");
		lines.push(`    <name>${escapeXml(agent.name)}</name>`);
		lines.push(`    <description>${escapeXml(agent.description)}</description>`);
		if (agent.tools && agent.tools.length > 0) {
			lines.push(`    <tools>${escapeXml(agent.tools.join(", "))}</tools>`);
		}
		if (agent.model) {
			lines.push(`    <model>${escapeXml(agent.model)}</model>`);
		}
		lines.push(`    <source>${escapeXml(agent.source)}</source>`);
		lines.push("  </agent>");
	}

	lines.push("</available_agents>");
	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Agent Registry manages the in-memory collection of loaded agents (Feat 7)
 */
export class AgentRegistry {
	private agentsByName = new Map<string, AgentDefinition>();
	private diagnostics: ResourceDiagnostic[] = [];

	constructor(agents: AgentDefinition[] = [], diagnostics: ResourceDiagnostic[] = []) {
		this.diagnostics = [...diagnostics];
		for (const agent of agents) {
			this.register(agent);
		}
	}

	/** Register or override an agent */
	register(agent: AgentDefinition): void {
		this.agentsByName.set(agent.name.toLowerCase(), agent);
	}

	/** Retrieve an agent by name */
	get(name: string): AgentDefinition | undefined {
		return this.agentsByName.get(name.toLowerCase());
	}

	/** Check if an agent name exists */
	has(name: string): boolean {
		return this.agentsByName.has(name.toLowerCase());
	}

	/** Get all registered agents */
	getAll(): AgentDefinition[] {
		return Array.from(this.agentsByName.values());
	}

	/** Get diagnostics recorded during discovery */
	getDiagnostics(): ResourceDiagnostic[] {
		return [...this.diagnostics];
	}

	/** Format agents as XML block for prompt */
	toPromptXml(): string {
		return formatAgentsForPrompt(this.getAll());
	}

	/** Clone registry */
	clone(): AgentRegistry {
		return new AgentRegistry(this.getAll(), this.getDiagnostics());
	}
}

export interface ParentAgentRuntimeConfig {
	model?: string;
	provider?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	env?: Record<string, string>;
}

export interface GlobalDefaultConfig {
	model?: string;
	provider?: string;
	thinking?: ThinkingLevel;
}

export interface ResolveAgentConfigOptions {
	agent: AgentDefinition;
	parentConfig?: ParentAgentRuntimeConfig;
	globalConfig?: GlobalDefaultConfig;
}

export interface ResolvedAgentConfig {
	name: string;
	description: string;
	systemPrompt: string;
	model?: string;
	provider?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	env: Record<string, string>;
	maxSpawnDepth?: number;
	source: AgentScope;
	filePath: string;
}

/**
 * Resolve runtime configuration for an agent with inheritance rules (Feat 11 & Feat 26):
 * 1. Model / Provider / Thinking: Agent definition > Parent runtime override > Global default
 * 2. Tools allowlist: Strict privilege convergence. If Agent specifies tools, take intersection with parent's allowed tools (child cannot escalate privileges). If not specified, inherit parent's allowed tools.
 * 3. Environment: Parent env merged with Agent specific env overrides.
 */
export function resolveAgentConfig(options: ResolveAgentConfigOptions): ResolvedAgentConfig {
	const { agent, parentConfig, globalConfig } = options;

	// Model resolution: Agent definition > Parent runtime override > Global default
	const model = agent.model ?? parentConfig?.model ?? globalConfig?.model;
	const provider = agent.provider ?? parentConfig?.provider ?? globalConfig?.provider;
	const thinking = agent.thinking ?? parentConfig?.thinking ?? globalConfig?.thinking;

	// Tool permissions resolution (Feat 26 & Feat 27)
	let resolvedTools: string[] | undefined;
	const parentTools = parentConfig?.tools;
	const agentTools = agent.tools;
	const disallowed = new Set(agent.disallowedTools ?? []);

	if (parentTools && parentTools.length > 0) {
		if (agentTools && agentTools.length > 0) {
			// Intersection: only tools explicitly allowed by both agent and parent
			const parentSet = new Set(parentTools);
			resolvedTools = agentTools.filter((t) => parentSet.has(t) && !disallowed.has(t));
		} else {
			// Inherit parent's tools minus agent's disallowed
			resolvedTools = parentTools.filter((t) => !disallowed.has(t));
		}
	} else if (agentTools && agentTools.length > 0) {
		resolvedTools = agentTools.filter((t) => !disallowed.has(t));
	} else {
		resolvedTools = undefined;
	}

	// Environment resolution
	const env: Record<string, string> = {
		...(parentConfig?.env ?? {}),
		...(agent.env ?? {}),
	};

	return {
		name: agent.name,
		description: agent.description,
		systemPrompt: agent.systemPrompt,
		model,
		provider,
		thinking,
		tools: resolvedTools,
		env,
		maxSpawnDepth: agent.maxSpawnDepth,
		source: agent.source,
		filePath: agent.filePath,
	};
}
