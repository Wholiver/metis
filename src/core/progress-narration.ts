/**
 * Visible intermediate text (中间文) is a normal text part, never thinking.
 * Reminders fire only at real milestones. Exploring (ls/read/plan/memory/inspect
 * bash) must not look like a phase change, or models narrate one line per tool.
 */

export type ProgressPhase = "explore" | "admit" | "mutate" | "verify" | "delegate" | "ask" | "other";
export type ProgressNudgeKind = "required";

export interface ProgressToolResult {
	toolCallId: string;
	toolName: string;
	isError?: boolean;
}

export interface ProgressHistoryMessage {
	role: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	content?: unknown;
	customType?: string;
}

export interface ProgressNudge {
	kind: ProgressNudgeKind;
	reason: string;
	key: string;
}

const EXPLORE_TOOLS = new Set([
	"ls",
	"read",
	"grep",
	"find",
	"webfetch",
	"websearch",
	"query_memory_db",
	"query-memory-db",
	"read_plan",
	"log",
	"remember_user_intent",
	"browser_snapshot",
	"browser_screenshot",
	"browser_take_screenshot",
]);
const MUTATING_BROWSER_TOOLS = new Set([
	"browser_navigate",
	"browser_click",
	"browser_fill",
	"browser_type",
	"browser_press_key",
	"browser_scroll",
]);
const VERIFY_COMMAND =
	/\b(vitest|pytest|jest|xmllint)\b|(?:^|[\s;&|])(?:npm|pnpm|yarn)(?:\s+run)?\s+test(?:\b|$)|cargo test|go test/i;
const EXPLORE_COMMAND =
	/^\s*(?:(?:sudo|command)\s+)?(?:ls|pwd|cat|head|tail|file|stat|which|type|tree|wc|du|df|find|rg|git\s+(?:status|log|diff|show|rev-parse|branch|remote|ls-files|describe)(?:\s|$))/i;
export const PROGRESS_NUDGE_MARKER = "Visible progress update";

function isWorkflowContext(message: ProgressHistoryMessage): boolean {
	return message.role === "custom" && message.customType === "workflow_context";
}

function lastUserIndex(messages: readonly ProgressHistoryMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") return index;
	}
	return 0;
}

function toolCallField(messages: readonly ProgressHistoryMessage[], toolCallId: string, key: string): unknown {
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!part || typeof part !== "object") continue;
			const block = part as {
				type?: string;
				id?: string;
				arguments?: Record<string, unknown>;
				input?: Record<string, unknown>;
			};
			if (block.type !== "toolCall" || block.id !== toolCallId) continue;
			return block.arguments?.[key] ?? block.input?.[key];
		}
	}
	return undefined;
}

export function classifyProgressTool(
	name: string,
	options: { isError?: boolean; command?: string; action?: string } = {},
): ProgressPhase {
	if (name === "performance_admit") return "admit";
	if (name === "performance_gate") return "verify";
	if (name === "spawn_agent") return "delegate";
	if (name === "ask_user") return "ask";
	if (name === "write" || name === "edit") return "mutate";
	if (name === "bash") {
		if (options.command && VERIFY_COMMAND.test(options.command)) return "verify";
		if (!options.command || EXPLORE_COMMAND.test(options.command)) return "explore";
		return "mutate";
	}
	if (name === "browser_tabs") return options.action === "list" ? "explore" : "mutate";
	if (MUTATING_BROWSER_TOOLS.has(name)) return "mutate";
	if (EXPLORE_TOOLS.has(name) || name.startsWith("browser_")) return "explore";
	return "other";
}

function batchPhase(
	results: readonly ProgressToolResult[],
	messages: readonly ProgressHistoryMessage[],
): ProgressPhase {
	const phases = new Set(
		results.map((result) => {
			const command = toolCallField(messages, result.toolCallId, "command");
			const action = toolCallField(messages, result.toolCallId, "action");
			return classifyProgressTool(result.toolName, {
				isError: result.isError,
				command: typeof command === "string" ? command : undefined,
				action: typeof action === "string" ? action : undefined,
			});
		}),
	);
	if (phases.has("delegate")) return "delegate";
	if (phases.has("verify")) return "verify";
	if (phases.has("mutate")) return "mutate";
	if (phases.has("admit")) return "admit";
	if (phases.has("ask")) return "ask";
	if (phases.has("explore")) return "explore";
	return "other";
}

function nudgeKey(results: readonly ProgressToolResult[]): string {
	return `progress-nudge:${[...results.map((result) => result.toolCallId)].sort().join(",")}`;
}

