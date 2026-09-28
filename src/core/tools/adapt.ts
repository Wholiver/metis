import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import {
	listAdaptations,
	rollbackAdaptation,
	writeAdaptation,
} from "../adaptations/store.ts";
import type { AdaptationKind, AdaptationScope } from "../adaptations/types.ts";
import { getAgentDir } from "../../config.ts";

export const adaptSchema = Type.Object({
	action: Type.Union(
		[Type.Literal("apply"), Type.Literal("rollback"), Type.Literal("list")],
		{
			description:
				"Action to perform: 'apply' to write/update an adaptation, 'rollback' to restore a previous revision, or 'list' to inspect active adaptations.",
		},
	),
	scope: Type.Optional(
		Type.Union([Type.Literal("user"), Type.Literal("project")], {
			description:
				"Scope of the adaptation: 'user' (~/.metis/agent/adaptations/) or 'project' (current project). Defaults to 'project'.",
		}),
	),
	kind: Type.Optional(
		Type.Union(
			[
				Type.Literal("profile"),
				Type.Literal("skill"),
				Type.Literal("role"),
				Type.Literal("tool"),
				Type.Literal("hook"),
				Type.Literal("architecture"),
				Type.Literal("workflow"),
				Type.Literal("proposal"),
			],
			{ description: "Kind of adaptation to modify or inspect." },
		),
	),
	name: Type.Optional(
		Type.String({
			description:
				"Identifier name for skill, role, tool, or hook (lowercase alphanumeric with dashes/underscores, e.g. 'clean-code'). Not used for profile, architecture, workflow.",
		}),
	),
	content: Type.Optional(
		Type.String({
			description:
				"File content to write when action is 'apply'. For architecture and workflow, this must be valid JSON matching their schemas.",
		}),
	),
	targetRevision: Type.Optional(
		Type.Integer({
			description:
				"Target revision number when action is 'rollback' (e.g. 0 to delete the file, or 1, 2, ... to restore that revision).",
		}),
	),
	expectedRevision: Type.Optional(
		Type.Integer({
			description:
				"Expected current revision for optimistic concurrency control when action is 'apply'.",
		}),
	),
});

export type AdaptToolInput = Static<typeof adaptSchema>;

export interface AdaptToolOptions {
	agentDir?: string;
	isProjectTrusted?: () => boolean;
	getCollaborationMode?: () => "plan" | "build";
	isNamedAgentSession?: () => boolean;
	onRefreshAdaptations?: (event?: {
		action: string;
		kind?: string;
		name?: string;
		scope?: string;
	}) => Promise<void> | void;
}

