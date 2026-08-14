import type { AssistantMessage } from "@earendil-works/metis-ai";
import { describe, expect, test } from "vitest";
import {
	AssistantMessageComponent,
	compactProposedPlanText,
	parseProposedPlanPreview,
} from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function createAssistantMessage(
	content: AssistantMessage["content"],
	overrides: Partial<Pick<AssistantMessage, "stopReason">> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: overrides.stopReason ?? "stop",
		timestamp: Date.now(),
	};
}

describe("AssistantMessageComponent", () => {
	test("limits proposed-plan display lines without changing ordinary responses", () => {
		const lines = Array.from({ length: 15 }, (_, index) => `- Step ${index + 1}`);
		const full = `<proposed_plan>\n${lines.join("\n")}\n</proposed_plan>`;
		const compact = compactProposedPlanText(full, 12);

		expect(compact).toContain("- Step 12");
		expect(compact).not.toContain("- Step 13");
		expect(compact).toContain("3 more lines");
		expect(compact).not.toContain("<proposed_plan>");
		expect(compactProposedPlanText("ordinary response", 2)).toBe("ordinary response");
	});

	test("renders a compact proposed plan while retaining full source message", () => {
		initTheme("dark");
		const plan = Array.from({ length: 15 }, (_, index) => `- Step ${index + 1}`).join("\n");
		const message = createAssistantMessage([{ type: "text", text: `<proposed_plan>\n${plan}\n</proposed_plan>` }]);
		const component = new AssistantMessageComponent(message);
		const rendered = stripAnsi(component.render(80).join("\n"));

		expect(rendered).toContain("Step 12");
		expect(rendered).not.toContain("Step 13");
		expect(rendered).toContain("Plan ready");
		expect(rendered).toContain("3 more lines");
		expect(rendered).not.toContain("<proposed_plan>");
		expect(message.content[0]).toMatchObject({ text: expect.stringContaining("Step 15") });
	});

	test("renders an unfinished proposal as a draft without leaking its protocol tag", () => {
		initTheme("dark");
		const preview = parseProposedPlanPreview("Before\n<proposed_plan>\n## Summary\nDraft");
		expect(preview).toMatchObject({ before: "Before", complete: false, totalLines: 2 });

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "<proposed_plan>\n## Summary\nDraft" }]),
		);
		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toContain("Drafting plan");
		expect(rendered).not.toContain("<proposed_plan>");
	});

	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	test("renders length stops as visible errors", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }], { stopReason: "length" }),
			true,
		);
		const rendered = component.render(80).join("\n");

		expect(rendered).toContain("Thinking...");
		expect(rendered).toContain("maximum output token limit");
		expect(rendered).toContain("response may be incomplete");
	});

	test("uses configured output padding for text and thinking", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "reasoning" },
			]),
			false,
			undefined,
			"Thinking...",
			1,
		);
		const lines = component.render(80).map((line) => stripAnsi(line));

		expect(lines.some((line) => line.includes(" hello"))).toBe(true);
		expect(lines.some((line) => line.includes(" reasoning"))).toBe(true);

		component.setOutputPad(0);
		const updatedLines = component.render(80).map((line) => stripAnsi(line));
		expect(updatedLines.some((line) => line.startsWith("hello"))).toBe(true);
		expect(updatedLines.some((line) => line.startsWith("reasoning"))).toBe(true);
	});

	test("uses configured output padding for user messages", () => {
		initTheme("dark");

		const paddedComponent = new UserMessageComponent("hello", undefined, 1);
		const paddedLines = paddedComponent.render(40).map((line) => stripAnsi(line));
		expect(paddedLines.some((line) => line.startsWith(" hello"))).toBe(true);

		const unpaddedComponent = new UserMessageComponent("hello", undefined, 0);
		const unpaddedLines = unpaddedComponent.render(40).map((line) => stripAnsi(line));
		expect(unpaddedLines.some((line) => line.startsWith("hello"))).toBe(true);
	});
});
