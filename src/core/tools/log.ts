import type { AgentTool } from "@earendil-works/metis-agent-core";
import { readFileSync as fsReadFileSync } from "node:fs";
import { appendFile as fsAppendFile, mkdir as fsMkdir, readFile as fsReadFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const WORKING_MEMORY_MAX_BYTES = 12 * 1024;
export const WORKING_MEMORY_MAX_LINES = 120;

const logActionSchema = Type.Union(
	[Type.Literal("read"), Type.Literal("checkpoint"), Type.Literal("error"), Type.Literal("completion")],
	{
		description:
			"Read current working memory, or append a checkpoint, material error, or task completion entry. Omit for legacy completion behavior.",
	},
);

const logSchema = Type.Object({
	action: Type.Optional(logActionSchema),
	content: Type.Optional(
		Type.String({
			description:
				"High-density Markdown working-memory content. Required for checkpoint, error, and completion actions.",
		}),
	),
});

export type LogToolInput = Static<typeof logSchema>;

export interface LogToolOptions {
	/**
	 * Optional custom append operation for tests or alternate storage backends.
	 */
	appendFile?: (absolutePath: string, content: string) => Promise<void>;
	/**
	 * Optional custom read operation for tests or alternate storage backends.
	 */
	readFile?: (absolutePath: string) => Promise<string>;
	/**
	 * Optional custom mkdir operation for tests or alternate storage backends.
	 */
	mkdir?: (dir: string) => Promise<void>;
}

const defaultLogOperations = {
	appendFile: (path: string, content: string) => fsAppendFile(path, content, "utf-8"),
	readFile: (path: string) => fsReadFile(path, "utf-8"),
	mkdir: (dir: string) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export function getWorkingLogPath(cwd: string, sessionId: string): string {
	return resolveToCwd(join(".temp", `${sessionId}_log.md`), cwd);
}

function formatLocalTimestamp(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function isMissingFileError(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR")
	);
}

function takeUtf8Head(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, "utf-8");
	if (buffer.length <= maxBytes) return text;
	let end = maxBytes;
	while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
	return buffer.subarray(0, end).toString("utf-8");
}

function takeUtf8Tail(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, "utf-8");
	if (buffer.length <= maxBytes) return text;
	let start = buffer.length - maxBytes;
	while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
	return buffer.subarray(start).toString("utf-8");
}

function truncateWorkingMemory(content: string): string {
	const marker = "\n\n[... older working-memory content omitted ...]\n\n";
	let bounded = content;
	const lines = bounded.split("\n");
	if (lines.length > WORKING_MEMORY_MAX_LINES) {
		const headLines = Math.floor(WORKING_MEMORY_MAX_LINES / 3);
		const tailLines = WORKING_MEMORY_MAX_LINES - headLines - 1;
		bounded = `${lines.slice(0, headLines).join("\n")}${marker}${lines.slice(-tailLines).join("\n")}`;
	}

	if (Buffer.byteLength(bounded, "utf-8") <= WORKING_MEMORY_MAX_BYTES) {
		return bounded;
	}

	const markerBytes = Buffer.byteLength(marker, "utf-8");
	const availableBytes = WORKING_MEMORY_MAX_BYTES - markerBytes;
	const headBytes = Math.floor(availableBytes / 3);
	const tailBytes = availableBytes - headBytes;
	return `${takeUtf8Head(bounded, headBytes)}${marker}${takeUtf8Tail(bounded, tailBytes)}`;
}

const LOG_ENTRY_HEADING = /^## \[[^\]]+\] (Checkpoint|Error|Completion|Task summary)\s*$/gm;

/** Extract latest authoritative snapshot plus later events from the append-only working log. */
export function extractWorkingMemory(logContent: string): string | undefined {
	if (logContent.trim().length === 0) return undefined;

	let latestCheckpointIndex = -1;
	let latestLegacySummaryIndex = -1;
	let latestCompletionIndex = -1;
	for (const match of logContent.matchAll(LOG_ENTRY_HEADING)) {
		const entryType = match[1];
		const index = match.index ?? -1;
		if (entryType === "Checkpoint") latestCheckpointIndex = index;
		if (entryType === "Task summary") latestLegacySummaryIndex = index;
		if (entryType === "Completion") latestCompletionIndex = index;
	}

	const baselineIndex =
		latestCheckpointIndex >= 0
			? latestCheckpointIndex
			: latestLegacySummaryIndex >= 0
				? latestLegacySummaryIndex
				: latestCompletionIndex;
	const current = (baselineIndex >= 0 ? logContent.slice(baselineIndex) : logContent).trim();
	return truncateWorkingMemory(current);
}

