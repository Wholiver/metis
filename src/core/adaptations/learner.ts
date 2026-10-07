import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/metis-agent-core";
import { completeSimple, type AssistantMessage, type Model } from "@earendil-works/metis-ai/compat";
import { sessionNameTextFromAssistantContent } from "../session-name-generator.ts";
import {
	getScopeDir,
	listAdaptations,
	writeAdaptation,
	getOutcomeLedger,
	updateOutcomeLedger,
	normalizeSkillName,
	extractExecutableCommands,
	hasCommandOverlap,
	getLearnedSkillsSummary,
	areStatementsSimilar,
} from "./store.ts";
import { type AdaptationKind, type AdaptationScope, DEFAULT_MAX_LEARNED_SKILLS } from "./types.ts";
import { validateArchitectureAdaptation, type ArchitectureAdaptation } from "./architecture-schema.ts";
import { validateWorkflowAdaptation } from "./workflow-schema.ts";
import { getEffectiveArchitecture, getEffectiveWorkflow, getEffectiveUserProfileData, applyTraitDecay } from "./effective.ts";
import { assertMainWorkflowInvariance } from "./validate.ts";
import { readTurnOutcomes, generateDailyGrowthReport } from "./ledger.ts";
import { extractUserPreferenceSignals } from "./preference-engine.ts";
import { runOnlineFastLearner } from "./fast-learner.ts";
import { getAgentDir } from "../../config.ts";

export interface LearningProgressEvent {
	type: "learning_progress";
	runId: string;
	trigger: "turn" | "idle";
	phase: "observe" | "review" | "guard" | "write" | "evaluate";
	step: number;
	total: number;
	status: "running" | "completed" | "skipped" | "failed";
	summary?: string;
}

export interface LearningSignal {
	type:
		| "correction"
		| "command_failure"
		| "pending_check"
		| "rigor_followup"
		| "autonomy_urge"
		| "interruption"
		| "positive_progression"
		| "repeated_misunderstanding"
		| "explicit_user_preference"
		| "user_file_edit"
		| "communication_style";
	detail: string;
}

export interface LearnerState {
	date: string; // YYYY-MM-DD
	callsCount: number;
	turnCallsCount?: number;
	idleCallsCount?: number;
	writesCount: number;
	watermarkTimestamp: number;
	unnotifiedLearnedCount: number;
}

export const DEFAULT_DAILY_CALL_BUDGET = Infinity;
export const MAX_TURN_CALLS_PER_DAY = Infinity;
export const MAX_IDLE_CALLS_PER_DAY = Infinity;
export const MAX_DAILY_WRITES = Infinity;
const MAX_LEARNER_TOKENS = 6000;
const MAX_LEARNER_CHARS = MAX_LEARNER_TOKENS * 4; // ~24,000 characters
const MAX_LEARNER_OUTPUT_TOKENS = 2048;
const MAX_PREVIOUS_SESSION_BYTES = 1_500_000;

type LearnerModelRegistry = {
	getApiKeyAndHeaders(model: Model<any>): Promise<{
		ok: boolean;
		apiKey?: string;
		headers?: Record<string, string>;
		env?: Record<string, string>;
		error?: string;
	}>;
};

/** User and assistant text, whether stored as a string or as content parts. */
export function messagePlainText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			Boolean(part) && (part as { type?: string }).type === "text" && typeof (part as { text?: unknown }).text === "string")
		.map((part) => part.text)
		.join(" ");
}

function bashCommandBase(input: unknown): string {
	const command = (input as { command?: unknown } | undefined)?.command;
	if (typeof command !== "string") return "";
	const trimmed = command.trim();
	return trimmed.split(/\s+/)[0] ?? trimmed;
}

function collectBashCalls(messages: AgentMessage[]): Map<string, string> {
	const calls = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			const record = part as { type?: string; name?: string; id?: string; arguments?: unknown; args?: unknown; input?: unknown };
			if (record.type !== "toolCall" && record.type !== "tool_use") continue;
			if (record.name !== "bash" || !record.id) continue;
			const base = bashCommandBase(record.arguments ?? record.args ?? record.input);
			if (base) calls.set(record.id, base);
		}
	}
	return calls;
}

function readSessionMessageFile(filePath: string): AgentMessage[] {
	let raw = "";
	try {
		const stat = fs.statSync(filePath);
		if (stat.size > MAX_PREVIOUS_SESSION_BYTES) {
			const fd = fs.openSync(filePath, "r");
			try {
				const length = MAX_PREVIOUS_SESSION_BYTES;
				const buffer = Buffer.alloc(length);
				fs.readSync(fd, buffer, 0, length, stat.size - length);
				raw = buffer.toString("utf8");
				const newline = raw.indexOf("\n");
				if (newline !== -1) raw = raw.slice(newline + 1);
			} finally {
				fs.closeSync(fd);
			}
		} else {
			raw = fs.readFileSync(filePath, "utf8");
		}
	} catch {
		return [];
	}

	const messages: AgentMessage[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as { type?: string; message?: AgentMessage };
			if (entry.type === "message" && entry.message) messages.push(entry.message);
		} catch {
			// Skip malformed session lines.
		}
	}
	return messages;
}

export type LearnerSessionIndex = Record<string, number>;

export function getLearnerSessionIndex(agentDir = getAgentDir()): LearnerSessionIndex {
	const indexFile = path.join(agentDir, "cache", "learner-sessions-v1.json");
	if (!fs.existsSync(indexFile)) return {};
	try {
		return JSON.parse(fs.readFileSync(indexFile, "utf8")) as LearnerSessionIndex;
	} catch {
		return {};
	}
}

export function saveLearnerSessionIndex(agentDir: string, index: LearnerSessionIndex): void {
	const cacheDir = path.join(agentDir, "cache");
	fs.mkdirSync(cacheDir, { recursive: true });
	const indexFile = path.join(cacheDir, "learner-sessions-v1.json");
	fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), "utf8");
}

export function isSessionAlreadyLearned(agentDir: string, sessionFilePath: string, currentMtimeMs: number): boolean {
	const index = getLearnerSessionIndex(agentDir);
	const resolved = path.resolve(sessionFilePath);
	const lastMtime = index[resolved];
	if (typeof lastMtime === "number" && currentMtimeMs <= lastMtime) {
		return true;
	}
	return false;
}

export function markSessionLearned(agentDir = getAgentDir(), sessionFilePath: string, currentMtimeMs?: number): void {
	const resolved = path.resolve(sessionFilePath);
	let mtime = currentMtimeMs;
	if (typeof mtime !== "number") {
		try {
			mtime = fs.statSync(resolved).mtimeMs;
		} catch {
			mtime = Date.now();
		}
	}
	const index = getLearnerSessionIndex(agentDir);
	index[resolved] = mtime;
	saveLearnerSessionIndex(agentDir, index);
}

/**
 * Find the newest sibling session file that has unlearned content or changes.
 * Sessions that have already been learned and have not been modified since are skipped.
 */
