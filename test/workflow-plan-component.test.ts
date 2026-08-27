import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { WorkflowPlanComponent } from "../src/modes/interactive/components/workflow-plan.ts";
import { setUiLanguage } from "../src/modes/interactive/i18n/index.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => {
	initTheme("dark");
	setUiLanguage("en");
});

describe("WorkflowPlanComponent", () => {
	it("renders persistent execution progress in the terminal theme and updates in place", () => {
		const component = new WorkflowPlanComponent({
			explanation: "Working through the accepted proposal",
			plan: [{ step: "Inspect", status: "completed" }, { step: "Implement", status: "in_progress" }, { step: "Verify", status: "pending" }],
			updatedAt: "first",
		});
		const initial = stripAnsi(component.render(56).join("\n"));
		expect(initial).toContain("Execution plan");
		expect(initial).toContain("1/3 completed");
		expect(initial).toContain("✓ Inspect");
		expect(initial).toContain("→ Implement");
		expect(initial).toContain("○ Verify");
		expect(initial).not.toContain("Approved proposal");
		expect(initial).not.toContain("Ship safely");

		component.update({ plan: [{ step: "Inspect", status: "completed" }, { step: "Implement", status: "completed" }, { step: "Verify", status: "in_progress" }], updatedAt: "second" });
		expect(stripAnsi(component.render(56).join("\n"))).toContain("2/3 completed");
		component.setExpanded(false);
		const collapsed = stripAnsi(component.render(56).join("\n"));
		expect(collapsed).toContain("Execution plan");
		expect(collapsed).not.toContain("Inspect");
	});

	it("keeps TUI lifecycle aligned with the Desktop dedicated plan surface", () => {
		const source = fs.readFileSync(new URL("../src/modes/interactive/interactive-mode.ts", import.meta.url), "utf8");
		expect(source).toContain("this.bottomContainer.addChild(this.workflowPlanContainer)");
		expect(source).toContain('event.entry.customType === "workflow_plan"');
		expect(source).toContain('event.entry.customType === "workflow_plan_reset"');
		expect(source).toContain('if (content.name === "update_plan") continue');
		expect(source).toContain('if (event.toolName === "update_plan") break');
	});
});

