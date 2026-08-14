import { createHash, randomUUID } from "node:crypto";
import type { AgentMessage, AgentTool, ThinkingLevel } from "@earendil-works/metis-agent-core";
import type { Model } from "@earendil-works/metis-ai";
import type { ToolCapabilities, ToolDefinition } from "./extensions/types.ts";
import type { InstructionStack } from "./system-prompt.ts";
import { compileInstructionStack, instructionStackHash } from "./system-prompt.ts";

export type CollaborationMode = "build" | "plan";

export type WorkflowPlanStatus = "pending" | "in_progress" | "completed";
export type WorkflowPlanPhase = "reading_proposal" | "creating_checklist" | "active";

/** Portable plan state: safe to persist in a session and expose to clients. */
export interface WorkflowPlanStep {
	step: string;
	status: WorkflowPlanStatus;
}

export interface WorkflowPlanState {
	explanation?: string;
	plan: WorkflowPlanStep[];
	updatedAt: string;
	/** Stable identity for the current Build task. Prevents a prior task plan from becoming current. */
	taskId?: string;
	/** Proposal revision being executed, when this task started from Process. */
	proposalRevision?: number;
	/** Preparation state shown while Process is establishing the executable checklist. */
	phase?: WorkflowPlanPhase;
	/** Compatibility body written by the pre-structured update_plan tool. */
	legacyMarkdown?: string;
}

/** Full conversational Plan artifact. Unlike workflowPlan this is never a task checklist. */
export interface WorkflowProposalState {
	markdown: string;
	revision: number;
	updatedAt: string;
	sourceMessageId?: string;
}

/** Resolve the latest persisted Build execution checklist on a branch. */
export function resolveWorkflowPlan(entries: readonly {
	type: string;
	customType?: string;
	data?: unknown;
	timestamp?: string;
}[]): WorkflowPlanState | undefined {
	for (const entry of [...entries].reverse()) {
		if (entry.type === "custom" && entry.customType === "workflow_plan_reset") return undefined;
		if (entry.type !== "custom" || entry.customType !== "workflow_plan" || !entry.data || typeof entry.data !== "object") continue;
		const data = entry.data as { plan?: unknown; explanation?: unknown; updatedAt?: unknown; legacyMarkdown?: unknown; taskId?: unknown; proposalRevision?: unknown; phase?: unknown };
		const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : entry.timestamp ?? new Date().toISOString();
		if (typeof data.plan === "string") return { plan: [], updatedAt, legacyMarkdown: data.plan, taskId: typeof data.taskId === "string" ? data.taskId : undefined };
		if (!Array.isArray(data.plan)) continue;
		const plan = data.plan.filter(
			(item): item is WorkflowPlanStep =>
				Boolean(item)
				&& typeof item === "object"
				&& typeof (item as { step?: unknown }).step === "string"
				&& ["pending", "in_progress", "completed"].includes((item as { status?: unknown }).status as string),
		);
		return {
			explanation: typeof data.explanation === "string" ? data.explanation : undefined,
			plan,
			updatedAt,
			taskId: typeof data.taskId === "string" ? data.taskId : undefined,
			proposalRevision: typeof data.proposalRevision === "number" ? data.proposalRevision : undefined,
			phase: ["reading_proposal", "creating_checklist", "active"].includes(data.phase as string)
				? data.phase as WorkflowPlanPhase
				: undefined,
			legacyMarkdown: typeof data.legacyMarkdown === "string" ? data.legacyMarkdown : undefined,
		};
	}
	return undefined;
}

export function extractProposedPlan(markdown: string): string | undefined {
	if ((markdown.match(/<proposed_plan>/g) ?? []).length !== 1 || (markdown.match(/<\/proposed_plan>/g) ?? []).length !== 1) return undefined;
	const matches = [...markdown.matchAll(/<proposed_plan>\s*\n?([\s\S]*?)\n?\s*<\/proposed_plan>/g)];
	if (matches.length !== 1) return undefined;
	const proposal = matches[0]?.[1]?.trim();
	return proposal || undefined;
}

