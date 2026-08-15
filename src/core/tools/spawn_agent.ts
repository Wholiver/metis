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
			description: "Optional isolated worktree or directory path to run the agent within ('auto', 'temp', 'branch:<name>', or relative/absolute path)",
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
	currentDepth?: number;
	provider?: string;
	model?: string;
	baseUrl?: string;
	thinking?: ThinkingLevel;
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
	sendMessage?: (agentId: string, result: string) => void;
	onStatusChange?: (agentId: string, running: boolean) => void;
}

export const SPAWN_AGENT_GUIDANCE = [
	"Delegate a specific task to a specialized named agent (e.g. planner, implementer, reviewer, verifier, or coordinator).",
	"By default, execution is synchronous ('sync') and blocks until the agent completes, returning structured results directly.",
	"For parallel background execution across multiple agents, set mode to 'async'.",
].join(" ");

function getMetisInvocation(): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	const isElectron = Boolean(process.versions.electron || process.env.ELECTRON_RUN_AS_NODE);

	if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
		const nodeCmd = isElectron ? "node" : process.execPath;
		return { command: nodeCmd, args: [currentScript] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime && !isElectron) {
		return { command: process.execPath, args: [] };
	}

	return { command: "metis", args: [] };
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
		async execute(toolCallId, { agent, task, context, mode = "sync", worktree, force, rationale, timeoutSeconds }, _signal, _onUpdate, _ctx) {
			const invocation = getMetisInvocation();
			const rt = options?.getRuntimeContext?.() ?? options?.runtimeContext;
			const guard = options?.getGuard?.() ?? options?.guard ?? getGlobalSpawnGuard();

			const currentDepth = rt?.currentDepth ?? (process.env.METIS_AGENT_DEPTH ? parseInt(process.env.METIS_AGENT_DEPTH, 10) : 0);
			const childDepth = currentDepth + 1;
			const rootRunId = rt?.rootRunId ?? process.env.METIS_ROOT_RUN_ID ?? `run-${randomBytes(4).toString("hex")}`;
			const parentId = rt?.currentAgentId ?? process.env.METIS_AGENT_ID ?? (currentDepth === 0 ? "root" : `agent-${currentDepth}`);
			const childSuffix = randomBytes(3).toString("hex");
			const childAgentId = `${agent}-${childSuffix}`;

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
				"--approve",
				"--agent", agent,
				"--depth", String(childDepth),
				"--parent-id", parentId,
				"--root-run-id", rootRunId,
				"--agent-chain", childChain.join(","),
			];

			if (context) {
				args.push("--agent-context", context);
			}

			// Forward runtime provider / model / thinking / keys / skills / extensions (Feat 8, 9, 10, 39, 43)
			if (rt?.provider) {
				args.push("--provider", rt.provider);
			}
			if (rt?.model) {
				args.push("--model", rt.model);
			}
			if (rt?.baseUrl || process.env.METIS_BASE_URL || process.env.OPENAI_BASE_URL) {
				args.push("--base-url", rt?.baseUrl ?? process.env.METIS_BASE_URL ?? process.env.OPENAI_BASE_URL!);
			}
			if (rt?.thinking) {
				args.push("--thinking", rt.thinking);
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
				ELECTRON_RUN_AS_NODE: "1",
				...(rt?.env ?? {}),
			});

			// Write task to temp file to prevent command line length or shell escaping issues
			const tempFile = path.join(effectiveCwd, `.metis-agent-task-${childSuffix}.txt`);
			await fs.writeFile(tempFile, task, "utf-8");
			args.push(`@${path.basename(tempFile)}`);

			const cleanupResources = async () => {
				try {
					await fs.unlink(tempFile);
				} catch {
					// Ignore cleanup error
				}
				try {
					await workspace.cleanup();
				} catch {
					// Ignore cleanup error
				}
			};

			if (mode === "sync") {
				return new Promise((resolve) => {
					let stdoutData = "";
					let stderrData = "";
					let timedOut = false;
					let timer: NodeJS.Timeout | undefined;

					const child = spawn(invocation.command, args, {
						cwd: effectiveCwd,
						env: childEnv as NodeJS.ProcessEnv,
						stdio: ["ignore", "pipe", "pipe"],
					});

					guard.updateChildStatus(childAgentId, {
						process: child,
						pid: child.pid,
					});

					const effectiveTimeoutSeconds = timeoutSeconds ?? (guard.getConfig().defaultTimeoutMs / 1000);
					if (effectiveTimeoutSeconds > 0) {
						timer = setTimeout(() => {
							timedOut = true;
							guard.killChild(childAgentId, "SIGTERM");
						}, effectiveTimeoutSeconds * 1000);
					}

					child.stdout?.on("data", (chunk) => {
						stdoutData += chunk.toString("utf-8");
					});

					child.stderr?.on("data", (chunk) => {
						stderrData += chunk.toString("utf-8");
					});

					child.on("error", async (error) => {
						if (timer) clearTimeout(timer);
						await cleanupResources();
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

					child.on("close", async (exitCode) => {
						if (timer) clearTimeout(timer);
						await cleanupResources();

						if (timedOut) {
							const payload: ChildAgentResultPayload = {
								status: "timed_out",
								errorCode: "TIMEOUT",
								agent,
								agentId: childAgentId,
								parentId,
								rootRunId,
								depth: childDepth,
								exitCode,
								worktree: workspace.workspacePath !== cwd ? workspace.workspacePath : undefined,
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
							result: stdoutData.trim() || undefined,
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
			const settle = (): boolean => {
				if (settled) return false;
				settled = true;
				options?.onStatusChange?.(childAgentId, false);
				return true;
			};

			child.on("close", async (exitCode) => {
				if (!settle()) return;
				await cleanupResources();

				const isSuccess = exitCode === 0;
				let resultContent = "(No output returned)";
				try {
					const content = await fs.readFile(outputFile, "utf-8");
					resultContent = content.length > 8000 ? "...(truncated)...\n" + content.slice(-8000) : content;
				} catch {
					// Ignore
				}

				const errorAttribution = isSuccess ? { error: undefined, hint: undefined } : attributeChildError(resultContent, "", exitCode);
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
