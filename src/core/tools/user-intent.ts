import type { AgentTool } from "@earendil-works/metis-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { SessionEntry } from "../session-manager.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const userIntentSchema = Type.Object({});

export type UserIntentToolInput = Static<typeof userIntentSchema>;

export function createUserIntentToolDefinition(cwd: string): ToolDefinition<typeof userIntentSchema, undefined> {
	return {
		name: "user_intent",
		label: "user_intent",
		description: "Compatibility interface. Current user prompts are persisted in session history automatically.",
		promptSnippet: "Retrieve saved user-intent history",
		promptGuidelines: [],
		parameters: userIntentSchema,
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const getEntries = (ctx.sessionManager as { getEntries?: () => SessionEntry[] }).getEntries;
			if (!getEntries) {
				return { content: [{ type: "text", text: "No user prompts have been saved for this session." }], details: undefined };
			}
			const entries = getEntries.call(ctx.sessionManager).filter((entry): entry is Extract<SessionEntry, { type: "message" }> => entry.type === "message" && entry.message.role === "user");
			const content = entries.map((entry) => {
				const message = entry.message as Extract<typeof entry.message, { role: "user" }>;
				const value = message.content;
				return Array.isArray(value) ? value.filter((part) => part.type === "text").map((part) => part.text).join("\n") : String(value);
			}).join("\n\n");
			return {
				content: [{ type: "text", text: content || "No user prompts have been saved for this session." }],
				details: undefined,
			};
		},
	};
}

export function createUserIntentTool(cwd: string): AgentTool<any> {
	return wrapToolDefinition(createUserIntentToolDefinition(cwd));
}