/** Read latest artifact from a branch without making it part of LLM context. */
export function getLatestWorkflowProposal(entries: readonly { type: string; customType?: string; data?: unknown; timestamp?: string }[]): WorkflowProposalState | undefined {
	for (const entry of [...entries].reverse()) {
		if (entry.type !== "custom" || entry.customType !== "workflow_proposal" || !entry.data || typeof entry.data !== "object") continue;
		const data = entry.data as Partial<WorkflowProposalState>;
		if (typeof data.markdown === "string" && typeof data.revision === "number") return { markdown: data.markdown, revision: data.revision, updatedAt: data.updatedAt ?? entry.timestamp ?? new Date().toISOString(), sourceMessageId: data.sourceMessageId };
	}
	return undefined;
}

/** Resolve the authoritative proposal, with read-only recovery for pre-artifact sessions. */
export function resolveWorkflowProposal(entries: readonly {
	type: string;
	id?: string;
	timestamp?: string;
	customType?: string;
	data?: unknown;
	message?: { role?: string; content?: unknown };
}[]): WorkflowProposalState | undefined {
	const persisted = getLatestWorkflowProposal(entries);
	if (persisted) return persisted;
	for (const entry of [...entries].reverse()) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		const content = entry.message.content;
		const text = Array.isArray(content)
			? content.filter((part): part is { type: "text"; text: string } => Boolean(part) && typeof part === "object" && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n")
			: typeof content === "string" ? content : "";
		const markdown = extractProposedPlan(text);
		if (markdown) return { markdown, revision: 1, updatedAt: entry.timestamp ?? new Date().toISOString(), sourceMessageId: entry.id };
	}
	return undefined;
}

export interface StepSnapshot {
	id: string;
	turnId: number;
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel;
	collaborationMode: CollaborationMode;
	instructions: InstructionStack;
	messages: readonly AgentMessage[];
	tools: readonly AgentTool[];
	dispatcher: WorkflowToolDispatcher;
	toolNames: readonly string[];
	contextWindowId: string;
	semanticHash: string;
	createdAt: number;
}

export type WorkflowToolErrorKind = "aborted" | "recoverable" | "terminal";

/** Error returned by the local tool dispatcher. Terminal failures stop the current tool batch. */
export class WorkflowToolError extends Error {
	readonly kind: WorkflowToolErrorKind;
	readonly cause?: unknown;

	constructor(kind: WorkflowToolErrorKind, message: string, cause?: unknown) {
		super(message);
		this.name = "WorkflowToolError";
		this.kind = kind;
		this.cause = cause;
	}
}

export interface ToolDispatchContext {
	callId: string;
	snapshot: StepSnapshot;
	name: string;
	capabilities: ToolCapabilities;
	parentSignal?: AbortSignal;
}

type DispatchWaiter = {
	shared: boolean;
	resolve: (release: () => void) => void;
	reject: (reason: Error) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
};

/**
 * Reader/writer scheduler owned by Metis, rather than by the vendored agent
 * loop. Read-only safe tools share a lock; every write/mixed/unknown tool
 * holds an exclusive lock. This keeps a mixed batch deterministic even when a
 * provider emits all calls in parallel.
 */
export class WorkflowToolDispatcher {
	private activeReaders = 0;
	private writerActive = false;
	private readonly queue: DispatchWaiter[] = [];
	private readonly activeCalls = new Map<string, AbortController>();

	private isShared(capabilities: ToolCapabilities): boolean {
		return capabilities.effect === "read" && capabilities.parallelSafe === true;
	}

