import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { killProcessTree } from "../utils/shell.ts";

/** Default recursion and concurrency limit configurations */
export const DEFAULT_MAX_SPAWN_DEPTH = 5;
export const DEFAULT_MAX_CHILDREN_PER_AGENT = 8;
export const DEFAULT_MAX_TOTAL_CHILDREN = 32;
export const DEFAULT_MAX_CONCURRENT_AGENTS = 4;
export const DEFAULT_AGENT_TIMEOUT_MS = 0; // 0 = unlimited by default

export type SpawnErrorCode =
	| "DEPTH_LIMIT_EXCEEDED"
	| "MAX_CHILDREN_EXCEEDED"
	| "CONCURRENCY_LIMIT_EXCEEDED"
	| "LOOP_DETECTED"
	| "DUPLICATE_TASK_WARNING"
	| "TIMEOUT";

export type ChildAgentStatus = "running" | "completed" | "error" | "killed" | "timed_out";

export interface SpawnGuardConfig {
	maxSpawnDepth: number;
	maxChildrenPerAgent: number;
	maxTotalChildren: number;
	maxConcurrentAgents: number;
	defaultTimeoutMs: number;
}

export interface SpawnValidationResult {
	valid: boolean;
	errorCode?: SpawnErrorCode;
	errorMessage?: string;
	hint?: string;
	requiresRationale?: boolean;
}

export interface ChildAgentState {
	agentId: string;
	agent: string;
	task: string;
	taskHash: string;
	mode: "sync" | "async";
	depth: number;
	parentId: string;
	rootRunId: string;
	status: ChildAgentStatus;
	startTime: number;
	endTime?: number;
	durationMs?: number;
	exitCode?: number | null;
	result?: string;
	error?: string;
	pid?: number;
	process?: ChildProcess;
	abortController?: AbortController;
	timer?: NodeJS.Timeout;
	rationale?: string;
	worktreePath?: string;
	isGitWorktree?: boolean;
	branchName?: string;
	cleanupWorktree?: () => Promise<void>;
}

export interface CanSpawnOptions {
	agent: string;
	task: string;
	depth: number;
	agentChain?: string[];
	force?: boolean;
	rationale?: string;
	parentId?: string;
}

