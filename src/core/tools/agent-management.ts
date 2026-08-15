import type { AgentTool } from "@earendil-works/metis-agent-core";
import { Text } from "@earendil-works/metis-tui";
import { Type, type Static } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { getGlobalSpawnGuard, type SpawnGuard } from "../spawn-guard.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

// =============================================================================
// list_agents tool (Feat 21)
// =============================================================================

export const listAgentsSchema = Type.Object({
	status: Type.Optional(
		Type.Union(
			[
				Type.Literal("all"),
				Type.Literal("running"),
				Type.Literal("completed"),
				Type.Literal("error"),
				Type.Literal("killed"),
				Type.Literal("timed_out"),
			],
			{
				description: "Filter subagents by lifecycle status (default: 'all')",
			},
		),
	),
});

export type ListAgentsToolInput = Static<typeof listAgentsSchema>;

export interface AgentManagementToolOptions {
	guard?: SpawnGuard;
	getGuard?: () => SpawnGuard;
	sendMessage?: (agentId: string, message: string) => void;
}

export function createListAgentsToolDefinition(
	options?: AgentManagementToolOptions,
): ToolDefinition<typeof listAgentsSchema, undefined> {
	return {
		name: "list_agents",
		label: "list_agents",
		description: "List tracked subagents, their running status, elapsed time, and completion results.",
		promptSnippet: "Inspect running and completed subagents",
		parameters: listAgentsSchema,
		executionMode: "sequential",
		async execute(_toolCallId, { status = "all" }) {
			const guard = options?.getGuard?.() ?? options?.guard ?? getGlobalSpawnGuard();
			const children = guard.listChildren({ status });

			const list = children.map((c) => ({
				agentId: c.agentId,
				agent: c.agent,
				mode: c.mode,
				status: c.status,
				depth: c.depth,
				parentId: c.parentId,
				startTime: new Date(c.startTime).toISOString(),
				durationMs: c.durationMs ?? (c.status === "running" ? Date.now() - c.startTime : undefined),
				exitCode: c.exitCode,
				result: c.result ? (c.result.length > 300 ? c.result.slice(0, 300) + "..." : c.result) : undefined,
				error: c.error,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify({ agents: list, total: list.length }, null, 2) }],
				details: undefined,
			};
		},
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(`List Subagents (status: ${args.status ?? "all"})`)));
			return text;
		},
		renderResult(result, _options, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			try {
				const firstText = result.content?.find((c) => c.type === "text")?.text;
				const parsed = JSON.parse(firstText ?? "{}");
				const total = parsed.total ?? 0;
				const header = theme.fg("success", theme.bold(`Found ${total} subagent(s)`));
				if (Array.isArray(parsed.agents) && parsed.agents.length > 0) {
					const lines = parsed.agents.map((a: any) => {
						const color = a.status === "completed" ? "success" : a.status === "running" ? "warning" : a.status === "error" ? "error" : "muted";
						const status = theme.fg(color, `[${a.status}]`);
						return `  • ${theme.fg("accent", a.agent)} (${a.agentId}) ${status}`;
					});
					text.setText(`${header}\n${lines.join("\n")}`);
					return text;
				}
				text.setText(header);
				return text;
			} catch {
				text.setText(theme.fg("accent", "Subagent list retrieved"));
				return text;
			}
		},
	};
}

export function createListAgentsTool(options?: AgentManagementToolOptions): AgentTool<typeof listAgentsSchema> {
	return wrapToolDefinition(createListAgentsToolDefinition(options));
}

// =============================================================================
// wait_agent tool (Feat 21)
// =============================================================================

export const waitAgentSchema = Type.Object({
	agentId: Type.Optional(
		Type.String({
			description: "Target agentId to wait for. If omitted or 'all', waits for all running background subagents.",
		}),
	),
	timeoutSeconds: Type.Optional(
		Type.Number({
			description: "Maximum timeout in seconds to wait before returning current statuses (default: 300s).",
		}),
	),
});

