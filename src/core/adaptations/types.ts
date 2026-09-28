/**
 * Types and constants for the self-learning runtime adaptation system.
 */

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
	action: "apply" | "rollback" | "retire";
	scope: AdaptationScope;
	kind: AdaptationKind;
	name?: string;
	revision: number;
	previousRevision?: number;
	reason?: string;
	snapshotId?: string;
}

export interface AdaptationStats {
	appliedCount: number;
	lastOutcome?: "success" | "failure";
	lastRunAt?: string;
	recurredCorrections: number;
}

export interface OutcomeLedger {
	totalRuns: number;
	appliedCount: number;
	lastOutcome?: "success" | "failure";
	lastRunAt?: string;
	recurredCorrections: number;
	activeAdaptations: string[];
	perAdaptationStats?: Record<string, AdaptationStats>;
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
	pendingChecks?: string[];
}
