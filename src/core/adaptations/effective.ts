import * as fs from "node:fs";
import * as path from "node:path";
import { getScopeDir } from "./store.ts";
import { type ArchitectureAdaptation, validateArchitectureAdaptation } from "./architecture-schema.ts";
import { type WorkflowAdaptation, validateWorkflowAdaptation } from "./workflow-schema.ts";
import { CONTROL_PLANE_TOOLS } from "./types.ts";
import { isSelfLearningActive, type SelfLearningActivationOptions } from "./activation.ts";

export interface AdaptationDiscoveryOptions extends SelfLearningActivationOptions {
	cwd: string;
	agentDir: string;
	isProjectTrusted?: boolean;
}

/**
 * Read and merge architecture.json from user and project scopes.
 * Project-level settings override/extend user-level settings.
 * Control plane tools are guaranteed to never be hidden.
 */
export function getEffectiveArchitecture(options: AdaptationDiscoveryOptions): ArchitectureAdaptation | undefined {
	const userScopeDir = getScopeDir(options.agentDir, options.cwd, "user");
	const userArchPath = path.join(userScopeDir, "architecture.json");
	let userArch: ArchitectureAdaptation | undefined;

	if (fs.existsSync(userArchPath)) {
		try {
			const content = fs.readFileSync(userArchPath, "utf8");
			const parsed = JSON.parse(content);
			if (parsed && typeof parsed === "object" && Array.isArray(parsed.hiddenTools)) {
				parsed.hiddenTools = parsed.hiddenTools.filter((t: any) => !CONTROL_PLANE_TOOLS.includes(t));
			}
			userArch = validateArchitectureAdaptation(parsed);
		} catch {}
	}

	let projectArch: ArchitectureAdaptation | undefined;
	if (options.isProjectTrusted) {
		const projectScopeDir = getScopeDir(options.agentDir, options.cwd, "project");
		const projectArchPath = path.join(projectScopeDir, "architecture.json");
		if (fs.existsSync(projectArchPath)) {
			try {
				const content = fs.readFileSync(projectArchPath, "utf8");
				const parsed = JSON.parse(content);
				if (parsed && typeof parsed === "object" && Array.isArray(parsed.hiddenTools)) {
					parsed.hiddenTools = parsed.hiddenTools.filter((t: any) => !CONTROL_PLANE_TOOLS.includes(t));
				}
				projectArch = validateArchitectureAdaptation(parsed);
			} catch {}
		}
	}

	if (!userArch && !projectArch) {
		return undefined;
	}

	// Merge hidden tools (union, minus control plane tools)
	const rawHidden = new Set<string>([
		...(userArch?.hiddenTools ?? []),
		...(projectArch?.hiddenTools ?? []),
	]);
	for (const tool of CONTROL_PLANE_TOOLS) {
		rawHidden.delete(tool);
	}
	const hiddenTools = rawHidden.size > 0 ? Array.from(rawHidden) : undefined;

	// Merge custom guidelines (user first, then project)
	const customGuidelinesList = [
		...(userArch?.customGuidelines ?? []),
		...(projectArch?.customGuidelines ?? []),
	];
	const customGuidelines = customGuidelinesList.length > 0 ? customGuidelinesList : undefined;

	// Preferred tools (project overrides user)
	const preferredTools = projectArch?.preferredTools ?? userArch?.preferredTools;

	return {
		hiddenTools,
		customGuidelines,
		preferredTools,
	};
}

/**
 * Read and merge workflow.json from user and project scopes.
 * Project-level extraChecks and routeBias override or extend user-level ones.
 */
export function getEffectiveWorkflow(options: AdaptationDiscoveryOptions): WorkflowAdaptation | undefined {
	if (!isSelfLearningActive(options)) {
		return undefined;
	}

	const userScopeDir = getScopeDir(options.agentDir, options.cwd, "user");
	const userWfPath = path.join(userScopeDir, "workflow.json");
	let userWf: WorkflowAdaptation | undefined;

	if (fs.existsSync(userWfPath)) {
		try {
			const content = fs.readFileSync(userWfPath, "utf8");
			const parsed = JSON.parse(content);
			userWf = validateWorkflowAdaptation(parsed);
		} catch {}
	}

	let projectWf: WorkflowAdaptation | undefined;
	if (options.isProjectTrusted) {
		const projectScopeDir = getScopeDir(options.agentDir, options.cwd, "project");
		const projectWfPath = path.join(projectScopeDir, "workflow.json");
		if (fs.existsSync(projectWfPath)) {
			try {
				const content = fs.readFileSync(projectWfPath, "utf8");
				const parsed = JSON.parse(content);
				projectWf = validateWorkflowAdaptation(parsed);
			} catch {}
		}
	}

	if (!userWf && !projectWf) {
		return undefined;
	}

	// Merge extraChecks by id (project overrides user)
	const checksMap = new Map<string, any>();
	for (const check of userWf?.extraChecks ?? []) {
		checksMap.set(check.id, check);
	}
	for (const check of projectWf?.extraChecks ?? []) {
		checksMap.set(check.id, check);
	}
	const extraChecks = checksMap.size > 0 ? Array.from(checksMap.values()) : undefined;

	// Merge routeBias (project overrides user)
	let routeBias: Record<string, string> | undefined;
	if (userWf?.routeBias || projectWf?.routeBias) {
		routeBias = {
			...(userWf?.routeBias ?? {}),
			...(projectWf?.routeBias ?? {}),
		};
	}

	return {
		extraChecks,
		routeBias,
	};
}

