/**
 * Shared reliable-headless turn runner for print / TUI / server.
 * Runtime is always reliable-headless. Controller short-loop runs when a
 * compiled contract already has instruction-owned oracle evidence (chat-aware),
 * or always under strict headless policy (print/adapters with taskPaths).
 * Ambient bundled-public checks alone do not force chat-aware Controller entry.
 * Plan is the scoped exception: never host-verify.
 */

import type { ImageContent } from "@earendil-works/metis-ai";
import {
	DEFAULT_EXECUTION_PROFILE,
	EMPTY_TASK_CONTRACT,
	ensureReliableExecutionEnv,
	type ChildResult,
	type ExecutionResult,
	type TaskPaths,
} from "./execution-types.ts";
import {
	createHostNamedChildRunners,
	type HostNamedChildExecuteInput,
	type HostNamedChildExecuteResult,
} from "./host-named-child-runner.ts";
import {
	createTaskExecutionController,
	type AgentRunOutcome,
	type TaskExecutionControllerDeps,
} from "./task-execution-controller.ts";
import {
	buildContractInstruction,
	compileTaskContractFromRequest,
	contractHasInstructionOwnedOracle,
} from "./task-contract.ts";
import { verifyTaskContract } from "./task-verifier.ts";
import type { TraceCollector } from "./trace-collector.ts";

export type ReliableTurnPolicy = "strict" | "chat-aware";

export interface ReliableSessionLike {
	prompt: (text: string, opts?: { images?: ImageContent[] }) => Promise<unknown>;
	getActiveToolDefinition: (name: string) => import("./extensions/types.ts").ToolDefinition | undefined;
	performanceRun?: { status?: string; frontier?: string } | null;
	/** Plan mode must keep the original read-only prompt path; never host-verify. */
	collaborationMode?: string;
	/** Optional: latest assistant text / stopReason collection for outcomes. */
	collectAssistantOutcome?: () => AgentRunOutcome;
}

/** Adapters/headless oracles set task path env or explicit taskPaths. */
export function hasTaskPathHints(taskPaths?: TaskPaths, env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(
		taskPaths?.input
			|| taskPaths?.output
			|| taskPaths?.software
			|| env.METIS_TASK_INPUT?.trim()
			|| env.METIS_TASK_OUTPUT?.trim()
			|| env.METIS_TASK_SOFTWARE?.trim(),
	);
}

/**
 * Designed cutover: print/TUI/Desktop default chat-aware; Harbor/ALE/TB with
 * task path hints take strict named-child Controller.
 */
export function resolveReliableTurnPolicy(args: {
	requested?: ReliableTurnPolicy;
	taskPaths?: TaskPaths;
	env?: NodeJS.ProcessEnv;
}): ReliableTurnPolicy {
	if (args.requested) return args.requested;
	return hasTaskPathHints(args.taskPaths, args.env) ? "strict" : "chat-aware";
}

export interface RunReliableTurnOptions {
	session: ReliableSessionLike;
	instruction: string;
	cwd: string;
	taskPaths?: TaskPaths;
	signal?: AbortSignal;
	/**
	 * strict: always Controller (solver + named-child short-loop) — adapters with taskPaths.
	 * chat-aware: root prompt; Controller verify when the instruction owns an oracle; no child short-loop.
	 */
	policy: ReliableTurnPolicy;
	/** Images for the first conversational/root prompt only. */
	images?: ImageContent[];
	/** Additional follow-up messages for root runAgent (print batch). */
	followUpMessages?: string[];
	/** Override initial prompt text for root (defaults to instruction). */
	rootPromptText?: string;
	collectAssistantOutcome: () => AgentRunOutcome;
	traceCollector?: TraceCollector;
	hostNamedChildExecute?: (
		input: HostNamedChildExecuteInput,
		signal?: AbortSignal,
	) => Promise<HostNamedChildExecuteResult>;
	/** Injected ExecutionResult (tests). */
	executionResult?: ExecutionResult;
	/** Plan is the designed scoped exception: never host-verify. */
	collaborationMode?: string;
}

async function promptOnce(
	session: ReliableSessionLike,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	if (images) {
		await session.prompt(text, { images });
		return;
	}
	await session.prompt(text);
}

/** Original user→session.prompt loop: do not double-send joined instruction + follow-ups. */
async function promptOriginalWorkflow(options: RunReliableTurnOptions): Promise<void> {
	if (options.rootPromptText) {
		await promptOnce(options.session, options.rootPromptText, options.images);
	}
	for (const message of options.followUpMessages ?? []) {
		await promptOnce(options.session, message);
	}
	if (!options.rootPromptText && (options.followUpMessages?.length ?? 0) === 0 && options.instruction.trim()) {
		await promptOnce(options.session, options.instruction, options.images);
	}
}

function failingOrPassingFromOutcome(outcome: AgentRunOutcome, contract = EMPTY_TASK_CONTRACT): ExecutionResult {
	const failed = outcome.stopReason === "error" || outcome.stopReason === "aborted";
	return {
		status: failed ? "task_failed" : "completed",
		contract,
		attempts: [{ role: "root", status: failed ? "failed" : "completed", summary: outcome.finalText.slice(0, 200) }],
		completion: {
			passed: !failed,
			reasons: failed
				? [{ code: "task_failed", message: outcome.errorMessage || `Request ${outcome.stopReason}` }]
				: [],
			requiredArtifactsPresent: !failed,
			forbiddenArtifactsAbsent: true,
			checksPassed: !failed,
			unresolvedFindings: failed ? 1 : 0,
		},
		finalText: outcome.finalText,
		failure: failed
			? {
					code: "task_failed",
					message: outcome.errorMessage || `Request ${outcome.stopReason}`,
					retryable: false,
				}
			: undefined,
	};
}