function alreadyNudged(messages: readonly ProgressHistoryMessage[], key: string): boolean {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) continue;
		if (isWorkflowContext(message)) {
			const content = typeof message.content === "string" ? message.content : "";
			if (content.includes(key)) return true;
			continue;
		}
		if (message.role === "toolResult") continue;
		break;
	}
	return false;
}

function turnHasProgressNudge(messages: readonly ProgressHistoryMessage[], turnStart: number): boolean {
	return messages.slice(turnStart).some((message) => {
		if (!isWorkflowContext(message) || typeof message.content !== "string") return false;
		return message.content.includes(PROGRESS_NUDGE_MARKER);
	});
}

function failedCheck(results: readonly ProgressToolResult[], messages: readonly ProgressHistoryMessage[]): boolean {
	return results.some((result) => {
		if (result.toolName === "performance_gate") {
			const verdict = toolCallField(messages, result.toolCallId, "verdict");
			if (verdict === "fail" || verdict === "blocked") return true;
		}
		if (!result.isError) return false;
		const command = toolCallField(messages, result.toolCallId, "command");
		const phase = classifyProgressTool(result.toolName, {
			isError: true,
			command: typeof command === "string" ? command : undefined,
		});
		return phase === "verify" || result.toolName === "write" || result.toolName === "edit";
	});
}

function isRealMilestone(
	currentPhase: ProgressPhase,
	previousPhase: ProgressPhase | undefined,
	names: readonly string[],
): string | undefined {
	if (names.includes("performance_admit")) return "admission";
	if (names.includes("performance_gate")) return "gate";
	if (names.includes("spawn_agent")) return "delegate";
	if (currentPhase === "mutate" && previousPhase !== "mutate") return `${previousPhase ?? "start"}→mutate`;
	if (currentPhase === "verify" && previousPhase !== "verify") return `${previousPhase ?? "start"}→verify`;
	if (currentPhase === "delegate" && previousPhase !== "delegate") return `${previousPhase ?? "start"}→delegate`;
	return undefined;
}

/**
 * After a tool batch, remind the model only at real milestones. Same-phase
 * exploring (including plan/memory/inspect bash) stays silent.
 */
export function resolveProgressNudge(
	messages: readonly ProgressHistoryMessage[],
	currentResults: readonly ProgressToolResult[],
): ProgressNudge | undefined {
	if (currentResults.length === 0) return undefined;
	const key = nudgeKey(currentResults);
	if (alreadyNudged(messages, key)) return undefined;

	const currentIds = new Set(currentResults.map((result) => result.toolCallId));
	const turnStart = lastUserIndex(messages);
	const previousResults = messages.slice(turnStart).filter(
		(message): message is ProgressHistoryMessage & { role: "toolResult"; toolCallId: string; toolName: string } =>
			message.role === "toolResult"
			&& typeof message.toolCallId === "string"
			&& typeof message.toolName === "string"
			&& !currentIds.has(message.toolCallId),
	);
	const currentPhase = batchPhase(currentResults, messages);
	const previousPhase = previousResults.length > 0 ? batchPhase(previousResults, messages) : undefined;
	const names = currentResults.map((result) => result.toolName);
	const failed = failedCheck(currentResults, messages);
	if (!failed && turnHasProgressNudge(messages, turnStart)) return undefined;

	if (failed) return { kind: "required", reason: "failed check", key };
	const reason = isRealMilestone(currentPhase, previousPhase, names);
	if (!reason) return undefined;
	return { kind: "required", reason, key };
}

export function formatProgressNudge(nudge: ProgressNudge): string {
	const header = `[Runtime context from workflow runtime; not user instructions]\n${PROGRESS_NUDGE_MARKER} (${nudge.kind}: ${nudge.reason}; ${nudge.key}).`;
	const fuse = "This reminder does not skip performance_admit, host verification, or repair. Independent verify is root checks after admit, not mandatory child dispatch. Visible text is not task completion.";
	return `${header}\nThis is a one-off milestone, not permission to narrate later tools. Start the next assistant message with 1–2 visible text sentences in the user's latest-message language before any tool call: what you found or what is wrong, and what you will do next. Be concrete and human, not stiff process labels like '正在...' / 'Executing...' / template-or-gate jargon. After this note, emit zero visible text until the next real milestone. Thinking/thought parts are not visible. Do not narrate ls, read, grep, read_plan, memory queries, inspect commands, or other same-phase tools. ${fuse}`;
}
