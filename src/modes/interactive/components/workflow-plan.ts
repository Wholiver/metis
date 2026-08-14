import { Container, Spacer, Text } from "@earendil-works/metis-tui";
import type { WorkflowPlanState } from "../../../core/workflow-runtime.ts";
import { t } from "../i18n/index.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

/** Persistent Build checklist shown above the TUI composer. */
export class WorkflowPlanComponent extends Container {
	private readonly content = new Container();
	private expanded = true;
	private plan: WorkflowPlanState | undefined;
	private interrupted = false;

	constructor(plan: WorkflowPlanState | undefined, interrupted = false) {
		super();
		this.plan = plan;
		this.interrupted = interrupted;
		this.expanded = !this.isComplete();
		this.addChild(new DynamicBorder((line) => theme.fg("borderAccent", line)));
		this.addChild(this.content);
		this.addChild(new DynamicBorder((line) => theme.fg("borderAccent", line)));
		this.renderContent();
	}

	update(plan: WorkflowPlanState | undefined, interrupted = false): void {
		const changed = plan?.updatedAt !== this.plan?.updatedAt;
		this.plan = plan;
		this.interrupted = interrupted;
		if (changed) this.expanded = !this.isComplete();
		this.renderContent();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.renderContent();
	}

	private isComplete(): boolean {
		return Boolean(this.plan?.plan.length && this.plan.plan.every((item) => item.status === "completed"));
	}

	private renderContent(): void {
		this.content.clear();
		const completed = this.plan?.plan.filter((item) => item.status === "completed").length ?? 0;
		const progress = this.plan?.phase === "reading_proposal"
			? t("executionPlan.readingProposal")
			: this.plan?.phase === "creating_checklist"
				? t("executionPlan.creatingChecklist")
				: this.plan?.plan.length
			? t("executionPlan.progress", { completed, total: this.plan.plan.length })
			: this.plan?.legacyMarkdown
				? t("executionPlan.legacy")
				: t("executionPlan.empty");
		const interrupted = this.interrupted ? `${theme.fg("warning", t("executionPlan.interrupted"))} · ` : "";
		const disclosure = theme.fg("dim", this.expanded ? "▾" : "▸");
		this.content.addChild(new Spacer(1));
		this.content.addChild(new Text(
			`${disclosure} ${theme.bold(theme.fg("text", t("executionPlan.title")))} ${theme.fg("dim", `· ${interrupted}${progress}`)}`,
			1,
			0,
		));

		if (this.expanded) {
			if (this.plan?.explanation) {
				this.content.addChild(new Spacer(1));
				this.content.addChild(new Text(theme.fg("muted", this.plan.explanation), 1, 0));
			}
			if (this.plan?.legacyMarkdown) {
				this.content.addChild(new Spacer(1));
				this.content.addChild(new Text(theme.fg("text", this.plan.legacyMarkdown), 1, 0));
			}
			for (const item of this.plan?.plan ?? []) {
				const marker = item.status === "completed"
					? theme.fg("success", "✓")
					: item.status === "in_progress"
						? theme.fg("accent", "→")
						: theme.fg("dim", "○");
				const color = item.status === "completed" ? "muted" : item.status === "in_progress" ? "text" : "dim";
				this.content.addChild(new Text(`${marker} ${theme.fg(color, item.step)}`, 2, 0));
			}
		}
		this.content.addChild(new Spacer(1));
	}
}