function dedupeChildResults(fromTrace: ChildResult[], collected: ChildResult[]): ChildResult[] {
	if (fromTrace.length === 0) return [...collected];
	const seen = new Set(fromTrace.map((r) => `${r.status}|${r.summary}|${r.findings.length}|${r.commands.length}`));
	const extras = collected.filter((r) => {
		const key = `${r.status}|${r.summary}|${r.findings.length}|${r.commands.length}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return [...fromTrace, ...extras];
}

export function buildReliableControllerDeps(args: {
	session: ReliableSessionLike;
	cwd: string;
	collectAssistantOutcome: () => AgentRunOutcome;
	traceCollector?: TraceCollector;
	hostNamedChildExecute?: RunReliableTurnOptions["hostNamedChildExecute"];
	rootPromptText?: string;
	images?: ImageContent[];
	followUpMessages?: string[];
	/** Only strict/adapter turns may replace the root tool loop with named children. */
	attachHostNamedChildren?: boolean;
	/** Ambient package.json `npm test` must not run after ordinary chat. */
	includeBundledPublicChecks?: boolean;
}): TaskExecutionControllerDeps {
	const collectedChildResults: ChildResult[] = [];
	const namedRunners = args.attachHostNamedChildren
		? createHostNamedChildRunners({
				cwd: args.cwd,
				execute: args.hostNamedChildExecute,
				getSpawnTool: () => args.session.getActiveToolDefinition("spawn_agent"),
				onChildResult: (result) => {
					collectedChildResults.push(result);
				},
			})
		: {};

	return {
		runAgent: async () => {
			const text = args.rootPromptText ?? "";
			if (text) {
				await promptOnce(args.session, text, args.images);
			}
			for (const message of args.followUpMessages ?? []) {
				await promptOnce(args.session, message);
			}
			return args.collectAssistantOutcome();
		},
		runRepair: async (repair) => {
			const repairPrompt = [
				"Host verification failed. Repair the workspace using the exact failure evidence.",
				`Failure code: ${repair.failure.code}`,
				`Failure message: ${repair.failure.message}`,
				repair.failure.evidence ? `Evidence: ${repair.failure.evidence}` : "",
				"Do not claim success until the host re-runs checks.",
			]
				.filter(Boolean)
				.join("\n");
			await args.session.prompt(repairPrompt);
			return args.collectAssistantOutcome();
		},
		runPlanner: namedRunners.runPlanner,
		runImplementer: namedRunners.runImplementer,
		runVerifier: namedRunners.runVerifier,
		runContractSolver: namedRunners.runContractSolver,
		includeBundledPublicChecks: args.includeBundledPublicChecks ?? true,
		getPerformanceSnapshot: () =>
			args.session.performanceRun
				? {
						status: args.session.performanceRun.status as "active" | "completed" | "blocked" | "aborted" | undefined,
						frontier: args.session.performanceRun.frontier,
					}
				: undefined,
		resolveContract: (request) => compileTaskContractFromRequest(request),
		evaluateCompletion: async ({ request, contract, priorEvidenceHash }) => {
			const verified = await verifyTaskContract({
				contract,
				cwd: request.cwd,
				taskPaths: request.taskPaths,
				priorEvidenceHash,
				includeBundledPublicChecks: args.includeBundledPublicChecks ?? true,
			});
			return verified.completion;
		},
		getChildResults: () => {
			const fromTrace = args.traceCollector?.getChildResults?.() ?? [];
			return dedupeChildResults(fromTrace, collectedChildResults);
		},
	};
}

/**
 * Run one host-owned reliable turn.
 */
export async function runReliableTurn(options: RunReliableTurnOptions): Promise<ExecutionResult> {
	ensureReliableExecutionEnv();
	if (options.executionResult) return options.executionResult;

	const instruction =
		options.instruction.trim() ||
		buildContractInstruction(options.rootPromptText, options.followUpMessages ?? []);

	const compiled = compileTaskContractFromRequest({
		instruction,
		cwd: options.cwd,
		profile: DEFAULT_EXECUTION_PROFILE,
		deadlineMs: 0,
		taskPaths: options.taskPaths,
	});

	const collaborationMode = options.collaborationMode ?? options.session.collaborationMode;
	const useController =
		collaborationMode !== "plan"
		&& (options.policy === "strict" || contractHasInstructionOwnedOracle(compiled));

	if (!useController) {
		await promptOriginalWorkflow(options);
		return failingOrPassingFromOutcome(options.collectAssistantOutcome(), compiled);
	}

	const strict = options.policy === "strict";
	const deps = buildReliableControllerDeps({
		session: options.session,
		cwd: options.cwd,
		collectAssistantOutcome: options.collectAssistantOutcome,
		traceCollector: options.traceCollector,
		hostNamedChildExecute: options.hostNamedChildExecute,
		rootPromptText: options.rootPromptText ?? options.instruction,
		images: options.images,
		followUpMessages: options.followUpMessages,
		attachHostNamedChildren: strict,
		includeBundledPublicChecks: strict,
	});

	return createTaskExecutionController(deps).execute(
		{
			instruction,
			cwd: options.cwd,
			profile: DEFAULT_EXECUTION_PROFILE,
			deadlineMs: 0,
			taskPaths: options.taskPaths,
		},
		options.signal,
	);
}