	private drain(): void {
		if (this.writerActive) return;
		const first = this.queue[0];
		if (!first) return;
		if (!first.shared && this.activeReaders > 0) return;

		if (!first.shared) {
			this.queue.shift();
			this.writerActive = true;
			first.onAbort && first.signal?.removeEventListener("abort", first.onAbort);
			first.resolve(() => {
				this.writerActive = false;
				this.drain();
			});
			return;
		}

		while (this.queue[0]?.shared && !this.writerActive) {
			const waiter = this.queue.shift()!;
			this.activeReaders += 1;
			waiter.onAbort && waiter.signal?.removeEventListener("abort", waiter.onAbort);
			waiter.resolve(() => {
				this.activeReaders -= 1;
				this.drain();
			});
		}
	}

	private acquire(shared: boolean, signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) return Promise.reject(new WorkflowToolError("aborted", "Tool execution aborted"));
		return new Promise((resolve, reject) => {
			const waiter: DispatchWaiter = { shared, resolve, reject, signal };
			if (signal) {
				waiter.onAbort = () => {
					const index = this.queue.indexOf(waiter);
					if (index >= 0) this.queue.splice(index, 1);
					reject(new WorkflowToolError("aborted", "Tool execution aborted"));
					this.drain();
				};
				signal.addEventListener("abort", waiter.onAbort, { once: true });
			}
			this.queue.push(waiter);
			this.drain();
		});
	}

	async dispatch<T>(context: ToolDispatchContext, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		const abort = () => controller.abort();
		context.parentSignal?.addEventListener("abort", abort, { once: true });
		this.activeCalls.set(context.callId, controller);
		let release: (() => void) | undefined;
		try {
			release = await this.acquire(this.isShared(context.capabilities), controller.signal);
			if (controller.signal.aborted) throw new WorkflowToolError("aborted", "Tool execution aborted");
			return await execute(controller.signal);
		} catch (error) {
			if (error instanceof WorkflowToolError) throw error;
			if (controller.signal.aborted) throw new WorkflowToolError("aborted", "Tool execution aborted", error);
			const terminal = typeof error === "object" && error !== null && (error as { terminate?: unknown }).terminate === true;
			throw new WorkflowToolError(terminal ? "terminal" : "recoverable", error instanceof Error ? error.message : String(error), error);
		} finally {
			release?.();
			this.activeCalls.delete(context.callId);
			context.parentSignal?.removeEventListener("abort", abort);
		}
	}

	abort(callId: string): void {
		this.activeCalls.get(callId)?.abort();
	}

	abortAll(): void {
		for (const controller of this.activeCalls.values()) controller.abort();
	}
}

export interface WorkflowCheckpoint {
	workflowSchemaVersion: 2;
	reason: "prompt_accepted" | "step_completed" | "compaction" | "aborted" | "error" | "completed";
	stepId?: string;
	contextWindowId: string;
	semanticHash: string;
	collaborationMode: CollaborationMode;
	timestamp: string;
}

const BUILTIN_CAPABILITIES: Record<string, ToolCapabilities> = {
	read: { effect: "read", parallelSafe: true },
	grep: { effect: "read", parallelSafe: true },
	find: { effect: "read", parallelSafe: true },
	ls: { effect: "read", parallelSafe: true },
	websearch: { effect: "read", parallelSafe: true },
	webfetch: { effect: "read", parallelSafe: true },
	video: { effect: "read", parallelSafe: false },
	edit: { effect: "write", parallelSafe: false },
	write: { effect: "write", parallelSafe: false },
	log: { effect: "write", parallelSafe: false },
	remember_user_intent: { effect: "write", parallelSafe: false },
	user_intent: { effect: "read", parallelSafe: false },
	ask_user: { effect: "read", parallelSafe: false },
	read_plan: { effect: "read", parallelSafe: true },
	bash: { effect: "mixed", parallelSafe: false },
	subagent: { effect: "mixed", parallelSafe: false },
	// update_plan mutates session workflow state. It is available during Build,
	// but deliberately hidden from conversational Plan mode.
	update_plan: { effect: "write", parallelSafe: false },
};

