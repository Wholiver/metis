/**
 * Built-in routine_* tools for Metis Desktop Routines & Scheduled tasks.
 * Registered only when a RoutineHostClient is available (Desktop METIS_ROUTINE_HOST).
 */

import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { RoutineHostClient, RoutineHostCommand, RoutineHostResult, RoutineItemData } from "../routine-host.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export interface RoutineToolOptions {
	host: RoutineHostClient;
	defaultProjectPath?: string;
}

const ROUTINE_GUIDELINE =
	"Use routine_* tools to view, create, pause, resume, update, delete, or manually trigger recurring routines/schedules in Metis Desktop. Routines run on cron expressions (standard 5-field syntax: minute hour day-of-month month day-of-week). When triggered, a routine automatically creates a new session in Metis and executes the specified prompt.";

const listSchema = Type.Object({});

const createSchema = Type.Object({
	title: Type.String({ description: "Human-readable name for the routine, e.g. 'Morning code briefing'" }),
	cron: Type.String({
		description:
			"Standard 5-field cron expression: minute hour day-of-month month day-of-week (e.g. '0 9 * * *' for daily 9am, '0 18 * * 1-5' for weekdays 6pm, '*/30 * * * *' for every 30m)",
	}),
	prompt: Type.String({ description: "The prompt instruction for the agent to execute when triggered" }),
	projectPath: Type.Optional(Type.String({ description: "Optional workspace root directory to run the task in" })),
	status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused")], { description: "Initial status (default 'active')" })),
	source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("self_learning")], { description: "Creation source (default 'manual')" })),
});

const updateSchema = Type.Object({
	id: Type.String({ description: "Unique ID of the routine to update" }),
	title: Type.Optional(Type.String({ description: "New title for the routine" })),
	cron: Type.Optional(Type.String({ description: "New 5-field cron expression" })),
	prompt: Type.Optional(Type.String({ description: "New prompt instruction" })),
	projectPath: Type.Optional(Type.String({ description: "New workspace project path" })),
	status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused")], { description: "New status: 'active' or 'paused'" })),
	source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("self_learning")], { description: "Source: 'manual' or 'self_learning'" })),
});

const deleteSchema = Type.Object({
	id: Type.String({ description: "Unique ID of the routine to delete" }),
});

const runNowSchema = Type.Object({
	id: Type.String({ description: "Unique ID of the routine to trigger immediately" }),
});

export type RoutineListInput = Static<typeof listSchema>;
export type RoutineCreateInput = Static<typeof createSchema>;
export type RoutineUpdateInput = Static<typeof updateSchema>;
export type RoutineDeleteInput = Static<typeof deleteSchema>;
export type RoutineRunNowInput = Static<typeof runNowSchema>;

export const ROUTINE_TOOL_NAMES = [
	"routine_list",
	"routine_create",
	"routine_update",
	"routine_delete",
	"routine_run_now",
];

function formatRoutine(r: RoutineItemData): string {
	const parts = [
		`- [${r.status.toUpperCase()}] ${r.title} (id: ${r.id})`,
		`  Cron: ${r.cron}`,
		`  Prompt: "${r.prompt.replace(/\n/g, " ").slice(0, 80)}"`,
	];
	if (r.projectPath) parts.push(`  Project: ${r.projectPath}`);
	if (r.nextRunAt) parts.push(`  Next run: ${r.nextRunAt}`);
	if (r.lastRunAt) parts.push(`  Last run: ${r.lastRunAt} (${r.lastStatus || "unknown"}${r.lastSessionId ? `, session: ${r.lastSessionId}` : ""})`);
	return parts.join("\n");
}

