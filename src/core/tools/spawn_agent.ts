import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentTool, ThinkingLevel } from "@earendil-works/metis-agent-core";
import { Text } from "@earendil-works/metis-tui";
import { Type, type Static } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

import { getGlobalSpawnGuard, type SpawnGuard, type SpawnErrorCode, computeTaskHash } from "../spawn-guard.ts";
import { createIsolatedWorkspace, type IsolatedWorkspace } from "../worktree.ts";
import { filterChildEnvironment, sanitizeTraceData } from "../env-sanitizer.ts";
import { isMutatingChildRole, resolveChildWorktree } from "../workspace-probe.ts";
import type { ChildResult } from "../execution-types.ts";
import { getGlobalTraceCollector, type TraceSummaryPayload } from "../trace-collector.ts";

const SPAWN_PROGRESS_HEARTBEAT_MS = 5_000;
const SPAWN_PROGRESS_THROTTLE_MS = 1_500;
const SPAWN_EXIT_DRAIN_GRACE_MS = 1_000;
const SPAWN_RELEASE_RETRY_DELAYS_MS = [25, 50, 100] as const;

/**
 * TypeBox Schema for spawn_agent (Feat 4, 15, 50)
 */
export const spawnAgentSchema = Type.Object({
	agent: Type.String({
		description: "Name of the target named agent (e.g. 'coordinator', 'planner', 'implementer', 'reviewer', 'verifier', or any custom defined agent)",
	}),
	task: Type.String({
		description: "The concrete task instructions and expected output for the agent",
	}),
	context: Type.Optional(
		Type.String({
			description: "Optional contextual background, data payload, or findings to provide to the agent",
		}),
	),
	laneId: Type.Optional(
		Type.String({ description: "Typed Performance admission lane identifier" }),
	),
	gate: Type.Optional(
		Type.Union([
			Type.Literal("G0"), Type.Literal("G1"), Type.Literal("G1-review"), Type.Literal("G1-verify"),
			Type.Literal("G2"), Type.Literal("G2-review"), Type.Literal("G2-verify"), Type.Literal("G3.5"),
			Type.Literal("G4"), Type.Literal("G5"), Type.Literal("G6"), Type.Literal("G7"),
			Type.Literal("sweep"), Type.Literal("goal-check"),
		], { description: "Host-assigned Performance gate this child is bound to. The child emits ChildResult; it must not call performance_gate." }),
	),
	mode: Type.Optional(
		Type.Union([Type.Literal("sync"), Type.Literal("async")], {
			description: "Execution mode: 'sync' (default, foreground blocking wait) or 'async' (background execution)",
		}),
	),
	worktree: Type.Optional(
		Type.String({
			description: "Optional isolated workspace ('auto', 'temp', 'branch:<name>', or relative/absolute path). Auto/branch modes snapshot the parent workspace; successful isolated workspaces are retained for integration.",
		}),
	),
	force: Type.Optional(
		Type.Boolean({
			description: "Force execution if a duplicate task warning was triggered",
		}),
	),
	rationale: Type.Optional(
		Type.String({
			description: "Explanation or rationale for repeating a task or re-invoking the agent",
		}),
	),
	timeoutSeconds: Type.Optional(
		Type.Number({
			description: "Optional execution timeout in seconds (e.g. 60, 300)",
		}),
	),
	ownedPaths: Type.Optional(
		Type.Array(Type.String(), {
			description: "Optional list of file or directory paths owned exclusively by this agent for shared-cwd exclusivity",
		}),
	),
});

export type SpawnAgentToolInput = Static<typeof spawnAgentSchema>;

export interface SpawnAgentRuntimeContext {
	rootRunId?: string;
	currentAgentId?: string;
	currentAgentName?: string;
	currentDepth?: number;
	provider?: string;
	model?: string;
	baseUrl?: string;
	thinking?: ThinkingLevel;
	/** Native orchestration may select a configured child model per role. */
	getChildModel?: (agent: string) => { provider: string; model: string; baseUrl?: string } | undefined;
	/** Native orchestration may select an effort per child role. */
	getChildThinking?: (agent: string) => ThinkingLevel | undefined;
	apiKey?: string;
	skills?: string[];
	extensions?: string[];
	env?: Record<string, string>;
	agentChain?: string[];
	/** Absolute owned paths for shared-cwd exclusivity checks. */
	ownedPaths?: string[];
}

export interface HostChildGateRecord {
	evidence: string;
	frontier: string;
	nextAction: string;
	live?: string;
}

export interface SpawnAgentToolOptions {
	guard?: SpawnGuard;
	getGuard?: () => SpawnGuard;
	runtimeContext?: SpawnAgentRuntimeContext;
	getRuntimeContext?: () => SpawnAgentRuntimeContext;
	/** Canonicalize a governed dispatch before policy checks and workspace creation. */
	prepareDispatch?: (input: SpawnAgentToolInput, runtime: SpawnAgentRuntimeContext | undefined) => Promise<SpawnAgentToolInput> | SpawnAgentToolInput;
	/** Optional runtime policy layered before generic depth/concurrency guard checks. */
	validateSpawn?: (input: SpawnAgentToolInput, runtime: SpawnAgentRuntimeContext | undefined, childAgentId: string) => string | undefined;
	/** Releases a successful policy reservation after a child exits or launch fails. */
	releaseSpawn?: (childAgentId: string) => void | Promise<void>;
	/** Claim shared-cwd mutating ownership before launch; return error string to reject. */
	claimMutatingOwner?: (childAgentId: string, role: string, ownedPaths: string[]) => string | undefined;
	/** Release shared-cwd mutating ownership after child exit. */
	releaseMutatingOwner?: (childAgentId: string) => void;
	/** Optional resolver for lane owned boundaries */
	getLaneOwnedPaths?: (laneId: string) => string[] | undefined;
	/**
	 * Host records child-owned gates (G4/G5/G6/G7/sweep/goal-check and G1/G2 assurance)
	 * from ChildResult under the child's actor. Root must not stamp those gates.
	 */
	recordChildGate?: (input: {
		agentId: string;
		role: string;
		gate: NonNullable<SpawnAgentToolInput["gate"]>;
		itemId?: string;
		outcome: "pass" | "fail" | "blocked";
		childResult: ChildResult;
	}) => HostChildGateRecord | undefined;
	sendMessage?: (agentId: string, result: string) => void;
	onStatusChange?: (agentId: string, running: boolean) => void;
}

export const SPAWN_AGENT_GUIDANCE = [
	"Delegate a specific task to a specialized named agent (e.g. planner, implementer, reviewer, verifier, or coordinator).",
	"Children emit one ChildResult JSON line and must not call performance_gate; the host records gate evidence.",
	"T0 forbids spawn_agent. T1 keeps implementation on root and permits only fresh reviewer/verifier assurance after G4. T2/T3 may delegate only roles and lanes admitted by Performance runtime.",
	"By default, execution is synchronous ('sync') and blocks until the agent completes, returning structured results directly.",
	"For parallel background execution across multiple agents, set mode to 'async'.",
	"An isolated worktree starts from a snapshot of the parent workspace, including uncommitted and untracked files.",
	"Isolated worktrees are retained after successful completion so the parent can inspect and integrate child changes; failed or cancelled workspaces are cleaned up.",
].join(" ");