export type WaitAgentToolInput = Static<typeof waitAgentSchema>;

export function createWaitAgentToolDefinition(
	options?: AgentManagementToolOptions,
): ToolDefinition<typeof waitAgentSchema, undefined> {
	return {
		name: "wait_agent",
		label: "wait_agent",
		description: "Wait for one or more background subagents to finish execution and retrieve their results.",
		promptSnippet: "Wait for background subagents to complete",
		parameters: waitAgentSchema,
		executionMode: "sequential",
		async execute(_toolCallId, { agentId, timeoutSeconds = 300 }) {
			const guard = options?.getGuard?.() ?? options?.guard ?? getGlobalSpawnGuard();
			const timeoutMs = timeoutSeconds * 1000;

			if (agentId && agentId !== "all") {
				const child = await guard.waitForChild(agentId, timeoutMs);
				if (!child) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										status: "error",
										error: `Agent with ID '${agentId}' not found`,
									},
									null,
									2,
								),
							},
						],
						details: undefined,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									status: child.status === "completed" ? "success" : child.status,
									agent: child.agent,
									agentId: child.agentId,
									exitCode: child.exitCode,
									result: child.result,
									error: child.error,
									durationMs: child.durationMs,
								},
								null,
								2,
							),
						},
					],
					details: undefined,
				};
			}

			// Wait for all running children
			const results = await guard.waitForAllChildren(timeoutMs);
			const formatted = results.map((c) => ({
				agentId: c.agentId,
				agent: c.agent,
				status: c.status,
				exitCode: c.exitCode,
				result: c.result ? (c.result.length > 500 ? c.result.slice(0, 500) + "..." : c.result) : undefined,
				error: c.error,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify({ agents: formatted }, null, 2) }],
				details: undefined,
			};
		},
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const target = args.agentId ?? "all";
			text.setText(theme.fg("toolTitle", theme.bold(`Wait Subagent (${target}, timeout: ${args.timeoutSeconds ?? 300}s)`)));
			return text;
		},
		renderResult(result, _options, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			try {
				const firstText = result.content?.find((c) => c.type === "text")?.text;
				if (firstText) {
					const parsed = JSON.parse(firstText);
					if (parsed.status === "error") {
						text.setText(theme.fg("error", `Wait failed: ${parsed.error}`));
						return text;
					}
					if (parsed.agent && parsed.agentId) {
						const color = parsed.status === "success" || parsed.status === "completed" ? "success" : "accent";
						text.setText(theme.fg(color, `Subagent ${parsed.agent} (${parsed.agentId}) completed`));
						return text;
					}
				}
			} catch {}
			text.setText(theme.fg("success", "Subagent wait completed"));
			return text;
		},
	};
}

export function createWaitAgentTool(options?: AgentManagementToolOptions): AgentTool<typeof waitAgentSchema> {
	return wrapToolDefinition(createWaitAgentToolDefinition(options));
}

// =============================================================================
// kill_agent tool (Feat 21, 22)
// =============================================================================

export const killAgentSchema = Type.Object({
	agentId: Type.String({
		description: "Target agentId to terminate, or 'all' to terminate all running subagents.",
	}),
	signal: Type.Optional(
		Type.Union([Type.Literal("SIGTERM"), Type.Literal("SIGKILL")], {
			description: "Signal to send (default: SIGTERM)",
		}),
	),
});

export type KillAgentToolInput = Static<typeof killAgentSchema>;

