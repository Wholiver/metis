import * as fs from "node:fs";
import * as path from "node:path";
import { getScopeDir, getUserPreferences, getArchitectureEvolution } from "./store.ts";
import { compileSelfLearningPrompt } from "./compiler.ts";
import { type ArchitectureAdaptation, validateArchitectureAdaptation } from "./architecture-schema.ts";
import { type WorkflowAdaptation, validateWorkflowAdaptation } from "./workflow-schema.ts";
import { CONTROL_PLANE_TOOLS } from "./types.ts";
import { isSelfLearningActive, type SelfLearningActivationOptions } from "./activation.ts";

export interface AdaptationDiscoveryOptions extends SelfLearningActivationOptions {
	cwd: string;
	agentDir: string;
	isProjectTrusted?: boolean;
	turnContext?: {
		userMessage?: string;
		activeToolNames?: string[];
		collaborationMode?: string;
	};
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
	const userGuidelines = (userArch?.customGuidelines ?? []).map((g) =>
		typeof g === "object" && g !== null ? { ...g, scope: "user" } : g,
	);
	const projectGuidelines = (projectArch?.customGuidelines ?? []).map((g) =>
		typeof g === "object" && g !== null ? { ...g, scope: "project" } : g,
	);
	const customGuidelinesList = [...userGuidelines, ...projectGuidelines];
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

export interface UserTrait {
	dimension: "communication" | "rigor_and_acceptance" | "autonomy" | "coding_style" | "toolchain" | "domain_vocabulary";
	statement: string;
	confidence: number;
	evidence: string[];
	lastConfirmed: string;
	status: "tentative" | "active" | "retired";
	userStated?: boolean;
}

export interface FollowUpPrediction {
	triggerPattern: string;
	prediction: string;
	supportCount: number;
	confidence: number;
	lastTriggered?: string;
}

export interface UserProfileData {
	version: 2;
	traits: UserTrait[];
	followUpPredictions: FollowUpPrediction[];
	updatedAt: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function applyTraitDecay(traits: UserTrait[], nowMs = Date.now()): UserTrait[] {
	return traits.map((trait) => {
		if (trait.userStated || trait.status === "retired") return trait;
		const lastConfirmedTime = trait.lastConfirmed ? new Date(trait.lastConfirmed).getTime() : 0;
		if (lastConfirmedTime > 0 && nowMs - lastConfirmedTime > THIRTY_DAYS_MS) {
			const daysOver30 = Math.floor((nowMs - lastConfirmedTime - THIRTY_DAYS_MS) / (24 * 60 * 60 * 1000));
			const decay = Math.min(0.5, (daysOver30 / 10) * 0.05);
			const newConfidence = Math.max(0.1, Number((trait.confidence - decay).toFixed(2)));
			const newStatus = newConfidence < 0.3 ? "retired" : trait.status;
			return {
				...trait,
				confidence: newConfidence,
				status: newStatus,
			};
		}
		return trait;
	});
}

export function renderUserProfile(data: UserProfileData, holdoutStatements?: Set<string>): string {
	const activeTraits = applyTraitDecay(data.traits).filter(
		(t) => t.status !== "retired" && !(holdoutStatements?.has(t.statement)),
	);
	const lines: string[] = [];

	if (activeTraits.length > 0) {
		lines.push("### User Profile & Preferences");
		for (const trait of activeTraits) {
			lines.push(`- [${trait.dimension}] ${trait.statement} (confidence: ${trait.confidence})`);
		}
	}

	const eligiblePredictions = (data.followUpPredictions ?? []).filter(
		(p) => p.supportCount >= 3 && p.confidence >= 0.5,
	);
	if (eligiblePredictions.length > 0) {
		lines.push("### Predicted Follow-Up Patterns");
		for (const pred of eligiblePredictions) {
			lines.push(`- When ${pred.triggerPattern}: ${pred.prediction} (supported by ${pred.supportCount} observations)`);
		}
	}

	return lines.join("\n");
}

function readProfileFromDir(scopeDir: string): { data?: UserProfileData; rawText?: string } {
	const jsonPath = path.join(scopeDir, "profile.json");
	if (fs.existsSync(jsonPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
			if (parsed && typeof parsed === "object" && (parsed.version === 2 || Array.isArray(parsed.traits))) {
				return { data: parsed as UserProfileData };
			}
		} catch {}
	}
	const mdPath = path.join(scopeDir, "profile.md");
	if (fs.existsSync(mdPath)) {
		try {
			const rawText = fs.readFileSync(mdPath, "utf8").trim();
			return { rawText };
		} catch {}
	}
	return {};
}

/**
 * Read and merge structured UserProfileData from user and project scopes.
 */
export function getEffectiveUserProfileData(options: AdaptationDiscoveryOptions): UserProfileData | undefined {
	const userScopeDir = getScopeDir(options.agentDir, options.cwd, "user");
	const userProfile = readProfileFromDir(userScopeDir);

	let projectProfile: { data?: UserProfileData; rawText?: string } | undefined;
	if (options.isProjectTrusted) {
		const projectScopeDir = getScopeDir(options.agentDir, options.cwd, "project");
		projectProfile = readProfileFromDir(projectScopeDir);
	}

	const traitsMap = new Map<string, UserTrait>();
	const predictionsMap = new Map<string, FollowUpPrediction>();

	const addData = (data?: UserProfileData, rawText?: string) => {
		if (data) {
			for (const trait of data.traits ?? []) {
				traitsMap.set(`${trait.dimension}:${trait.statement}`, trait);
			}
			for (const pred of data.followUpPredictions ?? []) {
				predictionsMap.set(pred.triggerPattern, pred);
			}
		} else if (rawText) {
			traitsMap.set(`communication:${rawText}`, {
				dimension: "communication",
				statement: rawText,
				confidence: 1.0,
				evidence: ["Migrated from legacy profile.md"],
				lastConfirmed: new Date().toISOString(),
				status: "active",
				userStated: true,
			});
		}
	};

	addData(userProfile.data, userProfile.rawText);
	if (projectProfile) {
		addData(projectProfile.data, projectProfile.rawText);
	}

	if (traitsMap.size === 0 && predictionsMap.size === 0) {
		return undefined;
	}

	return {
		version: 2,
		traits: Array.from(traitsMap.values()),
		followUpPredictions: Array.from(predictionsMap.values()),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Read profile from user and project scopes, rendering profile.json or profile.md.
 */
export function getEffectiveProfile(
	options: AdaptationDiscoveryOptions,
	holdoutStatements?: Set<string>,
): string | undefined {
	const userScopeDir = getScopeDir(options.agentDir, options.cwd, "user");
	const userProfile = readProfileFromDir(userScopeDir);

	let projectProfile: { data?: UserProfileData; rawText?: string } | undefined;
	if (options.isProjectTrusted) {
		const projectScopeDir = getScopeDir(options.agentDir, options.cwd, "project");
		projectProfile = readProfileFromDir(projectScopeDir);
	}

	if (!userProfile.data && !projectProfile?.data && (userProfile.rawText || projectProfile?.rawText)) {
		return [userProfile.rawText, projectProfile?.rawText].filter(Boolean).join("\n\n");
	}

	const data = getEffectiveUserProfileData(options);
	if (!data) return undefined;
	const rendered = renderUserProfile(data, holdoutStatements);
	return rendered.trim() ? rendered.trim() : undefined;
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

const SKILL_STOP_BIGRAMS = new Set(["一个", "一下", "这个", "我们", "什么", "怎么", "没有", "不是"]);

/** User-language terms that should hit a skill description. */
export function skillMatchesPrompt(description: string, userText: string): boolean {
	const desc = description.toLowerCase();
	const terms: string[] = [];
	for (const run of userText.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
		for (let i = 0; i < run.length - 1; i++) {
			const bigram = run.slice(i, i + 2);
			if (!SKILL_STOP_BIGRAMS.has(bigram)) terms.push(bigram);
		}
	}
	for (const word of userText.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) ?? []) {
		terms.push(word.toLowerCase());
	}
	return terms.some((term) => desc.includes(term.toLowerCase()));
}

function extractSkillMeta(content: string, defaultName: string): { name: string; description: string } {
	const trimmed = content.trim();
	let name = defaultName;
	let description = "Learned project skill.";
	if (trimmed.startsWith("---\n")) {
		const fence = trimmed.indexOf("\n---", 4);
		if (fence !== -1) {
			const front = trimmed.slice(4, fence);
			const nameMatch = front.match(/^name\s*:\s*(.+)$/m);
			const descMatch = front.match(/^description\s*:\s*(.+)$/m);
			if (nameMatch && nameMatch[1]) name = nameMatch[1].trim();
			if (descMatch && descMatch[1]) description = descMatch[1].trim();
		}
	}
	return { name, description };
}

/**
 * Render a comprehensive summary of active learned adaptations (skills, rules, preferences)
 * to be injected into the agent system prompt so the agent is explicitly aware of them.
 */
export function getLearnedAdaptationsPromptSummary(options: AdaptationDiscoveryOptions): string | undefined {
	if (options.adaptationsFlag === "off") {
		return undefined;
	}

	const sections: string[] = [];

	// 0. Compiled structured preferences & architecture evolution (conflict-free)
	const userPrefs = getUserPreferences(options.agentDir);
	const archEvolution = getArchitectureEvolution(options.agentDir, options.cwd);
	const compiled = compileSelfLearningPrompt({
		userPreferences: userPrefs,
		architecture: archEvolution,
		turnContext: options.turnContext,
	});
	if (compiled.promptText) {
		sections.push(compiled.promptText);
	}

	// 1. Learned skills
	const resources = discoverAdaptationResources(options);
	if (resources.skillPaths.length > 0) {
		const skillLines: string[] = [];
		for (const skillPath of resources.skillPaths) {
			try {
				if (!fs.existsSync(skillPath)) continue;
				const raw = fs.readFileSync(skillPath, "utf8");
				const defaultName = path.basename(path.dirname(skillPath));
				const meta = extractSkillMeta(raw, defaultName);
				skillLines.push(`- \`${meta.name}\`: ${meta.description} (Location: ${skillPath})`);
			} catch {}
		}
		if (skillLines.length > 0) {
			sections.push(`### Learned Skills\n${skillLines.join("\n")}`);
		}
	}

	// 2. Custom architecture guidelines
	const arch = getEffectiveArchitecture(options);
	if (arch?.customGuidelines && arch.customGuidelines.length > 0) {
		const guideLines: string[] = [];
		for (const g of arch.customGuidelines) {
			if (typeof g === "string") {
				guideLines.push(`- ${g}`);
			} else if (g && typeof g === "object") {
				const triggerInfo = g.trigger
					? ` (trigger: ${g.trigger.keyword ? `keyword "${g.trigger.keyword}"` : g.trigger.regex ? `regex /${g.trigger.regex}/` : JSON.stringify(g.trigger)})`
					: "";
				guideLines.push(`- ${g.text}${triggerInfo}`);
			}
		}
		if (guideLines.length > 0) {
			sections.push(`### Learned Architectural Guidelines\n${guideLines.join("\n")}`);
		}
	}

	// 3. User profile preferences
	const profileData = getEffectiveUserProfileData(options);
	if (profileData && profileData.traits && profileData.traits.length > 0) {
		const activeTraits = applyTraitDecay(profileData.traits).filter((t) => t.status !== "retired");
		if (activeTraits.length > 0) {
			const traitLines = activeTraits.map(
				(t) => `- [${t.dimension}] ${t.statement}${t.userStated ? " (user explicit preference)" : ""}`,
			);
			sections.push(`### Learned User Preferences\n${traitLines.join("\n")}`);
		}
	}

	if (sections.length === 0) return undefined;

	return [
		"The following operational adaptations, procedures, and preferences were automatically learned from previous task executions, user corrections, and verified solutions in this workspace:",
		"<learned_adaptations>",
		sections.join("\n\n"),
		"</learned_adaptations>",
		"Instructions:",
		"- Follow these learned procedures and rules when performing matching tasks in this workspace.",
		"- When the user asks what you have learned or inquires about project conventions, answer directly using the adaptations above without needing to search the filesystem.",
	].join("\n");
}