function getMetisInvocation(): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	const isElectron = Boolean(process.versions.electron || process.env.ELECTRON_RUN_AS_NODE);

	if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
		// Prefer a real Node binary under Electron. Spawning Electron-as-node is fragile and
		// historically left orphaned child trees when parents exited uncleanly.
		if (isElectron) {
			const candidate = process.env.npm_node_execpath || process.env.NODE_BINARY;
			if (candidate && existsSync(candidate)) {
				return { command: candidate, args: [currentScript] };
			}
			// Fall back to ELECTRON_RUN_AS_NODE with the Electron binary.
			return { command: process.execPath, args: [currentScript] };
		}
		return { command: process.execPath, args: [currentScript] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime && !isElectron) {
		return { command: process.execPath, args: [] };
	}

	return { command: process.execPath || "metis", args: [] };
}

export interface ChildAgentResultPayload {
	status: "success" | "error" | "started" | "timed_out";
	outcome?: "pass" | "fail" | "blocked" | "invalid_brief" | "no_verdict" | "invalid";
	gate?: SpawnAgentToolInput["gate"];
	itemId?: string;
	evidence?: string;
	errorCode?: SpawnErrorCode | "CHILD_RESULT_INVALID";
	agent: string;
	agentId: string;
	parentId: string;
	rootRunId: string;
	depth: number;
	provider?: string;
	model?: string;
	baseUrl?: string;
	result?: string;
	error?: string;
	hint?: string;
	exitCode?: number | null;
	worktree?: string;
	worktreeRetained?: boolean;
	/** Present when the host auto-recorded a governed gate from ChildResult. */
	hostGate?: HostChildGateRecord;
	frontier?: string;
	nextAction?: string;
	childResult?: ChildResult;
}

interface GateOutcome {
	outcome: NonNullable<ChildAgentResultPayload["outcome"]>;
	gate?: SpawnAgentToolInput["gate"];
	itemId?: string;
	evidence?: string;
}

function extractGateOutcome(value: unknown, expectedGate?: SpawnAgentToolInput["gate"]): GateOutcome | undefined {
	if (typeof value === "string") {
		try { return extractGateOutcome(JSON.parse(value), expectedGate); } catch { return undefined; }
	}
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (record.outcome === "invalid_brief" || record.code === "INVALID_BRIEF") {
		return { outcome: "invalid_brief", gate: expectedGate };
	}
	if (Array.isArray(record.reports)) {
		const reports = record.reports.filter((report): report is Record<string, unknown> => Boolean(report) && typeof report === "object");
		const report = [...reports].reverse().find((candidate) => !expectedGate || candidate.gate === expectedGate);
		if (report && ["pass", "fail", "blocked"].includes(String(report.verdict))) {
			return {
				outcome: report.verdict as GateOutcome["outcome"],
				gate: report.gate as GateOutcome["gate"],
				itemId: typeof report.itemId === "string" ? report.itemId : undefined,
				evidence: typeof report.evidence === "string" ? report.evidence : undefined,
			};
		}
	}
	for (const key of ["details", "result", "content", "data"]) {
		const nested = extractGateOutcome(record[key], expectedGate);
		if (nested) return nested;
	}
	return undefined;
}

function extractGateOutcomeFromJsonLines(content: string, expectedGate?: SpawnAgentToolInput["gate"]): GateOutcome | undefined {
	let latest: GateOutcome | undefined;
	for (const line of content.split(/\r?\n/)) {
		try {
			const event = JSON.parse(line);
			if (event?.type === "tool_execution_end" && event.toolName === "performance_gate") {
				latest = extractGateOutcome(event.result, expectedGate) ?? latest;
			}
		} catch {}
	}
	return latest;
}

export function normalizeChildResult(parsed: any): ChildResult | undefined {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

	// Ignore internal trace/streaming events unless explicitly a child result event
	const eventTypes = new Set([
		"trace_summary",
		"message_start",
		"message_update",
		"message_end",
		"tool_execution_start",
		"tool_execution_end",
		"subagent_status",
		"agent_event",
	]);
	if (parsed.type && eventTypes.has(parsed.type)) return undefined;

	// Status normalization
	const rawStatus = String(parsed.status ?? parsed.verdict ?? parsed.outcome ?? parsed.result ?? "").toLowerCase().trim();
	let status: ChildResult["status"] | undefined;
	if (["completed", "pass", "passed", "success", "succeeded", "ok"].includes(rawStatus)) {
		status = "completed";
	} else if (["failed", "fail", "failure", "error"].includes(rawStatus)) {
		status = "failed";
	} else if (rawStatus === "blocked") {
		status = "blocked";
	} else if (["invalid", "invalid_brief"].includes(rawStatus)) {
		status = "invalid";
	}

	const hasIndicators = parsed.filesChanged !== undefined || parsed.changedFiles !== undefined ||
		parsed.summary !== undefined || parsed.commands !== undefined || parsed.findings !== undefined ||
		parsed.testCommand !== undefined || parsed.testOutput !== undefined || parsed.risks !== undefined ||
		parsed.files !== undefined || parsed.modifiedFiles !== undefined || parsed.deliverables !== undefined;
	if (!status || !hasIndicators) {
		if (hasIndicators && !status) {
			status = "completed";
		} else {
			return undefined;
		}
	}

	// Summary normalization
	let summary = "";
	if (typeof parsed.summary === "string" && parsed.summary.trim()) {
		summary = parsed.summary.trim();
	} else if (typeof parsed.message === "string" && parsed.message.trim()) {
		summary = parsed.message.trim();
	} else if (typeof parsed.description === "string" && parsed.description.trim()) {
		summary = parsed.description.trim();
	} else if (typeof parsed.testOutput === "string" && parsed.testOutput.trim()) {
		summary = parsed.testOutput.trim();
	} else {
		summary = `Child agent ${status} execution.`;
	}

	// Files changed normalization
	const rawFiles = parsed.filesChanged ?? parsed.changedFiles ?? parsed.files ?? parsed.modifiedFiles ?? parsed.deliverables;
	let filesChanged: string[] = [];
	if (Array.isArray(rawFiles)) {
		filesChanged = rawFiles.map((f: unknown) => String(f).trim()).filter(Boolean);
	} else if (typeof rawFiles === "string" && rawFiles.trim()) {
		filesChanged = [rawFiles.trim()];
	}

	// Commands normalization
	let commands: ChildResult["commands"] = [];
	const rawCommands = parsed.commands ?? parsed.commandsRun;
	if (Array.isArray(rawCommands)) {
		commands = rawCommands.map((c: any) => {
			if (typeof c === "string") {
				return { argv: c.split(" ").filter(Boolean), cwd: ".", exitCode: 0 };
			}
			const argv = Array.isArray(c?.argv) ? c.argv.map(String) : typeof c?.command === "string" ? c.command.split(" ").filter(Boolean) : [];
			return {
				argv,
				cwd: typeof c?.cwd === "string" ? c.cwd : ".",
				exitCode: typeof c?.exitCode === "number" ? c.exitCode : 0,
			};
		});
	} else if (parsed.testCommand) {
		const cmdStr = String(parsed.testCommand).trim();
		commands = [{
			argv: cmdStr.split(" ").filter(Boolean),
			cwd: ".",
			exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : 0,
		}];
	}

	// Findings normalization
	let findings: ChildResult["findings"] = [];
	const rawFindings = parsed.findings ?? parsed.risks ?? parsed.issues;
	if (Array.isArray(rawFindings)) {
		findings = rawFindings.map((f: any) => {
			if (typeof f === "string") {
				return { code: "FINDING", message: f };
			}
			return {
				code: typeof f?.code === "string" ? f.code : "FINDING",
				message: typeof f?.message === "string" ? f.message : String(f ?? ""),
				evidence: typeof f?.evidence === "string" ? f.evidence : undefined,
			};
		});
	}

	const proposedRepair = typeof parsed.proposedRepair === "string"
		? parsed.proposedRepair
		: typeof parsed.repair === "string"
			? parsed.repair
			: undefined;

	return {
		status,
		summary,
		filesChanged,
		commands,
		findings,
		...(proposedRepair ? { proposedRepair } : {}),
	};
}

