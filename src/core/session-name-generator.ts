import type { AgentMessage } from "@earendil-works/metis-agent-core";
import type { Model } from "@earendil-works/metis-ai/compat";
import { completeSimple } from "@earendil-works/metis-ai/compat";
import type { ModelRegistry } from "./model-registry.ts";

const MAX_CONVERSATION_MESSAGES = 4;
const MAX_MESSAGE_CHARS = 1000;
const MAX_SESSION_NAME_CHARS = 80;
export const DEFAULT_SESSION_NAME_TIMEOUT_MS = 15_000;

export interface GenerateSessionNameOptions {
	model: Model<any>;
	modelRegistry: ModelRegistry;
	messages: readonly AgentMessage[];
	signal?: AbortSignal;
	timeoutMs?: number;
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Session name generation aborted");
}

function getMessageText(message: AgentMessage): string {
	if (!(message.role === "user" || message.role === "assistant")) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join(" ");
}

function buildConversationText(messages: readonly AgentMessage[]): string | undefined {
	const conversation = messages
		.filter((message) => message.role === "user" || message.role === "assistant")
		.map((message) => ({ role: message.role, text: getMessageText(message).trim() }))
		.filter((message) => message.text.length > 0)
		.slice(0, MAX_CONVERSATION_MESSAGES);

	if (!conversation.some((message) => message.role === "user") || !conversation.some((message) => message.role === "assistant")) {
		return undefined;
	}

	return conversation
		.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text.slice(0, MAX_MESSAGE_CHARS)}`)
		.join("\n\n");
}

export function sanitizeGeneratedSessionName(value: string): string | undefined {
	const firstLine = value
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.trim()
		.split(/\r?\n/, 1)[0]
		.trim()
		.replace(/^#+\s*/, "")
		.replace(/^["'“‘\s()]+|["'”’\s()]+$/g, "")
		.replace(/^\*\*(.*?)\*\*$/, "$1")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_SESSION_NAME_CHARS)
		.trim();
	return firstLine || undefined;
}

export function generateFallbackSessionName(messages: readonly AgentMessage[]): string {
	const firstUserMessage = messages.find((message) => message.role === "user");
	const firstAssistantMessage = messages.find((message) => message.role === "assistant");
	const originalText =
		(firstUserMessage ? getMessageText(firstUserMessage).trim() : "") ||
		(firstAssistantMessage ? getMessageText(firstAssistantMessage).trim() : "");
	if (!originalText) return "New task";

	const withoutLeadingFile = originalText.replace(/^(['"“‘])(?:\/|[A-Za-z]:\\).+?['"”’]\s*/, "");
	return sanitizeGeneratedSessionName(withoutLeadingFile || originalText) ?? "New task";
}

export async function generateSessionName(options: GenerateSessionNameOptions): Promise<string | undefined> {
	const conversationText = buildConversationText(options.messages);
	if (!conversationText) return undefined;
	if (options.signal?.aborted) throw abortError(options.signal);

	const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_NAME_TIMEOUT_MS;
	const requestController = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let removeAbortListener: (() => void) | undefined;
	const guard = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => {
			const error = new Error(`Session name generation timed out after ${timeoutMs}ms`);
			reject(error);
			requestController.abort(error);
		}, timeoutMs);

		if (options.signal) {
			const onAbort = () => {
				const error = abortError(options.signal!);
				reject(error);
				requestController.abort(error);
			};
			options.signal.addEventListener("abort", onAbort, { once: true });
			removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
		}
	});

	let response: Awaited<ReturnType<typeof completeSimple>>;
	try {
		const auth = await Promise.race([options.modelRegistry.getApiKeyAndHeaders(options.model), guard]);
		if (!auth.ok) throw new Error(auth.error);

		response = await Promise.race([
			completeSimple(
				options.model,
				{
					systemPrompt:
						"Generate a concise session title describing the conversation's main task. Use the same language as the user. Return only the title, normally 2-6 words, with no quotes, markdown, file extension, or explanation.",
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: `<conversation>\n${conversationText}\n</conversation>\n\nGenerate the session title now.`,
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					env: auth.env,
					maxTokens: 1024,
					signal: requestController.signal,
				},
			),
			guard,
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
		removeAbortListener?.();
	}

	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(response.errorMessage || "Session name generation failed");
	}

	return sanitizeGeneratedSessionName(
		response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n"),
	);
}
