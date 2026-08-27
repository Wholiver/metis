import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AssistantMessage, ImageContent } from "@earendil-works/metis-ai";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { flushRawStdout, writeRawStdout } from "../core/output-guard.ts";
import {
	getGlobalTraceCollector,
	type TraceCollector,
	type TraceContext,
} from "../core/trace-collector.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Array of additional prompts to send after initialMessage */
	messages?: string[];
	/** First message to send (may contain @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** Isolated final answer output file path (Feat 49) */
	outputFinalAnswer?: string;
	/** Custom TraceCollector instance (Feat 37) */
	traceCollector?: TraceCollector;
	/** Root run or current agent TraceContext */
	traceContext?: TraceContext;
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
	const { mode, messages = [], initialMessage, initialImages, outputFinalAnswer } = options;
	let exitCode = 0;
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let disposed = false;
	const signalCleanupHandlers: Array<() => void> = [];

	const rootRunId = options.traceContext?.rootRunId ?? process.env.METIS_ROOT_RUN_ID ?? `run-${Date.now()}`;
	const currentDepth = options.traceContext?.depth ?? (process.env.METIS_AGENT_DEPTH ? parseInt(process.env.METIS_AGENT_DEPTH, 10) : 0);
	const agentId = options.traceContext?.agentId ?? process.env.METIS_AGENT_ID ?? (currentDepth === 0 ? "root" : `agent-${currentDepth}`);
	const parentId = options.traceContext?.parentId ?? process.env.METIS_PARENT_AGENT_ID;
	const traceCollector = options.traceCollector ?? getGlobalTraceCollector(rootRunId);

	const activeTraceContext: TraceContext = {
		rootRunId,
		agentId,
		parentId,
		depth: currentDepth,
		provider: session.model?.provider,
		model: session.model?.id,
		baseUrl: session.model?.baseUrl,
		...(options.traceContext ?? {}),
	};

	const disposeRuntime = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		await runtimeHost.dispose();
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void disposeRuntime().finally(() => {
					process.exit(signal === "SIGHUP" ? 129 : 143);
				});
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	registerSignalHandlers();

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		if (session.model) {
			activeTraceContext.provider = session.model.provider;
			activeTraceContext.model = session.model.id;
			activeTraceContext.baseUrl = session.model.baseUrl;
		}

		await session.bindExtensions({
			mode: mode === "json" ? "json" : "print",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navigateOptions) => {
					const result = await session.navigateTree(targetId, {
						summarize: navigateOptions?.summarize,
						customInstructions: navigateOptions?.customInstructions,
						replaceInstructions: navigateOptions?.replaceInstructions,
						label: navigateOptions?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, switchOptions) => {
					return runtimeHost.switchSession(sessionPath, switchOptions);
				},
				reload: async () => {
					await session.reload();
				},
			},
			onError: (err) => {
				console.error(`Extension error (${err.extensionPath}): ${err.error}`);
			},
		});

		unsubscribe?.();
		unsubscribe = session.subscribe((event) => {
			if (event.type === "message_end" && (event.message as any).role === "assistant") {
				const assistantMsg = event.message as AssistantMessage;
				const usage = assistantMsg.usage;
				if (usage) {
					traceCollector.recordUsage(
						agentId,
						{
							input: usage.input,
							output: usage.output,
							cacheRead: usage.cacheRead,
							cacheWrite: usage.cacheWrite,
							cost: usage.cost?.total,
						},
						{
							provider: session.model?.provider,
							model: session.model?.id,
							baseUrl: session.model?.baseUrl,
							depth: currentDepth,
							parentId,
						},
					);
				}
			}

			if (mode === "json") {
				const enrichedEvent = traceCollector.injectTraceContext(event as any, activeTraceContext);
				writeRawStdout(`${JSON.stringify(enrichedEvent)}\n`);
			}
		});
	};

	try {
		if (mode === "json") {
			const header = session.sessionManager.getHeader();
			if (header) {
				const enrichedHeader = traceCollector.injectTraceContext(header as any, activeTraceContext);
				writeRawStdout(`${JSON.stringify(enrichedHeader)}\n`);
			}
			const workflowState = traceCollector.injectTraceContext(
				{
					type: "workflow_state",
					model: session.model ? { provider: session.model.provider, id: session.model.id, baseUrl: session.model.baseUrl } : undefined,
					thinkingLevel: session.thinkingLevel,
					collaborationMode: session.collaborationMode,
					contextWindowId: session.contextWindowId,
					workflowPlan: session.workflowPlan,
					instructionSources: session.instructionSources,
					instructionDiagnostics: session.instructionDiagnostics,
					memoryState: session.memoryState,
				},
				activeTraceContext,
			);
			writeRawStdout(`${JSON.stringify(workflowState)}\n`);
		}

		await rebindSession();

		if (initialMessage) {
			await session.prompt(initialMessage, { images: initialImages });
		}

		for (const message of messages) {
			await session.prompt(message);
		}

		const state = session.state;
		const lastMessage = state.messages[state.messages.length - 1];
		let finalAnswerText = "";

		if (lastMessage?.role === "assistant") {
			const assistantMsg = lastMessage as AssistantMessage;
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
				console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
				exitCode = 1;
			} else {
				for (const content of assistantMsg.content) {
					if (content.type === "text") {
						finalAnswerText += (finalAnswerText ? "\n" : "") + content.text;
					}
				}
				if (mode === "text") {
					writeRawStdout(`${finalAnswerText}\n`);
				}
			}
		}

		if (outputFinalAnswer && finalAnswerText) {
			try {
				const outPath = resolve(process.cwd(), outputFinalAnswer);
				const outDir = dirname(outPath);
				if (!existsSync(outDir)) {
					mkdirSync(outDir, { recursive: true });
				}
				writeFileSync(outPath, finalAnswerText, "utf-8");
			} catch (err: any) {
				console.error(`Failed to write final answer to ${outputFinalAnswer}: ${err.message}`);
				exitCode = 2;
			}
		}

		if (mode === "json") {
			const summary = traceCollector.getSummary();
			const enrichedSummary = traceCollector.injectTraceContext(summary as any, activeTraceContext);
			writeRawStdout(`${JSON.stringify(enrichedSummary)}\n`);
		}

		return exitCode;
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		return 2;
	} finally {
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		await disposeRuntime();
		await flushRawStdout();
	}
}

