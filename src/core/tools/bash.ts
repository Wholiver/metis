import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/metis-agent-core";
import { Container, Text, truncateToWidth } from "@earendil-works/metis-tui";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { getTextOutput, invalidArgText, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
/** Safety net for nested agents: unbounded grep/rg was hanging sync spawn_agent trees. */
export const DEFAULT_SUBAGENT_BASH_TIMEOUT_SECONDS = 180;

function resolveSubagentDepth(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.METIS_AGENT_DEPTH;
	if (raw === undefined || raw === "") return 0;
	const depth = Number(raw);
	return Number.isFinite(depth) && depth > 0 ? depth : 0;
}

/** Resolve effective bash timeout seconds (nested subagents get a default when omitted). */
export function resolveBashTimeoutSeconds(timeout: number | undefined, env: NodeJS.ProcessEnv = process.env): number | undefined {
	if (timeout !== undefined) return timeout;
	return resolveSubagentDepth(env) > 0 ? DEFAULT_SUBAGENT_BASH_TIMEOUT_SECONDS : undefined;
}

function resolveTimeoutMs(timeout: number | undefined, env: NodeJS.ProcessEnv = process.env): number | undefined {
	const effectiveTimeout = resolveBashTimeoutSeconds(timeout, env);
	if (effectiveTimeout === undefined) return undefined;
	if (!Number.isFinite(effectiveTimeout) || effectiveTimeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}

	const timeoutMs = effectiveTimeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
	}
	return timeoutMs;
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({
		description: `Timeout in seconds (optional; nested subagents default to ${DEFAULT_SUBAGENT_BASH_TIMEOUT_SECONDS}s when omitted)`,
	})),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/**
 * Create bash operations using metis's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want metis's
 * standard local shell behavior while wrapping or rewriting commands.
 */
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			const timeoutMs = resolveTimeoutMs(timeout, env ?? process.env);
			if (signal?.aborted) {
				throw new Error("aborted");
			}
			const shellConfig = getShellConfig(options?.shellPath);
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}

			const commandFromStdin = shellConfig.commandTransport === "stdin";
			const child = spawn(shellConfig.shell, commandFromStdin ? shellConfig.args : [...shellConfig.args, command], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? getShellEnv(),
				stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			if (commandFromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(command);
			}
			if (child.pid) trackDetachedChildPid(child.pid);
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				// Set timeout if provided.
				if (timeoutMs !== undefined) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeoutMs);
				}
				// Stream stdout and stderr.
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				// Handle abort signal by killing the entire process tree.
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				// Handle shell spawn errors and wait for the process to terminate without hanging
				// on inherited stdio handles held by detached descendants.
				const exitCode = await waitForChildProcess(child);
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					const timedOutSeconds = timeout
						?? (timeoutMs !== undefined ? Math.round(timeoutMs / 1000) : DEFAULT_SUBAGENT_BASH_TIMEOUT_SECONDS);
					throw new Error(`timeout:${timedOutSeconds}`);
				}
				return { exitCode };
			} finally {
				if (child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/**
	 * When true (or when the callback returns true), reject cat/heredoc/tee
	 * commands that embed file writes. Use when the write tool is active so
	 * bash stays for running programs and verification, not editing.
	 */
	rejectEmbeddedFileWrites?: boolean | (() => boolean);
	/**
	 * When true (or when the callback returns true), reject Chrome/Safari/qlmanage
	 * preview commands so Desktop Inspector browser_* tools are used instead.
	 */
	rejectExternalBrowserPreview?: boolean | (() => boolean);
	/**
	 * When true (or when the callback returns true), reject python3 -c / node -e
	 * snippets that open workspace files. Use when the read tool is active.
	 */
	rejectInlineFileReads?: boolean | (() => boolean);
}

const HEREDOC_TOKEN = String.raw`<<-?\s*(?:'[^'\n]+'|"[^"\n]+"|\\?\w+)`;

/**
 * Detect shell patterns that write file contents via cat/tee + heredoc.
 * Does not match plain reads (`cat file`), scripts (`python3 x.py`), or `python3 -c`.
 */
export function commandEmbedsFileWrite(command: string): boolean {
	const text = command.trim();
	if (!text) return false;
	// cat > path <<EOF
	if (new RegExp(String.raw`\bcat\s+>\s*\S+\s+${HEREDOC_TOKEN}`).test(text)) return true;
	// cat [-flags] <<EOF > path
	if (new RegExp(String.raw`\bcat(?:\s+-[A-Za-z]+)*\s+${HEREDOC_TOKEN}\s*>\s*\S+`).test(text)) return true;
	// tee [-a] path <<EOF
	if (new RegExp(String.raw`\btee(?:\s+-a)?\s+\S+\s+${HEREDOC_TOKEN}`).test(text)) return true;
	// cat [-flags] <<EOF | tee [-a] path
	if (new RegExp(String.raw`\bcat(?:\s+-[A-Za-z]+)*\s+${HEREDOC_TOKEN}[\s\S]*?\|\s*tee(?:\s+-a)?\s+\S+`).test(text)) return true;
	return false;
}

function shouldRejectOption(option: boolean | (() => boolean) | undefined): boolean {
	if (typeof option === "function") return option();
	return option === true;
}

const EMBEDDED_FILE_WRITE_REJECTION =
	"Use the write tool to create or overwrite files. Do not use cat/heredoc/tee to write file contents when write is available.";

const EXTERNAL_BROWSER_PREVIEW_REJECTION =
	"Use browser_navigate after performance_admit for local SVG/HTML preview. browser_snapshot and browser_screenshot are readable. Do not launch Chrome/Safari/Edge --headless --screenshot, open -a, xdg-open, or qlmanage when browser_* tools are available.";

const INLINE_FILE_READ_REJECTION =
	"Use the read tool to inspect workspace files. Do not use python3 -c / node -e with open()/readFile to read or search file contents when read is available. python3 script.py and ET.parse checks are still allowed.";

const INLINE_EVAL = /\b(?:python3?|pypy3?)\s+-c\b|\bnode\s+(?:-e|--eval)\b|\bruby\s+-e\b/;
const INLINE_FILE_READ =
	/\bopen\s*\(|\.read_text\s*\(|\.read_bytes\s*\(|\breadFileSync\s*\(|\bfs\.read(?:File)?\s*\(/;

/**
 * Detect python3 -c / node -e used as a substitute for read/grep.
 * Allows `python3 file.py`, math-only -c, and ET.parse verification.
 */
export function commandUsesInlineFileRead(command: string): boolean {
	const text = command.trim();
	if (!text || !INLINE_EVAL.test(text)) return false;
	return INLINE_FILE_READ.test(text);
}

/**
 * Detect bash using an external browser as a substitute for Inspector browser_*.
 * Allows listing apps (`ls /Applications/*Chrome*`) and real test runners.
 */
export function commandUsesExternalBrowserPreview(command: string): boolean {
	const text = command.trim();
	if (!text) return false;
	if (/\bqlmanage\b/.test(text) && !/\bwhich\b/.test(text)) return true;
	if (/\bopen\s+(-a\s+)?["']?(Google Chrome|Chromium|Safari|Microsoft Edge|Firefox)\b/i.test(text)) return true;
	if (/\bxdg-open\b/.test(text) && /\.(svg|html?)(\s|$|["'])/i.test(text)) return true;
	if (
		/Google Chrome\.app|Chromium\.app|Microsoft Edge\.app|Safari\.app|Firefox\.app/i.test(text) &&
		/--headless|--screenshot|file:\/\//i.test(text)
	) {
		return true;
	}
	if (/\b(google-chrome|chromium-browser|chromium|msedge)\b/i.test(text) && /--headless|--screenshot/i.test(text)) {
		return true;
	}
	return false;
}

const TRUNCATED_ACTION_STUB_REJECTION =
	"This bash call is a truncated no-op and did not run. Do not echo Action logged. If the previous arguments were truncated, use write for file contents, then run a real verification command.";

/**
 * Gemini/custom-anti sometimes replaces a large bash payload with
 * `echo "[OK: Action logged - Action logged]"` plus `_truncated`.
 * Executing that stub succeeds and the model loops.
 */
export function commandIsTruncatedActionStub(command: string): boolean {
	const text = command.trim();
	if (!text) return false;
	if (/Action logged\s*[-:]\s*Action logged/i.test(text)) return true;
	const firstLine = text.split("\n", 1)[0] ?? text;
	return /^(?:echo|printf)\s+.*\[OK:\s*Action logged/i.test(firstLine) && text.length < 400;
}

export function bashCallIsTruncatedStub(args: unknown): boolean {
	if (!args || typeof args !== "object") return false;
	const record = args as Record<string, unknown>;
	if (typeof record._truncated === "string" && record._truncated.trim().length > 0) return true;
	return typeof record.command === "string" && commandIsTruncatedActionStub(record.command);
}

export function prepareBashArguments(input: unknown): BashToolInput {
	if (bashCallIsTruncatedStub(input)) {
		throw new Error(TRUNCATED_ACTION_STUB_REJECTION);
	}
	return input as BashToolInput;
}

const BASH_PREVIEW_LINES = 5;
const BASH_UPDATE_THROTTLE_MS = 100;

type BashRenderState = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	interval: NodeJS.Timeout | undefined;
};

type BashResultRenderState = {
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	cachedSkipped: number | undefined;
};

class BashResultRenderComponent extends Container {
	state: BashResultRenderState = {
		cachedWidth: undefined,
		cachedLines: undefined,
		cachedSkipped: undefined,
	};
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatBashCall(args: { command?: string; timeout?: number } | undefined): string {
	const command = str(args?.command);
	const timeout = args?.timeout as number | undefined;
	const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
	const commandDisplay = command === null ? invalidArgText(theme) : command ? command : theme.fg("toolOutput", "...");
	return theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`)) + timeoutSuffix;
}

function rebuildBashResultRenderComponent(
	component: BashResultRenderComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
): void {
	const state = component.state;
	component.clear();

	let output = getTextOutput(result as any, showImages).trim();
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (options.expanded) {
			component.addChild(new Text(`\n${styledOutput}`, 0, 0));
		} else {
			component.addChild({
				render: (width: number) => {
					if (state.cachedLines === undefined || state.cachedWidth !== width) {
						const preview = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
						state.cachedLines = preview.visualLines;
						state.cachedSkipped = preview.skippedCount;
						state.cachedWidth = width;
					}
					if (state.cachedSkipped && state.cachedSkipped > 0) {
						const hint =
							theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
							` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
						return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
					}
					return ["", ...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	if (truncation?.truncated || fullOutputPath) {
		const warnings: string[] = [];
		if (fullOutputPath) {
			warnings.push(`Full output: ${fullOutputPath}`);
		}
		if (truncation?.truncated) {
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
				);
			}
		}
		component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
	}

	if (startedAt !== undefined) {
		const label = options.isPartial ? "Elapsed" : "Took";
		const endTime = endedAt ?? Date.now();
		component.addChild(new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}`, 0, 0));
	}
}

/** Prefer dedicated file tools; do not steer progress narration. */
export const BASH_GUIDELINES = [
	"When read/write/edit/grep/ls are available: read files with read, search file contents with grep, list directories with ls, create or rewrite files with write, make precise edits with edit; use bash only to run programs, tests, and verification commands. Do not use cat/heredoc/tee to write file contents.",
] as const;

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const rejectEmbeddedFileWrites = options?.rejectEmbeddedFileWrites;
	const rejectExternalBrowserPreview = options?.rejectExternalBrowserPreview;
	const rejectInlineFileReads = options?.rejectInlineFileReads;
	return {
		name: "bash",
		label: "bash",
		description: `Run programs, tests, and verification commands in cwd; return stdout+stderr. Do not use cat/heredoc/tee to write files — use write/edit. Tail truncates at ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB, whichever first; full output goes to temp file. Optional seconds timeout (nested subagents default to ${DEFAULT_SUBAGENT_BASH_TIMEOUT_SECONDS}s).`,
		promptSnippet: "Run programs, tests, and verification commands (not for writing files)",
		promptGuidelines: [...BASH_GUIDELINES],
		parameters: bashSchema,
		prepareArguments: prepareBashArguments,
		async execute(
			_toolCallId,
			{ command, timeout }: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?,
			_ctx?,
		) {
			if (commandIsTruncatedActionStub(command)) {
				throw new Error(TRUNCATED_ACTION_STUB_REJECTION);
			}
			if (shouldRejectOption(rejectExternalBrowserPreview) && commandUsesExternalBrowserPreview(command)) {
				throw new Error(EXTERNAL_BROWSER_PREVIEW_REJECTION);
			}
			if (shouldRejectOption(rejectInlineFileReads) && commandUsesInlineFileRead(command)) {
				throw new Error(INLINE_FILE_READ_REJECTION);
			}
			if (shouldRejectOption(rejectEmbeddedFileWrites) && commandEmbedsFileWrite(command)) {
				throw new Error(EMBEDDED_FILE_WRITE_REJECTION);
			}
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
			const output = new OutputAccumulator({ tempFilePrefix: "metis-bash" });
			let acceptingOutput = true;
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			if (onUpdate) {
				onUpdate({ content: [], details: undefined });
			}

			const handleData = (data: Buffer) => {
				if (!acceptingOutput) return;
				output.append(data);
				scheduleOutputUpdate();
			};

			const finishOutput = async () => {
				acceptingOutput = false;
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				await output.closeTempFile();
				return snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") => {
				const truncation = snapshot.truncation;
				let text = snapshot.content || emptyText;
				let details: BashToolDetails | undefined;
				if (truncation.truncated) {
					details = { truncation, fullOutputPath: snapshot.fullOutputPath };
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(output.getLastLineBytes());
						text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
					} else if (truncation.truncatedBy === "lines") {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
					} else {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
					}
				}
				return { text, details };
			};

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			try {
				let exitCode: number | null;
				try {
					const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
						onData: handleData,
						signal,
						timeout,
						env: spawnContext.env,
					});
					exitCode = result.exitCode;
				} catch (err) {
					const snapshot = await finishOutput();
					const { text } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						throw new Error(appendStatus(text, "Command aborted"));
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						const timeoutSecs = err.message.split(":")[1];
						throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
					}
					throw err;
				}

				const snapshot = await finishOutput();
				const { text: outputText, details } = formatOutput(snapshot);
				if (exitCode !== 0 && exitCode !== null) {
					throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`));
				}
				return { content: [{ type: "text", text: outputText }], details };
			} finally {
				clearUpdateTimer();
			}
		},
		renderCall(args, _theme, context) {
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatBashCall(args));
			return text;
		},
		renderResult(result, options, _theme, context) {
			const state = context.state;
			if (state.startedAt !== undefined && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}
			const component =
				(context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
			rebuildBashResultRenderComponent(
				component,
				result as any,
				options,
				context.showImages,
				state.startedAt,
				state.endedAt,
			);
			component.invalidate();
			return component;
		},
	};
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	return wrapToolDefinition(createBashToolDefinition(cwd, options));
}

