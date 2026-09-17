/**
 * Shared reliable-headless turn runner for print / TUI / server.
 * Runtime is always reliable-headless. Controller short-loop runs when a
 * compiled contract already has instruction-owned oracle evidence (chat-aware),
 * or always under strict headless policy (print/adapters). Ambient bundled-public
 * checks alone do not force chat-aware Controller entry.
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
	/** Optional: latest assistant text / stopReason collection for outcomes. */
	collectAssistantOutcome?: () => AgentRunOutcome;
}

export interface RunReliableTurnOptions {
	session: ReliableSessionLike;
	instruction: string;
	cwd: string;
	taskPaths?: TaskPaths;
	signal?: AbortSignal;
	/**
	 * strict: always Controller (solver + fail-closed) — print/json/adapters.
	 * chat-aware: Controller only when compile already has instruction-owned oracle; else conversational prompt.
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
}): TaskExecutionControllerDeps {
	const collectedChildResults: ChildResult[] = [];
	const namedRunners = createHostNamedChildRunners({
		cwd: args.cwd,
		execute: args.hostNamedChildExecute,
		getSpawnTool: () => args.session.getActiveToolDefinition("spawn_agent"),
		onChildResult: (result) => {
			collectedChildResults.push(result);
		},
	});

	return {
		runAgent: async () => {
			const text = args.rootPromptText ?? "";
			if (text) {
				await args.session.prompt(text, args.images ? { images: args.images } : undefined);
			}
			for (const message of args.followUpMessages ?? []) {
				await args.session.prompt(message);
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

	const useController =
		options.policy === "strict" || contractHasInstructionOwnedOracle(compiled);

	if (!useController) {
		const text = options.rootPromptText ?? options.instruction;
		if (text) {
			await options.session.prompt(text, options.images ? { images: options.images } : undefined);
		}
		for (const message of options.followUpMessages ?? []) {
			await options.session.prompt(message);
		}
		return failingOrPassingFromOutcome(options.collectAssistantOutcome(), compiled);
	}

	const deps = buildReliableControllerDeps({
		session: options.session,
		cwd: options.cwd,
		collectAssistantOutcome: options.collectAssistantOutcome,
		traceCollector: options.traceCollector,
		hostNamedChildExecute: options.hostNamedChildExecute,
		rootPromptText: options.rootPromptText ?? options.instruction,
		images: options.images,
		followUpMessages: options.followUpMessages,
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
