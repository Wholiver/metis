/**
 * Host-owned named-child runners for reliable-headless Controller short-loop.
 * Reuses the session-registered spawn_agent tool (full runtime options) so
 * model/thinking/policy/ownership match production AgentSession wiring.
 */

import type { ToolDefinition } from "./extensions/types.ts";
import type { ChildResult } from "./execution-types.ts";
import { runAsHostDispatch } from "./host-dispatch.ts";
import type { AgentRunOutcome } from "./task-execution-controller.ts";
import {
	createSpawnAgentToolDefinition,
	type ChildAgentResultPayload,
	type SpawnAgentToolOptions,
} from "./tools/spawn_agent.ts";

export interface HostNamedChildExecuteInput {
	agent: string;
	task: string;
	context?: string;
}

export interface HostNamedChildExecuteResult {
	finalText: string;
	stopReason?: string;
	errorMessage?: string;
	childResult?: ChildResult;
	rawPayload?: ChildAgentResultPayload;
}

export interface HostNamedChildRunnerOptions {
	cwd: string;
	/**
	 * Prefer the AgentSession-registered *active* spawn_agent definition so provider/model/
	 * prepareDispatch/validateSpawn/ownership are inherited. Required for production.
	 * Callers must resolve via getActiveToolDefinition("spawn_agent") (not bare registry).
	 */
	getSpawnTool?: () => ToolDefinition | undefined;
	/** Fallback options when getSpawnTool is unavailable (tests). */
	spawnOptions?: SpawnAgentToolOptions;
	/** Injectable execute seam for higher-level tests. Prefer process-level mocks for production tests. */
	execute?: (input: HostNamedChildExecuteInput, signal?: AbortSignal) => Promise<HostNamedChildExecuteResult>;
	onChildResult?: (result: ChildResult, agent: string) => void;
}

export function buildImplementerBrief(originalInstruction: string, plannerFinalText: string): string {
	return [
		"## Host plan from planner",
		plannerFinalText.trim() || "(empty planner output)",
		"",
		"## Original task",
		originalInstruction,
	].join("\n");
}

function payloadToOutcome(payload: ChildAgentResultPayload): HostNamedChildExecuteResult {
	const childResult = payload.childResult;
	const failed = payload.status === "error" || childResult?.status === "failed" || childResult?.status === "blocked";
	return {
		finalText: payload.result ?? childResult?.summary ?? "",
		stopReason: failed ? "error" : "stop",
		errorMessage: payload.error,
		childResult,
		rawPayload: payload,
	};
}

async function defaultExecute(
	options: HostNamedChildRunnerOptions,
	input: HostNamedChildExecuteInput,
	signal?: AbortSignal,
): Promise<HostNamedChildExecuteResult> {
	const sessionTool = options.getSpawnTool?.();
	// Production must use the active session spawn_agent. Never fall back to a bare
	// createSpawnAgentToolDefinition(cwd) that drops model/thinking/policy/ownership.
	const tool =
		sessionTool ??
		(options.spawnOptions
			? createSpawnAgentToolDefinition(options.cwd, options.spawnOptions)
			: undefined);
	if (!tool) {
		return {
			finalText: "",
			stopReason: "error",
			errorMessage:
				"HOST_NAMED_CHILD_NO_SPAWN: active session spawn_agent is required (no bare cwd fallback)",
		};
	}
	const result = await runAsHostDispatch(() =>
		tool.execute(
			`host-${input.agent}`,
			{
				agent: input.agent,
				task: input.task,
				context: input.context,
				mode: "sync",
			},
			signal,
			() => {},
			undefined as never,
		),
	);
	const text = result.content?.[0] && "text" in result.content[0] ? String(result.content[0].text) : "";
	try {
		const payload = JSON.parse(text) as ChildAgentResultPayload;
		return payloadToOutcome(payload);
	} catch {
		return { finalText: text, stopReason: "stop" };
	}
}

export function createHostNamedChildRunners(options: HostNamedChildRunnerOptions): {
	runPlanner?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	runImplementer?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	runVerifier?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
	runContractSolver?: (instruction: string, signal?: AbortSignal) => Promise<AgentRunOutcome>;
} {
	const runRole = async (agent: string, instruction: string, signal?: AbortSignal): Promise<AgentRunOutcome> => {
		const executed = options.execute
			? await runAsHostDispatch(() => options.execute!({ agent, task: instruction }, signal))
			: await defaultExecute(options, { agent, task: instruction }, signal);
		if (executed.childResult) {
			options.onChildResult?.(executed.childResult, agent);
		}
		return {
			finalText: executed.finalText,
			stopReason: executed.stopReason,
			errorMessage: executed.errorMessage,
		};
	};

	return {
		runPlanner: (instruction, signal) => runRole("planner", instruction, signal),
		runImplementer: (instruction, signal) => runRole("implementer", instruction, signal),
		runVerifier: (instruction, signal) => runRole("verifier", instruction, signal),
		runContractSolver: (instruction, signal) => runRole("contract-solver", instruction, signal),
	};
}