export function extractChildResultFromOutput(content: string): ChildResult | undefined {
	if (!content) return undefined;
	let latest: ChildResult | undefined;

	// 1. Check markdown fenced code blocks: ```json ... ``` or ``` ... ```
	const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
	let match: RegExpExecArray | null;
	while ((match = codeBlockRegex.exec(content)) !== null) {
		const blockText = match[1]?.trim();
		if (blockText && (blockText.startsWith("{") || blockText.includes('"status"') || blockText.includes('"verdict"'))) {
			try {
				const parsed = JSON.parse(blockText);
				const normalized = normalizeChildResult(parsed);
				if (normalized) latest = normalized;
			} catch {}
		}
	}

	// 2. Check line by line (handles single-line JSONs)
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const parsed = JSON.parse(trimmed);
			const normalized = normalizeChildResult(parsed);
			if (normalized) latest = normalized;
		} catch {}
	}

	// 3. Multiline balanced brace extraction if not yet found
	if (!latest) {
		let depth = 0;
		let endIndex = -1;
		for (let i = content.length - 1; i >= 0; i--) {
			if (content[i] === "}") {
				if (depth === 0) endIndex = i;
				depth++;
			} else if (content[i] === "{") {
				if (depth > 0) {
					depth--;
					if (depth === 0 && endIndex !== -1) {
						const candidate = content.slice(i, endIndex + 1);
						try {
							const parsed = JSON.parse(candidate);
							const normalized = normalizeChildResult(parsed);
							if (normalized) {
								latest = normalized;
								break;
							}
						} catch {}
						endIndex = -1;
					}
				}
			}
		}
	}

	return latest;
}

export function stripChildResultFromOutput(content: string): string {
	if (!content) return "";
	// 1. Remove code blocks that parse into a valid ChildResult
	let stripped = content.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, (match, blockText) => {
		try {
			const parsed = JSON.parse(blockText.trim());
			if (normalizeChildResult(parsed)) return "";
		} catch {}
		return match;
	});

	// 2. Remove single lines that parse into a valid ChildResult
	const lines = stripped.split(/\r?\n/);
	const filtered = lines.filter((line) => {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) return true;
		try {
			const parsed = JSON.parse(trimmed);
			if (normalizeChildResult(parsed)) return false;
			return true;
		} catch {
			return true;
		}
	});
	return filtered.join("\n").trim();
}

/** Extract nested trace_summary envelopes from child stdout/jsonl and merge into parent collector. */
export function extractAndMergeChildTraceSummaries(
	content: string,
	collector: ReturnType<typeof getGlobalTraceCollector> = getGlobalTraceCollector(),
): number {
	let merged = 0;
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{") || !trimmed.includes("trace_summary")) continue;
		try {
			const parsed = JSON.parse(trimmed) as { type?: string };
			if (parsed.type !== "trace_summary") continue;
			collector.mergeChildTrace(parsed as TraceSummaryPayload);
			merged += 1;
		} catch {
			// ignore malformed
		}
	}
	return merged;
}

function validateChildResultAgainstWorkspace(result: ChildResult, workspaceCwd: string): string | undefined {
	for (const relative of result.filesChanged) {
		if (!relative || relative.includes("..")) return `Illegal filesChanged path: ${relative}`;
		const absolute = path.resolve(workspaceCwd, relative);
		if (!absolute.startsWith(path.resolve(workspaceCwd))) return `filesChanged escapes cwd: ${relative}`;
		if (!existsSync(absolute)) return `Declared changed file missing: ${relative}`;
	}
	return undefined;
}

function resolveGovernedChildOutcome(args: {
	isSuccess: boolean;
	gate?: SpawnAgentToolInput["gate"];
	gateOutcome?: GateOutcome;
	stdoutData: string;
	liveFinalText: string;
	effectiveCwd: string;
	agent: string;
	agentId: string;
	parentId: string;
	rootRunId: string;
	depth: number;
	laneId?: string;
	cwd: string;
	workspacePath: string;
	exitCode: number | null;
	provider?: string;
	model?: string;
	baseUrl?: string;
	errorAttribution: { error?: string; hint?: string };
	parts?: any[];
}): ChildAgentResultPayload & { parts?: any[] } {
	const childResult = extractChildResultFromOutput(`${args.liveFinalText}\n${args.stdoutData}`);
	let outcome: ChildAgentResultPayload["outcome"] = args.isSuccess
		? (args.gateOutcome?.outcome ?? (args.gate ? "no_verdict" : undefined))
		: "fail";
	let errorCode: ChildAgentResultPayload["errorCode"];
	let error = args.errorAttribution.error;
	let hint = args.errorAttribution.hint;
	let status: ChildAgentResultPayload["status"] = args.isSuccess ? "success" : "error";

	if (args.isSuccess) {
		if (!childResult) {
			status = "error";
			outcome = "invalid";
			errorCode = "CHILD_RESULT_INVALID";
			error = "CHILD_RESULT_INVALID: governed child exited 0 without a valid ChildResult";
			hint = "Emit one ChildResult JSON line before exit; do not call performance_gate.";
		} else {
			const validationError = validateChildResultAgainstWorkspace(childResult, args.effectiveCwd);
			if (validationError || childResult.status === "invalid") {
				status = "error";
				outcome = "invalid";
				errorCode = "CHILD_RESULT_INVALID";
				error = validationError ?? "ChildResult status=invalid";
			} else if (childResult.status === "failed" || childResult.status === "blocked") {
				status = "error";
				outcome = childResult.status === "blocked" ? "blocked" : "fail";
				error = childResult.summary;
			} else {
				const failClosed = args.gateOutcome?.outcome;
				if (failClosed === "fail" || failClosed === "blocked" || failClosed === "invalid_brief" || failClosed === "invalid") {
					status = "error";
					outcome = failClosed;
					error = `Host fail-closed: completed ChildResult cannot override gate outcome ${failClosed}`;
				} else if (
					childResult.status === "completed" &&
					isMutatingChildRole(args.agent) &&
					args.gate === "G4" &&
					(!childResult.filesChanged || childResult.filesChanged.length === 0)
				) {
					status = "error";
					outcome = "invalid";
					errorCode = "CHILD_RESULT_INVALID";
					error = "CHILD_RESULT_INVALID: mutating implementer completed G4 without any changed files";
					hint = "Implementers must write, edit, and persist changes to disk before reporting completion.";
				} else {
					outcome = "pass";
				}
			}
		}
	}

	const rawOutput = args.liveFinalText || args.stdoutData.trim();
	const cleanOutput = stripChildResultFromOutput(rawOutput);
	const resolvedResult = cleanOutput || childResult?.summary || (status === "success" ? "(No output returned)" : undefined);

	const cleanedParts = args.parts?.map((part) => {
		if (part && part.type === "text" && typeof part.text === "string") {
			const cleaned = stripChildResultFromOutput(part.text);
			return { ...part, text: cleaned || childResult?.summary || part.text };
		}
		return part;
	});

	const hasToolCalls = cleanedParts?.some((p) => p.type === "toolCall");
	let resolvedParts = cleanedParts;
	if (!hasToolCalls && childResult?.commands && childResult.commands.length > 0) {
		const cmdParts = childResult.commands.map((cmd, idx) => ({
			type: "toolCall",
			id: `${args.agentId}-cmd-${idx}`,
			name: "bash",
			arguments: { command: cmd.argv.join(" ") },
			result: {
				content: `exitCode: ${cmd.exitCode ?? 0}`,
				isError: cmd.exitCode !== 0 && cmd.exitCode !== null,
			},
			progress: {
				jobId: `cmd-${idx}`,
				state: cmd.exitCode === 0 || cmd.exitCode === null ? "completed" : "failed",
			},
		}));
		resolvedParts = [...cmdParts, ...(cleanedParts ?? [])];
	}

	const payload: ChildAgentResultPayload & { parts?: any[] } = {
		status,
		agent: args.agent,
		agentId: args.agentId,
		parentId: args.parentId,
		rootRunId: args.rootRunId,
		depth: args.depth,
		provider: args.provider,
		model: args.model,
		baseUrl: args.baseUrl,
		exitCode: args.exitCode,
		worktree: args.workspacePath !== args.cwd ? args.workspacePath : undefined,
		worktreeRetained: status === "success" && args.workspacePath !== args.cwd,
		outcome,
		gate: args.gateOutcome?.gate ?? args.gate,
		itemId: args.gateOutcome?.itemId ?? args.laneId,
		evidence: args.gateOutcome?.evidence,
		parts: resolvedParts,
		result: resolvedResult,
		error,
		hint,
		errorCode,
		childResult,
	};

	try {
		getGlobalTraceCollector(args.rootRunId).recordChildResult({
			agentId: args.agentId,
			role: args.agent,
			cwd: args.effectiveCwd,
			workspacePolicy: args.workspacePath === args.cwd ? "shared" : "isolated",
			exitCode: args.exitCode,
			outcome: payload.outcome,
			childResult,
		});
		extractAndMergeChildTraceSummaries(
			`${args.liveFinalText}\n${args.stdoutData}`,
			getGlobalTraceCollector(args.rootRunId),
		);
	} catch {
		// Trace collection must not break spawn.
	}

	return payload;
}