export function findPreviousUnlearnedSession(
	sessionFile: string | undefined,
	watermarkTimestamp = 0,
	agentDir = getAgentDir(),
): { file: string; messages: AgentMessage[] } | undefined {
	if (!sessionFile) return undefined;
	const dir = path.dirname(sessionFile);
	if (!fs.existsSync(dir)) return undefined;
	const current = path.resolve(sessionFile);

	let best: { file: string; mtime: number } | undefined;
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith(".jsonl")) continue;
		const file = path.resolve(dir, name);
		if (file === current) continue;
		let mtime = 0;
		try {
			mtime = fs.statSync(file).mtimeMs;
		} catch {
			continue;
		}
		if (watermarkTimestamp > 0 && mtime <= watermarkTimestamp) continue;
		if (isSessionAlreadyLearned(agentDir, file, mtime)) continue;
		if (!best || mtime > best.mtime) best = { file, mtime };
	}
	if (!best) return undefined;
	return { file: best.file, messages: readSessionMessageFile(best.file) };
}

/** Newest sibling session file, used when the live session has not loaded user text yet. */
export function readPreviousSessionMessages(
	sessionFile: string | undefined,
	watermarkTimestamp = 0,
	agentDir = getAgentDir(),
): AgentMessage[] {
	return findPreviousUnlearnedSession(sessionFile, watermarkTimestamp, agentDir)?.messages ?? [];
}

const CHINESE_CORRECTION_REGEX =
	/(不对|错了|不是这样|改成|不要用|别用|不要在|应该用|换成|每次都要|以后都要|记住|请改用|不要再|以后请|下次请)/;