export function getToolCapabilities(definition: ToolDefinition | undefined, name: string): ToolCapabilities {
	return definition?.capabilities ?? BUILTIN_CAPABILITIES[name] ?? { effect: "mixed", parallelSafe: false };
}

/**
 * Local control plane around the vendor loop. It freezes each sampling input
 * and supplies deterministic policy checks without modifying vendored code.
 */
export class WorkflowRuntime {
	private currentSnapshot: StepSnapshot | undefined;
	private contextWindowId = randomUUID();
	private lastSemanticHash: string | undefined;
	private readonly dispatcher = new WorkflowToolDispatcher();
	private readonly toolCallSnapshots = new Map<string, StepSnapshot>();
	private proposalExecution: {
		taskId: string;
		phase: WorkflowPlanPhase;
		reminders: number;
		onPhaseChange?: (phase: WorkflowPlanPhase) => void;
	} | undefined;

	get snapshot(): StepSnapshot | undefined {
		return this.currentSnapshot;
	}

	get currentContextWindowId(): string {
		return this.contextWindowId;
	}

	get proposalExecutionState(): Readonly<{ taskId: string; phase: WorkflowPlanPhase }> | undefined {
		return this.proposalExecution
			? { taskId: this.proposalExecution.taskId, phase: this.proposalExecution.phase }
			: undefined;
	}

	beginProposalExecution(taskId: string, onPhaseChange?: (phase: WorkflowPlanPhase) => void): void {
		this.proposalExecution = { taskId, phase: "reading_proposal", reminders: 0, onPhaseChange };
		onPhaseChange?.("reading_proposal");
	}

	endProposalExecution(): void {
		this.proposalExecution = undefined;
	}

	/** Model-only recovery instruction when a Process run ends before its required setup tools. */
	takeProposalExecutionReminder(): string | undefined {
		const execution = this.proposalExecution;
		if (!execution || execution.phase === "active" || execution.reminders >= 2) return undefined;
		execution.reminders += 1;
		return execution.phase === "reading_proposal"
			? "Process is not ready. Call read_plan now. Do not finish or call another tool first."
			: "Process is not ready. Call update_plan now with a concise implementation and verification checklist. Do not finish or call another tool first.";
	}

	private assertProposalExecutionOrder(name: string): void {
		const execution = this.proposalExecution;
		if (!execution || execution.phase === "active") return;
		if (execution.phase === "reading_proposal" && name !== "read_plan") {
			throw new WorkflowToolError("recoverable", "Process requires read_plan before any other tool. Call read_plan, then retry.");
		}
		if (execution.phase === "creating_checklist" && name !== "read_plan" && name !== "update_plan") {
			throw new WorkflowToolError("recoverable", "Process requires update_plan before implementation tools. Create the checklist, then retry.");
		}
	}

	private recordProposalExecutionTool(name: string): void {
		const execution = this.proposalExecution;
		if (!execution) return;
		if (execution.phase === "reading_proposal" && name === "read_plan") {
			execution.phase = "creating_checklist";
			execution.onPhaseChange?.(execution.phase);
		} else if (execution.phase === "creating_checklist" && name === "update_plan") {
			execution.phase = "active";
			execution.onPhaseChange?.(execution.phase);
		}
	}

	beginNewContextWindow(): string {
		this.contextWindowId = randomUUID();
		return this.contextWindowId;
	}