const HOST_RECORDABLE_GATES = new Set<NonNullable<SpawnAgentToolInput["gate"]>>([
	"G0",
	"G1",
	"G1-review",
	"G1-verify",
	"G2-review",
	"G2-verify",
	"G3.5",
	"G4",
	"G5",
	"G6",
	"G7",
	"sweep",
	"goal-check",
]);

function applyHostChildGateRecord(
	payload: ChildAgentResultPayload & { parts?: any[] },
	recordChildGate: SpawnAgentToolOptions["recordChildGate"],
): ChildAgentResultPayload & { parts?: any[] } {
	if (!recordChildGate || !payload.childResult || !payload.gate || !HOST_RECORDABLE_GATES.has(payload.gate)) {
		return payload;
	}
	if (payload.outcome !== "pass" && payload.outcome !== "fail" && payload.outcome !== "blocked") {
		return payload;
	}
	try {
		const hostGate = recordChildGate({
			agentId: payload.agentId,
			role: payload.agent,
			gate: payload.gate,
			itemId: payload.itemId,
			outcome: payload.outcome,
			childResult: payload.childResult,
		});
		if (!hostGate) return payload;
		return {
			...payload,
			evidence: hostGate.evidence,
			hostGate,
			frontier: hostGate.frontier,
			nextAction: hostGate.nextAction,
			hint: [
				payload.hint,
				`Host recorded ${payload.gate} from ChildResult as ${payload.agentId}.`,
				`frontier: ${hostGate.frontier}.`,
				`Next required action: ${hostGate.nextAction}`,
			]
				.filter(Boolean)
				.join(" "),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			...payload,
			status: "error",
			error: `HOST_GATE_RECORD_FAILED: ${message}`,
			hint: "Child finished, but the host could not record the gate. Fix the frontier/independence issue named above; do not call performance_gate as root for G5/G6, and do not read Metis source.",
		};
	}
}

function attributeChildError(stderr: string, stdout: string, exitCode: number | null): { error: string; hint?: string } {
	const combined = `${stderr}\n${stdout}`.trim();
	if (/no models available|model.*not found/i.test(combined)) {
		return {
			error: `Model Access Error: Requested model could not be resolved or found. ${stderr.trim()}`,
			hint: `Check the model identifier and ensure provider/base-url configuration is valid.`,
		};
	}
	if (/api[ _-]?key|unauthorized|401|403|authentication failed/i.test(combined)) {
		return {
			error: `Authentication / Credential Error: Child process failed to authenticate with the provider. ${stderr.trim()}`,
			hint: `Ensure API key or OAuth credentials are set and forwarded to child agents.`,
		};
	}
	if (/tool.*not (found|allowed|permitted)|permission denied/i.test(combined)) {
		return {
			error: `Tool Permission Error: Child agent attempted to use an unauthorized or unmounted tool. ${stderr.trim()}`,
			hint: `Verify the agent definition's tools allowlist in .metis/agents/*.md.`,
		};
	}
	return {
		error: stderr.trim() || `Agent process exited with code ${exitCode}`,
	};
}