const ENGLISH_CORRECTION_REGEX =
	/\b(that's wrong|not that|don't do|don't use|instead of|should use|stop doing|always do|remember to|you should|do not use|never use)\b/i;
const RIGOR_FOLLOWUP_REGEX =
	/(?:深度|再次|重新|仔细|继续)?(?:核查|核对|验收|检查|测试|验证|确认)|(?:double[- ]?check|re-?verify|re-?test|acceptance|audit|verify again|check again)/i;
const AUTONOMY_URGE_REGEX =
	/(?:继续(?:啊|呀|推进)?|别停|快点|自主|你多等等|直接搞|赶紧|go on|continue|proceed|keep going|don't stop|hurry)/i;
const INTERRUPTION_REGEX =
	/(?:停|别做了|打住|取消|stop|cancel|abort)/i;
const POSITIVE_PROGRESSION_REGEX =
	/(?:(?:下一个|继续做|接下来|下一步|next (?:task|step|topic)|now let's|now please|now do))/i;
const REPEATED_MISUNDERSTANDING_REGEX =
	/(?:我说的是|还是那个|不是.*是|as I said|I already mentioned|repeat)/i;
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;
const TABLE_FORMAT_REGEX = /(?:表格|\btables?\b)/i;
const BULLET_FORMAT_REGEX = /(?:简短|要点|\bbullets?\b)/i;

/** Get learner state for a given scope directory */
export function getLearnerState(scopeDir: string): LearnerState {
	const statePath = path.join(scopeDir, "learner-state.json");
	const today = new Date().toISOString().slice(0, 10);
	const defaultState: LearnerState = {
		date: today,
		callsCount: 0,
		turnCallsCount: 0,
		idleCallsCount: 0,
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
				turnCallsCount: 0,
				idleCallsCount: 0,
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
	modifiedFiles?: string[];
}): { hasSignal: boolean; signals: LearningSignal[] } {
	const signals: LearningSignal[] = [];
	const { messages, pendingChecks, watermarkTimestamp = 0, modifiedFiles } = options;

	// 1. Pending checks signal
	if (pendingChecks && pendingChecks.length > 0) {
		for (const check of pendingChecks) {
			signals.push({
				type: "pending_check",
				detail: `Pending check requires attention: ${check}`,
			});
		}
	}

	// 2. User file edit signal
	if (modifiedFiles && modifiedFiles.length > 0) {
		signals.push({
			type: "user_file_edit",
			detail: `User modified file(s) previously written by agent: ${modifiedFiles.join(", ")}`,
		});
	}

	// 2. Scan conversation messages for explicit and implicit signals
	const failedCommands = new Map<string, number>();
	const userTexts: string[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;

		const msgTime = (msg as any).timestamp ?? 0;
		if (watermarkTimestamp > 0 && msgTime > 0 && msgTime <= watermarkTimestamp) {
			continue;
		}

		if (msg.role === "user") {
			const text = messagePlainText(msg);
			userTexts.push(text);
			const hasAssistantBefore = messages.slice(0, i).some((m) => m.role === "assistant");

			if (CHINESE_CORRECTION_REGEX.test(text) || ENGLISH_CORRECTION_REGEX.test(text)) {
				if (hasAssistantBefore) {
					signals.push({
						type: "correction",
						detail: text.slice(0, 200),
					});
				}
			} else if (hasAssistantBefore && RIGOR_FOLLOWUP_REGEX.test(text)) {
				signals.push({
					type: "rigor_followup",
					detail: text.slice(0, 200),
				});
			} else if (hasAssistantBefore && AUTONOMY_URGE_REGEX.test(text)) {
				signals.push({
					type: "autonomy_urge",
					detail: text.slice(0, 200),
				});
			} else if (hasAssistantBefore && REPEATED_MISUNDERSTANDING_REGEX.test(text)) {
				signals.push({
					type: "repeated_misunderstanding",
					detail: text.slice(0, 200),
				});
			} else if (hasAssistantBefore && POSITIVE_PROGRESSION_REGEX.test(text)) {
				signals.push({
					type: "positive_progression",
					detail: text.slice(0, 200),
				});
			} else if (INTERRUPTION_REGEX.test(text)) {
				signals.push({
					type: "interruption",
					detail: text.slice(0, 200),
				});
			}
		} else if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			if ((assistantMsg as any).stopReason === "aborted") {
				signals.push({
					type: "interruption",
					detail: "Turn execution was aborted.",
				});
			}
		}
	}

	// Communication style signals (zero-token, at most one per category per call)
	if (userTexts.length >= 2) {
		const cjkCount = userTexts.filter((t) => CJK_REGEX.test(t)).length;
		if (cjkCount > userTexts.length / 2) {
			signals.push({
				type: "communication_style",
				detail: "用户主要使用中文",
			});
		}
	}

	let recordedFormatStyle = false;
	for (const text of userTexts) {
		if (recordedFormatStyle) break;
		const wantsTable = TABLE_FORMAT_REGEX.test(text);
		const wantsBullet = BULLET_FORMAT_REGEX.test(text);
		if (wantsTable && wantsBullet) {
			signals.push({
				type: "communication_style",
				detail: "用户偏好表格与简短要点呈现",
			});
			recordedFormatStyle = true;
		} else if (wantsTable) {
			signals.push({
				type: "communication_style",
				detail: "用户偏好表格呈现",
			});
			recordedFormatStyle = true;
		} else if (wantsBullet) {
			signals.push({
				type: "communication_style",
				detail: "用户偏好简短要点呈现",
			});
			recordedFormatStyle = true;
		}
	}

	const bashCalls = collectBashCalls(messages);
	for (const result of messages) {
		if (result.role !== "toolResult") continue;
		const resultTime = (result as { timestamp?: number }).timestamp ?? 0;
		if (watermarkTimestamp > 0 && resultTime > 0 && resultTime <= watermarkTimestamp) continue;
		const toolCallId = (result as { toolCallId?: string }).toolCallId;
		const toolName = (result as { toolName?: string }).toolName;

		if (toolName === "ask_user") {
			signals.push({
				type: "explicit_user_preference",
				detail: `ask_user answered: ${messagePlainText(result).slice(0, 200)}`,
			});
		}

		if ((result as { isError?: boolean }).isError) {
			const cmdBase = toolCallId ? bashCalls.get(toolCallId) : undefined;
			if (!cmdBase && toolName !== "bash") continue;
			const key = cmdBase || "bash";
			failedCommands.set(key, (failedCommands.get(key) ?? 0) + 1);
		}
	}

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

export function isTurnImportant(options: {
	messages: AgentMessage[];
	toolCallsCount?: number;
	hadRecovery?: boolean;
}): boolean {
	const { messages, toolCallsCount = 0, hadRecovery = false } = options;
	if (extractUserPreferenceSignals(messages).length > 0) return true;
	if (toolCallsCount >= 8) return true;
	if (hadRecovery) return true;

	for (const msg of messages) {
		if (msg.role === "user") {
			const text = messagePlainText(msg);
			if (
				CHINESE_CORRECTION_REGEX.test(text) ||
				ENGLISH_CORRECTION_REGEX.test(text) ||
				RIGOR_FOLLOWUP_REGEX.test(text) ||
				REPEATED_MISUNDERSTANDING_REGEX.test(text)
			) {
				return true;
			}
		}
		if (msg.role === "toolResult" && (msg as { toolName?: string }).toolName === "ask_user") {
			return true;
		}
	}
	return false;
}

/** Build rich summary of existing adaptations including key commands, profile traits, and custom guidelines */
export function buildActiveAdaptationsSummary(adaptations: ReturnType<typeof listAdaptations>): Record<string, unknown>[] {
	return adaptations.map((a) => {
		const item: Record<string, unknown> = {
			kind: a.kind,
			name: a.name,
			description: a.description,
			revision: a.revision,
		};
		if (a.filePath && fs.existsSync(a.filePath)) {
			try {
				if (a.kind === "skill") {
					const cmds = extractExecutableCommands(fs.readFileSync(a.filePath, "utf8"));
					if (cmds.length > 0) item.keyCommands = cmds;
				} else if (a.kind === "profile" && a.filePath.endsWith(".json")) {
					const profileJson = JSON.parse(fs.readFileSync(a.filePath, "utf8"));
					if (Array.isArray(profileJson.traits)) {
						item.traits = profileJson.traits
							.filter((t: any) => t.status !== "retired")
							.map((t: any) => ({
								dimension: t.dimension,
								statement: t.statement,
								confidence: t.confidence,
							}));
					}
					if (Array.isArray(profileJson.followUpPredictions) && profileJson.followUpPredictions.length > 0) {
						item.followUpPredictions = profileJson.followUpPredictions.map((p: any) => ({
							trigger: p.triggerPattern,
							prediction: p.prediction,
							confidence: p.confidence,
						}));
					}
				} else if (a.kind === "architecture") {
					const archJson = JSON.parse(fs.readFileSync(a.filePath, "utf8"));
					if (Array.isArray(archJson.customGuidelines) && archJson.customGuidelines.length > 0) {
						item.customGuidelines = archJson.customGuidelines.map((g: any) => {
							if (typeof g === "string") return { text: g };
							return { id: g.id, text: g.text, trigger: g.trigger };
						});
					}
					if (Array.isArray(archJson.hiddenTools) && archJson.hiddenTools.length > 0) {
						item.hiddenTools = archJson.hiddenTools;
					}
					if (Array.isArray(archJson.preferredTools) && archJson.preferredTools.length > 0) {
						item.preferredTools = archJson.preferredTools;
					}
				} else if (a.kind === "proposal") {
					const propJson = JSON.parse(fs.readFileSync(a.filePath, "utf8"));
					item.details = {
						command: propJson.command,
						extraChecks: Array.isArray(propJson.extraChecks) ? propJson.extraChecks.map((c: any) => c.name || c.id) : undefined,
					};
				}
			} catch {}
		}
		return item;
	});
}

/** Sanitize conversation messages into concise text strictly capped under 6000 tokens */
export function sanitizeConversationForLearner(messages: AgentMessage[], maxChars = MAX_LEARNER_CHARS): string {
	const sanitizedLines: string[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			sanitizedLines.push(`User: ${messagePlainText(msg).trim()}`);
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
	replaces?: string;
	content: string;
	reason: string;
}

function resolveLearnerCompletion(options: {
	model?: Model<any>;
	modelRegistry?: LearnerModelRegistry;
	learnerModel?: string;
	completeText?: (input: { systemPrompt: string; userPrompt: string }) => Promise<string>;
	systemPrompt: string;
	userPrompt: string;
}): (() => Promise<string>) | undefined {
	const { model, modelRegistry, learnerModel, completeText, systemPrompt, userPrompt } = options;
	if (completeText) {
		return () => completeText({ systemPrompt, userPrompt });
	}
	let effectiveModel = model;
	if (learnerModel && modelRegistry && typeof (modelRegistry as any).find === "function") {
		const parts = learnerModel.split("/");
		const found = parts.length === 2
			? (modelRegistry as any).find(parts[0], parts[1])
			: (modelRegistry as any).find(model?.provider ?? "", learnerModel);
		if (found) {
			effectiveModel = found;
		}
	}
	const legacyComplete = (effectiveModel as { complete?: (input: unknown) => Promise<unknown> } | undefined)?.complete;
	if (typeof legacyComplete === "function") {
		return async () => {
			const res = await legacyComplete({
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
			});
			if (typeof res === "string") return res;
			const record = res as { content?: unknown; text?: unknown } | null;
			if (typeof record?.content === "string") return record.content;
			if (typeof record?.text === "string") return record.text;
			if (Array.isArray(record?.content)) return sessionNameTextFromAssistantContent(record.content as Array<{ type: string; text?: string; thinking?: string }>);
			return "";
		};
	}
	if (effectiveModel && modelRegistry) {
		return () => completeLearnerPrompt({ model: effectiveModel, modelRegistry, systemPrompt, userPrompt });
	}
	return undefined;
}

async function completeLearnerPrompt(options: {
	model: Model<any>;
	modelRegistry: LearnerModelRegistry;
	systemPrompt: string;
	userPrompt: string;
}): Promise<string> {
	const auth = await options.modelRegistry.getApiKeyAndHeaders(options.model);
	if (!auth.ok) throw new Error(auth.error || "Idle learner has no model credentials");
	const response = await completeSimple(
		options.model,
		{
			systemPrompt: options.systemPrompt,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: options.userPrompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			maxTokens: MAX_LEARNER_OUTPUT_TOKENS,
		},
	);
	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(response.errorMessage || "Idle learner model call failed");
	}
	return sessionNameTextFromAssistantContent(response.content);
}

export interface RunIdleLearnerOptions {
	agentDir: string;
	cwd: string;
	scope: AdaptationScope;
	model?: Model<any>;
	modelRegistry?: LearnerModelRegistry;
	learnerModel?: string;
	/** Test seam. Production uses model.complete when present, otherwise completeSimple. */
	completeText?: (input: { systemPrompt: string; userPrompt: string }) => Promise<string>;
	messages: AgentMessage[];
	pendingChecks?: string[];
	mode?: string; // "tui" | "desktop" | "server" | "print" | "json"
	isProjectTrusted?: boolean;
	dailyCallBudget?: number;
	maxLearnedSkills?: number;
	onAdaptationApplied?: () => Promise<void> | void;
	onProgress?: (event: LearningProgressEvent) => void;
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
		modelRegistry,
		learnerModel,
		completeText,
		messages,
		pendingChecks,
		mode = "tui",
		isProjectTrusted = true,
		dailyCallBudget = DEFAULT_DAILY_CALL_BUDGET,
		onAdaptationApplied,
		onProgress,
	} = options;

	const runId = Math.random().toString(36).slice(2, 10);

	// 1. Mode isolation check: skip non-interactive modes
	if (mode === "print" || mode === "json") {
		return { ran: false, reason: "skipped_non_interactive_mode" };
	}

	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const state = getLearnerState(scopeDir);

	// Phase 1: observe
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "idle",
		phase: "observe",
		step: 1,
		total: 5,
		status: "running",
		summary: "Observing signals",
	});

	// 2. Zero-token maintenance: decay traits in profile.json
	try {
		const profileData = getEffectiveUserProfileData({ agentDir, cwd, isProjectTrusted });
		if (profileData && profileData.traits.length > 0) {
			const decayedTraits = applyTraitDecay(profileData.traits);
			const changed = decayedTraits.some((t, i) => t.confidence !== profileData.traits[i]?.confidence || t.status !== profileData.traits[i]?.status);
			if (changed) {
				const updatedProfile = {
					...profileData,
					traits: decayedTraits.filter((t) => t.status !== "retired" || (Date.now() - new Date(t.lastConfirmed).getTime() < 60 * 24 * 60 * 60 * 1000)),
					updatedAt: new Date().toISOString(),
				};
				await writeAdaptation({
					agentDir,
					cwd,
					scope,
					kind: "profile",
					content: JSON.stringify(updatedProfile, null, 2),
					reason: "Zero-token maintenance: applied trait decay",
					actor: "learner",
					projectTrusted: isProjectTrusted,
				});
			}
		}
	} catch {}

	// 3. Zero-token signal detection
	const { hasSignal, signals } = detectLearningSignals({
		messages,
		pendingChecks,
		watermarkTimestamp: state.watermarkTimestamp,
	});

	// Check outcomes for skill distillation or tool proposals
	const recentOutcomes = readTurnOutcomes(scopeDir, 50);
	const intentCounts = new Map<string, number>();
	for (const o of recentOutcomes) {
		if (o.intentTag && (o.implicitFeedbackScore ?? 0) >= 0) {
			intentCounts.set(o.intentTag, (intentCounts.get(o.intentTag) ?? 0) + 1);
		}
	}

	// 4. Quota check: only enforce when a finite dailyCallBudget is explicitly configured
	const idleCalls = state.idleCallsCount ?? 0;
	if (Number.isFinite(dailyCallBudget) && dailyCallBudget > 0) {
		const maxIdleCalls = Number.isFinite(MAX_IDLE_CALLS_PER_DAY) ? Math.min(MAX_IDLE_CALLS_PER_DAY, dailyCallBudget) : dailyCallBudget;
		if (state.callsCount >= dailyCallBudget || (Number.isFinite(maxIdleCalls) && idleCalls >= maxIdleCalls)) {
			onProgress?.({
				type: "learning_progress",
				runId,
				trigger: "idle",
				phase: "observe",
				step: 1,
				total: 5,
				status: "skipped",
				summary: "Daily model call quota reached",
			});
			return { ran: false, reason: "daily_model_call_quota_exceeded", signals };
		}
	}

	if (!hasSignal && intentCounts.size === 0) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "idle",
			phase: "observe",
			step: 1,
			total: 5,
			status: "skipped",
			summary: "No learning signals",
		});
		return { ran: false, reason: "no_signals" };
	}

	if (!model && !completeText) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "idle",
			phase: "observe",
			step: 1,
			total: 5,
			status: "skipped",
			summary: "No model available",
		});
		return { ran: false, reason: "no_model_available", signals };
	}

	// Phase 2: review
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "idle",
		phase: "review",
		step: 2,
		total: 5,
		status: "running",
		summary: Number.isFinite(MAX_IDLE_CALLS_PER_DAY)
			? `Synthesizing idle adaptations (${idleCalls + 1}/${MAX_IDLE_CALLS_PER_DAY})`
			: `Synthesizing idle adaptations (${idleCalls + 1})`,
	});

	const conversationText = sanitizeConversationForLearner(messages);
	const currentWorkflow = getEffectiveWorkflow({ cwd, agentDir, isProjectTrusted });
	const ledger = getOutcomeLedger(scopeDir);

	// Check if any adaptations have recurring corrections and need rewriting
	const rewriteNotice = ledger.perAdaptationStats
		? Object.entries(ledger.perAdaptationStats)
				.filter(([_, stats]) => (stats.recurredCorrections ?? 0) >= 2)
				.map(([id]) => id)
		: [];

	const existingSkills = getLearnedSkillsSummary(scopeDir, scope);
	const currentSkillCount = existingSkills.length;
	const maxLearnedSkills = options.maxLearnedSkills ?? DEFAULT_MAX_LEARNED_SKILLS;

	const existingAdaptations = listAdaptations(agentDir, cwd, { projectTrusted: isProjectTrusted });
	const activeAdaptationsSummary = buildActiveAdaptationsSummary(existingAdaptations);

	const systemPrompt = `You are the Metis Idle Self-Learning Synthesizer.
Analyze feedback, corrections, and tool failure signals to synthesize persistent adaptations.

STRICT CONSTRAINTS:
1. You may ONLY output data-only adaptations: "profile", "skill", "architecture", or "proposal".
2. You are STRICTLY FORBIDDEN from generating "tool", "hook", or "workflow" adaptations.
3. You must NEVER include control plane tools (performance_admit, performance_gate, update_plan, read_plan, spawn_agent, ask_user, adapt), gate numbers (G0-G7), receipts, or intent to bypass verification.
4. If recurring corrections exist for an adaptation, rewrite that adaptation rather than adding duplicate rules.
5. Never create a second skill/role/proposal that does the same job under a new name. If a similar adaptation already exists, output an update using the existing name only.
6. CHECK EXISTING ADAPTATIONS FIRST: Inspect the "Existing Active Adaptations" list provided in the user prompt.
7. UPDATE IN-PLACE: If a new learning signal or improvement relates to a task or command covered by an existing adaptation, you MUST update that existing adaptation using its EXACT name. NEVER create a new skill or guideline with a similar or variant name.
8. OPERATIONAL COMMANDS MUST BE SKILLS: Concrete executable commands, script workflows, and task-specific commands (such as publishing articles, running specific test/build scripts) MUST ONLY be generated as 'skill' adaptations. NEVER generate 'architecture' guidelines for task-specific command execution. 'architecture' guidelines are strictly for repository-wide coding conventions, general style rules, or tool restrictions (e.g. "prefer pnpm over npm").
9. NEVER DUPLICATE IN ONE RESPONSE: Never emit both a skill and an architecture guideline for the same task or command.
10. PROFILE TRAITS DEDUPLICATION: Check existing profile traits before proposing a profile adaptation. If an existing trait in the same dimension covers the preference (e.g. language or formatting style), do NOT propose a redundant trait or synonymous wording. Only update confidence or statement if there is new evidence or a significant change.
11. ARCHITECTURE GUIDELINES DEDUPLICATION: Check existing architecture guidelines. If a rule with similar intent or trigger exists, reuse its exact ID to update it. Never add a second guideline that rephrases an existing rule.
12. ROLE & PROPOSAL DEDUPLICATION: Check existing roles and proposals. Never create duplicate roles or proposals under slight name variations.
13. CAPACITY CONSTRAINT: Learned skills capacity limit is ${maxLearnedSkills}. Current learned skills in this scope: ${currentSkillCount} / ${maxLearnedSkills}.
    If current learned skills >= ${maxLearnedSkills} (or adding a skill would exceed ${maxLearnedSkills}), you CANNOT introduce a new skill name unless you also specify "replaces": "<existing-skill-name>" in the JSON object to retire an obsolete, lower-value, or superseded skill. Alternatively, update an existing skill in-place.
14. Output must be a valid JSON array of objects with the following schema:
[
  {
    "scope": "${scope}",
    "kind": "profile" | "skill" | "architecture" | "proposal",
    "name": "string (required for skill/proposal, e.g. 'browser-verify')",
    "replaces": "optional string (when kind is 'skill' and at capacity, name of obsolete existing skill to retire)",
    "content": "string",
    "reason": "concise explanation"
  }
]
If no adaptation is needed, return [].

Skill and guideline rules:
- A skill's content must be a SKILL.md document whose frontmatter has name and description. The description must include the user's own words for the task (for example 发布文章) so the next turn can recall it before any command runs.
- Copy the command that actually succeeded, including every flag the tool required. Do not shorten a command that was rejected.
- An architecture guideline must set trigger.keyword or trigger.regex when relevant, but must be repo-level coding/tooling standards, never a task execution procedure.
- Do not emit two near-duplicate guidelines or skills in one response; revise the single canonical item instead.`;

	const userPrompt = `Learning Signals:
${JSON.stringify(signals, null, 2)}

Existing Active Adaptations (Inspect these first; MUST update existing instead of creating duplicates):
${JSON.stringify(activeAdaptationsSummary, null, 2)}

Existing Learned Skills (${currentSkillCount}/${maxLearnedSkills}):
${JSON.stringify(existingSkills, null, 2)}

Current Workflow extraChecks:
${JSON.stringify(currentWorkflow?.extraChecks ?? [], null, 2)}

Adaptations needing rewrite:
${JSON.stringify(rewriteNotice, null, 2)}

Sanitized Conversation:
${conversationText}

Produce appropriate adaptations (update existing skills using their exact name if related):`;

	const complete = resolveLearnerCompletion({ model, modelRegistry, learnerModel, completeText, systemPrompt, userPrompt });
	if (!complete) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "idle",
			phase: "review",
			step: 2,
			total: 5,
			status: "skipped",
			summary: "Model completion unsupported",
		});
		return { ran: false, reason: "model_completion_unsupported", signals };
	}

	state.callsCount += 1;
	state.idleCallsCount = idleCalls + 1;
	saveLearnerState(scopeDir, state);

	let responseText = "";
	try {
		responseText = await complete();
	} catch (err) {
		state.callsCount = Math.max(0, state.callsCount - 1);
		state.idleCallsCount = Math.max(0, (state.idleCallsCount ?? 1) - 1);
		state.watermarkTimestamp = Date.now();
		saveLearnerState(scopeDir, state);
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "idle",
			phase: "review",
			step: 2,
			total: 5,
			status: "failed",
			summary: `Model call failed: ${String(err)}`,
		});
		return { ran: false, reason: `model_call_failed: ${String(err)}`, signals };
	}

	// 5. Parse and filter output
	let proposals: ProposedLearnerAdaptation[] = [];
	try {
		let cleaned = responseText.trim();
		if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
		else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
		if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, cleaned.length - 3);
		proposals = JSON.parse(cleaned.trim());
		if (!Array.isArray(proposals)) proposals = [];
	} catch {
		state.callsCount = Math.max(0, state.callsCount - 1);
		state.idleCallsCount = Math.max(0, (state.idleCallsCount ?? 1) - 1);
		state.watermarkTimestamp = Date.now();
		saveLearnerState(scopeDir, state);
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "idle",
			phase: "guard",
			step: 3,
			total: 5,
			status: "skipped",
			summary: "Invalid model JSON output",
		});
		return { ran: true, appliedCount: 0, reason: "invalid_model_json_output", signals };
	}

	// Phase 3: guard
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "idle",
		phase: "guard",
		step: 3,
		total: 5,
		status: "running",
		summary: "Validating safety guard",
	});

	// Check skill distillation from outcomes: if >= 3 successes for an intent, add skill proposal
	for (const [intent, count] of intentCounts.entries()) {
		if (count >= 3) {
			const sanitized = normalizeSkillName(intent).slice(0, 32);
			const existsInProposals = proposals.some((p) => p.kind === "skill" && normalizeSkillName(p.name ?? "") === sanitized);
			const existsInActive = existingAdaptations.some((a) => a.kind === "skill" && normalizeSkillName(a.name ?? "") === sanitized);
			if (sanitized && !existsInProposals && !existsInActive) {
				proposals.push({
					scope,
					kind: "skill",
					name: sanitized,
					content: `---\nname: ${sanitized}\ndescription: Distilled skill for ${intent}\n---\n# ${sanitized}\n\nAutomated procedure based on 3+ successful executions of ${intent}.\n`,
					reason: `Distilled skill from ${count} successful executions of ${intent}`,
				});
			}
		}
	}

	// Collect known skill commands to prevent duplicate architecture guidelines
	const allKnownSkillCommands: string[] = [];
	for (const p of proposals) {
		if (p.kind === "skill") {
			allKnownSkillCommands.push(...extractExecutableCommands(p.content));
		}
	}
	for (const a of existingAdaptations) {
		if (a.kind === "skill" && a.filePath && fs.existsSync(a.filePath)) {
			try {
				allKnownSkillCommands.push(...extractExecutableCommands(fs.readFileSync(a.filePath, "utf8")));
			} catch {}
		}
	}

	let applied = 0;
	// Phase 4: write
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "idle",
		phase: "write",
		step: 4,
		total: 5,
		status: "running",
		summary: "Persisting adaptations",
	});

	for (const item of proposals) {
		if (item.kind === "tool" || item.kind === "hook" || item.kind === "workflow") {
			continue;
		}

		// Filter out duplicate profile traits if already covered in active adaptations
		if (item.kind === "profile") {
			try {
				let incomingTraits: any[] = [];
				if (item.content.trim().startsWith("{")) {
					const parsed = JSON.parse(item.content);
					if (Array.isArray(parsed.traits)) incomingTraits = parsed.traits;
				} else {
					incomingTraits = [{ dimension: "communication", statement: item.content.trim() }];
				}
				const profileAdaptation = existingAdaptations.find((a) => a.kind === "profile");
				if (profileAdaptation && profileAdaptation.filePath && fs.existsSync(profileAdaptation.filePath)) {
					try {
						const existingProfile = JSON.parse(fs.readFileSync(profileAdaptation.filePath, "utf8"));
						if (Array.isArray(existingProfile.traits)) {
							incomingTraits = incomingTraits.filter((inT) => {
								const match = existingProfile.traits.find(
									(exT: any) =>
										exT.dimension === inT.dimension &&
										areStatementsSimilar(exT.statement, inT.statement, inT.dimension),
								);
								if (match) {
									if (match.confidence >= (inT.confidence ?? 0.8) && !inT.userStated && match.statement === inT.statement) {
										return false;
									}
								}
								return true;
							});
							if (incomingTraits.length === 0) {
								continue;
							}
						}
					} catch {}
				}
			} catch {}
		}

		// Filter out architecture guidelines that duplicate skill workflows or contain task-specific script executions
		if (item.kind === "architecture") {
			const archCmds = extractExecutableCommands(item.content);
			if (archCmds.length > 0) {
				if (hasCommandOverlap(archCmds, allKnownSkillCommands) || /node\s+\S+\.(?:mjs|js|ts)|publish|build|deploy/.test(item.content)) {
					continue;
				}
			}
		}

		if (Number.isFinite(MAX_DAILY_WRITES) && state.writesCount >= MAX_DAILY_WRITES) {
			break;
		}

		try {
			assertMainWorkflowInvariance(item.content);

			if (item.kind === "architecture") {
				const parsed = JSON.parse(item.content);
				validateArchitectureAdaptation(parsed);
			}

			await writeAdaptation({
				agentDir,
				cwd,
				scope: item.scope ?? scope,
				kind: item.kind,
				name: item.name,
				content: item.content,
				reason: item.reason,
				replaces: (item as any).replaces,
				maxLearnedSkills,
				actor: "learner",
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

	// Phase 5: evaluate
	generateDailyGrowthReport(scopeDir);

	const summary = applied > 0 ? `Learned ${applied} new adaptation(s)` : "Idle synthesis complete";
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "idle",
		phase: "evaluate",
		step: 5,
		total: 5,
		status: "completed",
		summary,
	});

	return {
		ran: true,
		appliedCount: applied,
		signals,
	};
}

export interface RunTurnLearnerOptions {
	agentDir: string;
	cwd: string;
	scope: AdaptationScope;
	model?: Model<any>;
	modelRegistry?: LearnerModelRegistry;
	learnerModel?: string;
	completeText?: (input: { systemPrompt: string; userPrompt: string }) => Promise<string>;
	messages: AgentMessage[];
	toolCallsCount?: number;
	hadRecovery?: boolean;
	dailyCallBudget?: number;
	maxLearnedSkills?: number;
	mode?: string;
	isProjectTrusted?: boolean;
	recoveryPairs?: Array<{ failedCommand: string; recoveredCommand: string }>;
	commandFingerprints?: Array<{ command: string; exitCode: number }>;
	onAdaptationApplied?: () => Promise<void> | void;
	onProgress?: (event: LearningProgressEvent) => void;
}

/**
 * Execute in-turn learning pass after an important turn finishes.
 */
export async function runTurnLearner(options: RunTurnLearnerOptions): Promise<IdleLearnerResult> {
	const {
		agentDir,
		cwd,
		scope,
		model,
		modelRegistry,
		learnerModel,
		completeText,
		messages,
		toolCallsCount = 0,
		hadRecovery = false,
		dailyCallBudget = DEFAULT_DAILY_CALL_BUDGET,
		mode = "tui",
		isProjectTrusted = true,
		onAdaptationApplied,
		onProgress,
	} = options;

	const runId = Math.random().toString(36).slice(2, 10);

	if (mode === "print" || mode === "json") {
		return { ran: false, reason: "skipped_non_interactive_mode" };
	}

	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const state = getLearnerState(scopeDir);

	// Phase 1: observe
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "turn",
		phase: "observe",
		step: 1,
		total: 5,
		status: "running",
		summary: "Observing signals",
	});

	const { hasSignal, signals } = detectLearningSignals({
		messages,
		watermarkTimestamp: state.watermarkTimestamp,
	});

	const important = isTurnImportant({ messages, toolCallsCount, hadRecovery });
	if (!hasSignal && !important) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "turn",
			phase: "observe",
			step: 1,
			total: 5,
			status: "skipped",
			summary: "No learning signals",
		});
		return { ran: false, reason: "no_signals" };
	}

	const turnCalls = state.turnCallsCount ?? 0;
	if (Number.isFinite(dailyCallBudget) && dailyCallBudget > 0 && state.callsCount >= dailyCallBudget) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "turn",
			phase: "review",
			step: 2,
			total: 5,
			status: "skipped",
			summary: "Daily budget limit reached",
		});
		return { ran: false, reason: "daily_model_call_quota_exceeded", signals };
	}
	if (Number.isFinite(MAX_TURN_CALLS_PER_DAY) && turnCalls >= MAX_TURN_CALLS_PER_DAY) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "turn",
			phase: "review",
			step: 2,
			total: 5,
			status: "skipped",
			summary: "Daily budget limit reached",
		});
		return { ran: false, reason: "daily_model_call_quota_exceeded", signals };
	}

	if (!model && !completeText) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "turn",
			phase: "review",
			step: 2,
			total: 5,
			status: "skipped",
			summary: "No model available",
		});
		return { ran: false, reason: "no_model_available", signals };
	}

	// Phase 2: review
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "turn",
		phase: "review",
		step: 2,
		total: 5,
		status: "running",
		summary: Number.isFinite(MAX_TURN_CALLS_PER_DAY)
			? `Reviewing turn (${turnCalls + 1}/${MAX_TURN_CALLS_PER_DAY})`
			: `Reviewing turn (${turnCalls + 1})`,
	});

	const conversationText = sanitizeConversationForLearner(messages);
	const existingSkills = getLearnedSkillsSummary(scopeDir, scope);
	const currentSkillCount = existingSkills.length;
	const maxLearnedSkills = options.maxLearnedSkills ?? DEFAULT_MAX_LEARNED_SKILLS;

	const existingAdaptations = listAdaptations(agentDir, cwd, { projectTrusted: isProjectTrusted });
	const activeAdaptationsSummary = buildActiveAdaptationsSummary(existingAdaptations);

	const systemPrompt = `You are the Metis In-Turn Self-Learning Synthesizer.
Analyze this important turn to extract persistent soft-layer adaptations: user profile traits (communication, coding style, rigor), project guidelines with triggers, or follow-up predictions.

STRICT CONSTRAINTS:
1. You may ONLY output soft-layer adaptations: "profile", "architecture", "skill", or "proposal".
2. You are STRICTLY FORBIDDEN from generating "tool", "hook", or "workflow" adaptations.
3. You must NEVER output control plane tools (performance_admit, performance_gate, update_plan, read_plan, spawn_agent, ask_user, adapt), gate numbers (G0-G7), receipts, or intent to bypass verification.
4. Never create a second skill/role/proposal that does the same job under a new name. If a similar adaptation already exists, output an update using the existing name only.
5. CHECK EXISTING ADAPTATIONS FIRST: Inspect the "Existing Active Adaptations" list provided in the user prompt.
6. UPDATE IN-PLACE: If a new learning signal or improvement relates to a task or command covered by an existing adaptation, you MUST update that existing adaptation using its EXACT name. NEVER create a new skill or guideline with a similar or variant name.
7. OPERATIONAL COMMANDS MUST BE SKILLS: Concrete executable commands, script workflows, and task-specific commands (such as publishing articles, running specific test/build scripts) MUST ONLY be generated as 'skill' adaptations. NEVER generate 'architecture' guidelines for task-specific command execution. 'architecture' guidelines are strictly for repository-wide coding conventions, general style rules, or tool restrictions (e.g. "prefer pnpm over npm").
8. NEVER DUPLICATE IN ONE RESPONSE: Never emit both a skill and an architecture guideline for the same task or command.
9. PROFILE TRAITS DEDUPLICATION: Check existing profile traits before proposing a profile adaptation. If an existing trait in the same dimension covers the preference (e.g. language or formatting style), do NOT propose a redundant trait or synonymous wording. Only update confidence or statement if there is new evidence or a significant change.
10. ARCHITECTURE GUIDELINES DEDUPLICATION: Check existing architecture guidelines. If a rule with similar intent or trigger exists, reuse its exact ID to update it. Never add a second guideline that rephrases an existing rule.
11. ROLE & PROPOSAL DEDUPLICATION: Check existing roles and proposals. Never create duplicate roles or proposals under slight name variations.
12. CAPACITY CONSTRAINT: Learned skills capacity limit is ${maxLearnedSkills}. Current learned skills in this scope: ${currentSkillCount} / ${maxLearnedSkills}.
   If current learned skills >= ${maxLearnedSkills} (or adding a skill would exceed ${maxLearnedSkills}), you CANNOT introduce a new skill name unless you also specify "replaces": "<existing-skill-name>" in the JSON object to retire an obsolete, lower-value, or superseded skill. Alternatively, update an existing skill in-place.
13. Output must be a valid JSON array of objects with the schema:
[
  {
    "scope": "${scope}",
    "kind": "profile" | "architecture" | "skill" | "proposal",
    "name": "string (for skill/proposal)",
    "replaces": "optional string (when kind is 'skill' and at capacity, name of obsolete existing skill to retire)",
    "content": "string",
    "reason": "concise explanation"
  }
]
For "architecture", content should be valid JSON with customGuidelines having text and optional trigger:
{"customGuidelines": [{"text": "...", "trigger": {"command": "npm test", "error": "ETIMEDOUT"}}]}
For "profile", content can be a statement or JSON profile.
If nothing new to learn, return [].

Skill and guideline rules:
- A skill's content must be a SKILL.md document whose frontmatter has name and description. The description must include the user's own words for the task (for example 发布文章) so the next turn can recall it before any command runs.
- Copy the exact full command that actually succeeded, including every flag and argument the tool required. Do not shorten or truncate commands, and never output placeholder summaries like "[Used tool: bash]".
- An architecture guideline must set trigger.keyword or trigger.regex when relevant, but must be repo-level coding/tooling standards, never a task execution procedure.
- Do not emit two near-duplicate guidelines or skills in one response; revise the single canonical item instead.`;

	const successfulCommands = (options.commandFingerprints ?? [])
		.filter((fp) => fp.exitCode === 0)
		.map((fp) => fp.command);

	const recoveryInfo = options.recoveryPairs && options.recoveryPairs.length > 0
		? `\nRecovery Pairs (failed -> recovered command):\n${options.recoveryPairs.map((p) => `- Failed: ${p.failedCommand}\n  Recovered: ${p.recoveredCommand}`).join("\n")}\n`
		: "";

	const successfulCommandsInfo = successfulCommands.length > 0
		? `\nSuccessful Command Fingerprints:\n${successfulCommands.map((c) => `- ${c}`).join("\n")}\n`
		: "";

	const userPrompt = `Turn Signals:
${JSON.stringify(signals, null, 2)}

Existing Active Adaptations (Inspect these first; MUST update existing instead of creating duplicates):
${JSON.stringify(activeAdaptationsSummary, null, 2)}

Existing Learned Skills (${currentSkillCount}/${maxLearnedSkills}):
${JSON.stringify(existingSkills, null, 2)}

Turn Metrics:
- Tool calls: ${toolCallsCount}
- Had recovery: ${hadRecovery}
${recoveryInfo}${successfulCommandsInfo}
Sanitized Conversation:
${conversationText}

Produce appropriate adaptations (update existing skills using their exact name if related; copy the exact full command into skills; never output placeholders like "[Used tool: bash]"):`;

	const complete = resolveLearnerCompletion({ model, modelRegistry, learnerModel, completeText, systemPrompt, userPrompt });
	if (!complete) {
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "turn",
			phase: "review",
			step: 2,
			total: 5,
			status: "skipped",
			summary: "Model completion unsupported",
		});
		return { ran: false, reason: "model_completion_unsupported", signals };
	}

	state.callsCount += 1;
	state.turnCallsCount = turnCalls + 1;
	saveLearnerState(scopeDir, state);

	let responseText = "";
	try {
		responseText = await complete();
	} catch (err) {
		state.callsCount = Math.max(0, state.callsCount - 1);
		state.turnCallsCount = Math.max(0, (state.turnCallsCount ?? 1) - 1);
		state.watermarkTimestamp = Date.now();
		saveLearnerState(scopeDir, state);
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "turn",
			phase: "review",
			step: 2,
			total: 5,
			status: "failed",
			summary: `Model call failed: ${String(err)}`,
		});
		return { ran: false, reason: `model_call_failed: ${String(err)}`, signals };
	}

	let proposals: ProposedLearnerAdaptation[] = [];
	try {
		let cleaned = responseText.trim();
		if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
		else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
		if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, cleaned.length - 3);
		proposals = JSON.parse(cleaned.trim());
		if (!Array.isArray(proposals)) proposals = [];
	} catch {
		state.callsCount = Math.max(0, state.callsCount - 1);
		state.turnCallsCount = Math.max(0, (state.turnCallsCount ?? 1) - 1);
		state.watermarkTimestamp = Date.now();
		saveLearnerState(scopeDir, state);
		onProgress?.({
			type: "learning_progress",
			runId,
			trigger: "turn",
			phase: "guard",
			step: 3,
			total: 5,
			status: "skipped",
			summary: "Invalid model JSON output",
		});
		return { ran: true, appliedCount: 0, reason: "invalid_model_json_output", signals };
	}

	// Phase 3: guard
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "turn",
		phase: "guard",
		step: 3,
		total: 5,
		status: "running",
		summary: "Validating safety guard",
	});

	// Collect known skill commands to prevent duplicate architecture guidelines
	const allKnownSkillCommands: string[] = [];
	for (const p of proposals) {
		if (p.kind === "skill") {
			allKnownSkillCommands.push(...extractExecutableCommands(p.content));
		}
	}
	for (const a of existingAdaptations) {
		if (a.kind === "skill" && a.filePath && fs.existsSync(a.filePath)) {
			try {
				allKnownSkillCommands.push(...extractExecutableCommands(fs.readFileSync(a.filePath, "utf8")));
			} catch {}
		}
	}

	const validProposals: ProposedLearnerAdaptation[] = [];
	for (const p of proposals) {
		if (p.kind === "tool" || p.kind === "hook" || p.kind === "workflow") continue;

		// Filter out duplicate profile traits if already covered in active adaptations
		if (p.kind === "profile") {
			try {
				let incomingTraits: any[] = [];
				if (p.content.trim().startsWith("{")) {
					const parsed = JSON.parse(p.content);
					if (Array.isArray(parsed.traits)) incomingTraits = parsed.traits;
				} else {
					incomingTraits = [{ dimension: "communication", statement: p.content.trim() }];
				}
				const profileAdaptation = existingAdaptations.find((a) => a.kind === "profile");
				if (profileAdaptation && profileAdaptation.filePath && fs.existsSync(profileAdaptation.filePath)) {
					try {
						const existingProfile = JSON.parse(fs.readFileSync(profileAdaptation.filePath, "utf8"));
						if (Array.isArray(existingProfile.traits)) {
							incomingTraits = incomingTraits.filter((inT) => {
								const match = existingProfile.traits.find(
									(exT: any) =>
										exT.dimension === inT.dimension &&
										areStatementsSimilar(exT.statement, inT.statement, inT.dimension),
								);
								if (match) {
									if (match.confidence >= (inT.confidence ?? 0.8) && !inT.userStated && match.statement === inT.statement) {
										return false;
									}
								}
								return true;
							});
							if (incomingTraits.length === 0) {
								continue;
							}
						}
					} catch {}
				}
			} catch {}
		}

		// Filter out architecture guidelines that duplicate skill workflows or contain task-specific script executions
		if (p.kind === "architecture") {
			const archCmds = extractExecutableCommands(p.content);
			if (archCmds.length > 0) {
				if (hasCommandOverlap(archCmds, allKnownSkillCommands) || /node\s+\S+\.(?:mjs|js|ts)|publish|build|deploy/.test(p.content)) {
					continue;
				}
			}
		}

		try {
			assertMainWorkflowInvariance(p.content);
			validProposals.push(p);
		} catch {
			// rejected by guard
		}
	}

	// Phase 4: write
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "turn",
		phase: "write",
		step: 4,
		total: 5,
		status: "running",
		summary: "Persisting adaptations",
	});

	let applied = 0;
	for (const item of validProposals) {
		if (Number.isFinite(MAX_DAILY_WRITES) && state.writesCount >= MAX_DAILY_WRITES) break;
		try {
			if (item.kind === "architecture") {
				const parsed = JSON.parse(item.content);
				validateArchitectureAdaptation(parsed);
			}
			await writeAdaptation({
				agentDir,
				cwd,
				scope: item.scope ?? scope,
				kind: item.kind,
				name: item.name,
				content: item.content,
				reason: item.reason,
				replaces: (item as any).replaces,
				maxLearnedSkills,
				actor: "learner",
				projectTrusted: isProjectTrusted,
			});
			state.writesCount += 1;
			state.unnotifiedLearnedCount += 1;
			applied += 1;
		} catch {
			// skip
		}
	}

	state.watermarkTimestamp = Date.now();
	saveLearnerState(scopeDir, state);
	if (applied > 0) {
		await onAdaptationApplied?.();
	}

	// Phase 5: evaluate
	const summary = applied > 0 ? `Learned ${applied} new adaptation(s)` : "Review complete";
	onProgress?.({
		type: "learning_progress",
		runId,
		trigger: "turn",
		phase: "evaluate",
		step: 5,
		total: 5,
		status: "completed",
		summary,
	});

	return { ran: true, appliedCount: applied, signals };
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
	modelRegistry?: LearnerModelRegistry;
	agentDir?: string;
	settingsManager?: {
		isProjectTrusted: () => boolean;
		getSettings?: () => any;
		getMaxLearnedSkills?: () => number;
	};
	emit?: (event: any) => void;
	refreshAdaptations?: (event?: { action?: string; kind?: string; name?: string; scope?: string }) => Promise<void>;
}

