import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/metis-agent-core";
import type { AssistantMessage, Model } from "@earendil-works/metis-ai/compat";
import { getScopeDir, listAdaptations, writeAdaptation, getOutcomeLedger, updateOutcomeLedger } from "./store.ts";
import type { AdaptationKind, AdaptationScope } from "./types.ts";
import { validateArchitectureAdaptation } from "./architecture-schema.ts";
import { validateWorkflowAdaptation } from "./workflow-schema.ts";
import { getEffectiveWorkflow } from "./effective.ts";
import { getAgentDir } from "../../config.ts";

export interface LearningSignal {
	type: "correction" | "command_failure" | "pending_check";
	detail: string;
}

export interface LearnerState {
	date: string; // YYYY-MM-DD
	callsCount: number;
	writesCount: number;
	watermarkTimestamp: number;
	unnotifiedLearnedCount: number;
}

const CHINESE_CORRECTION_REGEX =
	/(不对|错了|不是这样|改成|不要用|别用|不要在|应该用|换成|每次都要|以后都要|记住|请改用|不要再|以后请|下次请)/;
const ENGLISH_CORRECTION_REGEX =
	/\b(that's wrong|not that|don't do|don't use|instead of|should use|stop doing|always do|remember to|you should|do not use|never use)\b/i;

const MAX_LEARNER_TOKENS = 6000;
const MAX_LEARNER_CHARS = MAX_LEARNER_TOKENS * 4; // ~24,000 characters
const MAX_DAILY_CALLS = 1;
const MAX_DAILY_WRITES = 3;

/** Get learner state for a given scope directory */
export function getLearnerState(scopeDir: string): LearnerState {
	const statePath = path.join(scopeDir, "learner-state.json");
	const today = new Date().toISOString().slice(0, 10);
	const defaultState: LearnerState = {
		date: today,
		callsCount: 0,
		writesCount: 0,
		watermarkTimestamp: 0,
		unnotifiedLearnedCount: 0,
	};

	if (!fs.existsSync(statePath)) {
		return defaultState;
	}

	try {
		const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as LearnerState;
		if (raw.date !== today) {
			return {
				date: today,
				callsCount: 0,
				writesCount: 0,
				watermarkTimestamp: raw.watermarkTimestamp ?? 0,
				unnotifiedLearnedCount: raw.unnotifiedLearnedCount ?? 0,
			};
		}
		return raw;
	} catch {
		return defaultState;
	}
}

/** Save learner state */
export function saveLearnerState(scopeDir: string, state: LearnerState): void {
	fs.mkdirSync(scopeDir, { recursive: true });
	const statePath = path.join(scopeDir, "learner-state.json");
	fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

/** Zero-token signal detector */
export function detectLearningSignals(options: {
	messages: AgentMessage[];
	pendingChecks?: string[];
	watermarkTimestamp?: number;
}): { hasSignal: boolean; signals: LearningSignal[] } {
	const signals: LearningSignal[] = [];
	const { messages, pendingChecks, watermarkTimestamp = 0 } = options;

	// 1. Pending checks signal
	if (pendingChecks && pendingChecks.length > 0) {
		for (const check of pendingChecks) {
			signals.push({
				type: "pending_check",
				detail: `Pending check requires attention: ${check}`,
			});
		}
	}

	// 2. User corrections & repeated command failures
	const failedCommands = new Map<string, number>();

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;

		// Check timestamp if available
		const msgTime = (msg as any).timestamp ?? 0;
		if (watermarkTimestamp > 0 && msgTime > 0 && msgTime <= watermarkTimestamp) {
			continue;
		}

		// User correction detection
		if (msg.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : "";
			if (CHINESE_CORRECTION_REGEX.test(text) || ENGLISH_CORRECTION_REGEX.test(text)) {
				// Only treat as correction if preceded by assistant response
				const hasAssistantBefore = messages.slice(0, i).some((m) => m.role === "assistant");
				if (hasAssistantBefore) {
					signals.push({
						type: "correction",
						detail: text.slice(0, 200),
					});
				}
			}
		}

		// Tool execution failure tracking
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			if (Array.isArray(assistantMsg.content)) {
				for (const part of assistantMsg.content) {
					if ((part.type === "toolCall" || (part as any).type === "tool_use") && (part as any).name === "bash") {
						const input = ((part as any).arguments ?? (part as any).args ?? (part as any).input) as Record<string, unknown> | undefined;
						const cmd = typeof input?.command === "string" ? input.command.trim() : "";
						const cmdBase = cmd.split(" ")[0] ?? cmd;

						// Check next message for tool error
						const nextMsg = messages[i + 1];
						if (nextMsg && nextMsg.role === "custom" && (nextMsg as any).isError) {
							failedCommands.set(cmdBase, (failedCommands.get(cmdBase) ?? 0) + 1);
						}
					}
				}
			}
		}
	}

	// Check if any failed command occurred twice or more
	for (const [cmd, count] of failedCommands.entries()) {
		if (count >= 2) {
			signals.push({
				type: "command_failure",
				detail: `Command '${cmd}' failed repeatedly (${count} times)`,
			});
		}
	}

	return {
		hasSignal: signals.length > 0,
		signals,
	};
}

