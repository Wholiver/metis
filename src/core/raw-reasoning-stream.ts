import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Model,
	type ThinkingContent,
} from "@earendil-works/metis-ai";

interface OpenAIReasoningItem {
	type?: string;
	content?: Array<{ type?: string; text?: unknown }>;
}

function extractOpenAIRawReasoning(block: ThinkingContent): string | undefined {
	if (!block.thinkingSignature?.startsWith("{")) return undefined;

	try {
		const item = JSON.parse(block.thinkingSignature) as OpenAIReasoningItem;
		if (item.type !== "reasoning" || !Array.isArray(item.content)) return undefined;

		const rawParts = item.content
			.filter((part) => part?.type === "reasoning_text" || part?.type === "text")
			.map((part) => (typeof part.text === "string" ? part.text : ""))
			.filter((text) => text.trim().length > 0);
		const rawReasoning = rawParts.join("\n\n");
		return rawReasoning.trim().length > 0 ? rawReasoning : undefined;
	} catch {
		// Other providers use opaque signatures. Their visible thinking text is
		// already raw and must pass through unchanged.
		return undefined;
	}
}

function preferRawReasoningBlock(block: ThinkingContent): string | undefined {
	const rawReasoning = extractOpenAIRawReasoning(block);
	if (rawReasoning !== undefined) block.thinking = rawReasoning;
	return rawReasoning;
}

export function preferRawReasoningInMessage(message: AssistantMessage): void {
	for (const block of message.content) {
		if (block.type === "thinking") preferRawReasoningBlock(block);
	}
}

function createStreamError(model: Model<any>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

/**
 * Preserve provider-emitted raw reasoning across the normalized stream.
 *
 * OpenAI Responses items can contain both a user-facing summary and raw
 * `content`. The upstream normalizer currently finalizes the block with the
 * summary first. Reconcile from the signed completed item so raw content wins
 * when the provider actually returned it. Providers with opaque signatures
 * (Anthropic, Google, Cohere/OpenAI-compatible APIs, Bedrock, Mistral) pass
 * through unchanged.
 */
export function withRawReasoningPreference(
	source: AssistantMessageEventStream,
	model: Model<any>,
): AssistantMessageEventStream {
	const target = createAssistantMessageEventStream();

	void (async () => {
		try {
			for await (const sourceEvent of source) {
				let event: AssistantMessageEvent = sourceEvent;
				if (sourceEvent.type === "thinking_end") {
					const block = sourceEvent.partial.content[sourceEvent.contentIndex];
					if (block?.type === "thinking") {
						const rawReasoning = preferRawReasoningBlock(block);
						if (rawReasoning !== undefined) event = { ...sourceEvent, content: rawReasoning };
					}
				} else if (sourceEvent.type === "done") {
					preferRawReasoningInMessage(sourceEvent.message);
				} else if (sourceEvent.type === "error") {
					preferRawReasoningInMessage(sourceEvent.error);
				}
				target.push(event);
			}

			const result = await source.result();
			preferRawReasoningInMessage(result);
			target.end(result);
		} catch (error) {
			const message = createStreamError(model, error);
			target.push({ type: "error", reason: "error", error: message });
			target.end(message);
		}
	})();

	return target;
}

