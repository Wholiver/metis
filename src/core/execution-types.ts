/**
 * Host-owned headless execution types for reliable-headless profile.
 * Agent text is evidence input only; completion and exit codes are derived here.
 */

/** Sole product execution profile. Legacy has been removed. */
export type ExecutionProfile = "reliable-headless";

export const DEFAULT_EXECUTION_PROFILE: ExecutionProfile = "reliable-headless";

export type TaskKind = "code" | "artifact" | "numeric-data" | "service-config" | "mixed";

/** Stable failure codes for regression fixtures and host decisions. */
export type ExecutionFailureCode =
	| "CHILD_NO_VERDICT"
	| "FALSE_COMPLETION_AFTER_VERIFIER_FAIL"
	| "REQUIRED_ARTIFACT_MISSING"
	| "OUTPUT_POLLUTION"
	| "NUMERIC_TOLERANCE_FAILED"
	| "CHILD_WORKSPACE_DRIFT"
	| "NO_PROGRESS_FINGERPRINT"
	| "CHILD_RESULT_INVALID"
	| "OVERLAPPING_OWNED_PATHS"
	| "WORKSPACE_PROBE_FAILED"
	| "CONTRACT_NOT_COMPILED"
	| "COMPLETION_EVIDENCE_MISSING"
	| "INSUFFICIENT_EVIDENCE"
	| "FORMAT_INVALID"
	| "SERVICE_UNREACHABLE"
	| "CHECK_FAILED"
	| "EVIDENCE_STALE"
	| "ARTIFACT_CONTENT_INVALID"
	| "CONSTRAINT_UNEXECUTABLE"
	| "CONSTRAINT_FAILED"
	| "CHILD_RESULT_FAILED"
	| "CHILD_FINDINGS_PRESENT"
	| "CONTRACT_SOLVER_INVALID"
	| "CONTRACT_SOLVER_INSUFFICIENT";

export type EvidenceLevel = "public-check" | "structural" | "derived-invariant" | "agent-claim" | "none";

export type ConstraintOracle =
	| { type: "file-contains"; path: string; substring: string }
	| { type: "file-exists"; path: string }
	| { type: "valid-json"; path: string }
	| { type: "line-count"; path: string; lines: number }
	| { type: "command"; command: string[]; cwd?: string; timeoutMs?: number }
	| { type: "unexecutable"; reason: string };

export interface ConstraintResult {
	id: string;
	passed: boolean;
	code?: ExecutionFailureCode | string;
	message: string;
	evidence?: string;
	authority: "task" | "public-check" | "derived-invariant";
	evidenceLevel: EvidenceLevel;
}

export interface VerificationFailure {
	code: ExecutionFailureCode | string;
	message: string;
	checkId?: string;
	fingerprint?: string;
	evidence?: string;
}

export interface ChildTask {
	role: "contract-solver" | "planner" | "implementer" | "verifier" | "repairer" | "reviewer";
	objective: string;
	cwd: string;
	ownedPaths: string[];
	contract: TaskContract;
	priorFailure?: VerificationFailure;
}

export interface ChildResult {
	status: "completed" | "failed" | "blocked" | "invalid";
	summary: string;
	filesChanged: string[];
	commands: Array<{
		argv: string[];
		cwd: string;
		exitCode: number | null;
	}>;
	findings: Array<{
		code: string;
		message: string;
		evidence?: string;
	}>;
	proposedRepair?: string;
}

export interface ExecutionPlan {
	implementationOwner: "root" | "implementer";
	workspacePolicy: "shared" | "isolated";
	plannerRequired: boolean;
	verifierKind: TaskKind;
	independentLanes: Array<{
		id: string;
		ownedPaths: string[];
		dependencies: string[];
	}>;
	maxRepairAttempts: number;
	reviewerRequired: boolean;
}

export interface TaskPaths {
	input?: string;
	output?: string;
	software?: string;
}

export interface TaskContract {
	kind: TaskKind;
	requiredArtifacts: Array<{
		path: string;
		type?: string;
		nonEmpty: boolean;
	}>;
	forbiddenArtifacts: string[];
	constraints: Array<{
		id: string;
		description: string;
		authority: "task" | "public-check" | "derived-invariant";
		oracle?: ConstraintOracle;
	}>;
	checks: Array<{
		id: string;
		command: string[];
		cwd: string;
		timeoutMs: number;
		authority: "task" | "bundled-public" | "agent-authored";
	}>;
	environment: {
		requiredPaths: string[];
		requiredCommands: string[];
	};
	unresolved: string[];
	/** Host-compiled marker; empty stub contracts are not compiled. */
	compiled: boolean;
	/** Hash of instruction + discovered public facts used for stale-evidence checks. */
	contractHash: string;
	/** Lowest evidence level available without running agent claims. */
	evidenceLevel: EvidenceLevel;
}

