import { randomUUID } from "node:crypto";
import { type Static, Type } from "typebox";
import type { AskUserHandler, AskUserRequest, AskUserResponse } from "../ask-user.ts";
import { validateAskUserRequest } from "../ask-user.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const optionSchema = Type.Object({
	label: Type.String({ minLength: 1 }),
	description: Type.String({ minLength: 1 }),
	recommended: Type.Optional(Type.Boolean()),
});
const questionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	header: Type.String({ minLength: 1, maxLength: 48 }),
	question: Type.String({ minLength: 1 }),
	options: Type.Optional(Type.Array(optionSchema, { minItems: 2, maxItems: 3 })),
});
export const askUserSchema = Type.Object({ questions: Type.Array(questionSchema, { minItems: 1, maxItems: 3 }) });
export type AskUserToolInput = Static<typeof askUserSchema>;
export interface AskUserToolOptions { handler?: () => AskUserHandler | undefined; }

export function createAskUserToolDefinition(options: AskUserToolOptions = {}): ToolDefinition<typeof askUserSchema> {
	return {
		name: "ask_user",
		label: "Ask user",
		description: "Ask the user one to three material clarification questions and wait for structured answers. Use this instead of writing clarification questions in ordinary assistant text when repository evidence cannot resolve a decision that would materially change the result.",
		promptSnippet: "Ask the user a material clarification question",
		promptGuidelines: ["Use ask_user for material ambiguity that cannot be resolved from available evidence. Never write clarification questions as ordinary assistant text. Do not ask for facts that can be discovered locally."],
		capabilities: { effect: "read", parallelSafe: false },
		parameters: askUserSchema,
		execute: async (toolCallId, input, signal) => {
			const error = validateAskUserRequest(input);
			if (error) throw new Error(error);
			const handler = options.handler?.();
			if (!handler) {
				const answers = input.questions.map((q) => {
					const recommended = q.options?.find((opt) => opt.recommended);
					const chosen = recommended ?? q.options?.[0];
					return {
						id: q.id,
						value: chosen ? chosen.label : "(unattended default)",
						selectedLabel: chosen ? chosen.label : undefined,
					};
				});
				const autoResponse: AskUserResponse = {
					cancelled: false,
					answers,
				};
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							...autoResponse,
							note: "Unattended mode: auto-resolved questions with default/recommended options.",
						}),
					}],
					details: autoResponse,
				};
			}
			const request: AskUserRequest = { requestId: randomUUID(), toolCallId, questions: input.questions };
			const response = await handler(request, signal);
			return { content: [{ type: "text", text: JSON.stringify(response) }], details: response };
		},
	};
}
export function createAskUserTool(options?: AskUserToolOptions) { return wrapToolDefinition(createAskUserToolDefinition(options)); }