function extractLatestCheckpointContent(logContent: string): string | undefined {
	const checkpointHeading = /^## \[[^\]]+\] Checkpoint\s*$/gm;
	let latest: RegExpExecArray | null = null;
	for (let match = checkpointHeading.exec(logContent); match; match = checkpointHeading.exec(logContent)) {
		latest = match;
	}
	if (!latest) return undefined;

	const contentStart = latest.index + latest[0].length;
	const nextHeading = /^## \[[^\]]+\] (?:Checkpoint|Error|Completion|Task summary)\s*$/gm;
	nextHeading.lastIndex = contentStart;
	const next = nextHeading.exec(logContent);
	return logContent.slice(contentStart, next?.index ?? logContent.length).trim();
}

export async function readWorkingMemory(cwd: string, sessionId: string): Promise<string | undefined> {
	try {
		return extractWorkingMemory(await defaultLogOperations.readFile(getWorkingLogPath(cwd, sessionId)));
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw error;
	}
}

export function readWorkingMemorySync(cwd: string, sessionId: string): string | undefined {
	try {
		return extractWorkingMemory(fsReadFileSync(getWorkingLogPath(cwd, sessionId), "utf-8"));
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw error;
	}
}

function formatEntry(action: Exclude<NonNullable<LogToolInput["action"]>, "read">, content: string): string {
	const heading = action === "checkpoint" ? "Checkpoint" : action === "error" ? "Error" : "Completion";
	return `## [${formatLocalTimestamp()}] ${heading}\n${content}`;
}

export function createLogToolDefinition(
	cwd: string,
	options?: LogToolOptions,
): ToolDefinition<typeof logSchema, undefined> {
	const ops = {
		appendFile: options?.appendFile ?? defaultLogOperations.appendFile,
		readFile: options?.readFile ?? defaultLogOperations.readFile,
		mkdir: options?.mkdir ?? defaultLogOperations.mkdir,
	};

	return {
		name: "log",
		label: "log",
		description:
			"Read or update the current session's append-only working memory. Dream later consolidates the complete log.",
		promptSnippet: "Read or update current working memory",
		promptGuidelines: [
			"Use log action=read to recover the latest working-memory checkpoint and all later errors/completion events.",
			"Write action=checkpoint after a plan step, material decision or scope change, implementation batch, verification result, or blocker. Include the complete current state: goal, done, active work, decisions, next step, verification, and blockers.",
			"After diagnosing a material error, immediately write action=error with phase/reproduction, impact, root cause or diagnosis, fix/workaround, post-fix verification, and residual risk. Skip expected negative-test failures and no-impact informational messages.",
			"Write action=completion once when the task finishes. Keep entries concise and omit routine narration or raw tool output.",
		],
		parameters: logSchema,
		async execute(_toolCallId, { action, content }, signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const absolutePath = getWorkingLogPath(cwd, sessionId);

			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = (): void => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};
				const readExisting = async (): Promise<string> => {
					try {
						return await ops.readFile(absolutePath);
					} catch (error) {
						if (isMissingFileError(error)) return "";
						// Preserve compatibility with custom backends that signal a fresh file generically.
						if (options?.readFile) return "";
						throw error;
					}
				};

				throwIfAborted();
				const existing = await readExisting();
				throwIfAborted();

				if (action === "read") {
					if (content !== undefined && content.trim().length > 0) {
						throw new Error("log action=read does not accept content");
					}
					return {
						content: [{ type: "text", text: extractWorkingMemory(existing) ?? "No working memory has been saved for this session." }],
						details: undefined,
					};
				}

				const normalizedContent = content?.trim();
				if (!normalizedContent) {
					throw new Error("log content is required for checkpoint, error, and completion actions");
				}

				const isLegacyCompletion = action === undefined;
				const writeAction = action ?? "completion";
				const loggedContent = isLegacyCompletion
					? `## [${formatLocalTimestamp()}] Task summary\n${normalizedContent}`
					: formatEntry(writeAction, normalizedContent);

				let skippedDuplicate = false;
				if (writeAction === "checkpoint" && extractLatestCheckpointContent(existing) === normalizedContent) {
					skippedDuplicate = true;
				} else {
					await ops.mkdir(dirname(absolutePath));
					throwIfAborted();
					const prefix = existing.trim().length > 0 ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
					await ops.appendFile(absolutePath, `${prefix}${loggedContent}\n`);
					throwIfAborted();
				}

				const updated = skippedDuplicate ? existing : `${existing}${existing.trim().length > 0 ? (existing.endsWith("\n") ? "\n" : "\n\n") : ""}${loggedContent}\n`;
				const currentMemory = extractWorkingMemory(updated) ?? loggedContent;
				const status = skippedDuplicate
					? `Checkpoint unchanged; skipped duplicate in ${absolutePath}.`
					: `Successfully appended ${normalizedContent.length} bytes to ${absolutePath}.`;
				return {
					content: [{ type: "text", text: `${status}\n\nCurrent working memory:\n${currentMemory}` }],
					details: undefined,
				};
			});
		},
	};
}

export function createLogTool(cwd: string, options?: LogToolOptions): AgentTool<typeof logSchema> {
	return wrapToolDefinition(createLogToolDefinition(cwd, options));
}
