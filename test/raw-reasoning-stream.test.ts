import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type Model,
} from "@earendil-works/metis-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/metis-ai/providers/all";
import { describe, expect, it } from "vitest";
import { withRawReasoningPreference } from "../src/core/raw-reasoning-stream.ts";

function createModel(provider = "openai-codex"): Model<any> {
	return {
		id: "reasoning-model",
		name: "Reasoning Model",
		api: provider === "openai-codex" ? "openai-codex-responses" : "openai-completions",
		provider,
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function createMessage(model: Model<any>, thinking: string, thinkingSignature?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "thinking", thinking, thinkingSignature }],
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
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("raw reasoning stream preference", () => {
	it("covers every built-in reasoning provider API", () => {
		const reasoningApis = new Set(
			getBuiltinProviders().flatMap((provider) =>
				getBuiltinModels(provider)
					.filter((model) => model.reasoning)
					.map((model) => model.api),
			),
		);

		expect([...reasoningApis].sort()).toEqual([
			"anthropic-messages",
			"azure-openai-responses",
			"bedrock-converse-stream",
			"google-generative-ai",
			"google-vertex",
			"mistral-conversations",
			"openai-codex-responses",
			"openai-completions",
			"openai-responses",
		]);
	});

	it("prefers OpenAI raw reasoning content over its summary", async () => {
		const model = createModel();
		const signature = JSON.stringify({
			type: "reasoning",
			summary: [{ type: "summary_text", text: "**Planning**" }],
			content: [{ type: "reasoning_text", text: "Inspect inputs, then choose the smallest safe change." }],
		});
		const message = createMessage(model, "**Planning**", signature);
		const source = createAssistantMessageEventStream();
		const stream = withRawReasoningPreference(source, model);

		source.push({ type: "thinking_end", contentIndex: 0, content: "**Planning**", partial: message });
		source.push({ type: "done", reason: "stop", message });

		const events = [];
		for await (const event of stream) events.push(event);
		const thinkingEnd = events.find((event) => event.type === "thinking_end");

		expect(thinkingEnd).toMatchObject({
			type: "thinking_end",
			content: "Inspect inputs, then choose the smallest safe change.",
		});
		expect((await stream.result()).content[0]).toMatchObject({
			type: "thinking",
			thinking: "Inspect inputs, then choose the smallest safe change.",
		});
	});

	it("keeps OpenAI summaries when the service returns no raw content", async () => {
		const model = createModel();
		const signature = JSON.stringify({
			type: "reasoning",
			summary: [{ type: "summary_text", text: "**Planning**" }],
			content: [],
		});
		const message = createMessage(model, "**Planning**", signature);
		const source = createAssistantMessageEventStream();
		const stream = withRawReasoningPreference(source, model);

		source.push({ type: "done", reason: "stop", message });

		expect((await stream.result()).content[0]).toMatchObject({ type: "thinking", thinking: "**Planning**" });
	});

	it.each(["cohere", "anthropic", "google", "amazon-bedrock", "mistral"])(
		"passes through %s raw reasoning",
		async (provider) => {
			const model = createModel(provider);
			const message = createMessage(model, `${provider} raw reasoning`, "opaque-provider-signature");
			const source = createAssistantMessageEventStream();
			const stream = withRawReasoningPreference(source, model);

			source.push({ type: "done", reason: "stop", message });

			expect((await stream.result()).content[0]).toMatchObject({
				type: "thinking",
				thinking: `${provider} raw reasoning`,
			});
		},
	);
});