export function createSpawnAgentToolDefinition(
	cwd: string,
	options?: SpawnAgentToolOptions,
): ToolDefinition<typeof spawnAgentSchema, undefined> {
	return {
		name: "spawn_agent",
		label: "spawn_agent",
		description: SPAWN_AGENT_GUIDANCE,
		promptSnippet: "Delegate tasks to named subagents",
		parameters: spawnAgentSchema,
		executionMode: "sequential",
		async execute(toolCallId, rawInput, signal, _onUpdate, _ctx) {
			const invocation = getMetisInvocation();
			const rt = options?.getRuntimeContext?.() ?? options?.runtimeContext;
			const guard = options?.getGuard?.() ?? options?.guard ?? getGlobalSpawnGuard();
			const agent = rawInput.agent;

			const currentDepth = rt?.currentDepth ?? (process.env.METIS_AGENT_DEPTH ? parseInt(process.env.METIS_AGENT_DEPTH, 10) : 0);
			const childDepth = currentDepth + 1;
			const rootRunId = rt?.rootRunId ?? process.env.METIS_ROOT_RUN_ID ?? `run-${randomBytes(4).toString("hex")}`;
			const parentId = rt?.currentAgentId ?? process.env.METIS_AGENT_ID ?? (currentDepth === 0 ? "root" : `agent-${currentDepth}`);
			const childSuffix = randomBytes(3).toString("hex");
			const childAgentId = `${agent}-${childSuffix}`;
			let preparedInput: SpawnAgentToolInput;
			try {
				preparedInput = await options?.prepareDispatch?.(rawInput, rt) ?? rawInput;
			} catch (error) {
				const payload: ChildAgentResultPayload = {
					status: "error", agent, agentId: childAgentId, parentId, rootRunId, depth: childDepth,
					outcome: "invalid_brief",
					error: error instanceof Error ? error.message : String(error),
				};
				return { content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }], details: undefined };
			}
			const { task, context, laneId, gate, mode = "sync", worktree: requestedWorktree, force, rationale, timeoutSeconds } = preparedInput;
			const worktree = resolveChildWorktree({ role: agent, requestedWorktree });
			if (signal?.aborted) {
				const payload: ChildAgentResultPayload = {
					status: "error", agent, agentId: childAgentId, parentId, rootRunId, depth: childDepth,
					error: "Agent execution cancelled before spawn.",
				};
				return { content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }], details: undefined };
			}
			const policyError = options?.validateSpawn?.(preparedInput, rt, childAgentId);
			if (policyError) {
				const payload: ChildAgentResultPayload = {
					status: "error", agent, agentId: childAgentId, parentId, rootRunId, depth: childDepth,
					error: policyError,
				};
				return { content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }], details: undefined };
			}
			const ownedPaths = (preparedInput.ownedPaths && preparedInput.ownedPaths.length > 0)
				? preparedInput.ownedPaths
				: (laneId && options?.getLaneOwnedPaths ? options.getLaneOwnedPaths(laneId) : undefined)
				?? (rt?.ownedPaths && !laneId ? rt.ownedPaths : undefined)
				?? ["."];
			const releaseMutatingOwner = () => {
				options?.releaseMutatingOwner?.(childAgentId);
			};
			const releaseSpawnReservation = async () => {
				releaseMutatingOwner();
				if (!options?.releaseSpawn) return;
				for (let attempt = 0; attempt <= SPAWN_RELEASE_RETRY_DELAYS_MS.length; attempt++) {
					try {
						await options.releaseSpawn(childAgentId);
						return;
					} catch {
						const delayMs = SPAWN_RELEASE_RETRY_DELAYS_MS[attempt];
						if (delayMs === undefined) return;
						await new Promise((resolve) => setTimeout(resolve, delayMs));
					}
				}
			};
			if (isMutatingChildRole(agent)) {
				const ownerError = options?.claimMutatingOwner?.(childAgentId, agent, ownedPaths);
				if (ownerError) {
					await releaseSpawnReservation();
					const payload: ChildAgentResultPayload = {
						status: "error",
						agent,
						agentId: childAgentId,
						parentId,
						rootRunId,
						depth: childDepth,
						error: ownerError,
					};
					return { content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }], details: undefined };
				}
			};

			// 1. Guard check (Feats 12, 13, 14, 15, 16)
			const parentChain = rt?.agentChain ?? (process.env.METIS_AGENT_CHAIN ? process.env.METIS_AGENT_CHAIN.split(",") : ["root"]);
			const check = guard.canSpawn({
				agent,
				task,
				depth: childDepth,
				agentChain: parentChain,
				force,
				rationale,
				parentId,
			});

			if (!check.valid) {
				await releaseSpawnReservation();
				const payload: ChildAgentResultPayload = {
					status: "error",
					errorCode: check.errorCode,
					agent,
					agentId: childAgentId,
					parentId,
					rootRunId,
					depth: childDepth,
					error: check.errorMessage,
					hint: check.hint,
				};
				return {
					content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }],
					details: undefined,
				};
			}

			// 2. Workspace & Worktree Isolation (Feat 25)
			let workspace: IsolatedWorkspace;
			try {
				workspace = await createIsolatedWorkspace({
					cwd,
					worktree,
					agentId: childAgentId,
				});
			} catch (err: any) {
				await releaseSpawnReservation();
				const payload: ChildAgentResultPayload = {
					status: "error",
					agent,
					agentId: childAgentId,
					parentId,
					rootRunId,
					depth: childDepth,
					error: `Failed to create isolated workspace: ${err.message}`,
				};
				return {
					content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }],
					details: undefined,
				};
			}

			const effectiveCwd = workspace.workspacePath;
			if (signal?.aborted) {
				await releaseSpawnReservation();
				await workspace.cleanup().catch(() => {});
				const payload: ChildAgentResultPayload = {
					status: "error", agent, agentId: childAgentId, parentId, rootRunId, depth: childDepth,
					error: "Agent execution cancelled before process launch.",
				};
				return { content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }], details: undefined };
			}

			// Register to guard
			const childChain = [...parentChain, agent];
			const taskHash = computeTaskHash(task);
			guard.registerChild({
				agentId: childAgentId,
				agent,
				task,
				taskHash,
				mode,
				depth: childDepth,
				parentId,
				rootRunId,
				status: "running",
				startTime: Date.now(),
				rationale,
				worktreePath: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
				isGitWorktree: workspace.isGitWorktree,
				branchName: workspace.branchName,
				cleanupWorktree: workspace.cleanup,
			});

			// Prepare CLI arguments
			const args: string[] = [
				...invocation.args,
				"--print",
				"--mode", "json",
				"--approve",
				"--no-session",
				"--collaboration-mode", "build",
				"--agent", agent,
				"--depth", String(childDepth),
				"--parent-id", parentId,
				"--root-run-id", rootRunId,
				"--agent-chain", childChain.join(","),
			];
			args.push("--execution-profile", "reliable-headless");
			const guardConfig = guard.getConfig();
			args.push(
				"--max-spawn-depth", String(guardConfig.maxSpawnDepth),
				"--max-children", String(guardConfig.maxChildrenPerAgent),
				"--max-concurrent", String(guardConfig.maxConcurrentAgents),
			);

			if (context) {
				args.push("--agent-context", context);
			}

			// Forward role-aware model/effort selection before inherited runtime defaults.
			const selectedModel = rt?.getChildModel?.(agent);
			const childProvider = selectedModel?.provider ?? rt?.provider;
			const childModel = selectedModel?.model ?? rt?.model;
			const childBaseUrl = selectedModel?.baseUrl ?? rt?.baseUrl;
			if (childProvider) {
				args.push("--provider", childProvider);
			}
			if (childModel) {
				args.push("--model", childModel);
			}
			if (childBaseUrl || process.env.METIS_BASE_URL || process.env.OPENAI_BASE_URL) {
				args.push("--base-url", childBaseUrl ?? process.env.METIS_BASE_URL ?? process.env.OPENAI_BASE_URL!);
			}
			const childThinking = rt?.getChildThinking?.(agent) ?? rt?.thinking;
			if (childThinking) {
				args.push("--thinking", childThinking);
			}
			if (rt?.apiKey) {
				args.push("--api-key", rt.apiKey);
			}
			if (rt?.skills && rt.skills.length > 0) {
				for (const skill of rt.skills) {
					args.push("--skill", skill);
				}
			}
			if (rt?.extensions && rt.extensions.length > 0) {
				for (const ext of rt.extensions) {
					args.push("--extension", ext);
				}
			}

			// Forward filtered environment variables & attribution headers (Feat 24, 43, 44)
			const childEnv = filterChildEnvironment(process.env, {
				METIS_ROOT_RUN_ID: rootRunId,
				METIS_PARENT_AGENT_ID: parentId,
				METIS_AGENT_ID: childAgentId,
				METIS_AGENT_DEPTH: String(childDepth),
				METIS_AGENT_CHAIN: childChain.join(","),
				METIS_AGENT_NAME: agent,
				METIS_EXECUTION_PROFILE: "reliable-headless",
				METIS_WORKSPACE_POLICY: process.env.METIS_WORKSPACE_POLICY ?? "shared",
				...(laneId ? { METIS_PERFORMANCE_LANE_ID: laneId } : {}),
				...(gate ? { METIS_PERFORMANCE_GATE: gate } : {}),
				ELECTRON_RUN_AS_NODE: "1",
				...(rt?.env ?? {}),
			});

			// Write task to temp file to prevent command line length or shell escaping issues
			const tempFile = path.join(effectiveCwd, `.metis-agent-task-${childSuffix}.txt`);
			await fs.writeFile(tempFile, task, "utf-8");
			args.push(`@${path.basename(tempFile)}`);

			const cleanupResources = async (preserveWorkspace = false) => {
				await releaseSpawnReservation();
				try {
					await fs.unlink(tempFile);
				} catch {
					// Ignore cleanup error
				}
				if (!preserveWorkspace) {
					try {
						await workspace.cleanup();
					} catch {
						// Ignore cleanup error
					}
				}
			};

			if (mode === "sync") {
				return new Promise((resolve) => {
					let stdoutData = "";
					let stderrData = "";
					let lineBuffer = "";
					let timedOut = false;
					let cancelled = false;
					let settled = false;
					let timer: NodeJS.Timeout | undefined;
					let heartbeat: NodeJS.Timeout | undefined;
					let throttledProgressTimer: NodeJS.Timeout | undefined;
					let lastProgressEmitTime = 0;
					let exitFallback: NodeJS.Timeout | undefined;
					const startedAt = Date.now();

					const liveParts: Array<{
						type: string;
						id: string;
						[key: string]: any;
					}> = [];
					let liveFinalText = "";
					let gateOutcome: GateOutcome | undefined;
					const messageOrder: string[] = [];
					const messageParts = new Map<string, Array<{ type: string; id: string; [key: string]: any }>>();
					let currentAssistantMsgId: string | undefined;
					let assistantMessageCounter = 0;

					const syncLiveParts = () => {
						liveParts.length = 0;
						for (const id of messageOrder) {
							const parts = messageParts.get(id);
							if (parts) liveParts.push(...parts);
						}
					};

					const emitProgress = (text: string) => {
						if (!_onUpdate) return;
						_onUpdate({
							content: [{ type: "text", text }],
							details: undefined,
						});
					};

					const processJsonLine = (line: string) => {
						const trimmed = line.trim();
						if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) return;
						try {
							const evt = JSON.parse(trimmed);
							if (!evt || typeof evt !== "object") return;

							if (evt.type === "message_start" || evt.type === "message_update" || evt.type === "message_end") {
								const msg = evt.message;
								if (msg && msg.role === "assistant") {
									let msgId: string;
									if (evt.type === "message_start") {
										msgId = String(msg.id || `${childAgentId}-msg-${assistantMessageCounter++}`);
										currentAssistantMsgId = msgId;
										if (!messageOrder.includes(msgId)) {
											messageOrder.push(msgId);
										}
										messageParts.set(msgId, []);
									} else {
										if (!currentAssistantMsgId) {
											currentAssistantMsgId = String(msg.id || `${childAgentId}-msg-${assistantMessageCounter++}`);
											if (!messageOrder.includes(currentAssistantMsgId)) {
												messageOrder.push(currentAssistantMsgId);
											}
											if (!messageParts.has(currentAssistantMsgId)) {
												messageParts.set(currentAssistantMsgId, []);
											}
										}
										msgId = currentAssistantMsgId;
									}

									const currentParts = messageParts.get(msgId) || [];
									if (Array.isArray(msg.content)) {
										const updatedParts: Array<{ type: string; id: string; [key: string]: any }> = [];
										let textAccumulator = "";
										let partIdx = 0;
										for (const part of msg.content) {
											if (!part || typeof part !== "object") continue;
											const partType = part.type;
											if (partType === "thinking") {
												updatedParts.push({
													type: "thinking",
													id: part.id || `${msgId}-thinking-${partIdx++}`,
													thinking: part.thinking || part.text || "",
													durationMs: part.durationMs,
												});
											} else if (partType === "toolCall" || partType === "tool_use") {
												const toolId = String(part.id || part.toolCallId || `${msgId}-tool-${partIdx++}`);
												const existingTool = currentParts.find((p) => p.type === "toolCall" && p.id === toolId)
													|| liveParts.find((p) => p.type === "toolCall" && p.id === toolId);
												updatedParts.push({
													type: "toolCall",
													id: toolId,
													name: part.name || part.toolName || existingTool?.name || "tool",
													arguments: part.arguments || part.input || existingTool?.arguments || {},
													result: part.result
														? {
																content: typeof part.result === "string" ? part.result : (part.result.content || ""),
																isError: Boolean(part.result.isError),
															}
														: existingTool?.result,
													progress: part.progress || existingTool?.progress || {
														jobId: String(toolId).slice(-6),
														state: (part.result || existingTool?.result)
															? ((part.result?.isError || existingTool?.result?.isError) ? "failed" : "completed")
															: "running",
													},
												});
											} else if (partType === "text") {
												const text = part.text || "";
												updatedParts.push({
													type: "text",
													id: part.id || `${msgId}-text-${partIdx++}`,
													text,
												});
												textAccumulator += (textAccumulator ? "\n" : "") + text;
											}
										}
										messageParts.set(msgId, updatedParts);
										if (textAccumulator) {
											liveFinalText = textAccumulator;
										}
									} else if (typeof msg.content === "string" && msg.content.trim()) {
										messageParts.set(msgId, [{
											type: "text",
											id: `${msgId}-text-0`,
											text: msg.content,
										}]);
										liveFinalText = msg.content;
									}
									if (evt.type === "message_end") {
										currentAssistantMsgId = undefined;
									}
									syncLiveParts();
								}
							} else if (evt.type === "tool_execution_start") {
								const toolId = String(evt.toolCallId || `${childAgentId}-tool-${liveParts.length}`);
								const existing = liveParts.find((p) => p.type === "toolCall" && p.id === toolId);
								if (existing) {
									existing.name = evt.toolName || existing.name;
									existing.arguments = evt.args || existing.arguments;
									existing.progress = { jobId: String(toolId).slice(-6), state: "running" };
								} else {
									const newTool = {
										type: "toolCall",
										id: toolId,
										name: evt.toolName || "tool",
										arguments: evt.args || {},
										progress: { jobId: String(toolId).slice(-6), state: "running" },
									};
									const targetMsgId = currentAssistantMsgId || (messageOrder.length > 0 ? messageOrder[messageOrder.length - 1] : `${childAgentId}-msg-0`);
									if (!messageParts.has(targetMsgId)) {
										messageOrder.push(targetMsgId);
										messageParts.set(targetMsgId, []);
									}
									messageParts.get(targetMsgId)!.push(newTool);
									syncLiveParts();
								}
							} else if (evt.type === "tool_execution_end") {
								if (evt.toolName === "performance_gate") gateOutcome = extractGateOutcome(evt.result, gate) ?? gateOutcome;
								const toolId = String(evt.toolCallId || "");
								const existing = liveParts.find((p) => p.type === "toolCall" && p.id === toolId);
								const resultContent = typeof evt.result === "string" ? evt.result : JSON.stringify(evt.result ?? "");
								if (existing) {
									existing.result = { content: resultContent, isError: Boolean(evt.isError) };
									existing.progress = { jobId: String(toolId).slice(-6), state: evt.isError ? "failed" : "completed" };
								} else if (toolId) {
									const newTool = {
										type: "toolCall",
										id: toolId,
										name: evt.toolName || "tool",
										arguments: {},
										result: { content: resultContent, isError: Boolean(evt.isError) },
										progress: { jobId: String(toolId).slice(-6), state: evt.isError ? "failed" : "completed" },
									};
									const targetMsgId = currentAssistantMsgId || (messageOrder.length > 0 ? messageOrder[messageOrder.length - 1] : `${childAgentId}-msg-0`);
									if (!messageParts.has(targetMsgId)) {
										messageOrder.push(targetMsgId);
										messageParts.set(targetMsgId, []);
									}
									messageParts.get(targetMsgId)!.push(newTool);
									syncLiveParts();
								}
							}
						} catch {
							// Ignore unparseable line
						}
					};

					const emitCurrentProgress = () => {
						const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
						if (liveParts.length > 0) {
							emitProgress(JSON.stringify({
								status: "running",
								agent,
								agentId: childAgentId,
								parentId,
								rootRunId,
								depth: childDepth,
								pid: child.pid,
								elapsedSec,
								parts: liveParts,
								result: liveFinalText || undefined,
								message: `${agent} running (${elapsedSec}s)…`,
							}, null, 2));
							return;
						}
						const preview = stderrData.trim();
						if (preview && !preview.startsWith("{")) {
							emitProgress(preview.slice(-8_000));
							return;
						}
						emitProgress(JSON.stringify({
							status: "running",
							agent,
							agentId: childAgentId,
							parentId,
							rootRunId,
							depth: childDepth,
							pid: child.pid,
							elapsedSec,
							message: `${agent} running (${elapsedSec}s)…`,
						}, null, 2));
					};

					const scheduleProgressEmit = () => {
						const now = Date.now();
						const elapsed = now - lastProgressEmitTime;
						if (elapsed >= SPAWN_PROGRESS_THROTTLE_MS) {
							lastProgressEmitTime = now;
							if (throttledProgressTimer) {
								clearTimeout(throttledProgressTimer);
								throttledProgressTimer = undefined;
							}
							emitCurrentProgress();
						} else if (!throttledProgressTimer) {
							throttledProgressTimer = setTimeout(() => {
								throttledProgressTimer = undefined;
								lastProgressEmitTime = Date.now();
								emitCurrentProgress();
							}, SPAWN_PROGRESS_THROTTLE_MS - elapsed);
						}
					};

					const child = spawn(invocation.command, args, {
						cwd: effectiveCwd,
						env: childEnv as NodeJS.ProcessEnv,
						// Own process group so timeout/abort can kill bash grandchildren.
						detached: process.platform !== "win32",
						stdio: ["ignore", "pipe", "pipe"],
					});

					guard.updateChildStatus(childAgentId, {
						process: child,
						pid: child?.pid,
					});

					emitProgress(JSON.stringify({
						status: "started",
						agent,
						agentId: childAgentId,
						parentId,
						rootRunId,
						depth: childDepth,
						pid: child?.pid,
						message: `Spawned ${agent}; waiting for progress…`,
					}, null, 2));

					heartbeat = setInterval(() => {
						emitCurrentProgress();
					}, SPAWN_PROGRESS_HEARTBEAT_MS);

					const configuredTimeoutMs = guard.getConfig().defaultTimeoutMs;
					const effectiveTimeoutSeconds = timeoutSeconds !== undefined
						? timeoutSeconds
						: (configuredTimeoutMs > 0 ? configuredTimeoutMs / 1000 : 0);
					// Subagents are governed by the parent AbortSignal and global runner timeouts.
					// We do not forcibly kill subagent processes via internal timers to prevent premature termination
					// during deep reasoning or multi-turn tool calling.

					const MAX_SPAWN_BUFFER_CHARS = 2 * 1024 * 1024;
					child.stdout?.on("data", (chunk) => {
						const text = chunk.toString("utf-8");
						stdoutData += text;
						if (stdoutData.length > MAX_SPAWN_BUFFER_CHARS) {
							stdoutData = stdoutData.slice(-Math.floor(MAX_SPAWN_BUFFER_CHARS / 2));
						}
						lineBuffer += text;
						if (lineBuffer.length > MAX_SPAWN_BUFFER_CHARS) {
							lineBuffer = lineBuffer.slice(-Math.floor(MAX_SPAWN_BUFFER_CHARS / 2));
						}

						const lines = lineBuffer.split(/\r?\n/);
						lineBuffer = lines.pop() ?? "";
						for (const line of lines) {
							processJsonLine(line);
						}
						scheduleProgressEmit();
					});

					child.stderr?.on("data", (chunk) => {
						const text = chunk.toString("utf-8");
						stderrData += text;
						if (stderrData.length > MAX_SPAWN_BUFFER_CHARS) {
							stderrData = stderrData.slice(-Math.floor(MAX_SPAWN_BUFFER_CHARS / 2));
						}
						scheduleProgressEmit();
					});

					const finish = async (preserveWorkspace: boolean, handler: () => Promise<void> | void): Promise<void> => {
						if (settled) return;
						settled = true;
						if (timer) clearTimeout(timer);
						if (heartbeat) clearInterval(heartbeat);
						if (throttledProgressTimer) clearTimeout(throttledProgressTimer);
						if (exitFallback) clearTimeout(exitFallback);
						signal?.removeEventListener("abort", cancel);
						await cleanupResources(preserveWorkspace);
						await handler();
					};

					const cancel = () => {
						if (settled || cancelled) return;
						cancelled = true;
						guard.killChild(childAgentId, "SIGTERM");
					};
					signal?.addEventListener("abort", cancel, { once: true });
					if (signal?.aborted) cancel();
					if (timeoutSeconds !== undefined && effectiveTimeoutSeconds > 0) {
						timer = setTimeout(() => {
							if (settled) return;
							timedOut = true;
							guard.killChild(childAgentId, "SIGKILL");
						}, effectiveTimeoutSeconds * 1000);
					}

					child.on("error", async (error) => {
						await finish(false, async () => {
							const payload: ChildAgentResultPayload = {
								status: "error",
								agent,
								agentId: childAgentId,
								parentId,
								rootRunId,
								depth: childDepth,
								worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
								error: `Failed to spawn agent process: ${error.message}`,
							};
							guard.updateChildStatus(childAgentId, {
								status: "error",
								error: payload.error,
							});
							resolve({
								content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }],
								details: undefined,
							});
						});
					});

					const complete = async (exitCode: number | null) => {
						const preserveWorkspace = !cancelled && !timedOut && exitCode === 0 && workspace.workspacePath !== cwd;
						await finish(preserveWorkspace, async () => {
							if (lineBuffer.trim()) {
								processJsonLine(lineBuffer);
							}

							if (cancelled) {
								const payload: ChildAgentResultPayload & { parts?: any[] } = {
									status: "error",
									agent,
									agentId: childAgentId,
									parentId,
									rootRunId,
									depth: childDepth,
									exitCode,
									worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
									worktreeRetained: false,
									parts: liveParts.length > 0 ? liveParts : undefined,
									error: "Agent execution cancelled.",
								};
								guard.updateChildStatus(childAgentId, {
									status: "error",
									exitCode,
									error: payload.error,
								});
								resolve({
									content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }],
									details: undefined,
								});
								return;
							}

							if (timedOut) {
								const payload: ChildAgentResultPayload & { parts?: any[] } = {
									status: "timed_out",
									errorCode: "TIMEOUT",
									agent,
									agentId: childAgentId,
									parentId,
									rootRunId,
									depth: childDepth,
									exitCode,
									worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
									worktreeRetained: false,
									parts: liveParts.length > 0 ? liveParts : undefined,
									error: `Agent execution timed out after ${effectiveTimeoutSeconds}s`,
								};
								guard.updateChildStatus(childAgentId, {
									status: "timed_out",
									exitCode,
									error: payload.error,
								});
								resolve({
									content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }],
									details: undefined,
								});
								return;
							}

							const isSuccess = exitCode === 0;
							const errorAttribution = isSuccess ? { error: undefined, hint: undefined } : attributeChildError(stderrData, stdoutData, exitCode);
							const payload = applyHostChildGateRecord(
								resolveGovernedChildOutcome({
									isSuccess,
									gate,
									gateOutcome,
									stdoutData,
									liveFinalText,
									effectiveCwd,
									agent,
									agentId: childAgentId,
									parentId,
									rootRunId,
									depth: childDepth,
									laneId,
									cwd,
									workspacePath: workspace.workspacePath,
									exitCode,
									provider: rt?.provider ?? process.env.METIS_PROVIDER,
									model: rt?.model ?? process.env.METIS_MODEL,
									baseUrl: rt?.baseUrl ?? process.env.METIS_BASE_URL ?? process.env.OPENAI_BASE_URL,
									errorAttribution,
									parts: liveParts.length > 0 ? liveParts : undefined,
								}),
								options?.recordChildGate,
							);
							guard.updateChildStatus(childAgentId, {
								status: payload.status === "success" ? "completed" : "error",
								exitCode,
								result: payload.result,
								error: payload.error,
							});
							resolve({
								content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }],
								details: undefined,
							});
						});
					};

					child.on("close", (exitCode) => {
						void complete(exitCode);
					});
					child.on("exit", (exitCode) => {
						if (settled || exitFallback) return;
						exitFallback = setTimeout(() => {
							void complete(exitCode);
						}, SPAWN_EXIT_DRAIN_GRACE_MS);
					});
				});
			}

			// Async mode (Feat 17 & 18)
			const outputFile = path.join(effectiveCwd, `.metis-agent-${childSuffix}.log`);
			const outFd = openSync(outputFile, "a");

			const child = spawn(invocation.command, args, {
				cwd: effectiveCwd,
				detached: true,
				stdio: ["ignore", outFd, outFd],
				env: childEnv as NodeJS.ProcessEnv,
			});

			guard.updateChildStatus(childAgentId, {
				process: child,
				pid: child.pid,
			});

			try {
				closeSync(outFd);
			} catch {
				// Ignore
			}

			let settled = false;
			let cancelled = false;
			let exitFallback: NodeJS.Timeout | undefined;
			const settle = (): boolean => {
				if (settled) return false;
				settled = true;
				if (exitFallback) clearTimeout(exitFallback);
				signal?.removeEventListener("abort", cancel);
				options?.onStatusChange?.(childAgentId, false);
				return true;
			};
			const cancel = () => {
				if (settled || cancelled) return;
				cancelled = true;
				guard.killChild(childAgentId, "SIGTERM");
			};

			const complete = async (exitCode: number | null) => {
				if (!settle()) return;
				const isSuccess = !cancelled && exitCode === 0;
				let resultContent = "(No output returned)";
				try {
					const st = await fs.stat(outputFile).catch(() => undefined);
					if (st && st.size > 0) {
						if (st.size > 65536) {
							const fileHandle = await fs.open(outputFile, "r");
							try {
								const readLen = Math.min(st.size, 65536);
								const buf = Buffer.alloc(readLen);
								await fileHandle.read(buf, 0, readLen, st.size - readLen);
								const tailChunk = buf.toString("utf-8");
								resultContent = "...(truncated)...\n" + tailChunk.slice(-8000);
							} finally {
								await fileHandle.close().catch(() => {});
							}
						} else {
							const content = await fs.readFile(outputFile, "utf-8");
							resultContent = content.length > 8000 ? "...(truncated)...\n" + content.slice(-8000) : content;
						}
					}
				} catch {
					// Ignore
				}
				await cleanupResources(isSuccess && workspace.workspacePath !== cwd);

				const errorAttribution = cancelled
					? { error: "Agent execution cancelled.", hint: undefined }
					: isSuccess ? { error: undefined, hint: undefined } : attributeChildError(resultContent, "", exitCode);
				const gateOutcome = extractGateOutcomeFromJsonLines(resultContent, gate);
				const payload = applyHostChildGateRecord(
					resolveGovernedChildOutcome({
						isSuccess: Boolean(isSuccess) && !cancelled,
						gate,
						gateOutcome,
						stdoutData: resultContent,
						liveFinalText: resultContent,
						effectiveCwd,
						agent,
						agentId: childAgentId,
						parentId,
						rootRunId,
						depth: childDepth,
						laneId,
						cwd,
						workspacePath: workspace.workspacePath,
						exitCode,
						provider: rt?.provider ?? process.env.METIS_PROVIDER,
						model: rt?.model ?? process.env.METIS_MODEL,
						baseUrl: rt?.baseUrl ?? process.env.METIS_BASE_URL ?? process.env.OPENAI_BASE_URL,
						errorAttribution,
					}),
					options?.recordChildGate,
				);

				guard.updateChildStatus(childAgentId, {
					status: payload.status === "success" ? "completed" : "error",
					exitCode,
					result: payload.result,
					error: payload.error,
				});

				if (options?.sendMessage) {
					options.sendMessage(childAgentId, JSON.stringify(sanitizeTraceData(payload), null, 2));
				}
			};

			child.on("close", (exitCode) => {
				void complete(exitCode);
			});
			child.on("exit", (exitCode) => {
				if (settled || exitFallback) return;
				exitFallback = setTimeout(() => {
					void complete(exitCode);
				}, SPAWN_EXIT_DRAIN_GRACE_MS);
			});

			child.on("error", async (error) => {
				if (!settle()) return;
				await cleanupResources();
				const payload: ChildAgentResultPayload = {
					status: "error",
					agent,
					agentId: childAgentId,
					parentId,
					rootRunId,
					depth: childDepth,
					worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
					error: `Agent failed to start: ${error.message}`,
				};
				guard.updateChildStatus(childAgentId, {
					status: "error",
					error: payload.error,
				});
				options?.sendMessage?.(childAgentId, JSON.stringify(sanitizeTraceData(payload), null, 2));
			});

			options?.onStatusChange?.(childAgentId, true);
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
			child.unref();

			const initialPayload: ChildAgentResultPayload = {
				status: "started",
				agent,
				agentId: childAgentId,
				parentId,
				rootRunId,
				depth: childDepth,
				gate,
				itemId: laneId,
				worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
				result: `Agent ${agent} (${childAgentId}) launched in background (mode: async). Depth: ${childDepth}.`,
			};

			return {
				content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(initialPayload), null, 2) }],
				details: undefined,
			};
		},
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const agentRole = args.agent ? theme.fg("accent", theme.bold(`[${args.agent}]`)) : "";
			const modeBadge = args.mode === "async" ? theme.fg("warning", " (async)") : "";
			const taskSummary = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 57)}...` : args.task) : "";
			text.setText(
				`${theme.fg("toolTitle", theme.bold("Spawn Agent"))} ${agentRole}${modeBadge}: ${theme.fg("toolOutput", taskSummary)}`
			);
			return text;
		},
		renderResult(result, _options, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			try {
				const firstText = result.content?.find((c) => c.type === "text")?.text;
				if (firstText) {
					const parsed = JSON.parse(firstText) as ChildAgentResultPayload;
					const semanticFailure = parsed.outcome !== undefined && parsed.outcome !== "pass";
					const statusColor = semanticFailure || parsed.status === "error" || parsed.status === "timed_out" ? "error" : parsed.status === "success" ? "success" : "accent";
					const statusLabel = parsed.outcome ? `${parsed.status}/${parsed.outcome}` : parsed.status;
					const statusBadge = theme.fg(statusColor, theme.bold(`[${statusLabel.toUpperCase()}]`));
					const agentInfo = theme.fg("accent", `${parsed.agent} (${parsed.agentId})`);
					const worktreeInfo = parsed.worktree ? theme.fg("muted", ` (worktree: ${path.basename(parsed.worktree)})`) : "";
					let summary = "";
					if (parsed.result && parsed.result !== "(No output returned)") {
						const clean = parsed.result.replace(/\n+/g, " ").trim();
						summary = clean.length > 80 ? `\n  ${theme.fg("muted", clean.slice(0, 77) + "...")}` : `\n  ${theme.fg("muted", clean)}`;
					} else if (parsed.error) {
						summary = `\n  ${theme.fg("error", parsed.error)}`;
					}
					text.setText(`${statusBadge} Agent ${agentInfo}${worktreeInfo}${summary}`);
					return text;
				}
			} catch {
				// Fallback
			}
			text.setText(theme.fg("accent", "Agent finished"));
			return text;
		},
	};
}

export function createSpawnAgentTool(
	cwd: string,
	options?: SpawnAgentToolOptions,
): AgentTool<typeof spawnAgentSchema> {
	return wrapToolDefinition(createSpawnAgentToolDefinition(cwd, options));
}