/** Sanitize conversation messages into concise text strictly capped under 6000 tokens */
export function sanitizeConversationForLearner(messages: AgentMessage[], maxChars = MAX_LEARNER_CHARS): string {
	const sanitizedLines: string[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : "";
			sanitizedLines.push(`User: ${text.trim()}`);
		} else if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			if (typeof (assistantMsg as any).content === "string") {
				sanitizedLines.push(`Assistant: ${((assistantMsg as any).content as string).trim()}`);
			} else if (Array.isArray(assistantMsg.content)) {
				const textParts: string[] = [];
				for (const part of assistantMsg.content) {
					if (part.type === "text" && part.text) {
						textParts.push(part.text.trim());
					} else if (part.type === "toolCall" || (part as any).type === "tool_use") {
						textParts.push(`[Used tool: ${(part as any).name}]`);
					}
				}
				if (textParts.length > 0) {
					sanitizedLines.push(`Assistant: ${textParts.join(" ")}`);
				}
			}
		}
	}

	let result = sanitizedLines.join("\n\n");
	if (result.length > maxChars) {
		// Truncate keeping the most recent part of the conversation
		result = `...[earlier context truncated]...\n` + result.slice(result.length - maxChars + 100);
	}
	return result;
}

export interface ProposedLearnerAdaptation {
	scope: AdaptationScope;
	kind: AdaptationKind;
	name?: string;
	content: string;
	reason: string;
}

export interface RunIdleLearnerOptions {
	agentDir: string;
	cwd: string;
	scope: AdaptationScope;
	model?: Model<any>;
	messages: AgentMessage[];
	pendingChecks?: string[];
	mode?: string; // "tui" | "desktop" | "server" | "print" | "json"
	isProjectTrusted?: boolean;
	onAdaptationApplied?: () => Promise<void> | void;
}

export interface IdleLearnerResult {
	ran: boolean;
	reason?: string;
	signals?: LearningSignal[];
	appliedCount?: number;
}

/**
 * Execute idle learning pass on an interactive session if signals are present.
 */
export async function runIdleLearner(options: RunIdleLearnerOptions): Promise<IdleLearnerResult> {
	const {
		agentDir,
		cwd,
		scope,
		model,
		messages,
		pendingChecks,
		mode = "tui",
		isProjectTrusted = true,
		onAdaptationApplied,
	} = options;

	// 1. Mode isolation check: skip non-interactive modes
	if (mode === "print" || mode === "json") {
		return { ran: false, reason: "skipped_non_interactive_mode" };
	}

	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const state = getLearnerState(scopeDir);

	// 2. Zero-token signal detection
	const { hasSignal, signals } = detectLearningSignals({
		messages,
		pendingChecks,
		watermarkTimestamp: state.watermarkTimestamp,
	});

	if (!hasSignal) {
		return { ran: false, reason: "no_signals" };
	}

	// 3. Quota check: max 1 model call per scope per day
	if (state.callsCount >= MAX_DAILY_CALLS) {
		return { ran: false, reason: "daily_model_call_quota_exceeded", signals };
	}

	if (!model) {
		return { ran: false, reason: "no_model_available", signals };
	}

	// 4. Input sanitization under 6000 tokens
	const conversationText = sanitizeConversationForLearner(messages);
	const currentWorkflow = getEffectiveWorkflow({ cwd, agentDir, isProjectTrusted });

	const systemPrompt = `You are the Metis Idle Self-Learning Synthesizer.
Analyze the user's feedback, corrections, and tool failure signals from the session to synthesize persistent adaptations.

STRICT CONSTRAINTS:
1. You may ONLY output data-only adaptations: "profile", "skill", "architecture", "workflow", or "proposal".
2. You are STRICTLY FORBIDDEN from generating "tool" or "hook" adaptations. Any executable code adaptations will be rejected.
3. You must NEVER delete or disable existing verification checks. You may only add new extraChecks or update conditions.
4. Output must be a valid JSON array of objects with the following schema:
[
  {
    "scope": "${scope}",
    "kind": "profile" | "skill" | "architecture" | "workflow" | "proposal",
    "name": "string (required for skill/proposal, e.g. 'browser-verify')",
    "content": "string (file content. For architecture/workflow, this MUST be valid JSON string)",
    "reason": "concise explanation of why this adaptation was learned"
  }
]
If no adaptation is needed, return [].`;

	const userPrompt = `Learning Signals:
${JSON.stringify(signals, null, 2)}

Current Workflow extraChecks:
${JSON.stringify(currentWorkflow?.extraChecks ?? [], null, 2)}

Sanitized Conversation:
${conversationText}

Produce appropriate adaptations:`;

	// Record model call
	state.callsCount += 1;
	saveLearnerState(scopeDir, state);

	let responseText = "";
	try {
		// Call model complete/generate
		if (typeof (model as any).complete === "function") {
			const res = await (model as any).complete({
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
			});
			responseText = typeof res === "string" ? res : res.content ?? res.text ?? "";
		} else {
			return { ran: false, reason: "model_completion_unsupported", signals };
		}
	} catch (err) {
		return { ran: false, reason: `model_call_failed: ${String(err)}`, signals };
	}

	// 5. Parse and filter output
	let proposals: ProposedLearnerAdaptation[] = [];
	try {
		// Clean markdown fences if any
		let cleaned = responseText.trim();
		if (cleaned.startsWith("```json")) {
			cleaned = cleaned.slice(7);
		} else if (cleaned.startsWith("```")) {
			cleaned = cleaned.slice(3);
		}
		if (cleaned.endsWith("```")) {
			cleaned = cleaned.slice(0, cleaned.length - 3);
		}
		proposals = JSON.parse(cleaned.trim());
		if (!Array.isArray(proposals)) {
			proposals = [];
		}
	} catch {
		return { ran: true, appliedCount: 0, reason: "invalid_model_json_output", signals };
	}

	let applied = 0;
	for (const item of proposals) {
		// STRICT FILTER: Disallow code products (tool, hook)
		if (item.kind === "tool" || item.kind === "hook") {
			continue;
		}

		// Check write quota: max 3 writes per day
		if (state.writesCount >= MAX_DAILY_WRITES) {
			break;
		}

		try {
			// Validate content schema
			if (item.kind === "architecture") {
				const parsed = JSON.parse(item.content);
				validateArchitectureAdaptation(parsed);
			} else if (item.kind === "workflow") {
				const parsed = JSON.parse(item.content);
				validateWorkflowAdaptation(parsed);
				// Guard: cannot delete existing extraChecks
				const existingChecks = currentWorkflow?.extraChecks ?? [];
				const newChecks = parsed.extraChecks ?? [];
				const existingIds = new Set(existingChecks.map((c) => c.id));
				for (const checkId of existingIds) {
					if (!newChecks.some((c: any) => c.id === checkId)) {
						// Missing an existing check! Preserve it
						const missing = existingChecks.find((c) => c.id === checkId);
						if (missing) newChecks.push(missing);
					}
				}
				parsed.extraChecks = newChecks;
				item.content = JSON.stringify(parsed, null, 2);
			}

			await writeAdaptation({
				agentDir,
				cwd,
				scope: item.scope ?? scope,
				kind: item.kind,
				name: item.name,
				content: item.content,
				reason: item.reason,
				projectTrusted: isProjectTrusted,
			});

			state.writesCount += 1;
			state.unnotifiedLearnedCount += 1;
			applied += 1;
		} catch {
			// Ignore failed write for one item
		}
	}

	// Update watermark
	state.watermarkTimestamp = Date.now();
	saveLearnerState(scopeDir, state);

	if (applied > 0 && onAdaptationApplied) {
		await onAdaptationApplied();
	}

	return {
		ran: true,
		appliedCount: applied,
		signals,
	};
}

