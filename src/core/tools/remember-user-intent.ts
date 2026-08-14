import type { AgentTool } from "@earendil-works/metis-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const rememberUserIntentSchema = Type.Object({
	content: Type.String({ description: "Verbatim current user prompt to preserve as an active task requirement" }),
});

export type RememberUserIntentToolInput = Static<typeof rememberUserIntentSchema>;

export function createRememberUserIntentToolDefinition(
	cwd: string,
): ToolDefinition<typeof rememberUserIntentSchema, undefined> {
	return {
		name: "remember_user_intent",
		label: "remember_user_intent",
		description: "Compatibility interface for explicitly preserving a material user requirement. Session checkpoints already preserve prompts automatically.",
		promptSnippet: "Save a material user requirement",
		promptGuidelines: [],
		parameters: rememberUserIntentSchema,
		async execute(_toolCallId, { content }, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");
			return {
				content: [{ type: "text", text: "Saved explicit requirement to unified memory pipeline." }],
				details: undefined,
			};
		},
	};
}

export function createRememberUserIntentTool(cwd: string): AgentTool<any> {
	return wrapToolDefinition(createRememberUserIntentToolDefinition(cwd));
}
