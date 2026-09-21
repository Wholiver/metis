import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage } from "@earendil-works/metis-ai";
import { generateFallbackSessionName, sanitizeGeneratedSessionName, sessionNameCompletionModel, sessionNameTextFromAssistantContent } from "../src/core/session-name-generator.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("automatic session names", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("generates a title with the selected model before the first chat request", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		const order: string[] = [];
		let finishMainResponse: ((message: ReturnType<typeof fauxAssistantMessage>) => void) | undefined;
		harness.setResponses([
			(context, options) => {
				expect(harness.session.isStreaming).toBe(false);
				expect(options).toMatchObject({ maxTokens: 1024 });
				expect(options).not.toHaveProperty("temperature");
				expect(options).not.toHaveProperty("reasoning");
				expect(context.messages).toHaveLength(1);
				expect(context.messages[0]).toMatchObject({ role: "user" });
				expect(context.messages[0]?.content).toEqual([
					{
						type: "text",
						text: "<user_prompt>\n修复 Dream 指示器的对齐问题\n</user_prompt>\n\nGenerate title.",
					},
				]);
				order.push("title");
				return fauxAssistantMessage("**修复 Dream 指示器**");
			},
			async () => {
				order.push("chat");
				expect(harness.session.sessionName).toBe("修复 Dream 指示器");
				return await new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
					finishMainResponse = resolve;
				});
			},
		]);

		const prompt = harness.session.prompt("修复 Dream 指示器的对齐问题");
		await vi.waitFor(() => expect(order).toEqual(["title", "chat"]));
		expect(harness.session.isStreaming).toBe(true);
		expect(harness.session.sessionName).toBe("修复 Dream 指示器");
		finishMainResponse?.(fauxAssistantMessage("模型输出不应进入标题请求"));
		await prompt;
		await harness.session.ensureSessionName();

		expect(harness.session.sessionName).toBe("修复 Dream 指示器");
		expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual(["修复 Dream 指示器"]);
		expect(harness.eventsOfType("session_name_generation").map((event) => event.status)).toEqual([
			"started",
			"completed",
		]);
	});

	it("falls back to the user request when title generation fails, then starts the chat", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		let chatStarted = false;
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "title provider failed" }),
			() => {
				expect(harness.session.sessionName).toBe("执行任务");
				expect(harness.session.isGeneratingSessionName).toBe(false);
				chatStarted = true;
				return fauxAssistantMessage("完成");
			},
		]);

		await harness.session.prompt("执行任务");
		await harness.session.ensureSessionName();

		expect(chatStarted).toBe(true);
		expect(harness.session.isGeneratingSessionName).toBe(false);
		expect(harness.session.sessionName).toBe("执行任务");
		expect(harness.session.sessionNameError).toBeUndefined();
		expect(harness.eventsOfType("session_name_generation").map((event) => event.status)).toEqual([
			"started",
			"completed",
		]);

		harness.setResponses([fauxAssistantMessage("不应重试")]);
		await harness.session.ensureSessionName();
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("times out a title provider that never settles", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.setResponses([async () => await new Promise<never>(() => {})]);

		await harness.session.ensureSessionName({ prompt: "执行任务", timeoutMs: 10 });

		expect(harness.session.isGeneratingSessionName).toBe(false);
		expect(harness.session.sessionName).toBe("执行任务");
		expect(harness.session.sessionNameError).toBeUndefined();
		expect(harness.eventsOfType("session_name_generation").map((event) => event.status)).toEqual([
			"started",
			"completed",
		]);
	});

	it("falls back when a custom model returns no title text, then starts the chat", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		let chatStarted = false;
		harness.setResponses([
			fauxAssistantMessage(""),
			() => {
				expect(harness.session.sessionName).toBe("分析自定义模型标题");
				chatStarted = true;
				return fauxAssistantMessage("完成");
			},
		]);

		await harness.session.prompt("分析自定义模型标题");
		await harness.session.ensureSessionName();

		expect(chatStarted).toBe(true);
		expect(harness.session.sessionName).toBe("分析自定义模型标题");
		expect(harness.eventsOfType("session_name_generation").map((event) => event.status)).toEqual([
			"started",
			"completed",
		]);
	});

	it("generates a fallback even when no model remains selected", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.session.state.model = undefined;
		await harness.session.ensureSessionName({ prompt: "无模型标题" });

		expect(harness.session.sessionName).toBe("无模型标题");
		expect(harness.eventsOfType("session_name_generation").map((event) => event.status)).toEqual([
			"started",
			"completed",
		]);
	});

	it("settles when title generation is cancelled", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.setResponses([async () => await new Promise<never>(() => {})]);

		const controller = new AbortController();
		const naming = harness.session.ensureSessionName({ prompt: "执行任务", signal: controller.signal });
		controller.abort(new Error("title cancelled"));
		await naming;

		expect(harness.session.isGeneratingSessionName).toBe(false);
		expect(harness.session.sessionNameError).toBe("title cancelled");
	});

	it("never overwrites an explicit session name", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.session.setSessionName("用户指定名称");
		harness.setResponses([fauxAssistantMessage("完成"), fauxAssistantMessage("不应使用")]);

		await harness.session.prompt("执行任务");
		await harness.session.ensureSessionName();

		expect(harness.session.sessionName).toBe("用户指定名称");
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("does not generate a name when automatic naming is disabled", async () => {
		const harness = await createHarness({ autoSessionName: false });
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("完成"), fauxAssistantMessage("不应使用")]);

		await harness.session.prompt("执行任务");
		await harness.session.ensureSessionName();

		expect(harness.session.sessionName).toBeUndefined();
		expect(harness.getPendingResponseCount()).toBe(1);
	});
});

