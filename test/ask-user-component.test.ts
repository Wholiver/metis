import { beforeAll, describe, expect, it, vi } from "vitest";
import { AskUserComponent } from "../src/modes/interactive/components/ask-user.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => initTheme("dark"));

const request = {
	requestId: "request-1",
	toolCallId: "tool-1",
	questions: [
		{ id: "scope", header: "Scope", question: "Which scope?", options: [{ label: "Small", description: "Local" }, { label: "Full", description: "All", recommended: true }] },
		{ id: "notes", header: "Notes", question: "Any constraints?" },
	],
};

describe("AskUserComponent", () => {
	it("answers options and free text in stable question order", () => {
		const submit = vi.fn();
		const component = new AskUserComponent(request, submit, vi.fn());
		component.handleInput("j");
		component.handleInput("\n");
		component.handleInput("n");
		component.handleInput("o");
		component.handleInput("\n");
		expect(submit).toHaveBeenCalledWith({ cancelled: false, answers: [
			{ id: "scope", value: "Full", selectedLabel: "Full" },
			{ id: "notes", value: "no" },
		] });
	});

	it("uses Tab and Shift+Tab to review answers and Esc to cancel", () => {
		const cancel = vi.fn();
		const component = new AskUserComponent(request, vi.fn(), cancel);
		component.handleInput("\n");
		component.handleInput("\x1b[Z");
		component.handleInput("\t");
		component.handleInput("\x1b");
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("renders at narrow terminal width using the active theme", () => {
		const component = new AskUserComponent(request, vi.fn(), vi.fn());
		const lines = component.render(28);
		expect(lines.length).toBeGreaterThan(3);
		expect(lines.join("\n")).toContain("Scope");
	});
});