export function createAdaptToolDefinition(
	cwd: string,
	options: AdaptToolOptions = {},
): ToolDefinition<typeof adaptSchema> {
	return {
		name: "adapt",
		label: "Adapt runtime architecture",
		description:
			"Modify, roll back, or list learned runtime architecture adaptations. Persists files to user or project adaptation directories that immediately alter agent behavior on next step.",
		promptSnippet: "Inspect or modify self-learning runtime adaptations (skills, roles, architecture, workflow, profile)",
		promptGuidelines: [
			"Use adapt to persist learned patterns, preferences, extra verification checks, or customized roles/skills.",
			"Control plane tools (performance_admit, performance_gate, update_plan, read_plan, spawn_agent, ask_user, adapt) can never be hidden or removed.",
			"In Plan mode, only data-only adaptations (profile, skill, role, architecture, workflow, proposal) can be modified without performance admission. Tools and hooks require Build mode.",
			"Every change is tracked in journal.jsonl with revision snapshots and can be rolled back anytime.",
		],
		capabilities: { effect: "write", parallelSafe: false },
		parameters: adaptSchema,
		execute: async (_id, input) => {
			if (options.isNamedAgentSession?.()) {
				throw new Error("The 'adapt' tool is only available in root sessions.");
			}

			const agentDir = options.agentDir ?? getAgentDir();
			const projectTrusted = options.isProjectTrusted?.() ?? true;
			const mode = options.getCollaborationMode?.();

			switch (input.action) {
				case "apply": {
					if (!input.kind) {
						throw new Error("kind is required for 'apply' action.");
					}
					if (input.content === undefined) {
						throw new Error("content is required for 'apply' action.");
					}

					// Plan mode safety guard
					if (mode === "plan" && (input.kind === "tool" || input.kind === "hook")) {
						throw new Error(
							`Modifying ${input.kind} adaptations is not permitted in Plan mode. Only data-only adaptations (profile, skill, role, architecture, workflow, proposal) are permitted.`,
						);
					}

					const scope: AdaptationScope = input.scope ?? "project";
					if (
						(input.kind === "skill" ||
							input.kind === "role" ||
							input.kind === "tool" ||
							input.kind === "hook") &&
						!input.name
					) {
						throw new Error(`name is required for '${input.kind}' adaptations.`);
					}

					const result = await writeAdaptation({
						agentDir,
						cwd,
						scope,
						kind: input.kind,
						name: input.name,
						content: input.content,
						expectedRevision: input.expectedRevision,
						projectTrusted,
					});

					await options.onRefreshAdaptations?.({
						action: "apply",
						kind: input.kind,
						name: input.name,
						scope,
					});

					return {
						content: [
							{
								type: "text",
								text: `Successfully applied ${input.kind} adaptation${input.name ? ` '${input.name}'` : ""} (scope: ${scope}, revision: ${result.revision}) to ${result.filePath}. Runtime has been refreshed.`,
							},
						],
						details: {
							revision: result.revision,
							filePath: result.filePath,
							scope,
							kind: input.kind,
							name: input.name,
						},
					};
				}

				case "rollback": {
					if (!input.kind) {
						throw new Error("kind is required for 'rollback' action.");
					}
					if (input.targetRevision === undefined) {
						throw new Error(
							"targetRevision is required for 'rollback' action (use 0 to delete the adaptation).",
						);
					}

					const scope: AdaptationScope = input.scope ?? "project";
					const result = await rollbackAdaptation({
						agentDir,
						cwd,
						scope,
						kind: input.kind,
						name: input.name,
						targetRevision: input.targetRevision,
						projectTrusted,
					});

					await options.onRefreshAdaptations?.({
						action: "rollback",
						kind: input.kind,
						name: input.name,
						scope,
					});

					return {
						content: [
							{
								type: "text",
								text: `Successfully rolled back ${input.kind} adaptation${input.name ? ` '${input.name}'` : ""} (scope: ${scope}) to revision ${input.targetRevision}. Runtime has been refreshed.`,
							},
						],
						details: {
							revision: result.revision,
							scope,
							kind: input.kind,
							name: input.name,
							targetRevision: input.targetRevision,
						},
					};
				}

				case "list": {
					let summaries = listAdaptations(agentDir, cwd, { projectTrusted });
					if (input.scope) {
						summaries = summaries.filter((s) => s.scope === input.scope);
					}
					if (input.kind) {
						summaries = summaries.filter((s) => s.kind === input.kind);
					}

					if (summaries.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No active adaptations found for the specified criteria.",
								},
							],
							details: { adaptations: [] },
						};
					}

					const formatted = summaries
						.map(
							(s) =>
								`- [${s.scope}] ${s.kind}${s.name ? `/${s.name}` : ""} (rev: ${s.revision}, ${s.sizeBytes} bytes, updated: ${s.updatedAt}): ${s.filePath}`,
						)
						.join("\n");

					return {
						content: [
							{
								type: "text",
								text: `Active adaptations (${summaries.length}):\n${formatted}`,
							},
						],
						details: { adaptations: summaries },
					};
				}

				default:
					throw new Error(`Unknown action: ${(input as any).action}`);
			}
		},
	};
}

export function createAdaptTool(cwd: string, options?: AdaptToolOptions) {
	return wrapToolDefinition(createAdaptToolDefinition(cwd, options));
}