describe("sessionNameCompletionModel", () => {
	const base = {
		id: "grok-4.6",
		name: "grok-4.6",
		provider: "custom-cursor",
		reasoning: true,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 256000,
		maxTokens: 16384,
	};

	it("uses max_tokens and disables developer role for Cursor-style OpenAI-compatible proxies", () => {
		const model = sessionNameCompletionModel({
			...base,
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:8787/v1",
			compat: { supportsDeveloperRole: true, maxTokensField: "max_completion_tokens" },
		});
		expect(model.reasoning).toBe(false);
		expect(model.compat).toMatchObject({
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStore: false,
			supportsUsageInStreaming: false,
		});
	});

	it("does not rewrite Anthropic or other native APIs beyond disabling reasoning", () => {
		const model = sessionNameCompletionModel({
			...base,
			id: "claude-sonnet-4-6",
			name: "claude-sonnet-4-6",
			provider: "anthropic",
			api: "anthropic-messages",
			baseUrl: "https://api.anthropic.com",
			compat: { supportsTemperature: true },
		});
		expect(model.reasoning).toBe(false);
		expect(model.compat).toEqual({ supportsTemperature: true });
	});

	it("keeps official OpenAI hosts on native completion token fields", () => {
		const model = sessionNameCompletionModel({
			...base,
			id: "gpt-5.4",
			name: "gpt-5.4",
			provider: "openai",
			api: "openai-completions",
			baseUrl: "https://api.openai.com/v1",
			compat: { maxTokensField: "max_completion_tokens", supportsDeveloperRole: true },
		});
		expect(model.reasoning).toBe(false);
		expect(model.compat).toMatchObject({
			supportsDeveloperRole: false,
			maxTokensField: "max_completion_tokens",
		});
		expect(model.compat).not.toHaveProperty("supportsStore", false);
	});
});

describe("sanitizeGeneratedSessionName", () => {
	it("removes thinking, quotes, markdown, and extra lines", () => {
		expect(sanitizeGeneratedSessionName('<think>analysis</think>\n"**会话标题**"\n额外解释')).toBe("会话标题");
	});

	it("builds a readable fallback without a leading quoted file path", () => {
		expect(
			generateFallbackSessionName([
				{
					role: "user",
					content: "'/Users/demo/Desktop/video.mov' 复制视频中的网站，一比一复制",
					timestamp: Date.now(),
				},
			]),
		).toBe("复制视频中的网站，一比一复制");
	});

	it("strips Chinese accessibility list wrappers from fallback titles", () => {
		expect(
			generateFallbackSessionName([
				{
					role: "user",
					content: "第 Generate an SVG / a pelican riding a bicycle 项",
					timestamp: Date.now(),
				},
			]),
		).toBe("Generate an SVG / a pelican riding a bicycle");
		expect(
			generateFallbackSessionName([
				{
					role: "user",
					content: "第Generate an SVG / a pelican riding a bicycle項",
					timestamp: Date.now(),
				},
			]),
		).toBe("Generate an SVG / a pelican riding a bicycle");
		expect(sanitizeGeneratedSessionName("第 Pelican Bicycle 项")).toBe("Pelican Bicycle");
	});

	it("uses thinking text when Gemini OAuth returns a thought-only title", () => {
		expect(
			sanitizeGeneratedSessionName(
				sessionNameTextFromAssistantContent([{ type: "thinking", thinking: "鹈鹕骑行矢量动画" }]),
			),
		).toBe("鹈鹕骑行矢量动画");
		expect(
			sanitizeGeneratedSessionName(
				sessionNameTextFromAssistantContent([
					{ type: "thinking", thinking: "internal plan" },
					{ type: "text", text: "鹈鹕骑车动态SVG" },
				]),
			),
		).toBe("鹈鹕骑车动态SVG");
	});

	it("uses a provider-independent title for empty multimodal messages", () => {
		expect(
			generateFallbackSessionName([
				{ role: "user", content: [], timestamp: Date.now() },
				{ role: "assistant", content: [], timestamp: Date.now() },
			]),
		).toBe("New task");
	});
});