export function createKillAgentToolDefinition(
	options?: AgentManagementToolOptions,
): ToolDefinition<typeof killAgentSchema, undefined> {
	return {
		name: "kill_agent",
		label: "kill_agent",
		description: "Terminate a running background subagent process and clean up its resources.",
		promptSnippet: "Terminate running subagents",
		parameters: killAgentSchema,
		executionMode: "sequential",
		async execute(_toolCallId, { agentId, signal = "SIGTERM" }) {
			const guard = options?.getGuard?.() ?? options?.guard ?? getGlobalSpawnGuard();

			if (agentId === "all") {
				const killedCount = guard.killAllChildren(signal as NodeJS.Signals);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ status: "success", killedCount, message: `Terminated ${killedCount} running subagent(s)` }, null, 2),
						},
					],
					details: undefined,
				};
			}

			const success = guard.killChild(agentId, signal as NodeJS.Signals);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								status: success ? "success" : "not_found",
								agentId,
								message: success ? `Agent ${agentId} terminated with ${signal}` : `Agent ${agentId} was not running or not found`,
							},
							null,
							2,
						),
					},
				],
				details: undefined,
			};
		},
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(`Kill Subagent (${args.agentId}, signal: ${args.signal ?? "SIGTERM"})`)));
			return text;
		},
		renderResult(result, _options, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			try {
				const firstText = result.content?.find((c) => c.type === "text")?.text;
				if (firstText) {
					const parsed = JSON.parse(firstText);
					if (parsed.status === "success") {
						text.setText(theme.fg("warning", `Subagent terminated: ${parsed.message}`));
						return text;
					}
					if (parsed.status === "not_found") {
						text.setText(theme.fg("muted", parsed.message));
						return text;
					}
				}
			} catch {}
			text.setText(theme.fg("accent", "Subagent kill command executed"));
			return text;
		},
	};
}

export function createKillAgentTool(options?: AgentManagementToolOptions): AgentTool<typeof killAgentSchema> {
	return wrapToolDefinition(createKillAgentToolDefinition(options));
}

// =============================================================================
// message_agent tool (Feat 21)
// =============================================================================

export const messageAgentSchema = Type.Object({
	agentId: Type.String({
		description: "Target agentId to inspect or send instructions to",
	}),
	message: Type.String({
		description: "Instruction, feedback, or inquiry to send to the subagent",
	}),
});

export type MessageAgentToolInput = Static<typeof messageAgentSchema>;

export function createMessageAgentToolDefinition(
	options?: AgentManagementToolOptions,
): ToolDefinition<typeof messageAgentSchema, undefined> {
	return {
		name: "message_agent",
		label: "message_agent",
		description: "Send instructions, steering feedback, or query messages to a background subagent.",
		promptSnippet: "Communicate with a subagent",
		parameters: messageAgentSchema,
		executionMode: "sequential",
		async execute(_toolCallId, { agentId, message }) {
			const guard = options?.getGuard?.() ?? options?.guard ?? getGlobalSpawnGuard();
			const child = guard.getChild(agentId);

			if (!child) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ status: "error", error: `Subagent '${agentId}' not found.` }, null, 2),
						},
					],
					details: undefined,
				};
			}

			if (options?.sendMessage) {
				options.sendMessage(agentId, message);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								status: "delivered",
								agentId,
								agent: child.agent,
								childStatus: child.status,
								message: `Message dispatched to agent ${agentId} (${child.status})`,
							},
							null,
							2,
						),
					},
				],
				details: undefined,
			};
		},
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(`Message Subagent (${args.agentId}): ${args.message}`)));
			return text;
		},
		renderResult(result, _options, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			try {
				const firstText = result.content?.find((c) => c.type === "text")?.text;
				if (firstText) {
					const parsed = JSON.parse(firstText);
					if (parsed.status === "delivered") {
						text.setText(theme.fg("success", `Message delivered to ${parsed.agentId} (${parsed.agent})`));
						return text;
					}
					if (parsed.status === "error") {
						text.setText(theme.fg("error", parsed.error));
						return text;
					}
				}
			} catch {}
			text.setText(theme.fg("success", "Message delivered"));
			return text;
		},
	};
}

export function createMessageAgentTool(options?: AgentManagementToolOptions): AgentTool<typeof messageAgentSchema> {
	return wrapToolDefinition(createMessageAgentToolDefinition(options));
}