export interface ScheduleIdleLearningOptions {
	session: ScheduleIdleLearningSession;
	mode?: string;
}

/**
 * Schedule idle learning pass on interactive session startup.
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
	const settings = session.settingsManager?.getSettings?.();
	const dailyCallBudget = settings?.selfLearning?.dailyCallBudget ?? DEFAULT_DAILY_CALL_BUDGET;
	const learnerModel = settings?.selfLearning?.learnerModel;
	const maxLearnedSkills = settings?.selfLearning?.maxLearnedSkills ?? session.settingsManager?.getMaxLearnedSkills?.() ?? DEFAULT_MAX_LEARNED_SKILLS;

	const promise = (async () => {
		let messages = session.agent.state.messages ?? [];
		let previousSessionFile: string | undefined;
		if (!messages.some((message) => message.role === "user" && messagePlainText(message).trim())) {
			const sessionFile = session.sessionFile ?? session.sessionManager.getSessionFile?.();
			const scopeDir = getScopeDir(agentDir, cwd, scope);
			const watermark = getLearnerState(scopeDir).watermarkTimestamp;
			const unlearned = findPreviousUnlearnedSession(sessionFile, watermark, agentDir);
			if (unlearned) {
				previousSessionFile = unlearned.file;
				messages = unlearned.messages;
			}
		}

		if (!messages.some((message) => message.role === "user" && messagePlainText(message).trim())) {
			return undefined;
		}

		const res = await runIdleLearner({
			agentDir,
			cwd,
			scope,
			model: session.model,
			modelRegistry: session.modelRegistry,
			learnerModel,
			messages,
			mode,
			isProjectTrusted,
			dailyCallBudget,
			maxLearnedSkills,
			onProgress: (event) => session.emit?.(event),
			onAdaptationApplied: async () => {
				await session.refreshAdaptations?.({ action: "learned", kind: "adaptation" });
			},
		});

		if (previousSessionFile) {
			markSessionLearned(agentDir, previousSessionFile);
		} else {
			const liveSessionFile = session.sessionFile ?? session.sessionManager.getSessionFile?.();
			if (liveSessionFile) {
				markSessionLearned(agentDir, liveSessionFile);
			}
		}

		return res;
	})().catch((err) => {
		console.error("Failed to run idle learner:", err);
		return undefined;
	});

	return promise;
}

export type ScheduleTurnLearningSession = ScheduleIdleLearningSession;

export interface ScheduleTurnLearningOptions {
	session: ScheduleTurnLearningSession;
	mode?: string;
	toolCallsCount?: number;
	hadRecovery?: boolean;
	recoveryPairs?: Array<{ failedCommand: string; recoveredCommand: string }>;
	commandFingerprints?: Array<{ command: string; exitCode: number }>;
}

/**
 * Schedule in-turn learning pass after an important turn completes.
 */
