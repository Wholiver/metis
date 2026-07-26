import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage } from "@earendil-works/metis-ai";
import { sanitizeGeneratedSessionName } from "../src/core/session-name-generator.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("automatic session names", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("generates and persists a model-authored name after the first turn", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("可以，已修复。"),
			(_context, options) => {
				expect(options).toMatchObject({ maxTokens: 1024 });
				expect(options).not.toHaveProperty("temperature");
				expect(options).not.toHaveProperty("reasoning");
				return fauxAssistantMessage("**修复 Dream 指示器**");
			},
		]);

		await harness.session.prompt("修复 Dream 指示器的对齐问题");
		await harness.session.ensureSessionName();

		expect(harness.session.sessionName).toBe("修复 Dream 指示器");
		expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual(["修复 Dream 指示器"]);
		expect(harness.eventsOfType("session_name_generation").map((event) => event.status)).toEqual([
			"started",
			"completed",
		]);
	});

	it("reports generation failure instead of remaining pending", async () => {
		const harness = await createHarness({ autoSessionName: true });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("完成"),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "title provider failed" }),
		]);

		await harness.session.prompt("执行任务");
		await harness.session.ensureSessionName();

		expect(harness.session.isGeneratingSessionName).toBe(false);
		expect(harness.session.sessionNameError).toBe("title provider failed");
		expect(harness.eventsOfType("session_name_generation").map((event) => event.status)).toEqual([
			"started",
			"failed",
		]);
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
});
