/**
 * Host-owned TaskExecutionController.
 * reliable-headless is the sole profile: probe → contract → run → verify → repair → exit.
 */

import {
	DEFAULT_EXECUTION_PROFILE,
	EMPTY_TASK_CONTRACT,
	ensureReliableExecutionEnv,
	normalizeFailureFingerprint,
	type ChildResult,
	type CompletionDecision,
	type ExecutionAttempt,
	type ExecutionPlan,
	type ExecutionProfile,
	type ExecutionRequest,
	type ExecutionResult,
	type TaskContract,
	type TaskPaths,
	type VerificationFailure,
	mapExecutionStatusToExitCode,
} from "./execution-types.ts";
import { evaluateChildGateEvidence } from "./child-gate-evidence.ts";
import {
	compileTaskContractFromRequest,
	contractHasIndependentOracle,
	buildContractSolverPrompt,
	parseAndValidateSolverProposal,
} from "./task-contract.ts";
import { verifyTaskContract } from "./task-verifier.ts";
import { probeWorkspace } from "./workspace-probe.ts";
import { planExecution } from "./execution-policy.ts";
import { buildImplementerBrief } from "./host-named-child-runner.ts";

export interface AgentRunOutcome {
	finalText: string;
	stopReason?: string;
	errorMessage?: string;
}

export interface PerformanceSnapshot {
	status?: "active" | "completed" | "blocked" | "aborted";
	frontier?: string;
}

export interface RepairRequest {
	attempt: number;
	failure: VerificationFailure;
	contract: TaskContract;
	priorOutcome: AgentRunOutcome;
}