	private freezeValue<T>(value: T): T {
		if (value === null || typeof value !== "object") return value;
		if (Array.isArray(value)) return Object.freeze(value.map((entry) => this.freezeValue(entry))) as T;
		const clone: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			clone[key] = this.freezeValue(entry);
		}
		return Object.freeze(clone) as T;
	}

	freeze(input: Omit<StepSnapshot, "id" | "contextWindowId" | "semanticHash" | "createdAt" | "toolNames" | "dispatcher">): StepSnapshot {
		const instructionHash = instructionStackHash(input.instructions);
		const semanticHash = createHash("sha256")
			.update(
				JSON.stringify({
					instructionHash,
					model: input.model ? `${input.model.provider}/${input.model.id}` : undefined,
					thinkingLevel: input.thinkingLevel,
					mode: input.collaborationMode,
					messages: input.messages,
					tools: input.tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters,
						executionMode: tool.executionMode,
					})),
				}),
			)
			.digest("hex")
			.slice(0, 16);
		if (this.lastSemanticHash && this.lastSemanticHash !== semanticHash) {
			this.beginNewContextWindow();
		}
		this.lastSemanticHash = semanticHash;
		this.currentSnapshot = Object.freeze({
			...this.freezeValue(input),
			dispatcher: this.dispatcher,
			id: randomUUID(),
			contextWindowId: this.contextWindowId,
			semanticHash,
			toolNames: Object.freeze(input.tools.map((tool) => tool.name)),
			messages: this.freezeValue([...input.messages]),
			tools: this.freezeValue([...input.tools]),
			createdAt: Date.now(),
		});
		return this.currentSnapshot;
	}

	bindToolCall(callId: string, snapshot = this.currentSnapshot): StepSnapshot | undefined {
		if (snapshot) this.toolCallSnapshots.set(callId, snapshot);
		return snapshot;
	}

	getToolCallSnapshot(callId: string): StepSnapshot | undefined {
		return this.toolCallSnapshots.get(callId);
	}

	releaseToolCall(callId: string): void {
		this.toolCallSnapshots.delete(callId);
	}

	async dispatchTool<T>(
		callId: string,
		name: string,
		definition: ToolDefinition | undefined,
		parentSignal: AbortSignal | undefined,
		execute: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const snapshot = this.toolCallSnapshots.get(callId) ?? this.currentSnapshot;
		if (!snapshot) throw new WorkflowToolError("terminal", "No workflow snapshot is available for this tool call.");
		if (!snapshot.toolNames.includes(name)) {
			throw new WorkflowToolError("terminal", `Tool ${name} was not advertised for workflow step ${snapshot.id}.`);
		}
		if (!this.canDispatchTool(name, definition, snapshot.collaborationMode)) {
			throw new WorkflowToolError("terminal", `Tool ${name} is unavailable in Plan mode because it may modify state.`);
		}
		return snapshot.dispatcher.dispatch(
			{ callId, snapshot, name, capabilities: getToolCapabilities(definition, name), parentSignal },
			async (signal) => {
				// Check after the dispatcher lock is acquired. This preserves provider
				// batches such as read_plan -> update_plan -> bash while still making
				// their execution order authoritative.
				this.assertProposalExecutionOrder(name);
				const result = await execute(signal);
				this.recordProposalExecutionTool(name);
				return result;
			},
		);
	}

	abortToolCall(callId: string): void {
		this.dispatcher.abort(callId);
	}

	abortAllToolCalls(): void {
		this.dispatcher.abortAll();
	}

	compilePrivilegedInstructions(snapshot = this.currentSnapshot): string | undefined {
		return snapshot ? compileInstructionStack(snapshot.instructions) : undefined;
	}

	canDispatchTool(name: string, definition: ToolDefinition | undefined, mode: CollaborationMode): boolean {
		if (mode === "build") return true;
		if (name === "update_plan") return false;
		return getToolCapabilities(definition, name).effect === "read";
	}

	checkpoint(reason: WorkflowCheckpoint["reason"], mode: CollaborationMode): WorkflowCheckpoint {
		return {
			workflowSchemaVersion: 2,
			reason,
			stepId: this.currentSnapshot?.id,
			contextWindowId: this.currentSnapshot?.contextWindowId ?? this.contextWindowId,
			semanticHash: this.currentSnapshot?.semanticHash ?? this.lastSemanticHash ?? "initial",
			collaborationMode: mode,
			timestamp: new Date().toISOString(),
		};
	}
}