export function scheduleTurnLearning(
	options: ScheduleTurnLearningOptions,
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
	const settings = session.settingsManager?.getSettings?.();
	const dailyCallBudget = settings?.selfLearning?.dailyCallBudget ?? DEFAULT_DAILY_CALL_BUDGET;
	const learnerModel = settings?.selfLearning?.learnerModel;
	const maxLearnedSkills = settings?.selfLearning?.maxLearnedSkills ?? session.settingsManager?.getMaxLearnedSkills?.() ?? DEFAULT_MAX_LEARNED_SKILLS;

	const promise = (async () => {
		const messages = session.agent.state.messages ?? [];

		// Run online fast learner for user preferences and ask_user alignment
		await runOnlineFastLearner({
			session,
			mode,
			messages,
			isProjectTrusted,
		}).catch(() => undefined);

		const res = await runTurnLearner({
			agentDir,
			cwd,
			scope,
			model: session.model,
			modelRegistry: session.modelRegistry,
			learnerModel,
			messages,
			toolCallsCount: options.toolCallsCount ?? (session as any)._turnToolCallsCount ?? 0,
			hadRecovery: options.hadRecovery ?? (session as any)._turnHadRecovery ?? false,
			recoveryPairs: options.recoveryPairs ?? (session as any)._turnRecoveryPairs,
			commandFingerprints: options.commandFingerprints ?? (session as any)._turnCommandFingerprints,
			dailyCallBudget,
			maxLearnedSkills,
			mode,
			isProjectTrusted,
			onProgress: (event) => session.emit?.(event),
			onAdaptationApplied: async () => {
				await session.refreshAdaptations?.({ action: "learned", kind: "adaptation" });
			},
		});

		const liveSessionFile = session.sessionFile ?? session.sessionManager.getSessionFile?.();
		if (liveSessionFile) {
			markSessionLearned(agentDir, liveSessionFile);
		}

		return res;
	})().catch((err) => {
		console.error("Failed to run turn learner:", err);
		return undefined;
	});

	return promise;
}