/**
 * Read profile.md from user and project scopes.
 */
export function getEffectiveProfile(options: AdaptationDiscoveryOptions): string | undefined {
	const userScopeDir = getScopeDir(options.agentDir, options.cwd, "user");
	const userProfilePath = path.join(userScopeDir, "profile.md");
	let userProfile: string | undefined;

	if (fs.existsSync(userProfilePath)) {
		try {
			userProfile = fs.readFileSync(userProfilePath, "utf8").trim();
		} catch {}
	}

	let projectProfile: string | undefined;
	if (options.isProjectTrusted) {
		const projectScopeDir = getScopeDir(options.agentDir, options.cwd, "project");
		const projectProfilePath = path.join(projectScopeDir, "profile.md");
		if (fs.existsSync(projectProfilePath)) {
			try {
				projectProfile = fs.readFileSync(projectProfilePath, "utf8").trim();
			} catch {}
		}
	}

	const parts = [userProfile, projectProfile].filter(Boolean);
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export interface DiscoveredAdaptationResources {
	skillPaths: string[];
	rolePaths: string[];
	toolPaths: string[];
	hookPaths: string[];
}

/**
 * Discover all file paths for learned skills, roles, tools, and hooks across user and project scopes.
 */
export function discoverAdaptationResources(options: AdaptationDiscoveryOptions): DiscoveredAdaptationResources {
	const skillPaths: string[] = [];
	const rolePaths: string[] = [];
	const toolPaths: string[] = [];
	const hookPaths: string[] = [];

	const dirsToScan: string[] = [getScopeDir(options.agentDir, options.cwd, "user")];
	if (options.isProjectTrusted) {
		dirsToScan.push(getScopeDir(options.agentDir, options.cwd, "project"));
	}

	for (const scopeDir of dirsToScan) {
		if (!fs.existsSync(scopeDir)) continue;

		// Skills: scopeDir/skills/
		const skillsDir = path.join(scopeDir, "skills");
		if (fs.existsSync(skillsDir)) {
			try {
				const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
				for (const entry of entries) {
					const entryPath = path.join(skillsDir, entry.name);
					if (entry.isDirectory()) {
						const skillMd = path.join(entryPath, "SKILL.md");
						if (fs.existsSync(skillMd)) {
							skillPaths.push(skillMd);
						} else {
							skillPaths.push(entryPath);
						}
					} else if (entry.isFile() && entry.name.endsWith(".md")) {
						skillPaths.push(entryPath);
					}
				}
			} catch {}
		}

		// Roles: scopeDir/roles/*.md
		const rolesDir = path.join(scopeDir, "roles");
		if (fs.existsSync(rolesDir)) {
			try {
				const entries = fs.readdirSync(rolesDir, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isFile() && entry.name.endsWith(".md")) {
						rolePaths.push(path.join(rolesDir, entry.name));
					}
				}
			} catch {}
		}

		// Tools: scopeDir/tools/*.ts or *.js
		const toolsDir = path.join(scopeDir, "tools");
		if (fs.existsSync(toolsDir)) {
			try {
				const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
						toolPaths.push(path.join(toolsDir, entry.name));
					}
				}
			} catch {}
		}

		// Hooks: scopeDir/hooks/*.ts or *.js
		const hooksDir = path.join(scopeDir, "hooks");
		if (fs.existsSync(hooksDir)) {
			try {
				const entries = fs.readdirSync(hooksDir, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
						hookPaths.push(path.join(hooksDir, entry.name));
					}
				}
			} catch {}
		}
	}

	return {
		skillPaths,
		rolePaths,
		toolPaths,
		hookPaths,
	};
}