function formatResult(result: RoutineHostResult): {
	content: Array<{ type: "text"; text: string }>;
	details: RoutineHostResult;
} {
	if (!result.ok) {
		return {
			content: [{ type: "text", text: result.error || "Routine command failed" }],
			details: result,
		};
	}

	if (result.routines) {
		if (result.routines.length === 0) {
			return {
				content: [{ type: "text", text: "No scheduled routines found." }],
				details: result,
			};
		}
		const text = ["Scheduled routines:", ...result.routines.map(formatRoutine)].join("\n\n");
		return {
			content: [{ type: "text", text }],
			details: result,
		};
	}

	if (result.routine) {
		const text = `Routine successfully updated/saved:\n${formatRoutine(result.routine)}`;
		return {
			content: [{ type: "text", text }],
			details: result,
		};
	}

	if (result.sessionId) {
		return {
			content: [{ type: "text", text: `Routine triggered successfully. Created session ID: ${result.sessionId}` }],
			details: result,
		};
	}

	return {
		content: [{ type: "text", text: "ok" }],
		details: result,
	};
}

async function run(host: RoutineHostClient, command: RoutineHostCommand, signal?: AbortSignal) {
	const res = await host.execute(command, signal);
	return formatResult(res);
}

export function createRoutineToolDefinitions(options: RoutineToolOptions): ToolDefinition[] {
	const host = options.host;
	const defaultProjectPath = options.defaultProjectPath;
	return [
		{
			name: "routine_list",
			label: "List scheduled routines",
			description:
				"List all scheduled recurring routines/tasks in Metis Desktop, including active and paused routines, their cron schedules, prompts, and run history.",
			promptSnippet: "List scheduled routines in Metis Desktop",
			promptGuidelines: [ROUTINE_GUIDELINE],
			capabilities: { effect: "read", parallelSafe: true },
			parameters: listSchema,
			execute: async (_id, _input: RoutineListInput, signal) =>
				run(host, { action: "list" }, signal),
		},
		{
			name: "routine_create",
			label: "Create scheduled routine",
			description:
				"Create a new recurring routine (scheduled task) in Metis Desktop with a title, standard 5-field cron expression (e.g. '0 9 * * *' for daily 9am, '0 18 * * 1-5' for weekdays 6pm), and prompt instruction.",
			promptSnippet: "Create a scheduled routine in Metis Desktop",
			promptGuidelines: [ROUTINE_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: createSchema,
			execute: async (_id, input: RoutineCreateInput, signal) =>
				run(
					host,
					{
						action: "create",
						payload: {
							title: input.title,
							cron: input.cron,
							prompt: input.prompt,
							projectPath: input.projectPath || defaultProjectPath,
							status: input.status,
						},
					},
					signal,
				),
		},
		{
			name: "routine_update",
			label: "Update scheduled routine",
			description:
				"Update an existing routine's title, cron expression, prompt, status ('active' | 'paused'), or projectPath.",
			promptSnippet: "Update a scheduled routine in Metis Desktop",
			promptGuidelines: [ROUTINE_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: updateSchema,
			execute: async (_id, input: RoutineUpdateInput, signal) =>
				run(
					host,
					{
						action: "update",
						id: input.id,
						patch: {
							title: input.title,
							cron: input.cron,
							prompt: input.prompt,
							projectPath: input.projectPath,
							status: input.status,
						},
					},
					signal,
				),
		},
		{
			name: "routine_delete",
			label: "Delete scheduled routine",
			description: "Delete a scheduled routine in Metis Desktop by its ID.",
			promptSnippet: "Delete a scheduled routine in Metis Desktop",
			promptGuidelines: [ROUTINE_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: deleteSchema,
			execute: async (_id, input: RoutineDeleteInput, signal) =>
				run(host, { action: "delete", id: input.id }, signal),
		},
		{
			name: "routine_run_now",
			label: "Run routine now",
			description: "Trigger immediate execution of an existing routine by ID without waiting for its scheduled cron time.",
			promptSnippet: "Run scheduled routine now",
			promptGuidelines: [ROUTINE_GUIDELINE],
			capabilities: { effect: "write", parallelSafe: false },
			parameters: runNowSchema,
			execute: async (_id, input: RoutineRunNowInput, signal) =>
				run(host, { action: "run_now", id: input.id }, signal),
		},
	];
}

export function createRoutineTools(options: RoutineToolOptions) {
	return createRoutineToolDefinitions(options).map((definition) => wrapToolDefinition(definition));
}
