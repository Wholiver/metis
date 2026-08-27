import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage } from "@earendil-works/metis-ai";
import { generateFallbackSessionName, sanitizeGeneratedSessionName } from "../src/core/session-name-generator.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("automatic session names", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("starts title generation alongside the first turn using only the first user prompt", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		let finishMainResponse: ((message: ReturnType<typeof fauxAssistantMessage>) => void) | undefined;
		let titleRequestStarted = false;
		harness.setResponses([
			(context, options) => {
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
				titleRequestStarted = true;
				return fauxAssistantMessage("**修复 Dream 指示器**");
			},
			async () =>
				await new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
					finishMainResponse = resolve;
				}),
		]);

		const prompt = harness.session.prompt("修复 Dream 指示器的对齐问题");
		await vi.waitFor(() => expect(titleRequestStarted).toBe(true));
		expect(harness.session.isStreaming).toBe(true);
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

	it("falls back to the user request when title generation fails", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "title provider failed" }),
			fauxAssistantMessage("完成"),
		]);

		await harness.session.prompt("执行任务");
		await harness.session.ensureSessionName();

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

	it("falls back when a custom model returns no title text", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage(""), fauxAssistantMessage("完成")]);

		await harness.session.prompt("分析自定义模型标题");
		await harness.session.ensureSessionName();

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

	it("uses a provider-independent title for empty multimodal messages", () => {
		expect(
			generateFallbackSessionName([
				{ role: "user", content: [], timestamp: Date.now() },
				{ role: "assistant", content: [], timestamp: Date.now() },
			]),
		).toBe("New task");
	});
});