export interface ScheduleIdleLearningSession {
	isSelfLearningActive: () => boolean;
	isPersistent?: () => boolean;
	sessionManager: {
		isPersistent: () => boolean;
		getCwd: () => string;
		getSessionFile?: () => string | undefined;
	};
	sessionFile?: string | undefined;
	agent: {
		state: {
			messages: AgentMessage[];
		};
	};
	model?: Model<any>;
	agentDir?: string;
	settingsManager?: {
		isProjectTrusted: () => boolean;
	};
	refreshAdaptations?: (event?: { action?: string; kind?: string; name?: string; scope?: string }) => Promise<void>;
}

export interface ScheduleIdleLearningOptions {
	session: ScheduleIdleLearningSession;
	mode?: string;
}

/**
 * Schedule idle learning pass on interactive session startup.
 * Does not await and catches errors so startup is never blocked.
 * Bails out early if self-learning is inactive, mode is print/json, or session is non-persistent.
 */
export function scheduleIdleLearning(
	options: ScheduleIdleLearningOptions,
): Promise<IdleLearnerResult | undefined> | undefined {
	const { session, mode = "tui" } = options;

	if (mode === "print" || mode === "json") {
		return undefined;
	}

	if (!session.isSelfLearningActive?.()) {
		return undefined;
	}

	const isPersistent = typeof session.isPersistent === "function"
		? session.isPersistent()
		: (session.sessionManager?.isPersistent?.() && Boolean(session.sessionFile ?? session.sessionManager?.getSessionFile?.()));
	if (!isPersistent) {
		return undefined;
	}

	const agentDir = session.agentDir ?? getAgentDir();
	const cwd = session.sessionManager.getCwd();
	const isProjectTrusted = session.settingsManager?.isProjectTrusted?.() ?? true;
	const scope: AdaptationScope = isProjectTrusted ? "project" : "user";

	const promise = runIdleLearner({
		agentDir,
		cwd,
		scope,
		model: session.model,
		messages: session.agent.state.messages,
		mode,
		isProjectTrusted,
		onAdaptationApplied: async () => {
			await session.refreshAdaptations?.({ action: "learned", kind: "adaptation" });
		},
	}).catch((err) => {
		console.error("Failed to run idle learner:", err);
		return undefined;
	});

	return promise;
}

