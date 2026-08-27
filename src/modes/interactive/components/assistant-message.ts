import type { AssistantMessage } from "@earendil-works/metis-ai";
import { Container, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/metis-tui";
import { t } from "../i18n/index.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
export const PROPOSED_PLAN_VISIBLE_LINES = 12;

export interface ProposedPlanPreview {
	before: string;
	after: string;
	visibleMarkdown: string;
	hiddenLines: number;
	totalLines: number;
	complete: boolean;
}

export function parseProposedPlanPreview(text: string, maxLines = PROPOSED_PLAN_VISIBLE_LINES): ProposedPlanPreview | undefined {
	const opening = /<proposed_plan>\s*\n?/i.exec(text);
	if (!opening || opening.index === undefined) return undefined;
	const bodyStart = opening.index + opening[0].length;
	const closing = /\s*<\/proposed_plan>/i.exec(text.slice(bodyStart));
	const bodyEnd = closing ? bodyStart + closing.index : text.length;
	const markdown = text.slice(bodyStart, bodyEnd).trim();
	const lines = markdown ? markdown.split("\n") : [];
	const visibleLines = lines.slice(0, Math.max(1, maxLines));
	return {
		before: text.slice(0, opening.index).trim(),
		after: closing ? text.slice(bodyStart + closing.index + closing[0].length).trim() : "",
		visibleMarkdown: visibleLines.join("\n"),
		hiddenLines: Math.max(0, lines.length - visibleLines.length),
		totalLines: lines.length,
		complete: Boolean(closing),
	};
}

export function compactProposedPlanText(text: string, maxLines = PROPOSED_PLAN_VISIBLE_LINES): string {
	const preview = parseProposedPlanPreview(text, maxLines);
	if (!preview) return text;
	const hidden = preview.hiddenLines > 0
		? `… ${t("plan.preview.hidden", { count: preview.hiddenLines })}`
		: "";
	return [preview.before, preview.visibleMarkdown, hidden, preview.after].filter(Boolean).join("\n\n");
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	private addAssistantText(text: string): void {
		const preview = parseProposedPlanPreview(text);
		if (!preview) {
			this.contentContainer.addChild(new Markdown(text, this.outputPad, 0, this.markdownTheme));
			return;
		}

		if (preview.before) {
			this.contentContainer.addChild(new Markdown(preview.before, this.outputPad, 0, this.markdownTheme));
			this.contentContainer.addChild(new Spacer(1));
		}

		const plan = new Container();
		plan.addChild(new DynamicBorder((line) => theme.fg("borderAccent", line)));
		plan.addChild(new Spacer(1));
		const stateLabel = preview.complete ? t("plan.preview.ready") : t("plan.preview.drafting");
		const stateColor = preview.complete ? "success" : "accent";
		plan.addChild(new Text(
			`${theme.fg(stateColor, preview.complete ? "✓ " : "◆ ")}${theme.bold(theme.fg("text", stateLabel))}${theme.fg("dim", ` · ${t("plan.preview.lines", { count: preview.totalLines })}`)}`,
			this.outputPad,
			0,
		));
		if (preview.visibleMarkdown) {
			plan.addChild(new Spacer(1));
			plan.addChild(new Markdown(preview.visibleMarkdown, this.outputPad, 0, this.markdownTheme));
		}
		if (preview.hiddenLines > 0) {
			plan.addChild(new Spacer(1));
			plan.addChild(new Text(
				theme.fg("muted", `… ${t("plan.preview.hidden", { count: preview.hiddenLines })}`),
				this.outputPad,
				0,
			));
		}
		plan.addChild(new Spacer(1));
		plan.addChild(new DynamicBorder((line) => theme.fg("borderAccent", line)));
		this.contentContainer.addChild(plan);

		if (preview.after) {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(new Markdown(preview.after, this.outputPad, 0, this.markdownTheme));
		}
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.addAssistantText(content.text.trim());
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					// Show static thinking label when hidden
					this.contentContainer.addChild(
						new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad, 0),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in thinkingText color, italic
					this.contentContainer.addChild(
						new Markdown(content.thinking.trim(), this.outputPad, 0, this.markdownTheme, {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(
					theme.fg(
						"error",
						"Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
					),
					this.outputPad,
					0,
				),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}

