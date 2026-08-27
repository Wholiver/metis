import { beforeAll, describe, expect, it, vi } from "vitest";
import { PlanActionsComponent } from "../src/modes/interactive/components/plan-actions.ts";
import {
	createPlanRevisionPrompt,
	PLAN_PROCESS_PROMPT,
} from "../src/modes/interactive/interactive-mode.ts";
import { setUiLanguage } from "../src/modes/interactive/i18n/index.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => {
	initTheme("dark");
	setUiLanguage("en");
});

describe("PlanActionsComponent", () => {
	it("matches the ask-style question and option layout with one shared divider", () => {
		const process = vi.fn();
		const component = new PlanActionsComponent("", process, vi.fn(), vi.fn());
		const rendered = stripAnsi(component.render(64).join("\n"));
		expect(rendered).toContain("What next?");
		expect(rendered).toContain("Process");
		expect(rendered).toContain("Edit plan");
		expect(rendered).toContain("Switch to Build");
		expect(rendered).toContain("Send feedback");
		expect(component.render(64).map((line) => stripAnsi(line)).filter((line) => /^─+$/.test(line))).toHaveLength(1);
		const narrow = component.render(28).map((line) => stripAnsi(line));
		expect(narrow.every((line) => line.length <= 28)).toBe(true);
		component.handleInput("\n");
		expect(process).toHaveBeenCalledOnce();
	});

	it("collects non-empty revision feedback and preserves drafts on dismiss", () => {
		const revise = vi.fn();
		const cancel = vi.fn();
		const component = new PlanActionsComponent("", vi.fn(), revise, cancel);
		component.handleInput("j");
		component.handleInput("\n");
		component.handleInput("f");
		component.handleInput("i");
		component.handleInput("x");
		component.handleInput("\n");
		expect(revise).toHaveBeenCalledWith("fix");

		const empty = new PlanActionsComponent("", vi.fn(), revise, vi.fn());
		empty.handleInput("\x1b[B");
		empty.handleInput("\n");
		empty.handleInput("\n");
		expect(revise).toHaveBeenCalledTimes(1);
		expect(stripAnsi(empty.render(48).join("\n"))).toContain("Enter feedback before submitting.");

		const draft = new PlanActionsComponent("keep me", vi.fn(), vi.fn(), cancel);
		draft.handleInput("\x1b");
		draft.handleInput("\x1b");
		expect(cancel).toHaveBeenCalledWith("keep me");
	});

	it("forces both actions to recover the durable proposal first", () => {
		expect(PLAN_PROCESS_PROMPT).toContain("read_plan first");
		expect(PLAN_PROCESS_PROMPT).toContain("MUST call update_plan");
		expect(PLAN_PROCESS_PROMPT.indexOf("read_plan")).toBeLessThan(PLAN_PROCESS_PROMPT.indexOf("update_plan"));
		expect(PLAN_PROCESS_PROMPT).toContain("visible progress updates");
		expect(createPlanRevisionPrompt("narrow scope")).toContain("read_plan first");
		expect(createPlanRevisionPrompt("narrow scope")).toContain("narrow scope");
	});
});

