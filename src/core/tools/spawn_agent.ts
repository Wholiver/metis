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
}

export interface SpawnAgentToolOptions {
	guard?: SpawnGuard;
	getGuard?: () => SpawnGuard;
	runtimeContext?: SpawnAgentRuntimeContext;
	getRuntimeContext?: () => SpawnAgentRuntimeContext;
	/** Optional runtime policy layered before generic depth/concurrency guard checks. */
	validateSpawn?: (input: SpawnAgentToolInput, runtime: SpawnAgentRuntimeContext | undefined, childAgentId: string) => string | undefined;
	/** Releases a successful policy reservation after a child exits or launch fails. */
	releaseSpawn?: (childAgentId: string) => void | Promise<void>;
	sendMessage?: (agentId: string, result: string) => void;
	onStatusChange?: (agentId: string, running: boolean) => void;
}

export const SPAWN_AGENT_GUIDANCE = [
	"Delegate a specific task to a specialized named agent (e.g. planner, implementer, reviewer, verifier, or coordinator).",
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
	errorCode?: SpawnErrorCode;
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
		async execute(toolCallId, { agent, task, context, mode = "sync", worktree, force, rationale, timeoutSeconds }, signal, _onUpdate, _ctx) {
			const invocation = getMetisInvocation();
			const rt = options?.getRuntimeContext?.() ?? options?.runtimeContext;
			const guard = options?.getGuard?.() ?? options?.guard ?? getGlobalSpawnGuard();

			const currentDepth = rt?.currentDepth ?? (process.env.METIS_AGENT_DEPTH ? parseInt(process.env.METIS_AGENT_DEPTH, 10) : 0);
			const childDepth = currentDepth + 1;
			const rootRunId = rt?.rootRunId ?? process.env.METIS_ROOT_RUN_ID ?? `run-${randomBytes(4).toString("hex")}`;
			const parentId = rt?.currentAgentId ?? process.env.METIS_AGENT_ID ?? (currentDepth === 0 ? "root" : `agent-${currentDepth}`);
			const childSuffix = randomBytes(3).toString("hex");
			const childAgentId = `${agent}-${childSuffix}`;
			if (signal?.aborted) {
				const payload: ChildAgentResultPayload = {
					status: "error", agent, agentId: childAgentId, parentId, rootRunId, depth: childDepth,
					error: "Agent execution cancelled before spawn.",
				};
				return { content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }], details: undefined };
			}
			const policyError = options?.validateSpawn?.({ agent, task, context, mode, worktree, force, rationale, timeoutSeconds }, rt, childAgentId);
			if (policyError) {
				const payload: ChildAgentResultPayload = {
					status: "error", agent, agentId: childAgentId, parentId, rootRunId, depth: childDepth,
					error: policyError,
				};
				return { content: [{ type: "text", text: JSON.stringify(sanitizeTraceData(payload), null, 2) }], details: undefined };
			}
			const releaseSpawnReservation = async () => {
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
									if (Array.isArray(msg.content)) {
										liveParts.length = 0;
										let textAccumulator = "";
										let partIdx = 0;
										for (const part of msg.content) {
											if (!part || typeof part !== "object") continue;
											const partType = part.type;
											if (partType === "thinking") {
												liveParts.push({
													type: "thinking",
													id: part.id || `${childAgentId}-thinking-${partIdx++}`,
													thinking: part.thinking || part.text || "",
													durationMs: part.durationMs,
												});
											} else if (partType === "toolCall" || partType === "tool_use") {
												const toolId = part.id || part.toolCallId || `${childAgentId}-tool-${partIdx++}`;
												liveParts.push({
													type: "toolCall",
													id: toolId,
													name: part.name || part.toolName || "tool",
													arguments: part.arguments || part.input || {},
													result: part.result
														? {
																content: typeof part.result === "string" ? part.result : (part.result.content || ""),
																isError: Boolean(part.result.isError),
															}
														: undefined,
													progress: part.progress || {
														jobId: String(toolId).slice(-6),
														state: part.result ? (part.result.isError ? "failed" : "completed") : "running",
													},
												});
											} else if (partType === "text") {
												const text = part.text || "";
												liveParts.push({
													type: "text",
													id: part.id || `${childAgentId}-text-${partIdx++}`,
													text,
												});
												textAccumulator += (textAccumulator ? "\n" : "") + text;
											}
										}
										if (textAccumulator) {
											liveFinalText = textAccumulator;
										}
									} else if (typeof msg.content === "string" && msg.content.trim()) {
										liveFinalText = msg.content;
									}
								}
							} else if (evt.type === "tool_execution_start") {
								const toolId = evt.toolCallId || `${childAgentId}-tool-${liveParts.length}`;
								const existing = liveParts.find((p) => p.type === "toolCall" && p.id === toolId);
								if (existing) {
									existing.name = evt.toolName || existing.name;
									existing.arguments = evt.args || existing.arguments;
									existing.progress = { jobId: String(toolId).slice(-6), state: "running" };
								} else {
									liveParts.push({
										type: "toolCall",
										id: toolId,
										name: evt.toolName || "tool",
										arguments: evt.args || {},
										progress: { jobId: String(toolId).slice(-6), state: "running" },
									});
								}
							} else if (evt.type === "tool_execution_end") {
								const toolId = evt.toolCallId;
								const existing = liveParts.find((p) => p.type === "toolCall" && p.id === toolId);
								const resultContent = typeof evt.result === "string" ? evt.result : JSON.stringify(evt.result ?? "");
								if (existing) {
									existing.result = { content: resultContent, isError: Boolean(evt.isError) };
									existing.progress = { jobId: String(toolId).slice(-6), state: evt.isError ? "failed" : "completed" };
								} else if (toolId) {
									liveParts.push({
										type: "toolCall",
										id: toolId,
										name: evt.toolName || "tool",
										arguments: {},
										result: { content: resultContent, isError: Boolean(evt.isError) },
										progress: { jobId: String(toolId).slice(-6), state: evt.isError ? "failed" : "completed" },
									});
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
						pid: child.pid,
					});

					emitProgress(JSON.stringify({
						status: "started",
						agent,
						agentId: childAgentId,
						parentId,
						rootRunId,
						depth: childDepth,
						pid: child.pid,
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

					child.stdout?.on("data", (chunk) => {
						const text = chunk.toString("utf-8");
						stdoutData += text;
						lineBuffer += text;

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
							const payload: ChildAgentResultPayload & { parts?: any[] } = {
								status: isSuccess ? "success" : "error",
								agent,
								agentId: childAgentId,
								parentId,
								rootRunId,
								depth: childDepth,
								provider: rt?.provider ?? process.env.METIS_PROVIDER,
								model: rt?.model ?? process.env.METIS_MODEL,
								baseUrl: rt?.baseUrl ?? process.env.METIS_BASE_URL ?? process.env.OPENAI_BASE_URL,
									exitCode,
									worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
									worktreeRetained: isSuccess && workspace.workspacePath !== cwd,
									parts: liveParts.length > 0 ? liveParts : undefined,
								result: liveFinalText || (stdoutData || stderrData).trim() || (isSuccess ? "(No output returned)" : undefined),
								error: errorAttribution.error,
								hint: errorAttribution.hint,
							};
							guard.updateChildStatus(childAgentId, {
								status: isSuccess ? "completed" : "error",
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
					const content = await fs.readFile(outputFile, "utf-8");
					resultContent = content.length > 8000 ? "...(truncated)...\n" + content.slice(-8000) : content;
				} catch {
					// Ignore
				}
				await cleanupResources(isSuccess && workspace.workspacePath !== cwd);

				const errorAttribution = cancelled
					? { error: "Agent execution cancelled.", hint: undefined }
					: isSuccess ? { error: undefined, hint: undefined } : attributeChildError(resultContent, "", exitCode);
				const payload: ChildAgentResultPayload = {
					status: isSuccess ? "success" : "error",
					agent,
					agentId: childAgentId,
					parentId,
					rootRunId,
					depth: childDepth,
					provider: rt?.provider ?? process.env.METIS_PROVIDER,
					model: rt?.model ?? process.env.METIS_MODEL,
					baseUrl: rt?.baseUrl ?? process.env.METIS_BASE_URL ?? process.env.OPENAI_BASE_URL,
					exitCode,
					worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
					worktreeRetained: isSuccess && workspace.workspacePath !== cwd,
					result: resultContent.trim() || "(No output returned)",
					error: errorAttribution.error,
					hint: errorAttribution.hint,
				};

				guard.updateChildStatus(childAgentId, {
					status: isSuccess ? "completed" : "error",
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
					const statusColor = parsed.status === "success" ? "success" : parsed.status === "error" ? "error" : "accent";
					const statusBadge = theme.fg(statusColor, theme.bold(`[${parsed.status.toUpperCase()}]`));
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