export interface TaskExecutionControllerDeps {
	runAgent: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	/** Optional directed repair turn; when omitted, controller fails closed after first verifier failure. */
	runRepair?: (request: RepairRequest, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	/** Optional short-loop role runners. When absent, controller honestly records "root". */
	runPlanner?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	runImplementer?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	runVerifier?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	/** Optional host contract-solver for tasks whose instruction cannot yield deterministic oracles. */
	runContractSolver?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	getPerformanceSnapshot?: () => PerformanceSnapshot | undefined;
	resolveContract?: (request: ExecutionRequest) => Promise<TaskContract> | TaskContract;
	evaluateCompletion?: (args: {
		request: ExecutionRequest;
		contract: TaskContract;
		outcome: AgentRunOutcome;
		performance?: PerformanceSnapshot;
		priorEvidenceHash?: string;
	}) => Promise<CompletionDecision> | CompletionDecision;
	/** Optional: collect latest ChildResult events from spawn_agent for gate evidence. */
	getChildResults?: () => ChildResult[];
	maxRepairAttempts?: number;
}

export interface TaskExecutionController {
	execute(request: ExecutionRequest, signal?: AbortSignal): Promise<ExecutionResult>;
}

export function createTaskExecutionController(deps: TaskExecutionControllerDeps): TaskExecutionController {
	return {
		async execute(request, signal) {
			ensureReliableExecutionEnv();
			const normalized: ExecutionRequest = {
				...request,
				profile: DEFAULT_EXECUTION_PROFILE,
			};
			return executeReliableHeadless(normalized, deps, signal);
		},
	};
}

/**
 * @deprecated Prefer Controller.execute() as the production entry.
 * Kept for narrow unit tests that inject a precomputed agent outcome.
 */
export async function finalizeReliableHeadless(args: {
	request: ExecutionRequest;
	outcome: AgentRunOutcome;
	performance?: PerformanceSnapshot;
	resolveContract?: TaskExecutionControllerDeps["resolveContract"];
	evaluateCompletion?: TaskExecutionControllerDeps["evaluateCompletion"];
}): Promise<ExecutionResult> {
	return executeReliableHeadless(args.request, {
		runAgent: async () => args.outcome,
		getPerformanceSnapshot: () => args.performance,
		resolveContract: args.resolveContract,
		evaluateCompletion: args.evaluateCompletion,
	});
}

async function executeReliableHeadless(
	request: ExecutionRequest,
	deps: TaskExecutionControllerDeps,
	signal?: AbortSignal,
): Promise<ExecutionResult> {
	const probe = await probeWorkspace(request.cwd, request.taskPaths);
	if (!probe.ok) {
		return {
			status: "harness_error",
			contract: EMPTY_TASK_CONTRACT,
			attempts: [],
			completion: failingCompletion(probe.code ?? "WORKSPACE_PROBE_FAILED", probe.message ?? "Workspace probe failed"),
			finalText: "",
			failure: {
				code: probe.code ?? "WORKSPACE_PROBE_FAILED",
				message: probe.message ?? "Workspace probe failed",
				retryable: false,
			},
		};
	}

	const contractInitial = await resolveCompiledContract(request, deps);
	if (!contractInitial.compiled) {
		return {
			status: "task_failed",
			contract: contractInitial,
			attempts: [],
			completion: failingCompletion("CONTRACT_NOT_COMPILED", "TaskContract was not compiled by the host"),
			finalText: "",
			failure: { code: "CONTRACT_NOT_COMPILED", message: "TaskContract was not compiled by the host", retryable: false },
		};
	}

	const attempts: ExecutionAttempt[] = [];
	let contract = contractInitial;

	// After compile: if independent oracle is missing, invoke host-owned contract-solver when available.
	if (!contractHasIndependentOracle(contract) && deps.runContractSolver) {
		const solverOutcome = await deps.runContractSolver(buildContractSolverPrompt(request.instruction, contract), signal);
		attempts.push({
			role: "contract-solver",
			status: solverOutcome.stopReason === "error" || solverOutcome.stopReason === "aborted" ? "failed" : "completed",
			summary: solverOutcome.finalText.slice(0, 200),
		});
		if (solverOutcome.stopReason === "error" || solverOutcome.stopReason === "aborted") {
			return {
				status: "task_failed",
				contract,
				attempts,
				completion: failingCompletion("CONTRACT_SOLVER_INVALID", solverOutcome.errorMessage || "contract-solver failed"),
				finalText: solverOutcome.finalText,
				failure: {
					code: "CONTRACT_SOLVER_INVALID",
					message: solverOutcome.errorMessage || "contract-solver failed",
					retryable: true,
				},
			};
		}
		const parsed = parseAndValidateSolverProposal(solverOutcome.finalText, request.cwd, request.taskPaths);
		if (!parsed.ok) {
			const code = parsed.reason.startsWith("CONTRACT_SOLVER_INSUFFICIENT")
				? "CONTRACT_SOLVER_INSUFFICIENT"
				: "CONTRACT_SOLVER_INVALID";
			return {
				status: "task_failed",
				contract,
				attempts,
				completion: failingCompletion(code, parsed.reason),
				finalText: solverOutcome.finalText,
				failure: { code, message: parsed.reason, retryable: false },
			};
		}
		contract = compileTaskContractFromRequest(request, parsed.proposed);
		if (!contract.compiled || !contractHasIndependentOracle(contract)) {
			return {
				status: "task_failed",
				contract,
				attempts,
				completion: failingCompletion(
					"CONTRACT_SOLVER_INSUFFICIENT",
					"Solver proposal did not yield an independent host oracle after recompile",
				),
				finalText: solverOutcome.finalText,
				failure: {
					code: "CONTRACT_SOLVER_INSUFFICIENT",
					message: "Solver proposal did not yield an independent host oracle after recompile",
					retryable: false,
				},
			};
		}
	}

	const plan = planExecution({ request, contract });
	const { outcome: firstOutcome, attempts: dispatchAttempts } = await dispatchImplementation(request, plan, deps, signal);
	let outcome = firstOutcome;
	attempts.push(...dispatchAttempts);

	if (outcome.stopReason === "error" || outcome.stopReason === "aborted") {
		return {
			status: "task_failed",
			contract,
			attempts,
			completion: failingCompletion("task_failed", outcome.errorMessage || `Request ${outcome.stopReason}`),
			finalText: outcome.finalText,
			failure: {
				code: "task_failed",
				message: outcome.errorMessage || `Request ${outcome.stopReason}`,
				retryable: false,
			},
		};
	}

	const performance = deps.getPerformanceSnapshot?.();
	// Host ChildResult/oracle owns completion. Legacy performance active/blocked
	// must not fail a correctly verified workspace.

	let priorEvidenceHash: string | undefined;
	let gate = await evaluateHostGate({ request, contract, outcome, performance, deps, priorEvidenceHash });
	let lastFingerprint = gate.fingerprint;
	let lastEvidenceHash = gate.evidenceHash;

	const maxRepairs = deps.maxRepairAttempts ?? plan.maxRepairAttempts;
	let repairCount = 0;
	while (!gate.completion.passed && repairCount < maxRepairs) {
		const failure: VerificationFailure = {
			code: gate.completion.reasons[0]?.code ?? "CHECK_FAILED",
			message: gate.completion.reasons[0]?.message ?? "Verification failed",
			fingerprint: lastFingerprint,
			evidence: gate.completion.reasons[0]?.evidence,
		};

		if (!deps.runRepair) {
			attempts.push({
				role: "repairer",
				status: "failed",
				summary: "Verifier failed and no repair handler is configured",
				failureFingerprint: lastFingerprint,
			});
			break;
		}

		repairCount += 1;
		outcome = await deps.runRepair({ attempt: repairCount, failure, contract, priorOutcome: outcome }, signal);
		attempts.push({
			role: "repairer",
			status: outcome.stopReason === "error" || outcome.stopReason === "aborted" ? "failed" : "completed",
			summary: outcome.finalText.slice(0, 200),
			failureFingerprint: lastFingerprint,
		});

		// After repair, do not treat the previous success evidence as current;
		// pass lastEvidenceHash so workspace content changes are observed in fingerprints.
		priorEvidenceHash = undefined;
		gate = await evaluateHostGate({ request, contract, outcome, performance, deps, priorEvidenceHash });
		const nextFingerprint = gate.completion.passed ? undefined : gate.fingerprint;

		if (!gate.completion.passed && nextFingerprint && nextFingerprint === lastFingerprint) {
			return {
				status: "task_failed",
				contract,
				attempts,
				completion: failingCompletion("NO_PROGRESS_FINGERPRINT", `Identical failure fingerprint after repair ${repairCount}`),
				finalText: outcome.finalText,
				failure: {
					code: "NO_PROGRESS_FINGERPRINT",
					message: `Identical failure fingerprint after repair ${repairCount}`,
					retryable: false,
				},
			};
		}
		lastFingerprint = nextFingerprint;
		lastEvidenceHash = gate.evidenceHash;
		priorEvidenceHash = lastEvidenceHash;
	}

	if (!gate.completion.passed) {
		const primary = gate.completion.reasons[0];
		return {
			status: "task_failed",
			contract,
			attempts,
			completion: gate.completion,
			finalText: outcome.finalText,
			failure: primary
				? { code: primary.code, message: primary.message, retryable: repairCount < maxRepairs }
				: { code: "task_failed", message: "Completion decision failed", retryable: false },
		};
	}

	return {
		status: "completed",
		contract,
		attempts,
		completion: gate.completion,
		finalText: outcome.finalText,
	};
}

/**
 * Honest short-loop dispatch:
 * - When role runners exist and plan asks for them, run planner → implementer → verifier.
 * - Planner final text is embedded into the implementer brief (never discarded).
 * - Otherwise degrade to a single root attempt (never label root work as implementer).
 */
async function dispatchImplementation(
	request: ExecutionRequest,
	plan: ExecutionPlan,
	deps: TaskExecutionControllerDeps,
	signal?: AbortSignal,
): Promise<{ outcome: AgentRunOutcome; attempts: ExecutionAttempt[] }> {
	const canShortLoop =
		Boolean(deps.runPlanner || deps.runImplementer) &&
		(plan.plannerRequired || plan.implementationOwner === "implementer");

	const toAttempt = (role: ExecutionAttempt["role"], outcome: AgentRunOutcome): ExecutionAttempt => ({
		role,
		status: outcome.stopReason === "error" || outcome.stopReason === "aborted" ? "failed" : "completed",
		summary: outcome.finalText.slice(0, 200),
	});

	if (!canShortLoop) {
		const outcome = await deps.runAgent(request.instruction, signal);
		return { outcome, attempts: [toAttempt("root", outcome)] };
	}

	const attempts: ExecutionAttempt[] = [];
	let outcome: AgentRunOutcome = { finalText: "", stopReason: "stop" };
	let implementerInstruction = request.instruction;

	if (plan.plannerRequired && deps.runPlanner) {
		outcome = await deps.runPlanner(request.instruction, signal);
		attempts.push(toAttempt("planner", outcome));
		if (outcome.stopReason === "error" || outcome.stopReason === "aborted") {
			return { outcome, attempts };
		}
		implementerInstruction = buildImplementerBrief(request.instruction, outcome.finalText);
	}

	if (deps.runImplementer && (plan.implementationOwner === "implementer" || plan.plannerRequired)) {
		outcome = await deps.runImplementer(implementerInstruction, signal);
		attempts.push(toAttempt("implementer", outcome));
		if (outcome.stopReason === "error" || outcome.stopReason === "aborted") {
			return { outcome, attempts };
		}
	} else if (attempts.length === 0) {
		outcome = await deps.runAgent(request.instruction, signal);
		return { outcome, attempts: [toAttempt("root", outcome)] };
	}

	// Verifier is optional by policy; run only on design short-loops that already used planner.
	if (deps.runVerifier && plan.plannerRequired && attempts.some((a) => a.role === "implementer")) {
		outcome = await deps.runVerifier(
			[
				"## Host verification brief",
				"Inspect the shared cwd against the original task. Emit ChildResult JSON.",
				"",
				"## Original task",
				request.instruction,
			].join("\n"),
			signal,
		);
		attempts.push(toAttempt("verifier", outcome));
	}

	if (attempts.length === 0) {
		outcome = await deps.runAgent(request.instruction, signal);
		return { outcome, attempts: [toAttempt("root", outcome)] };
	}

	return { outcome, attempts };
}

async function resolveCompiledContract(request: ExecutionRequest, deps: TaskExecutionControllerDeps): Promise<TaskContract> {
	if (deps.resolveContract) {
		const resolved = await deps.resolveContract(request);
		if (resolved.compiled) return resolved;
		return resolved;
	}
	return compileTaskContractFromRequest(request);
}

interface HostGateResult {
	completion: CompletionDecision;
	evidenceHash: string;
	fingerprint?: string;
}

async function evaluateHostGate(args: {
	request: ExecutionRequest;
	contract: TaskContract;
	outcome: AgentRunOutcome;
	performance?: PerformanceSnapshot;
	deps: TaskExecutionControllerDeps;
	priorEvidenceHash?: string;
}): Promise<HostGateResult> {
	const { request, contract, outcome, performance, deps, priorEvidenceHash } = args;

	const childGate = evaluateChildGateEvidence(deps.getChildResults?.() ?? []);
	if (!childGate.passed) {
		return {
			completion: {
				passed: false,
				reasons: childGate.reasons,
				requiredArtifactsPresent: false,
				forbiddenArtifactsAbsent: true,
				checksPassed: false,
				unresolvedFindings: childGate.reasons.length,
			},
			evidenceHash: priorEvidenceHash ?? contract.contractHash,
			fingerprint: normalizeFailureFingerprint({
				checkId: String(childGate.reasons[0]?.code ?? "CHILD_RESULT_FAILED"),
				exitCode: 1,
				errorSummary: childGate.reasons[0]?.message ?? "child gate failed",
				artifactHash: priorEvidenceHash ?? "child-gate",
			}),
		};
	}

	if (deps.evaluateCompletion) {
		const completion = await deps.evaluateCompletion({ request, contract, outcome, performance, priorEvidenceHash });
		const verified = await verifyTaskContract({
			contract,
			cwd: request.cwd,
			taskPaths: request.taskPaths,
			priorEvidenceHash,
		});
		// Prefer host evaluateCompletion decision, but always use real workspace evidence hash.
		return {
			completion,
			evidenceHash: verified.evidenceHash,
			fingerprint: completion.passed
				? undefined
				: normalizeFailureFingerprint({
						checkId: String(completion.reasons[0]?.code ?? "CHECK_FAILED"),
						exitCode: 1,
						errorSummary: completion.reasons[0]?.message ?? "Verification failed",
						artifactHash: verified.evidenceHash,
					}),
		};
	}

	const verified = await verifyTaskContract({
		contract,
		cwd: request.cwd,
		taskPaths: request.taskPaths,
		priorEvidenceHash,
	});
	return {
		completion: verified.completion,
		evidenceHash: verified.evidenceHash,
		fingerprint: verified.fingerprint,
	};
}

function failingCompletion(code: string, message: string): CompletionDecision {
	return {
		passed: false,
		reasons: [{ code, message }],
		requiredArtifactsPresent: false,
		forbiddenArtifactsAbsent: true,
		checksPassed: false,
		unresolvedFindings: 1,
	};
}

export { mapExecutionStatusToExitCode };
export type { ExecutionPlan };

/**
 * Resolve the sole product profile. Unknown/legacy CLI or env values are forced to reliable-headless.
 */
export function resolveExecutionProfile(
	_cliProfile?: ExecutionProfile | string,
	env: NodeJS.ProcessEnv = process.env,
): ExecutionProfile {
	return ensureReliableExecutionEnv(env);
}

export function resolveTaskPathsFromEnv(env: NodeJS.ProcessEnv = process.env): TaskPaths | undefined {
	const input = env.METIS_TASK_INPUT?.trim();
	const output = env.METIS_TASK_OUTPUT?.trim();
	const software = env.METIS_TASK_SOFTWARE?.trim();
	if (!input && !output && !software) return undefined;
	return { input, output, software };
}
