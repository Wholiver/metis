/**
 * Types and constants for the self-learning runtime adaptation system.
 */

export const DEFAULT_MAX_LEARNED_SKILLS = 30;

export type AdaptationScope = "user" | "project";

export type AdaptationKind =
	| "profile"
	| "skill"
	| "role"
	| "tool"
	| "hook"
	| "architecture"
	| "workflow"
	| "proposal";

/** Size limits in bytes for each adaptation artifact. */
export const ADAPTATION_SIZE_LIMITS: Record<AdaptationKind, number> = {
	profile: 8 * 1024, // 8KB
	skill: 32 * 1024, // 32KB
	role: 16 * 1024, // 16KB
	tool: 32 * 1024, // 32KB
	hook: 32 * 1024, // 32KB
	architecture: 16 * 1024, // 16KB
	workflow: 16 * 1024, // 16KB
	proposal: 16 * 1024, // 16KB
};

/** Identifier pattern: lowercase alphanumeric, dashes, underscores, max 64 chars. */
export const ADAPTATION_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Control plane tools that must NEVER be hidden, intercepted, or removed by adaptations. */
export const CONTROL_PLANE_TOOLS: readonly string[] = Object.freeze([
	"performance_admit",
	"performance_gate",
	"update_plan",
	"read_plan",
	"spawn_agent",
	"ask_user",
	"adapt",
]);

/** Protected built-in performance role names that adaptations cannot collide with or redefine. */
export const PROTECTED_BUILTIN_ROLES: readonly string[] = Object.freeze([
	"lead",
	"architect",
	"implementer",
	"reviewer",
	"verifier",
]);

export interface JournalEntry {
	id: string;
	timestamp: string;
	action: "apply" | "rollback" | "retire" | "reject";
	scope: AdaptationScope;
	kind: AdaptationKind;
	name?: string;
	revision: number;
	previousRevision?: number;
	reason?: string;
	snapshotId?: string;
	actor?: "model" | "learner" | "evaluator";
	trial?: boolean;
}

export interface GrowthReport {
	date: string;
	correctionRate?: number;
	predictionHitRate?: number;
	recurringErrorRate?: number;
	toolErrorRate?: number;
	totalEvaluatedRuns?: number;
	adaptationSuccessRate?: number;
	activeCount?: number;
	trialCount?: number;
	retiredCount?: number;
	summary?: string;
}

export interface AdaptationStats {
	appliedCount: number;
	lastOutcome?: "success" | "failure";
	lastRunAt?: string;
	recurredCorrections: number;
	helped?: number;
	hurt?: number;
	trial?: boolean;
	status?: "trial" | "tentative" | "active" | "retired";
}

export interface OutcomeLedger {
	totalRuns: number;
	appliedCount: number;
	lastOutcome?: "success" | "failure";
	lastRunAt?: string;
	recurredCorrections: number;
	activeAdaptations: string[];
	perAdaptationStats?: Record<string, AdaptationStats>;
	growth?: GrowthReport;
	tentativeWithholdRate?: number;
}

export interface AdaptationSummary {
	id: string;
	scope: AdaptationScope;
	kind: AdaptationKind;
	name?: string;
	filePath: string;
	sizeBytes: number;
	revision: number;
	updatedAt: string;
	isRetired?: boolean;
	appliedCount?: number;
	lastOutcome?: "success" | "failure";
	recurredCorrections?: number;
	helped?: number;
	hurt?: number;
	trial?: boolean;
	status?: "trial" | "tentative" | "active" | "retired";
	pendingChecks?: string[];
	description?: string;
	reason?: string;
}

/** Dimension of user personal preferences. */
export type PreferenceDimension = "communication" | "engineering" | "interaction";

/** Single preference item with evidence and confidence score. */
export interface PreferenceItem {
	id: string;
	value: string;
	confidence: number; // 0.0 - 1.0
	updatedAt: string;
	evidence?: string;
	status?: "active" | "overridden" | "retired";
}

/** Structured multi-dimensional user preferences profile. */
export interface UserPreferencesProfile {
	/** Style of communication: brevity, language, tone, explanation depth, formatting */
	communication: Record<string, PreferenceItem>;
	/** Engineering conventions: test framework, typing strictness, naming convention, language flavor */
	engineering: Record<string, PreferenceItem>;
	/** Interaction and autonomy preferences: confirmation threshold, edit style, plan approval */
	interaction: Record<string, PreferenceItem>;
	updatedAt: string;
	version: number;
}

/** Tactical playbook for specific task types or error recovery patterns. */
export interface TacticalPlaybook {
	id: string;
	name: string;
	description: string;
	triggerKeywords: string[];
	strategy: string;
	verificationSteps?: string[];
	confidence: number;
	updatedAt: string;
	status?: "active" | "tentative" | "retired";
}

/** Step in a multi-tool macro workflow. */
export interface MacroWorkflowStep {
	tool: string;
	argsTemplate?: Record<string, any>;
	description?: string;
	continueOnError?: boolean;
}

/** Composite executable macro workflow composed of core tools. */
export interface MacroWorkflow {
	id: string;
	name: string;
	description: string;
	steps: MacroWorkflowStep[];
	updatedAt: string;
	status?: "active" | "retired";
}

/** Project-specific micro tool synthesized and sandboxed for the workspace. */
export interface ProjectMacroTool {
	name: string;
	description: string;
	parameters: Record<string, any>;
	script: string;
	runtime: "node" | "bash";
	createdAt: string;
	status?: "active" | "retired";
}

/** Container for architecture self-evolution. */
export interface ArchitectureEvolution {
	playbooks?: TacticalPlaybook[];
	macroWorkflows?: MacroWorkflow[];
	projectTools?: ProjectMacroTool[];
	updatedAt: string;
}

/** Output of the unified prompt compilation and conflict arbitration engine. */
export interface CompiledPromptResult {
	promptText: string;
	activePreferences: string[];
	activePlaybooks: string[];
	suppressedRules: string[];
}
