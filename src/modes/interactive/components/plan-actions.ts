import { Container, type Focusable, getKeybindings, Input, Spacer, Text } from "@earendil-works/metis-tui";
import { t } from "../i18n/index.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { rawKeyHint } from "./keybinding-hints.ts";

/** Terminal-native controls shown after a durable proposal is ready. */
export class PlanActionsComponent extends Container implements Focusable {
	private readonly onProcessCallback: () => void;
	private readonly onReviseCallback: (feedback: string) => void;
	private readonly onCancelCallback: (draft: string) => void;
	private readonly content = new Container();
	private readonly input = new Input();
	private selectedIndex = 0;
	private editing = false;
	private feedbackRequired = false;
	private _focused = false;

	get focused(): boolean { return this._focused; }
	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value && this.editing;
	}

	constructor(
		initialFeedback: string,
		onProcess: () => void,
		onRevise: (feedback: string) => void,
		onCancel: (draft: string) => void,
	) {
		super();
		this.onProcessCallback = onProcess;
		this.onReviseCallback = onRevise;
		this.onCancelCallback = onCancel;
		this.input.setValue(initialFeedback);
		if (initialFeedback.trim()) {
			this.editing = true;
		}

		this.addChild(new Spacer(1));
		this.addChild(this.content);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((line) => theme.fg("borderAccent", line)));
		this.renderContent();
	}

	getDraft(): string { return this.input.getValue(); }

	private renderContent(): void {
		this.content.clear();
		const title = this.editing ? t("plan.actions.edit") : t("plan.actions.next");
		this.content.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));

		if (this.editing) {
			this.content.addChild(new Spacer(1));
			this.content.addChild(new Text(theme.fg("text", t("plan.actions.feedback")), 1, 0));
			this.content.addChild(new Spacer(1));
			this.content.addChild(this.input);
			if (this.feedbackRequired) {
				this.content.addChild(new Text(theme.fg("warning", t("plan.actions.feedbackRequired")), 1, 0));
			}
			this.content.addChild(new Spacer(1));
			this.content.addChild(new Text(`${rawKeyHint("Enter", t("plan.actions.submit"))}  ${rawKeyHint("Esc", t("plan.actions.back"))}`, 1, 0));
			this.input.focused = this._focused;
			return;
		}

		this.content.addChild(new Spacer(1));
		const choices = [
			{ label: t("plan.actions.process"), description: t("plan.actions.processDescription") },
			{ label: t("plan.actions.edit"), description: t("plan.actions.editDescription") },
		];
		for (const [index, choice] of choices.entries()) {
			const selected = index === this.selectedIndex;
			const prefix = selected ? theme.fg("accent", "→ ") : "  ";
			this.content.addChild(new Text(`${prefix}${theme.fg(selected ? "accent" : "text", choice.label)}`, 1, 0));
			this.content.addChild(new Text(`    ${theme.fg("muted", choice.description)}`, 1, 0));
		}
		this.content.addChild(new Spacer(1));
		this.content.addChild(new Text(
			`${rawKeyHint("↑↓", t("plan.actions.select"))}  ${rawKeyHint("Enter", t("plan.actions.confirm"))}  ${rawKeyHint("Esc", t("plan.actions.dismiss"))}`,
			1,
			0,
		));
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.cancel")) {
			if (this.editing) {
				this.editing = false;
				this.input.focused = false;
				this.renderContent();
			} else {
				this.onCancelCallback(this.getDraft());
			}
			return;
		}

		if (this.editing) {
			if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
				const feedback = this.getDraft().trim();
				if (feedback) this.onReviseCallback(feedback);
				else {
					this.feedbackRequired = true;
					this.renderContent();
				}
				return;
			}
			this.feedbackRequired = false;
			this.input.handleInput(keyData);
			return;
		}

		if (keyData === "\t" || keyData === "\x1b[B" || keyData === "j") {
			this.selectedIndex = Math.min(1, this.selectedIndex + 1);
			this.renderContent();
			return;
		}
		if (keyData === "\x1b[Z" || keyData === "\x1b[A" || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.renderContent();
			return;
		}
		if (keyData === "\x1b[D" || keyData === "\x1b[C") {
			this.selectedIndex = this.selectedIndex === 0 ? 1 : 0;
			this.renderContent();
			return;
		}
		if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			if (this.selectedIndex === 0) {
				this.onProcessCallback();
				return;
			}
			this.editing = true;
			this.feedbackRequired = false;
			this.input.focused = this._focused;
			this.renderContent();
			return;
		}

		// Typing immediately starts revision feedback, matching the normal composer.
		this.selectedIndex = 1;
		this.editing = true;
		this.feedbackRequired = false;
		this.input.focused = this._focused;
		this.input.handleInput(keyData);
		this.renderContent();
	}
}