/** Compute a normalized hash for task deduplication */
export function computeTaskHash(task: string): string {
	const normalized = task.trim().toLowerCase().replace(/\s+/g, " ");
	return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * SpawnGuard manages limits, dead-loop protection, active child tracking, and lifecycle management (Bundle 3)
 */
export class SpawnGuard {
	private static activeGuards = new Set<SpawnGuard>();
	private static exitHookInstalled = false;

	private config: SpawnGuardConfig;
	private children = new Map<string, ChildAgentState>();
	private taskHistory: Array<{ agent: string; taskHash: string; task: string; agentId: string }> = [];
	private waitListeners = new Map<string, Array<(state: ChildAgentState) => void>>();

	constructor(config?: Partial<SpawnGuardConfig>) {
		this.config = {
			maxSpawnDepth: config?.maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH,
			maxChildrenPerAgent: config?.maxChildrenPerAgent ?? DEFAULT_MAX_CHILDREN_PER_AGENT,
			maxTotalChildren: config?.maxTotalChildren ?? DEFAULT_MAX_TOTAL_CHILDREN,
			maxConcurrentAgents: config?.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT_AGENTS,
			defaultTimeoutMs: config?.defaultTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
		};

		SpawnGuard.activeGuards.add(this);
		SpawnGuard.installExitHook();
	}

	/** Get current configuration */
	getConfig(): Readonly<SpawnGuardConfig> {
		return { ...this.config };
	}

	/** Update configuration dynamically */
	updateConfig(update: Partial<SpawnGuardConfig>): void {
		this.config = {
			...this.config,
			...update,
		};
	}

	/**
	 * Validate whether spawning this agent is permitted
	 */
	canSpawn(options: CanSpawnOptions): SpawnValidationResult {
		const { agent, task, depth, force, rationale } = options;

		// 1. Depth check (Feat 12)
		if (depth > this.config.maxSpawnDepth) {
			return {
				valid: false,
				errorCode: "DEPTH_LIMIT_EXCEEDED",
				errorMessage: `Maximum spawn depth (${this.config.maxSpawnDepth}) exceeded. Requested depth: ${depth}.`,
				hint: "The task must be completed directly at this recursion level without delegating further.",
			};
		}

		// 2. Total and per-session child limits (Feat 13)
		if (this.children.size >= this.config.maxTotalChildren) {
			return {
				valid: false,
				errorCode: "MAX_CHILDREN_EXCEEDED",
				errorMessage: `Global spawned child limit (${this.config.maxTotalChildren}) exceeded.`,
				hint: "Wait for existing child agents to finish or kill idle agents before spawning more.",
			};
		}

		const localChildCount = Array.from(this.children.values()).filter(
			(c) => !options.parentId || c.parentId === options.parentId,
		).length;
		if (localChildCount >= this.config.maxChildrenPerAgent) {
			return {
				valid: false,
				errorCode: "MAX_CHILDREN_EXCEEDED",
				errorMessage: `Maximum children per agent (${this.config.maxChildrenPerAgent}) reached.`,
				hint: "A single agent cannot spawn more children. Synthesize previous results or terminate finished tasks.",
			};
		}

		// 3. Concurrency limit (Feat 14)
		const runningCount = Array.from(this.children.values()).filter((c) => c.status === "running").length;
		if (runningCount >= this.config.maxConcurrentAgents) {
			return {
				valid: false,
				errorCode: "CONCURRENCY_LIMIT_EXCEEDED",
				errorMessage: `Maximum concurrent running agents (${this.config.maxConcurrentAgents}) reached (currently running: ${runningCount}).`,
				hint: "Use wait_agent to wait for background agents to complete before launching new ones.",
			};
		}

		// 4. Duplicate task check & rationale bypass (Feat 15)
		const taskHash = computeTaskHash(task);
		const existingSameTask = this.taskHistory.find(
			(h) => h.agent.toLowerCase() === agent.toLowerCase() && h.taskHash === taskHash,
		);

		if (existingSameTask) {
			const hasValidRationale = typeof rationale === "string" && rationale.trim().length > 0;
			if (!force && !hasValidRationale) {
				return {
					valid: false,
					errorCode: "DUPLICATE_TASK_WARNING",
					errorMessage: `Duplicate task detected for agent '${agent}' (previously run as ${existingSameTask.agentId}).`,
					hint: "To prevent dead loops or wasted executions, please provide 'rationale' explaining why repeating this task is necessary, or specify 'force: true' to deliberately re-run.",
					requiresRationale: true,
				};
			}
		}

		return { valid: true };
	}

	/** Register a newly spawned child agent */
	registerChild(state: ChildAgentState): void {
		this.children.set(state.agentId, state);
		this.taskHistory.push({
			agent: state.agent,
			taskHash: state.taskHash,
			task: state.task,
			agentId: state.agentId,
		});
	}

	/** Update child state */
	updateChildStatus(agentId: string, update: Partial<ChildAgentState>): void {
		const existing = this.children.get(agentId);
		if (!existing) return;

		const updated = {
			...existing,
			...update,
		};

		if (update.status && update.status !== "running" && !updated.endTime) {
			updated.endTime = Date.now();
			updated.durationMs = updated.endTime - updated.startTime;
		}

		this.children.set(agentId, updated);

		// Notify waiting callers
		if (updated.status !== "running") {
			const listeners = this.waitListeners.get(agentId);
			if (listeners && listeners.length > 0) {
				for (const listener of listeners) {
					try {
						listener(updated);
					} catch {
						// Ignore listener errors
					}
				}
				this.waitListeners.delete(agentId);
			}
		}
	}

	/** Get child by ID */
	getChild(agentId: string): ChildAgentState | undefined {
		return this.children.get(agentId);
	}

	/** List all tracked child agents */
	listChildren(filter?: { status?: string }): ChildAgentState[] {
		const all = Array.from(this.children.values());
		if (!filter?.status || filter.status === "all") {
			return all;
		}
		return all.filter((c) => c.status === filter.status);
	}

	/** Kill a specific child process and mark state as killed (Feat 21, 22) */
	killChild(agentId: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
		const child = this.children.get(agentId);
		if (!child) return false;

		if (child.timer) {
			clearTimeout(child.timer);
			child.timer = undefined;
		}

		if (child.abortController) {
			child.abortController.abort();
		}

		let killed = false;
		if (child.process && child.status === "running") {
			try {
				if (child.pid) {
					try {
						killProcessTree(child.pid);
						killed = true;
					} catch {
						// Fall through to handle kill below.
					}
				}
				// Always signal the ChildProcess handle too. Mocks and some platforms settle
				// waiters via process.kill(); process-group kill alone is not enough.
				child.process.kill(signal);
				killed = true;
			} catch {
				// Process might already be dead
			}
		}

		if (child.cleanupWorktree) {
			try {
				child.cleanupWorktree().catch(() => {});
			} catch {
				// Ignore
			}
		}

		this.updateChildStatus(agentId, {
			status: "killed",
			error: `Terminated by killChild (${signal})`,
		});

		return killed;
	}

	/** Kill all running children (Feat 22, 23) */
	killAllChildren(signal: NodeJS.Signals = "SIGTERM"): number {
		let count = 0;
		for (const [agentId, child] of this.children.entries()) {
			if (child.status === "running") {
				if (this.killChild(agentId, signal)) {
					count++;
				}
			}
		}
		return count;
	}

	/** Wait for a specific child agent to complete */
	waitForChild(agentId: string, timeoutMs?: number): Promise<ChildAgentState | undefined> {
		const child = this.children.get(agentId);
		if (!child) return Promise.resolve(undefined);
		if (child.status !== "running") return Promise.resolve(child);

		return new Promise((resolve) => {
			let timer: NodeJS.Timeout | undefined;

			const onDone = (state: ChildAgentState) => {
				if (timer) clearTimeout(timer);
				resolve(state);
			};

			const listeners = this.waitListeners.get(agentId) ?? [];
			listeners.push(onDone);
			this.waitListeners.set(agentId, listeners);

			if (typeof timeoutMs === "number" && timeoutMs > 0) {
				timer = setTimeout(() => {
					const currentListeners = this.waitListeners.get(agentId) ?? [];
					this.waitListeners.set(
						agentId,
						currentListeners.filter((l) => l !== onDone),
					);
					resolve(this.children.get(agentId));
				}, timeoutMs);
			}
		});
	}

	/** Wait for all running children to complete */
	async waitForAllChildren(timeoutMs?: number): Promise<ChildAgentState[]> {
		const running = Array.from(this.children.values()).filter((c) => c.status === "running");
		if (running.length === 0) {
			return Array.from(this.children.values());
		}

		const waitPromises = running.map((c) => this.waitForChild(c.agentId, timeoutMs));
		await Promise.all(waitPromises);
		return Array.from(this.children.values());
	}

	/** Clean up all resources and prevent orphans (Feat 23) */
	private static installExitHook(): void {
		if (SpawnGuard.exitHookInstalled) return;
		SpawnGuard.exitHookInstalled = true;

		const cleanup = () => {
			for (const guard of SpawnGuard.activeGuards) {
				for (const child of guard.children.values()) {
					if (child.status === "running") {
						try {
							if (child.pid) {
								process.kill(-child.pid, "SIGKILL");
							} else if (child.process) {
								child.process.kill("SIGKILL");
							}
						} catch {
							// Ignore
						}
					}
					if (child.cleanupWorktree) {
						try {
							child.cleanupWorktree().catch(() => {});
						} catch {
							// Ignore
						}
					}
				}
			}
		};

		process.once("exit", cleanup);
		process.once("SIGINT", cleanup);
		process.once("SIGTERM", cleanup);
	}
}

let globalSpawnGuard: SpawnGuard | undefined;

/** Get or create global singleton SpawnGuard */
export function getGlobalSpawnGuard(): SpawnGuard {
	if (!globalSpawnGuard) {
		globalSpawnGuard = new SpawnGuard();
	}
	return globalSpawnGuard;
}

/** Set or replace global singleton SpawnGuard (useful for tests) */
export function setGlobalSpawnGuard(guard?: SpawnGuard): void {
	globalSpawnGuard = guard;
}

