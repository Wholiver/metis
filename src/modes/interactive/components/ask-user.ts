import { Container, type Focusable, getKeybindings, Input, Spacer, Text } from "@earendil-works/metis-tui";
import type { AskUserAnswer, AskUserRequest, AskUserResponse } from "../../../core/ask-user.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export class AskUserComponent extends Container implements Focusable {
	private readonly request: AskUserRequest;
	private readonly answers = new Map<string, AskUserAnswer>();
	private readonly onSubmitCallback: (response: AskUserResponse) => void;
	private readonly onCancelCallback: () => void;
	private questionIndex = 0;
	private selectedIndex = 0;
	private writing = false;
	private input = new Input();
	private content = new Container();
	private _focused = false;

	get focused(): boolean { return this._focused; }
	set focused(value: boolean) { this._focused = value; this.input.focused = value && this.writing; }

	constructor(request: AskUserRequest, onSubmit: (response: AskUserResponse) => void, onCancel: () => void) {
		super();
		this.request = request;
		this.onSubmitCallback = onSubmit;
		this.onCancelCallback = onCancel;
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.content);
		this.addChild(new Spacer(1));
		this.addChild(new Text(`${rawKeyHint("↑↓", "navigate")}  ${keyHint("tui.select.confirm", "answer")}  ${rawKeyHint("Tab/Shift+Tab", "review")}  ${keyHint("tui.select.cancel", "cancel")}`, 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.renderQuestion();
	}

	private choices() {
		return [...(this.request.questions[this.questionIndex]?.options ?? []), { label: "Write my own answer", description: "Enter a free-form response", recommended: false }];
	}

	private renderQuestion(): void {
		this.content.clear();
		const question = this.request.questions[this.questionIndex]!;
		const saved = this.answers.get(question.id);
		this.content.addChild(new Text(theme.fg("accent", theme.bold(`${this.questionIndex + 1}/${this.request.questions.length} · ${question.header}`)), 1, 0));
		this.content.addChild(new Spacer(1));
		this.content.addChild(new Text(theme.fg("text", question.question), 1, 0));
		this.content.addChild(new Spacer(1));
		if (this.writing || !question.options?.length) {
			this.writing = true;
			this.input.setValue(saved?.selectedLabel ? "" : saved?.value ?? "");
			this.input.focused = this._focused;
			this.content.addChild(this.input);
			return;
		}
		for (const [index, option] of this.choices().entries()) {
			const selected = index === this.selectedIndex;
			const recommended = "recommended" in option && option.recommended ? theme.fg("success", " · recommended") : "";
			const prefix = selected ? theme.fg("accent", "→ ") : "  ";
			this.content.addChild(new Text(`${prefix}${theme.fg(selected ? "accent" : "text", option.label)}${recommended}`, 1, 0));
			this.content.addChild(new Text(`    ${theme.fg("muted", option.description)}`, 1, 0));
		}
		if (saved) this.content.addChild(new Text(theme.fg("muted", `  answered: ${saved.value}`), 1, 0));
	}

	private moveQuestion(delta: number): void {
		const next = Math.max(0, Math.min(this.request.questions.length - 1, this.questionIndex + delta));
		if (next === this.questionIndex) return;
		this.questionIndex = next;
		const question = this.request.questions[next]!;
		const saved = this.answers.get(question.id);
		const savedOption = saved?.selectedLabel ? question.options?.findIndex((option) => option.label === saved.selectedLabel) ?? -1 : -1;
		this.selectedIndex = Math.max(0, savedOption);
		this.writing = !question.options?.length || Boolean(saved && !saved.selectedLabel);
		this.renderQuestion();
	}

	private commit(value: string, selectedLabel?: string): void {
		const question = this.request.questions[this.questionIndex]!;
		const trimmed = value.trim();
		if (!trimmed) return;
		this.answers.set(question.id, { id: question.id, value: trimmed, ...(selectedLabel ? { selectedLabel } : {}) });
		if (this.questionIndex < this.request.questions.length - 1) {
			this.moveQuestion(1);
			return;
		}
		if (this.request.questions.every((candidate) => this.answers.has(candidate.id))) {
			this.onSubmitCallback({ cancelled: false, answers: this.request.questions.map((candidate) => this.answers.get(candidate.id)!) });
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.cancel")) return this.onCancelCallback();
		if (keyData === "\t") return this.moveQuestion(1);
		if (keyData === "\x1b[Z") return this.moveQuestion(-1);
		if (this.writing) {
			if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") this.commit(this.input.getValue());
			else this.input.handleInput(keyData);
			return;
		}
		const choices = this.choices();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		else if (kb.matches(keyData, "tui.select.down") || keyData === "j") this.selectedIndex = Math.min(choices.length - 1, this.selectedIndex + 1);
		else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			const selected = choices[this.selectedIndex]!;
			if (this.selectedIndex === choices.length - 1) { this.writing = true; this.input.setValue(""); }
			else this.commit(selected.label, selected.label);
		}
		this.renderQuestion();
	}
}