export interface CompletionDecision {
	passed: boolean;
	reasons: Array<{
		code: ExecutionFailureCode | string;
		message: string;
		evidence?: string;
	}>;
	requiredArtifactsPresent: boolean;
	forbiddenArtifactsAbsent: boolean;
	checksPassed: boolean;
	unresolvedFindings: number;
}

export interface ExecutionAttempt {
	role: string;
	status: "completed" | "failed" | "blocked" | "invalid";
	summary: string;
	failureFingerprint?: string;
}

export interface ExecutionRequest {
	instruction: string;
	cwd: string;
	profile: ExecutionProfile;
	deadlineMs: number;
	taskPaths?: TaskPaths;
}

export interface ExecutionResult {
	status: "completed" | "task_failed" | "harness_error";
	contract: TaskContract;
	attempts: ExecutionAttempt[];
	completion: CompletionDecision;
	finalText: string;
	failure?: {
		code: ExecutionFailureCode | string;
		message: string;
		retryable: boolean;
	};
}

export interface WorkspaceProbeResult {
	ok: boolean;
	code?: ExecutionFailureCode;
	message?: string;
	canonicalCwd: string;
	taskPaths: {
		input?: string;
		output?: string;
		software?: string;
	};
}

export interface OwnedPathClaim {
	ownerId: string;
	ownedPaths: string[];
}

export const EMPTY_TASK_CONTRACT: TaskContract = {
	kind: "mixed",
	requiredArtifacts: [],
	forbiddenArtifacts: [],
	constraints: [],
	checks: [],
	environment: { requiredPaths: [], requiredCommands: [] },
	unresolved: ["contract-not-compiled"],
	compiled: false,
	contractHash: "",
	evidenceLevel: "none",
};

export function isExecutionProfile(value: string): value is ExecutionProfile {
	return value === "reliable-headless";
}

/** Force the process env to the sole supported profile (idempotent). */
export function ensureReliableExecutionEnv(env: NodeJS.ProcessEnv = process.env): ExecutionProfile {
	env.METIS_EXECUTION_PROFILE = DEFAULT_EXECUTION_PROFILE;
	return DEFAULT_EXECUTION_PROFILE;
}

export function mapExecutionStatusToExitCode(status: ExecutionResult["status"]): number {
	switch (status) {
		case "completed":
			return 0;
		case "task_failed":
			return 1;
		case "harness_error":
			return 2;
	}
}

export function normalizeFailureFingerprint(parts: {
	checkId: string;
	exitCode: number | null;
	errorSummary: string;
	artifactHash?: string;
}): string {
	const summary = parts.errorSummary.replace(/\s+/g, " ").trim().slice(0, 240).toLowerCase();
	return [parts.checkId, String(parts.exitCode), summary, parts.artifactHash ?? ""].join("|");
}

/** Detect overlapping owned-path claims (shared-cwd mutating exclusivity). */
export function findOverlappingOwnedPaths(claims: OwnedPathClaim[]): OwnedPathClaim[] | undefined {
	for (let i = 0; i < claims.length; i++) {
		for (let j = i + 1; j < claims.length; j++) {
			const left = claims[i]!;
			const right = claims[j]!;
			for (const a of left.ownedPaths) {
				for (const b of right.ownedPaths) {
					if (pathsOverlap(a, b)) {
						return [left, right];
					}
				}
			}
		}
	}
	return undefined;
}

function pathsOverlap(a: string, b: string): boolean {
	const left = a.replace(/\\/g, "/").replace(/\/+$/, "") || ".";
	const right = b.replace(/\\/g, "/").replace(/\/+$/, "") || ".";
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export const OUTPUT_POLLUTION_NAMES = new Set([
	".venv",
	"venv",
	"__pycache__",
	".pytest_cache",
	"node_modules",
	".mypy_cache",
	".ruff_cache",
	".tox",
]);

export function detectOutputPollution(entryNames: string[]): string[] {
	return entryNames.filter((name) => OUTPUT_POLLUTION_NAMES.has(name) || name.endsWith(".pyc"));
}
