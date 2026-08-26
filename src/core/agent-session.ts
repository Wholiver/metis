/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { getAgentDir } from "../config.ts";
import type {
	Agent,
	AgentEvent,
	AgentMessage,
	AgentState,
	AgentTool,
	PrepareNextTurnContext,
	ThinkingLevel,
} from "@earendil-works/metis-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, TextContent, ThinkingOption } from "@earendil-works/metis-ai/compat";
import {
	clampThinkingLevel,
	cleanupSessionResources,
	getSupportedThinkingLevels,
	getThinkingOptions,
	isContextOverflow,
	isRetryableAssistantError,
	modelsAreEqual,
	resetApiProviders,
	streamSimple,
} from "@earendil-works/metis-ai/compat";
import { generateFallbackSessionName, generateSessionName } from "./session-name-generator.ts";
import { getThemeByName, theme } from "../modes/interactive/theme/theme.ts";
import { stripFrontmatter } from "../utils/frontmatter.ts";
import { resolvePath } from "../utils/paths.ts";
import { sleep } from "../utils/sleep.ts";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.ts";
import { type BashResult, executeBashWithOperations } from "./bash-executor.ts";
import {
	type CompactionResult,
	calculateContextTokens,
	collectEntriesForBranchSummary,
	compact,
	estimateContextTokens,
	estimateTokens,
	generateBranchSummary,
	prepareCompaction,
	shouldCompact,
} from "./compaction/index.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import { defaultModelPerProvider } from "./model-resolver.ts";
import { exportSessionToHtml, type ToolHtmlRenderer } from "./export-html/index.ts";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.ts";
import {
	type ContextUsage,
	type ExtensionCommandContextActions,
	type ExtensionErrorListener,
	type ExtensionMode,
	ExtensionRunner,
	type ExtensionUIContext,
	type InputSource,
	type MessageEndEvent,
	type MessageStartEvent,
	type MessageUpdateEvent,
	type ReplacedSessionContext,
	type SessionBeforeCompactResult,
	type SessionBeforeTreeResult,
	type SessionStartEvent,
	type ShutdownHandler,
	type ToolDefinition,
	type ToolExecutionEndEvent,
	type ToolExecutionStartEvent,
	type ToolExecutionUpdateEvent,
	type ToolInfo,
	type TreePreparation,
	type TurnEndEvent,
	type TurnStartEvent,
	wrapRegisteredTools,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import type { BashExecutionMessage, CustomMessage } from "./messages.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { expandPromptTemplate, type PromptTemplate } from "./prompt-templates.ts";
import type { ResourceExtensionPaths, ResourceLoader } from "./resource-loader.ts";
import type { BranchSummaryEntry, CompactionEntry, SessionEntry, SessionManager } from "./session-manager.ts";
import { CURRENT_SESSION_VERSION, getLatestCompactionEntry, type SessionHeader } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import type { SlashCommandInfo } from "./slash-commands.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";
import { type AskUserHandler, type AskUserRequest, type AskUserResponse, validateAskUserResponse } from "./ask-user.ts";
import {
	type BuildSystemPromptOptions,
	buildInstructionStack,
	buildSystemPrompt,
	summarizeInstructionStack,
	type InstructionSourceSummary,
	type InstructionStack,
} from "./system-prompt.ts";
import {
	extractProposedPlan,
	resolveWorkflowProposal,
	resolveWorkflowPlan,
	type CollaborationMode,
	getToolCapabilities,
	type StepSnapshot,
	type WorkflowPlanState,
	type WorkflowProposalState,
	WorkflowToolError,
	WorkflowRuntime,
} from "./workflow-runtime.ts";
import { type BashOperations, createLocalBashOperations } from "./tools/bash.ts";
import { createAllToolDefinitions } from "./tools/index.ts";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.ts";
import { type MemoryCoordinator, type MemoryRecordSummary, type MemorySearchOptions, type MemoryState } from "./memory-coordinator.ts";
import {
	PerformanceRuntime,
	summarizePerformanceRun,
	type PerformanceAttendance,
	type PerformanceConcurrency,
	type PerformanceRunState,
	type PerformanceRunSummary,
} from "./performance-runtime.ts";

// ============================================================================
// Skill Block Parsing
// ============================================================================

/** Parsed skill block from a user message */
export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
	const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
	if (!match) return null;
	return {
		name: match[1],
		location: match[2],
		content: match[3],
		userMessage: match[4]?.trim() || undefined,
	};
}

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| Exclude<AgentEvent, { type: "agent_end" }>
	| {
			type: "agent_end";
			messages: AgentMessage[];
			willRetry: boolean;
	  }
	| {
			type: "queue_update";
			steering: readonly string[];
			followUp: readonly string[];
	  }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| { type: "entry_appended"; entry: SessionEntry }
	| { type: "session_info_changed"; name: string | undefined }
	| {
			type: "session_name_generation";
			status: "started" | "completed" | "failed";
			name?: string;
			error?: string;
	  }
	| { type: "thinking_level_changed"; level: ThinkingLevel }
	| { type: "collaboration_mode_changed"; mode: CollaborationMode }
	| { type: "memory_state_changed"; state: MemoryState }
	| { type: "memory_records_changed" }
	| { type: "user_input_request"; request: AskUserRequest }
	| { type: "subagent_status"; runningCount: number; runningJobIds: readonly string[] }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

/** Complete queued user message retained for queue editing and reordering. */
export interface QueuedSessionMessage {
	text: string;
	images?: ImageContent[];
	timestamp: number;
}

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	cwd: string;
	/** Global Metis configuration directory. Performance governance lives here, never in cwd. */
	agentDir?: string;
	/** Models to cycle through with Ctrl+P (from --models flag) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	/** Resource loader for skills, prompts, themes, context files, system prompt */
	resourceLoader: ResourceLoader;
	/** SDK custom tools registered outside extensions */
	customTools?: ToolDefinition[];
	/** Model registry for API key resolution and model discovery */
	modelRegistry: ModelRegistry;
	/** Initial active built-in tool names. Default includes update_plan for Build progress. */
	initialActiveToolNames?: string[];
	/** Optional allowlist of tool names. When provided, only these tool names are exposed. */
	allowedToolNames?: string[];
	/** Optional denylist of tool names. When provided, these tool names are not exposed. */
	excludedToolNames?: string[];
	/**
	 * Override base tools (useful for custom runtimes).
	 *
	 * These are synthesized into minimal ToolDefinitions internally so AgentSession can keep
	 * a definition-first registry even when callers provide plain AgentTool instances.
	 */
	baseToolsOverride?: Record<string, AgentTool>;
	/** Mutable ref used by Agent to access the current ExtensionRunner */
	extensionRunnerRef?: { current?: ExtensionRunner };
	/** Session start event metadata emitted when extensions bind to this runtime. */
	sessionStartEvent?: SessionStartEvent;
	/** Whether to automatically generate an AI-summarized session title. Default: true */
	autoSessionName?: boolean;
	/** Build permits all configured tools; Plan exposes read-only tools only. */
	collaborationMode?: CollaborationMode;
	/** Host-provided interactive bridge for built-in ask_user. */
	askUserHandler?: AskUserHandler;
	/** Whether native Performance prompts may ask the operator for run knobs. */
	performanceAttendance?: PerformanceAttendance;
	/** Durable advisory memory; omitted for ephemeral and subagent sessions. */
	memoryCoordinator?: MemoryCoordinator;
}

export interface ExtensionBindings {
	uiContext?: ExtensionUIContext;
	mode?: ExtensionMode;
	commandContextActions?: ExtensionCommandContextActions;
	abortHandler?: () => void;
	shutdownHandler?: ShutdownHandler;
	onError?: ExtensionErrorListener;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Whether to expand file-based prompt templates (default: true) */
	expandPromptTemplates?: boolean;
	/** Image attachments */
	images?: ImageContent[];
	/** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
	streamingBehavior?: "steer" | "followUp";
	/** Source of input for extension input event handlers. Defaults to "interactive". */
	source?: InputSource;
	/** Internal hook used by RPC mode to observe prompt preflight acceptance or rejection. */
	preflightResult?: (success: boolean) => void;
	/** Explicit host action used to enforce proposal execution setup at runtime. */
	workflowAction?: "process_proposal";
}

/** Result from cycleModel() */
export interface ModelCycleResult {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	/** Whether cycling through scoped models (--models flag) or all available */
	isScoped: boolean;
}

/** Session statistics for /session command */
export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: ContextUsage;
}

interface ToolDefinitionEntry {
	definition: ToolDefinition;
	sourceInfo: SourceInfo;
}

function estimateMessagesTokens(messages: AgentMessage[]): number {
	let tokens = 0;
	for (const message of messages) {
		tokens += estimateTokens(message);
	}
	return tokens;
}

// ============================================================================
// Constants
// ============================================================================

/** Standard thinking levels */
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	private _scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

	// Event subscription state
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];

	/** Tracks pending steering messages for UI display. Removed when delivered. */
	private _steeringMessages: string[] = [];
	/** Tracks pending follow-up messages for UI display. Removed when delivered. */
	private _followUpMessages: string[] = [];
	/** Complete queue entries used to preserve images when removing or reordering. */
	private _steeringQueueEntries: QueuedSessionMessage[] = [];
	private _followUpQueueEntries: QueuedSessionMessage[] = [];
	/** Messages queued to be included with the next user prompt as context ("asides"). */
	private _pendingNextTurnMessages: CustomMessage[] = [];

	// Compaction state
	private _compactionAbortController: AbortController | undefined = undefined;
	private _autoCompactionAbortController: AbortController | undefined = undefined;
	private _overflowRecoveryAttempted = false;

	// Branch summarization state
	private _branchSummaryAbortController: AbortController | undefined = undefined;

	// Retry state
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;

	// Bash execution state
	private _bashAbortController: AbortController | undefined = undefined;
	private _pendingBashMessages: BashExecutionMessage[] = [];

	// Extension system
	private _extensionRunner!: ExtensionRunner;
	private _turnIndex = 0;
	private _activeWorkflowTaskId?: string;
	private _activeWorkflowProposalRevision?: number;

	private _resourceLoader: ResourceLoader;
	private _customTools: ToolDefinition[];
	private _baseToolDefinitions: Map<string, ToolDefinition> = new Map();
	private _cwd: string;
	private _extensionRunnerRef?: { current?: ExtensionRunner };
	private _initialActiveToolNames?: string[];
	private _allowedToolNames?: Set<string>;
	private _excludedToolNames?: Set<string>;
	private _baseToolsOverride?: Record<string, AgentTool>;
	private _sessionStartEvent: SessionStartEvent;
	private _extensionUIContext?: ExtensionUIContext;
	private _extensionMode: ExtensionMode = "print";
	private _extensionCommandContextActions?: ExtensionCommandContextActions;
	private _extensionAbortHandler?: () => void;
	private _extensionShutdownHandler?: ShutdownHandler;
	private _extensionErrorListener?: ExtensionErrorListener;
	private _extensionErrorUnsubscriber?: () => void;

	private _isGeneratingSessionName = false;
	private _sessionNameGenerationPromise?: Promise<string | undefined>;
	private _sessionNameError?: string;
	private _autoSessionName = true;

	// Model registry for API key resolution
	private _modelRegistry: ModelRegistry;

	// Tool registry for extension getTools/setTools
	private _toolRegistry: Map<string, AgentTool> = new Map();
	private _toolDefinitions: Map<string, ToolDefinitionEntry> = new Map();
	private _toolPromptSnippets: Map<string, string> = new Map();
	private _toolPromptGuidelines: Map<string, string[]> = new Map();

	// Base system prompt (without extension appends) - used to apply fresh appends each turn
	private _baseSystemPrompt = "";
	private _baseSystemPromptOptions!: BuildSystemPromptOptions;
	private _systemPromptOverride?: string;
	private _instructionStack!: InstructionStack;
	private _activeRunInstructionStack: InstructionStack | undefined;
	private readonly _workflowRuntime = new WorkflowRuntime();
	private readonly _performanceRuntime: PerformanceRuntime;
	private _collaborationMode: CollaborationMode = "build";
	/** Configured Build tool set. Plan mode derives a read-only view without replacing it. */
	private _buildToolNames: string[] | undefined;

	private _memoryCoordinator?: MemoryCoordinator;
	private _askUserHandler?: AskUserHandler;
	private _performanceAttendance: PerformanceAttendance;
	private _pendingUserInput?: AskUserRequest;
	private _subagentLaunchBatchOpen = false;
	private _subagentPauseActive = false;
	private _subagentBarrierActiveToolNames: string[] | undefined;
	private readonly _pendingSubagentResults = new Map<string, string>();
	private _subagentResultDeliveryInProgress = false;
	private _subagentResultDrainPromise: Promise<void> | undefined;

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._scopedModels = config.scopedModels ?? [];
		this._resourceLoader = config.resourceLoader;
		this._customTools = config.customTools ?? [];
		this._cwd = config.cwd;
		this._performanceRuntime = new PerformanceRuntime(config.agentDir ?? getAgentDir());
		this._modelRegistry = config.modelRegistry;
		this._autoSessionName = config.autoSessionName ?? false;
		this._collaborationMode = config.collaborationMode ?? "build";
		this._extensionRunnerRef = config.extensionRunnerRef;
		this._initialActiveToolNames = config.initialActiveToolNames;
		this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
		this._excludedToolNames = config.excludedToolNames ? new Set(config.excludedToolNames) : undefined;
		this._baseToolsOverride = config.baseToolsOverride;
		this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
		this._memoryCoordinator = config.memoryCoordinator;
		this._askUserHandler = config.askUserHandler;
		this._performanceAttendance = config.performanceAttendance ?? "unattended";
		this._memoryCoordinator?.on((event) => this._emit(event));
		this._memoryCoordinator?.start();

		// Always subscribe to agent events for internal handling
		// (session persistence, extensions, auto-compaction, retry logic)
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		this._installAgentToolHooks();
		this._installAgentNextTurnRefresh();

		this._buildRuntime({
			activeToolNames: this._initialActiveToolNames,
			includeAllExtensionTools: true,
		});
	}

	/** Model registry for API key resolution and model discovery */
	get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}


	private async _getRequiredRequestAuth(model: Model<any>): Promise<{
		apiKey: string;
		headers?: Record<string, string>;
		env?: Record<string, string>;
	}> {
		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		if (!result.ok) {
			if (result.error.startsWith("No API key found")) {
				throw new Error(formatNoApiKeyFoundMessage(model.provider));
			}
			throw new Error(result.error);
		}
		if (result.apiKey) {
			return { apiKey: result.apiKey, headers: result.headers, env: result.env };
		}

		const isOAuth = this._modelRegistry.isUsingOAuth(model);
		if (isOAuth) {
			throw new Error(
				`Authentication failed for "${model.provider}". ` +
					`Credentials may have expired or network is unavailable. ` +
					`Run '/login ${model.provider}' to re-authenticate.`,
			);
		}
		throw new Error(formatNoApiKeyFoundMessage(model.provider));
	}

	private async _getCompactionRequestAuth(model: Model<any>): Promise<{
		apiKey?: string;
		headers?: Record<string, string>;
		env?: Record<string, string>;
	}> {
		if (this.agent.streamFn === streamSimple) {
			return this._getRequiredRequestAuth(model);
		}

		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		return result.ok ? { apiKey: result.apiKey, headers: result.headers, env: result.env } : {};
	}

	/**
	 * Install tool hooks once on the Agent instance.
	 *
	 * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
	 * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
	 * registered tool execution to the extension context. Tool call and tool result interception now
	 * happens here instead of in wrappers.
	 */
	private _installAgentToolHooks(): void {
		this.agent.beforeToolCall = async ({ toolCall, args }) => {
			const definition = this._toolDefinitions.get(toolCall.name)?.definition;
			const snapshot = this._workflowRuntime.bindToolCall(toolCall.id);
			if (snapshot && !snapshot.toolNames.includes(toolCall.name)) {
				return { block: true, reason: `Tool ${toolCall.name} was not advertised for this workflow step.` };
			}
			if (!this._workflowRuntime.canDispatchTool(toolCall.name, definition, snapshot?.collaborationMode ?? this._collaborationMode)) {
				return {
					block: true,
					reason: `Tool ${toolCall.name} is unavailable in Plan mode because it may modify state.`,
				};
			}
			const subagentBarrierActive = this._subagentPauseActive;
			const canExtendLaunchBatch = this._subagentLaunchBatchOpen && (toolCall.name === "spawn_agent" || toolCall.name === "subagent");
			if (subagentBarrierActive && !canExtendLaunchBatch) {
				return {
					block: true,
					reason: "Subagent launch pause active. End this Agent run and wait for the next completed Subagent result.",
				};
			}

			const runner = this._extensionRunner;
			if (!runner.hasHandlers("tool_call")) {
				return undefined;
			}

			try {
				return await runner.emitToolCall({
					type: "tool_call",
					toolName: toolCall.name,
					toolCallId: toolCall.id,
					input: args as Record<string, unknown>,
				});
			} catch (err) {
				if (err instanceof Error) {
					throw err;
				}
				throw new Error(`Extension failed, blocking execution: ${String(err)}`);
			}
		};

		this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
			const runner = this._extensionRunner;
			const input = args as Record<string, unknown>;
			let hookResult: Awaited<ReturnType<typeof runner.emitToolResult>> | undefined;
			try {
				try {
					hookResult = runner.hasHandlers("tool_result")
						? await runner.emitToolResult({
								type: "tool_result",
								toolName: toolCall.name,
								toolCallId: toolCall.id,
								input,
								content: result.content,
								details: result.details,
								isError,
							})
						: undefined;
				} catch (error) {
					throw error;
				}

				const effectiveIsError = hookResult?.isError ?? isError;
					if ((toolCall.name === "log" || toolCall.name === "remember_user_intent") && typeof input.content === "string") {
						this._memoryCoordinator?.recordCheckpoint({
							sessionId: this.sessionManager.getSessionId(), reason: effectiveIsError ? "error" : "step_completed", timestamp: new Date().toISOString(),
							errors: effectiveIsError ? [input.content] : undefined,
							verification: !effectiveIsError && toolCall.name === "log" ? [input.content] : undefined,
							constraints: !effectiveIsError && toolCall.name === "remember_user_intent" ? [input.content] : undefined,
						});
				}
				if (effectiveIsError) {
					this._appendWorkflowCheckpoint("error");
				}

				if (!hookResult) {
					return undefined;
				}

				return {
					content: hookResult.content,
					details: hookResult.details,
					isError: hookResult.isError ?? isError,
				};
			} finally {
				this._workflowRuntime.releaseToolCall(toolCall.id);
			}
		};
	}

	/** Attach Metis-owned scheduling and snapshot policy to every tool. */
	private _wrapWorkflowTool(tool: AgentTool, definition: ToolDefinition | undefined): AgentTool {
		const execute = tool.execute.bind(tool);
		const capabilities = getToolCapabilities(definition, tool.name);
		const canParallel = capabilities?.effect === "read" && capabilities.parallelSafe === true;
		return {
			...tool,
			// This also tells the vendor stream loop not to make an unsafe batch
			// parallel. The local dispatcher remains authoritative for every call.
			executionMode: canParallel && tool.executionMode !== "sequential" ? "parallel" : "sequential",
			execute: async (toolCallId, params, signal, onUpdate) => {
				try {
					return await this._workflowRuntime.dispatchTool(
						toolCallId,
						tool.name,
						definition,
						signal,
						async (toolSignal) => await execute(toolCallId, params, toolSignal, onUpdate),
					);
				} catch (error) {
					if (error instanceof WorkflowToolError && error.kind === "terminal") {
						return {
							content: [{ type: "text", text: error.message }],
							details: { workflowErrorKind: error.kind },
							terminate: true,
						};
					}
					throw error;
				}
			},
		};
	}

	private _installAgentNextTurnRefresh(): void {
		const previousPrepareNextTurnWithContext =
			this.agent.prepareNextTurnWithContext ??
			(this.agent.prepareNextTurn
				? async (_turn: PrepareNextTurnContext, signal?: AbortSignal) => await this.agent.prepareNextTurn?.(signal)
				: undefined);
		this.agent.prepareNextTurnWithContext = async (turn, signal) => {
			const previousSnapshot = await previousPrepareNextTurnWithContext?.(turn, signal);
			const previousContext = previousSnapshot?.context ?? turn.context;
			const messages = previousContext.messages;
			const baseInstructions = this._activeRunInstructionStack ?? this._instructionStack;
			const instructions: InstructionStack = {
				...baseInstructions,
				context: baseInstructions.context.filter((entry) => entry.trust !== "memory"),
			};
			const snapshot = this._freezeStepSnapshot(messages, instructions);

			return {
				...previousSnapshot,
				context: {
					...previousContext,
					messages,
					systemPrompt: this._systemPromptOverride ?? this._workflowRuntime.compilePrivilegedInstructions(snapshot) ?? this._baseSystemPrompt,
					tools: snapshot.tools.slice(),
				},
				model: this.agent.state.model,
				thinkingLevel: this.agent.state.thinkingLevel,
			};
		};
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: AgentSessionEvent): void {
		if (event.type === "compaction_end" && event.result && !event.aborted) {
			this._workflowRuntime.beginNewContextWindow();
			this._appendWorkflowCheckpoint("compaction");
		}
		for (const l of this._eventListeners) {
			l(event);
		}
	}

	private _emitQueueUpdate(): void {
		this._emit({
			type: "queue_update",
			steering: [...this._steeringMessages],
			followUp: [...this._followUpMessages],
		});
	}

	private readonly _runningSubagentIds = new Set<string>();

	private _releaseSubagentPause(): void {
		this._subagentPauseActive = false;
		this._restoreToolsAfterSubagentBarrier();
	}

	private _restoreToolsAfterSubagentBarrier(): void {
		if (!this._subagentBarrierActiveToolNames) return;
		const toolNames = this._subagentBarrierActiveToolNames;
		this._subagentBarrierActiveToolNames = undefined;
		this.setActiveToolsByName(toolNames);
	}

	private _closeSubagentLaunchBatch(): void {
		if (!this._subagentLaunchBatchOpen) return;
		this._subagentLaunchBatchOpen = false;
		if (this._pendingSubagentResults.size > 0) {
			this._releaseSubagentPause();
			this._scheduleSubagentResultDelivery();
		} else if (this._runningSubagentIds.size > 0) {
			this.setActiveToolsByName([]);
		} else {
			this._releaseSubagentPause();
		}
	}

	private _queueSubagentResult(jobId: string, result: string): void {
		this._pendingSubagentResults.set(jobId, result);
		if (this._subagentLaunchBatchOpen) return;
		this._releaseSubagentPause();
		this._scheduleSubagentResultDelivery();
	}

	private _scheduleSubagentResultDelivery(): void {
		if (this._subagentLaunchBatchOpen || this._subagentResultDrainPromise || this._pendingSubagentResults.size === 0) {
			return;
		}

		const drainPromise = this._drainPendingSubagentResults();
		this._subagentResultDrainPromise = drainPromise;
		void drainPromise
			.catch((error) => console.error("Failed to drain Subagent results:", error))
			.finally(() => {
				this._subagentResultDrainPromise = undefined;
				if (!this._subagentLaunchBatchOpen && this._pendingSubagentResults.size > 0) {
					this._scheduleSubagentResultDelivery();
				}
			});
	}

	private async _drainPendingSubagentResults(): Promise<void> {
		this._subagentResultDeliveryInProgress = true;
		try {
			while (!this._subagentLaunchBatchOpen && this._pendingSubagentResults.size > 0) {
				const next = this._pendingSubagentResults.entries().next().value as [string, string] | undefined;
				if (!next) return;
				const [completedJobId, completedResult] = next;
				this._pendingSubagentResults.delete(completedJobId);
				this._releaseSubagentPause();

				const content = [
					`[Subagent Job ${completedJobId} finished]`,
					completedResult,
					"First emit a brief user-visible update about this result. Then decide whether to continue work now or end this turn and wait for another running Subagent. Other results will arrive separately.",
				].join("\n\n");
				try {
					await this.sendCustomMessage({
						customType: "subagent_result",
						content: [{ type: "text", text: content }],
						display: true,
					}, { triggerTurn: true, deliverAs: "followUp" });
					await this.agent.waitForIdle();
				} catch (error) {
					console.error("Failed to deliver Subagent result:", error);
				}
			}
		} finally {
			this._subagentResultDeliveryInProgress = false;
		}
	}

	private _setSubagentRunning(jobId: string, running: boolean): void {
		const previousCount = this._runningSubagentIds.size;
		if (running) {
			if (!this._subagentBarrierActiveToolNames) {
				this._subagentBarrierActiveToolNames = this.getActiveToolNames();
			}
			this._subagentPauseActive = true;
			this._subagentLaunchBatchOpen = true;
			this._runningSubagentIds.add(jobId);
			this.setActiveToolsByName(this._toolRegistry.has("spawn_agent") ? ["spawn_agent"] : this._toolRegistry.has("subagent") ? ["subagent"] : []);
		} else {
			this._runningSubagentIds.delete(jobId);
		}
		if (this._runningSubagentIds.size !== previousCount) {
			this._emit({
				type: "subagent_status",
				runningCount: this._runningSubagentIds.size,
				runningJobIds: [...this._runningSubagentIds],
			});
		}
	}

	getRunningSubagentCount(): number {
		return this._runningSubagentIds.size;
	}

	getRunningSubagentIds(): string[] {
		return [...this._runningSubagentIds];
	}

	// Track last assistant message for auto-compaction check
	private _lastAssistantMessage: AssistantMessage | undefined = undefined;

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
		// When a user message starts, check if it's from either queue and remove it BEFORE emitting
		// This ensures the UI sees the updated queue state
		if (event.type === "message_start" && event.message.role === "user") {
			this._overflowRecoveryAttempted = false;
			const messageText = this._getUserMessageText(event.message);
			if (messageText) {
				// Check steering queue first
				const steeringIndex = this._steeringMessages.indexOf(messageText);
				if (steeringIndex !== -1) {
					this._steeringMessages.splice(steeringIndex, 1);
					this._steeringQueueEntries.splice(steeringIndex, 1);
					this._emitQueueUpdate();
				} else {
					// Check follow-up queue
					const followUpIndex = this._followUpMessages.indexOf(messageText);
					if (followUpIndex !== -1) {
						this._followUpMessages.splice(followUpIndex, 1);
						this._followUpQueueEntries.splice(followUpIndex, 1);
						this._emitQueueUpdate();
					}
				}
			}
		}

		// Runtime context is model-only scaffolding. Do not leak it through host
		// events or persistence as if it were conversational content.
		if (
			(event.type === "message_start" || event.type === "message_update" || event.type === "message_end")
			&& event.message.role === "custom"
			&& event.message.customType === "workflow_context"
		) return;

		// Emit to extensions first
		await this._emitExtensionEvent(event);

		// Notify all listeners
		this._emit(event.type === "agent_end" ? { ...event, willRetry: this._willRetryAfterAgentEnd(event) } : event);

		// Handle session persistence
		if (event.type === "message_end") {
			// Check if this is a custom message from extensions
			if (event.message.role === "custom" && event.message.customType !== "workflow_context") {
				// Persist as CustomMessageEntry
				this.sessionManager.appendCustomMessageEntry(
					event.message.customType,
					event.message.content,
					event.message.display,
					event.message.details,
				);
			} else if (
				event.message.role === "user" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult"
			) {
				// Regular LLM message - persist as SessionMessageEntry
				this.sessionManager.appendMessage(event.message);
				if (event.message.role === "assistant" && this._collaborationMode === "plan") {
					this._persistWorkflowProposal(event.message as AssistantMessage);
				}
			}
			// Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere

			// Track assistant message for auto-compaction (checked on agent_end)
			if (event.message.role === "assistant") {
				this._lastAssistantMessage = event.message;

				const assistantMsg = event.message as AssistantMessage;
				if (assistantMsg.stopReason !== "error") {
					this._overflowRecoveryAttempted = false;
				}

				// Reset retry counter immediately on successful assistant response
				// This prevents accumulation across multiple LLM calls within a turn
				if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
					this._emit({
						type: "auto_retry_end",
						success: true,
						attempt: this._retryAttempt,
					});
					this._retryAttempt = 0;
				}
			}
		}

		if (event.type === "turn_end") {
			this._appendWorkflowCheckpoint("step_completed");
		}
		if (event.type === "agent_end") {
			const finalMessage = [...event.messages].reverse().find((message) => message.role === "assistant") as
				| AssistantMessage
				| undefined;
			this._appendWorkflowCheckpoint(
				finalMessage?.stopReason === "aborted"
					? "aborted"
					: finalMessage?.stopReason === "error"
						? "error"
						: "completed",
			);
		}
	};

	private _willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: "agent_end" }>): boolean {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
			return false;
		}

		for (let i = event.messages.length - 1; i >= 0; i--) {
			const message = event.messages[i];
			if (message.role === "assistant") {
				return this._isRetryableError(message as AssistantMessage);
			}
		}
		return false;
	}

	private _persistWorkflowProposal(message: AssistantMessage): void {
		const text = Array.isArray(message.content)
			? message.content.filter((part): part is TextContent => part.type === "text").map((part) => part.text).join("\n")
			: String(message.content ?? "");
		const markdown = extractProposedPlan(text);
		if (!markdown) return;
		const previous = this.workflowProposal;
		const entryId = this.sessionManager.appendCustomEntry("workflow_proposal", {
			markdown,
			revision: (previous?.revision ?? 0) + 1,
			updatedAt: new Date().toISOString(),
			sourceMessageId: this.sessionManager.getBranch().at(-1)?.id,
		});
		const entry = this.sessionManager.getEntry(entryId);
		if (entry) this._emit({ type: "entry_appended", entry });
	}

	/** Extract text content from a message */
	private _getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const content = message.content;
		if (typeof content === "string") return content;
		const textBlocks = content.filter((c) => c.type === "text");
		return textBlocks.map((c) => (c as TextContent).text).join("");
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	private _findLastAssistantMessage(): AssistantMessage | undefined {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as AssistantMessage;
			}
		}
		return undefined;
	}

	private _replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void {
		// Agent-core stores the finalized message object in its state before emitting message_end.
		// SessionManager persistence happens later in _handleAgentEvent() with event.message.
		// Mutating this object in place keeps agent state, later turn/agent events, listeners,
		// and the eventual SessionManager.appendMessage(event.message) persistence in sync.
		if (target === replacement) {
			return;
		}

		const targetRecord = target as unknown as Record<string, unknown>;
		for (const key of Object.keys(targetRecord)) {
			delete targetRecord[key];
		}
		Object.assign(targetRecord, replacement);
	}

	private _normalizeSubagentLaunchMessage(message: AgentMessage): void {
		if (message.role !== "assistant") return;
		const firstSubagentIndex = message.content.findIndex(
			(part) => part.type === "toolCall" && (part.name === "spawn_agent" || part.name === "subagent"),
		);
		if (firstSubagentIndex === -1) return;

		const content = message.content.filter((part, index) => {
			if (part.type === "toolCall") return part.name === "spawn_agent" || part.name === "subagent";
			if (index > firstSubagentIndex && part.type === "text") return false;
			return true;
		});
		this._replaceMessageInPlace(message, { ...message, content });
	}

	/** Emit extension events based on agent events */
	private async _emitExtensionEvent(event: AgentEvent): Promise<void> {
		if (event.type === "agent_start") {
			this._turnIndex = 0;
			await this._extensionRunner.emit({ type: "agent_start" });
		} else if (event.type === "agent_end") {
			await this._extensionRunner.emit({ type: "agent_end", messages: event.messages });
		} else if (event.type === "turn_start") {
			const extensionEvent: TurnStartEvent = {
				type: "turn_start",
				turnIndex: this._turnIndex,
				timestamp: Date.now(),
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "turn_end") {
			const extensionEvent: TurnEndEvent = {
				type: "turn_end",
				turnIndex: this._turnIndex,
				message: event.message,
				toolResults: event.toolResults,
			};
			await this._extensionRunner.emit(extensionEvent);
			this._closeSubagentLaunchBatch();
			this._turnIndex++;
		} else if (event.type === "message_start") {
			const extensionEvent: MessageStartEvent = {
				type: "message_start",
				message: event.message,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_update") {
			const extensionEvent: MessageUpdateEvent = {
				type: "message_update",
				message: event.message,
				assistantMessageEvent: event.assistantMessageEvent,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_end") {
			const extensionEvent: MessageEndEvent = {
				type: "message_end",
				message: event.message,
			};
			const replacement = await this._extensionRunner.emitMessageEnd(extensionEvent);
			if (replacement) {
				this._replaceMessageInPlace(event.message, replacement);
			}
			this._normalizeSubagentLaunchMessage(event.message);
		} else if (event.type === "tool_execution_start") {
			const extensionEvent: ToolExecutionStartEvent = {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_update") {
			const extensionEvent: ToolExecutionUpdateEvent = {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: event.partialResult,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_end") {
			const extensionEvent: ToolExecutionEndEvent = {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError,
			};
			await this._extensionRunner.emit(extensionEvent);
		}
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this._eventListeners.push(listener);

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this._eventListeners.indexOf(listener);
			if (index !== -1) {
				this._eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Temporarily disconnect from agent events.
	 * User listeners are preserved and will receive events again after resubscribe().
	 * Used internally during operations that need to pause event processing.
	 */
	private _disconnectFromAgent(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
	}

	/**
	 * Reconnect to agent events after _disconnectFromAgent().
	 * Preserves all existing listeners.
	 */
	private _reconnectToAgent(): void {
		if (this._unsubscribeAgent) return; // Already connected
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	dispose(): void {
		try {
			this.abortRetry();
			this.abortCompaction();
			this.abortBranchSummary();
			this.abortBash();
			this._workflowRuntime.abortAllToolCalls();
			this.agent.abort();
		} catch {
			// Dispose must succeed even if an abort hook throws.
		}

		this._extensionRunner.invalidate(
			"This extension ctx is stale after session replacement or reload. Do not use a captured metis or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
		);
		this._disconnectFromAgent();
		this._eventListeners = [];
		this._memoryCoordinator?.dispose();
		cleanupSessionResources(this.sessionId);
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model<any> | undefined {
		return this.agent.state.model;
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	/** Current deterministic collaboration policy. */
	get collaborationMode(): CollaborationMode {
		return this._collaborationMode;
	}

	/** Immutable input used for the currently executing model step. */
	get stepSnapshot(): StepSnapshot | undefined {
		return this._workflowRuntime.snapshot;
	}

	get contextWindowId(): string {
		return this._workflowRuntime.currentContextWindowId;
	}

	/** Typed state shared by TUI, Desktop, JSON, RPC and Server. */
	get memoryState(): MemoryState {
		return this._memoryCoordinator?.getState() ?? {
			enabled: false, phase: "disabled", globalCount: 0, projectCount: 0, pendingJobs: 0,
		};
	}

	setMemoryEnabled(enabled: boolean): MemoryState {
		if (this.isStreaming) throw new Error("Memory settings can only change while the session is idle.");
		this.settingsManager.setMemoryEnabled(enabled);
		return this._memoryCoordinator?.setEnabled(enabled) ?? this.memoryState;
	}

	async runMemory(): Promise<MemoryState> {
		if (this.isStreaming) throw new Error("Memory can only run while the session is idle.");
		return (await this._memoryCoordinator?.run(true)) ?? this.memoryState;
	}

	abortMemory(): MemoryState {
		this._memoryCoordinator?.abort();
		return this.memoryState;
	}

	searchMemory(query?: string, limit?: number, filterOptions?: MemorySearchOptions): MemoryRecordSummary[] { return this._memoryCoordinator?.search(query, limit, filterOptions) ?? []; }
	queryMemoryDb(sql: string, params?: Array<string | number | null | undefined>): Array<Record<string, unknown>> { return this._memoryCoordinator?.query(sql, params) ?? []; }
	forgetMemory(id: string): boolean {
		if (this.isStreaming) throw new Error("Memory can only change while the session is idle.");
		return this._memoryCoordinator?.forget(id) ?? false;
	}
	resetMemory(confirm: string): void {
		if (this.isStreaming) throw new Error("Memory can only change while the session is idle.");
		this._memoryCoordinator?.reset(confirm);
	}

	/** Content-free instruction provenance for TUI, Desktop, and RPC clients. */
	get instructionSources(): InstructionSourceSummary[] {
		return summarizeInstructionStack(this._instructionStack);
	}

	/** Reserved for loader budget/trust diagnostics; never contains instruction content. */
	get instructionDiagnostics(): string[] {
		return [];
	}

	/** Latest persisted plan on the active branch, including legacy Markdown recovery. */
	get workflowPlan(): WorkflowPlanState | undefined {
		return resolveWorkflowPlan(this.sessionManager.getBranch());
	}

	/** Latest durable conversational plan. Old sessions recover lazily without a migration write. */
	get workflowProposal(): WorkflowProposalState | undefined {
		return resolveWorkflowProposal(this.sessionManager.getBranch());
	}

	/** Explicit-only Performance run state for this session/process, if any. */
	get performanceRun(): Readonly<PerformanceRunState> | undefined {
		return this._performanceRuntime.state;
	}

	/** Safe transport view; mission text and gate evidence stay in governance files. */
	get performanceRunSummary(): PerformanceRunSummary | undefined {
		return summarizePerformanceRun(this._performanceRuntime.state);
	}

	private _appendPerformanceRunEntry(state: PerformanceRunState): void {
		const entryId = this.sessionManager.appendCustomEntry("performance_run", state);
		const entry = this.sessionManager.getEntry(entryId);
		if (entry) this._emit({ type: "entry_appended", entry });
	}

	private _appendWorkflowPlanEntry(plan: Omit<WorkflowPlanState, "updatedAt">): void {
		const entryId = this.sessionManager.appendCustomEntry("workflow_plan", {
			...plan,
			updatedAt: new Date().toISOString(),
		});
		const entry = this.sessionManager.getEntry(entryId);
		if (entry) this._emit({ type: "entry_appended", entry });
	}

	private _appendWorkflowPlanReset(): void {
		const entryId = this.sessionManager.appendCustomEntry("workflow_plan_reset", {
			updatedAt: new Date().toISOString(),
		});
		const entry = this.sessionManager.getEntry(entryId);
		if (entry) this._emit({ type: "entry_appended", entry });
		this._activeWorkflowTaskId = undefined;
		this._activeWorkflowProposalRevision = undefined;
	}

	private _resetCompletedWorkflowPlanForNewPrompt(): void {
		const current = this.workflowPlan;
		if (!current?.plan.length || !current.plan.every((item) => item.status === "completed")) return;
		this._appendWorkflowPlanReset();
	}

	private _beginProposalExecution(proposal: WorkflowProposalState): void {
		const taskId = randomUUID();
		this._activeWorkflowTaskId = taskId;
		this._activeWorkflowProposalRevision = proposal.revision;
		this._workflowRuntime.beginProposalExecution(taskId, (phase) => {
			if (phase === "active") return;
			this._appendWorkflowPlanEntry({
				taskId,
				proposalRevision: proposal.revision,
				phase,
				plan: [],
			});
		});
	}

	get pendingUserInput(): AskUserRequest | undefined { return this._pendingUserInput; }

	setAskUserHandler(handler: AskUserHandler | undefined): void { this._askUserHandler = handler; }

	private async _askUser(request: AskUserRequest, signal?: AbortSignal): Promise<AskUserResponse> {
		if (!this._askUserHandler) throw new Error("ask_user is unsupported in this mode because no interactive user-input handler is configured.");
		this._pendingUserInput = request;
		this._emit({ type: "user_input_request", request });
		try {
			const handler = this._askUserHandler;
			const response = await new Promise<AskUserResponse>((resolve, reject) => {
				const cancel = () => resolve({ cancelled: true, answers: [] });
				if (signal?.aborted) return cancel();
				signal?.addEventListener("abort", cancel, { once: true });
				handler(request, signal).then(resolve, reject).finally(() => signal?.removeEventListener("abort", cancel));
			});
			const error = validateAskUserResponse(request, response);
			if (error) throw new Error(error);
			return response;
		}
		finally { if (this._pendingUserInput?.requestId === request.requestId) this._pendingUserInput = undefined; }
	}

	/** Hosts with a visible ask surface opt into the upstream attended run chooser. */
	setPerformanceAttendance(attendance: PerformanceAttendance): void {
		if (this.isStreaming || this.isCompacting) throw new Error("Cannot change Performance attendance while the agent is running.");
		this._performanceAttendance = attendance;
	}

	get performanceAttendance(): PerformanceAttendance {
		return this._performanceAttendance;
	}

	private _parsePerformanceInvocation(text: string): {
		mission: string;
		concurrency?: PerformanceConcurrency;
		maxConcurrent?: number;
		agentSelection?: "off" | "auto" | "explicit";
		agentModels?: Array<{ provider: string; model: string }>;
		hasDirectives: boolean;
	} {
		let mission = text;
		let concurrency: PerformanceConcurrency | undefined;
		let maxConcurrent: number | undefined;
		let agentSelection: "off" | "auto" | "explicit" | undefined;
		let agentModels: Array<{ provider: string; model: string }> | undefined;
		let hasDirectives = false;
		const modeMatch = mission.match(/\bmode=([^\s]+)/i);
		const leadingMode = mission.match(/^\s*(tokensaver|wide|billionaire|custom)\b/i);
		const mode = (modeMatch?.[1] ?? leadingMode?.[1])?.toLowerCase();
		if (mode) {
			hasDirectives = true;
			if (mode === "tokensaver") concurrency = "tokensaver";
			else if (mode === "wide" || mode === "billionaire") concurrency = "wide";
			else if (mode === "custom") concurrency = "custom";
			else throw new Error(`Invalid Performance mode ${JSON.stringify(mode)}.`);
			mission = mission.replace(modeMatch?.[0] ?? leadingMode![0], " ");
		}
		const capMatch = mission.match(/\bmax_subs=([^\s]+)/i);
		if (capMatch) {
			hasDirectives = true;
			const cap = Number(capMatch[1]);
			if (!Number.isInteger(cap) || cap < 1 || cap > 200) throw new Error(`Invalid Performance max_subs ${JSON.stringify(capMatch[1])}.`);
			if (concurrency !== "custom") throw new Error("max_subs requires mode=custom.");
			maxConcurrent = cap;
			mission = mission.replace(capMatch[0], " ");
		}
		if (concurrency === "custom" && maxConcurrent === undefined) throw new Error("mode=custom requires max_subs=N.");
		const agentsMatch = mission.match(/\bagents=([^\s]+)/i);
		if (agentsMatch) {
			hasDirectives = true;
			const requested = agentsMatch[1]!;
			const available = this._modelRegistry.getAvailable();
			const resolveExact = (entry: string): Model<any> => {
				const matches = available.filter((model) => entry === `${model.provider}/${model.id}` || entry === `${model.provider}:${model.id}` || entry === model.id);
				if (matches.length !== 1) throw new Error(`Performance agents selector ${JSON.stringify(entry)} is not one exact configured model.`);
				return matches[0]!;
			};
			if (requested === "off") agentSelection = "off";
			else if (requested === "auto") agentSelection = "auto";
			else {
				const autoPool = requested.startsWith("auto:");
				const entries = (autoPool ? requested.slice("auto:".length) : requested).split(",").filter(Boolean);
				if (!entries.length) throw new Error("Performance agents selector requires one or more exact configured models.");
				agentSelection = autoPool ? "auto" : "explicit";
				agentModels = entries.map(resolveExact).map((model) => ({ provider: model.provider, model: model.id }));
			}
			mission = mission.replace(agentsMatch[0], " ");
		}
		return { mission: hasDirectives ? mission.replace(/\s+/g, " ").trim() : text, concurrency, maxConcurrent, agentSelection, agentModels, hasDirectives };
	}

	private async _resolvePerformanceStart(mission: string, invocation?: ReturnType<AgentSession["_parsePerformanceInvocation"]>): Promise<{
		kind: "start";
		mission: string;
		concurrency: PerformanceConcurrency;
		maxConcurrent: number;
		agentSelection: "off" | "auto" | "explicit";
		agentModels: Array<{ provider: string; model: string }>;
		attendance: PerformanceAttendance;
		effortCapability: "selectable" | "inherited-only" | "unsupported" | "unknown";
		maxReasoningEffort?: string;
	}> {
		const requestedModels = invocation?.agentModels?.map(({ provider, model }) => this._modelRegistry.find(provider, model)).filter((model): model is Model<any> => Boolean(model)) ?? [];
		const eligibleModels = requestedModels.length > 0
			? requestedModels
			: this.model
			? [this.model, ...this._scopedModels.map((entry) => entry.model)]
				.filter((model, index, all) => model.provider === this.model!.provider && this._modelRegistry.hasConfiguredAuth(model) && all.findIndex((candidate) => modelsAreEqual(candidate, model)) === index)
			: [];
		const levels = eligibleModels.flatMap((model) => getSupportedThinkingLevels(model) as ThinkingLevel[]);
		const effortRank = (level: ThinkingLevel | undefined) => ["off", "minimal", "low", "medium", "high", "xhigh"].indexOf(level ?? "off");
		const maxReasoningEffort = levels.reduce<ThinkingLevel | undefined>((maximum, level) => effortRank(level) > effortRank(maximum) ? level : maximum, undefined);
		const effortCapability = !this.model
			? "unknown"
			: eligibleModels.some((model) => getSupportedThinkingLevels(model).length > 1) ? "selectable" : levels[0] === "off" ? "unsupported" : "inherited-only";
		let concurrency: PerformanceConcurrency = invocation?.concurrency ?? "tokensaver";
		let maxConcurrent = invocation?.maxConcurrent ?? (concurrency === "wide" ? 200 : 6);
		let agentSelection: "off" | "auto" | "explicit" = invocation?.agentSelection ?? "off";
		let agentModels = invocation?.agentModels ?? [];
		let attendance: PerformanceAttendance = "unattended";
		if (!invocation?.hasDirectives && this._performanceAttendance === "attended" && this._askUserHandler) {
			attendance = "attended";
			const isChinese = /[\u4e00-\u9fa5]/.test(mission);
			const response = await this._askUser({
				requestId: `performance-chooser-${randomUUID()}`,
				toolCallId: `performance-chooser-${randomUUID()}`,
				questions: isChinese
					? [
						{
							id: "performance_concurrency",
							header: "并发策略",
							question: "为本次任务执行选择并发策略。",
							options: [
								{ label: "tokensaver（省 Token 模式）", description: "最多 6 个并发 Agent；适合日常常规任务（推荐）。", recommended: true },
								{ label: "wide（宽并发模式）", description: "最多 200 个并发 Agent；适合大规模完全解耦的独立任务。" },
								{ label: "custom（自定义模式）", description: "自定义并发模式；默认并发上限为 12。" },
							],
						},
						{
							id: "performance_agent_selection",
							header: "子 Agent 策略",
							question: "选择子 Agent 模型的调用与思考深度策略。",
							options: [
								{ label: "inherit（继承当前配置）", description: "子 Agent 继承当前模型与思考配置（推荐）。", recommended: true },
								{ label: "auto-tier（按角色自动分级）", description: "根据角色等级原生自适应分配思考强度。" },
								{ label: "custom-set（手动指定策略）", description: "保持明确的操作员指定子 Agent 策略。" },
							],
						},
						{
							id: "performance_custom_cap",
							header: "并发上限",
							question: "如果上一项选择了自定义模式，请选择并发 Agent 上限；否则此项将被自动忽略。",
							options: [
								{ label: "6", description: "保守并发上限。" },
								{ label: "12", description: "均衡并发上限（推荐）。", recommended: true },
								{ label: "24", description: "高并发上限（适用于独立分支）。" },
							],
						},
					]
					: [
						{
							id: "performance_concurrency",
							header: "Concurrency",
							question: "Choose parallelism for this run.",
							options: [
								{ label: "tokensaver", description: "Up to 6 live agents; recommended for ordinary work.", recommended: true },
								{ label: "wide", description: "Up to 200 live agents for proven disjoint work." },
								{ label: "custom", description: "Use custom mode; default ceiling is 12 unless host provides a numeric value." },
							],
						},
						{
							id: "performance_agent_selection",
							header: "Agent selection",
							question: "Choose how child model and reasoning settings are selected.",
							options: [
								{ label: "inherit", description: "Children inherit current model and reasoning settings.", recommended: true },
								{ label: "auto-tier", description: "Use native role-aware reasoning effort where supported." },
								{ label: "custom-set", description: "Keep an explicit operator-selected child-agent policy." },
							],
						},
						{
							id: "performance_custom_cap",
							header: "Custom cap",
							question: "If you choose custom concurrency, choose its live-agent ceiling; otherwise this answer is ignored.",
							options: [
								{ label: "6", description: "Conservative custom ceiling." },
								{ label: "12", description: "Balanced custom ceiling.", recommended: true },
								{ label: "24", description: "High custom ceiling for independently owned lanes." },
							],
						},
					],
			});
			if (response.cancelled) throw new Error("Performance run setup cancelled by the operator.");
			const answers = new Map(response.answers.map((answer) => [answer.id, answer.value.trim().toLowerCase()]));
			const selectedConcurrency = answers.get("performance_concurrency") || "";
			if (selectedConcurrency === "wide" || selectedConcurrency.includes("wide")) {
				concurrency = "wide";
				maxConcurrent = 200;
			} else if (selectedConcurrency === "custom" || selectedConcurrency.includes("custom")) {
				concurrency = "custom";
				const capStr = answers.get("performance_custom_cap") || "";
				const customCap = Number(capStr.replace(/[^0-9]/g, "")) || 12;
				if (!Number.isInteger(customCap) || customCap < 1 || customCap > 200) {
					throw new Error(`Invalid custom Performance concurrency cap ${JSON.stringify(answers.get("performance_custom_cap"))}.`);
				}
				maxConcurrent = customCap;
			} else if (selectedConcurrency === "tokensaver" || selectedConcurrency.includes("tokensaver") || !selectedConcurrency) {
				concurrency = "tokensaver";
				maxConcurrent = 6;
			} else {
				throw new Error(`Invalid Performance concurrency selection ${JSON.stringify(selectedConcurrency)}.`);
			}
			const selectedAgents = answers.get("performance_agent_selection") || "";
			if (selectedAgents === "auto-tier" || selectedAgents.includes("auto-tier") || selectedAgents.includes("auto")) agentSelection = "auto";
			else if (selectedAgents === "custom-set" || selectedAgents.includes("custom-set") || selectedAgents.includes("custom")) agentSelection = "explicit";
			else if (selectedAgents === "inherit" || selectedAgents.includes("inherit") || !selectedAgents) agentSelection = "off";
			else throw new Error(`Invalid Performance agent selection ${JSON.stringify(selectedAgents)}.`);
		}
		return { kind: "start", mission, concurrency, maxConcurrent, agentSelection, agentModels, attendance, effortCapability, maxReasoningEffort };
	}

	private _getPerformanceChildModel(childRole: string): Model<any> | undefined {
		const run = this._performanceRuntime.state;
		if (!run || run.agentSelection === "off" || !this.model) return undefined;
		const criticalRoles = new Set(["scope-coordinator", "planner", "reviewer", "fresh-verifier", "verifier", "juror", "goal-checker", "arbiter", "depth-prober"]);
		const explicitCandidates = run.agentModels.map(({ provider, model }) => this._modelRegistry.find(provider, model)).filter((model): model is Model<any> => Boolean(model));
		const candidates = (explicitCandidates.length > 0 ? explicitCandidates : [this.model, ...this._scopedModels.map((entry) => entry.model)])
			.filter((model, index, all) => (explicitCandidates.length > 0 || model.provider === this.model!.provider) && this._modelRegistry.hasConfiguredAuth(model) && all.findIndex((candidate) => modelsAreEqual(candidate, model)) === index);
		if (!candidates.length) return undefined;
		if (run.agentSelection === "explicit") return candidates[Math.min(criticalRoles.has(childRole) ? 0 : 1, candidates.length - 1)];
		if (!criticalRoles.has(childRole)) return undefined;
		const effortRank = (model: Model<any>) => {
			const maximum = getSupportedThinkingLevels(model).at(-1) as ThinkingLevel | undefined;
			return ["off", "minimal", "low", "medium", "high", "xhigh"].indexOf(maximum ?? "off");
		};
		return candidates.reduce((best, candidate) => effortRank(candidate) > effortRank(best) ? candidate : best, this.model);
	}

	private _getPerformanceChildThinking(childRole: string): ThinkingLevel | undefined {
		const run = this._performanceRuntime.state;
		const selectedModel = this._getPerformanceChildModel(childRole) ?? this.model;
		if (!run || run.agentSelection === "off" || !selectedModel) return this.thinkingLevel;
		const levels = getSupportedThinkingLevels(selectedModel);
		const maximum = levels.at(-1) as ThinkingLevel | undefined;
		if (!maximum) return this.thinkingLevel;
		const criticalRoles = new Set(["scope-coordinator", "planner", "reviewer", "fresh-verifier", "verifier", "juror", "goal-checker", "arbiter", "depth-prober"]);
		if (criticalRoles.has(childRole)) return maximum;
		return (levels.includes("high") ? "high" : maximum) as ThinkingLevel;
	}

	/**
	 * Switch only while idle. Plan mode removes every non-read tool from both
	 * model-visible state and dispatch-time policy.
	 */
	setCollaborationMode(mode: CollaborationMode): void {
		if (this.isStreaming || this.isCompacting) {
			throw new Error("Cannot change collaboration mode while the agent is running.");
		}
		if (mode === this._collaborationMode) return;
		if (mode === "plan") {
			this._buildToolNames = this._buildToolNames ?? this.getActiveToolNames();
			this._collaborationMode = mode;
			this.setActiveToolsByName(this._buildToolNames);
		} else {
			this._collaborationMode = mode;
			this.setActiveToolsByName(this._buildToolNames ?? this.getActiveToolNames());
		}
		this._workflowRuntime.beginNewContextWindow();
		this._emit({ type: "collaboration_mode_changed", mode });
		this.sessionManager.appendCollaborationModeChange(mode);
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** Current effective system prompt (includes any per-turn extension modifications) */
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}

	/** Current retry attempt (0 if not retrying) */
	get retryAttempt(): number {
		return this._retryAttempt;
	}

	/**
	 * Get the names of currently active tools.
	 * Returns the names of tools currently set on the agent.
	 */
	getActiveToolNames(): string[] {
		return this.agent.state.tools.map((t) => t.name);
	}

	/**
	 * Get all configured tools with name, description, parameter schema, prompt guidelines, and source metadata.
	 */
	getAllTools(): ToolInfo[] {
		return Array.from(this._toolDefinitions.values())
			.filter(({ definition }) => this._workflowRuntime.canDispatchTool(definition.name, definition, this._collaborationMode))
			.map(({ definition, sourceInfo }) => ({
				name: definition.name,
				description: definition.description,
				parameters: definition.parameters,
				promptGuidelines: definition.promptGuidelines,
				capabilities: definition.capabilities,
				sourceInfo,
			}));
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return this._toolDefinitions.get(name)?.definition;
	}

	/**
	 * Set active tools by name.
	 * Only tools in the registry can be enabled. Unknown tool names are ignored.
	 * Also rebuilds the system prompt to reflect the new tool set.
	 * Changes take effect on the next agent turn.
	 */
	setActiveToolsByName(toolNames: string[]): void {
		const tools: AgentTool[] = [];
		const validToolNames: string[] = [];
		for (const name of toolNames) {
			const tool = this._toolRegistry.get(name);
			const definition = this._toolDefinitions.get(name)?.definition;
			if (tool && this._workflowRuntime.canDispatchTool(name, definition, this._collaborationMode)) {
				tools.push(tool);
				validToolNames.push(name);
			}
		}
		this.agent.state.tools = tools;

		// Rebuild base system prompt with new tool set
		this._baseSystemPrompt = this._rebuildSystemPrompt(validToolNames);
		this.agent.state.systemPrompt = this._systemPromptOverride ?? this._baseSystemPrompt;
	}

	/** Whether compaction or branch summarization is currently running */
	get isCompacting(): boolean {
		return (
			this._autoCompactionAbortController !== undefined ||
			this._compactionAbortController !== undefined ||
			this._branchSummaryAbortController !== undefined
		);
	}

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	/** Current steering mode */
	get steeringMode(): "all" | "one-at-a-time" {
		return this.agent.steeringMode;
	}

	/** Current follow-up mode */
	get followUpMode(): "all" | "one-at-a-time" {
		return this.agent.followUpMode;
	}

	/** Current session file path, or undefined if sessions are disabled */
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	/** Current session display name, if set */
	get sessionName(): string | undefined {
		return this.sessionManager.getSessionName();
	}

	get isGeneratingSessionName(): boolean {
		return this._isGeneratingSessionName;
	}

	get sessionNameError(): string | undefined {
		return this._sessionNameError;
	}

	/** Scoped models for cycling (from --models flag) */
	get scopedModels(): ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }> {
		return this._scopedModels;
	}

	/** Update scoped models for cycling */
	setScopedModels(scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
		this._scopedModels = scopedModels;
	}

	/** File-based prompt templates */
	get promptTemplates(): ReadonlyArray<PromptTemplate> {
		return this._resourceLoader.getPrompts().prompts;
	}

	private _normalizePromptSnippet(text: string | undefined): string | undefined {
		if (!text) return undefined;
		const oneLine = text
			.replace(/[\r\n]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return oneLine.length > 0 ? oneLine : undefined;
	}

	private _normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
		if (!guidelines || guidelines.length === 0) {
			return [];
		}

		const unique = new Set<string>();
		for (const guideline of guidelines) {
			const normalized = guideline.trim();
			if (normalized.length > 0) {
				unique.add(normalized);
			}
		}
		return Array.from(unique);
	}

	private _rebuildSystemPrompt(toolNames: string[]): string {
		const validToolNames = toolNames.filter((name) => this._toolRegistry.has(name));
		const toolSnippets: Record<string, string> = {};
		const promptGuidelines: string[] = [];
		for (const name of validToolNames) {
			const snippet = this._toolPromptSnippets.get(name);
			if (snippet) {
				toolSnippets[name] = snippet;
			}

			const toolGuidelines = this._toolPromptGuidelines.get(name);
			if (toolGuidelines) {
				promptGuidelines.push(...toolGuidelines);
			}
		}

		const loaderSystemPrompt = this._resourceLoader.getSystemPrompt();
		const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();
		const appendSystemPrompt =
			loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : undefined;
		const loadedSkills = this._resourceLoader.getSkills ? this._resourceLoader.getSkills().skills : [];
		const loadedAgents = this._resourceLoader.getAgents ? this._resourceLoader.getAgents().agents : [];
		const loadedContextFiles = this._resourceLoader.getAgentsFiles ? this._resourceLoader.getAgentsFiles().agentsFiles : [];

		const memoryOverview = this._memoryCoordinator?.getMemoryOverview();

		this._baseSystemPromptOptions = {
			cwd: this._cwd,
			sessionId: this.sessionManager.getSessionId(),
			skills: loadedSkills,
			agents: loadedAgents,
			contextFiles: loadedContextFiles,
			customPrompt: loaderSystemPrompt,
			appendSystemPrompt,
			selectedTools: validToolNames,
			toolSnippets,
			promptGuidelines,
			collaborationMode: this._collaborationMode,
			memoryOverview,
		};
		this._instructionStack = buildInstructionStack(this._baseSystemPromptOptions);
		return buildSystemPrompt(this._baseSystemPromptOptions);
	}

	private _freezeStepSnapshot(messages: AgentMessage[], instructions = this._instructionStack): StepSnapshot {
		return this._workflowRuntime.freeze({
			turnId: this._turnIndex,
			model: this.agent.state.model,
			thinkingLevel: this.agent.state.thinkingLevel,
			collaborationMode: this._collaborationMode,
			instructions,
			messages,
			tools: this.agent.state.tools,
		});
	}

	private _appendWorkflowCheckpoint(reason: "prompt_accepted" | "step_completed" | "compaction" | "aborted" | "error" | "completed"): void {
		this.sessionManager.appendCustomEntry("workflow_checkpoint", this._workflowRuntime.checkpoint(reason, this._collaborationMode));
		const latestUser = [...this.messages].reverse().find((message) => message.role === "user");
		const goal = latestUser?.role === "user"
			? (Array.isArray(latestUser.content)
				? latestUser.content.filter((part): part is TextContent => part.type === "text").map((part) => part.text).join("\n")
				: String(latestUser.content))
			: undefined;
		let lastUserIndex = 0;
		for (let index = this.messages.length - 1; index >= 0; index -= 1) {
			if (this.messages[index]?.role === "user") { lastUserIndex = index; break; }
		}
		const recentTurn = this.messages.slice(lastUserIndex).flatMap((message) => {
			if (!("content" in message)) return [];
			const content = Array.isArray(message.content)
				? message.content.filter((part): part is TextContent => part.type === "text").map((part) => part.text).join("\n")
				: String(message.content ?? "");
			return content.trim() ? [{ role: message.role, content }] : [];
		}).slice(-12);
		this._memoryCoordinator?.recordCheckpoint({
			sessionId: this.sessionManager.getSessionId(), reason, timestamp: new Date().toISOString(), goal,
			workflowPlan: this.workflowPlan, workflowProposal: this.workflowProposal ? { revision: this.workflowProposal.revision, updatedAt: this.workflowProposal.updatedAt } : undefined, contextWindowId: this.contextWindowId, recentTurn,
		});
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
		try {
			await this.agent.prompt(messages);
			while (await this._handlePostAgentRun()) {
				await this.agent.continue();
			}
		} finally {
			// Per-step runtime context must survive tool continuations inside this run,
			// but must not accumulate in public/session message history.
			this.agent.state.messages = this.agent.state.messages.filter(
				(message) => message.role !== "custom" || message.customType !== "workflow_context",
			);
			this._activeRunInstructionStack = undefined;
			this._systemPromptOverride = undefined;
			this._flushPendingBashMessages();
		}
	}

	private async _handlePostAgentRun(): Promise<boolean> {
		const msg = this._lastAssistantMessage;
		this._lastAssistantMessage = undefined;
		if (!msg) {
			return false;
		}

		if (this._isRetryableError(msg) && (await this._prepareRetry(msg))) {
			return true;
		}

		if (msg.stopReason === "error" && this._retryAttempt > 0) {
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt: this._retryAttempt,
				finalError: msg.errorMessage,
			});
			this._retryAttempt = 0;
		}

		if (await this._checkCompaction(msg)) {
			return true;
		}

		const processReminder = this._workflowRuntime.takeProposalExecutionReminder();
		if (processReminder) {
			this.agent.state.messages.push({
				role: "custom",
				customType: "workflow_context",
				content: processReminder,
				display: false,
				timestamp: Date.now(),
			});
			return true;
		}
		const processState = this._workflowRuntime.proposalExecutionState;
		if (processState && processState.phase !== "active") {
			throw new Error("Process stopped before read_plan and update_plan completed. No implementation tool was allowed to run.");
		}

		// The agent loop drains both queues before emitting agent_end. Any messages
		// here were queued by agent_end extension handlers and need a continuation.
		return this.agent.hasQueuedMessages();
	}

	/**
	 * Send a prompt to the agent.
	 * - Handles extension commands (registered via metis.registerCommand) immediately, even during streaming
	 * - Expands file-based prompt templates by default
	 * - During streaming, queues via steer() or followUp() based on streamingBehavior option
	 * - Validates model and API key before sending (when not streaming)
	 * @throws Error if streaming and no streamingBehavior specified
	 * @throws Error if no model selected or no API key available (when not streaming)
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		const expandPromptTemplates = options?.expandPromptTemplates ?? true;
		const preflightResult = options?.preflightResult;
		let messages: AgentMessage[] | undefined;
		let proposalExecutionStarted = false;

		try {
			// Handle extension commands first (execute immediately, even during streaming)
			// Extension commands manage their own LLM interaction via metis.sendMessage()
			if (expandPromptTemplates && text.startsWith("/")) {
				const handled = await this._tryExecuteExtensionCommand(text);
				if (handled) {
					// Extension command executed, no prompt to send
					preflightResult?.(true);
					return;
				}
			}

			// Emit input event for extension interception (before skill/template expansion)
			let currentText = text;
			let currentImages = options?.images;
			if (this._extensionRunner.hasHandlers("input")) {
				const inputResult = await this._extensionRunner.emitInput(
					currentText,
					currentImages,
					options?.source ?? "interactive",
					this.isStreaming ? options?.streamingBehavior : undefined,
				);
				if (inputResult.action === "handled") {
					preflightResult?.(true);
					return;
				}
				if (inputResult.action === "transform") {
					currentText = inputResult.text;
					currentImages = inputResult.images ?? currentImages;
				}
			}

			let expandedText = currentText;
			if (expandPromptTemplates) {
				expandedText = this._expandSkillCommand(expandedText);
				expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
			}

			// If streaming, queue via steer() or followUp() based on option
			if (this.isStreaming) {
				if (options?.workflowAction) {
					throw new Error("Proposal Process cannot start while the agent is already running.");
				}
				if (!options?.streamingBehavior) {
					throw new Error(
						"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
					);
				}
				if (options.streamingBehavior === "followUp") {
					await this._queueFollowUp(expandedText, currentImages);
				} else {
					await this._queueSteer(expandedText, currentImages);
				}
				preflightResult?.(true);
				return;
			}

			// Flush any pending bash messages before the new prompt
			this._flushPendingBashMessages();

			// Validate model
			if (!this.model) {
				throw new Error(formatNoModelSelectedMessage());
			}

			if (!this._modelRegistry.hasConfiguredAuth(this.model)) {
				const isOAuth = this._modelRegistry.isUsingOAuth(this.model);
				if (isOAuth) {
					throw new Error(
						`Authentication failed for "${this.model.provider}". ` +
							`Credentials may have expired or network is unavailable. ` +
							`Run '/login ${this.model.provider}' to re-authenticate.`,
					);
				}
				throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
			}

			// Check if we need to compact before sending (catches aborted responses).
			// The user's new prompt is sent below, so do not call agent.continue() here.
			const lastAssistant = this._findLastAssistantMessage();
			if (lastAssistant) {
				await this._checkCompaction(lastAssistant, false);
			}

			// Older test/runtime extension runners may not implement the optional hook;
			// absence means no per-step additions, never a failed prompt preflight.
			const beforeStep = await this._extensionRunner.emitBeforeStep?.(expandedText, this._collaborationMode);
			if (beforeStep?.toolNames?.length) {
				// Extensions can only declare already-registered tools. Plan filtering is
				// enforced again by setActiveToolsByName and dispatch.
				this.setActiveToolsByName([...this.getActiveToolNames(), ...beforeStep.toolNames]);
				// Keep declaratively enabled Build tools across a temporary Plan view.
				// Plan itself never mutates this saved set.
				if (this._collaborationMode === "build") {
					this._buildToolNames = this.getActiveToolNames();
				}
			}

			let proposalForExecution: WorkflowProposalState | undefined;
			if (this._collaborationMode === "build") {
				if (options?.workflowAction === "process_proposal") {
					const proposal = this.workflowProposal;
					if (!proposal) throw new Error("No durable proposal is available to Process.");
					proposalForExecution = proposal;
					this._beginProposalExecution(proposal);
					proposalExecutionStarted = true;
				} else {
					this._resetCompletedWorkflowPlanForNewPrompt();
				}
			}
			// Plan mode is intentionally read-only: it persists a conversational proposal
			// but must not open a runnable Performance lane. Build mode always opens one
			// for a direct task; Process binds that lane to the approved proposal itself.
			if (
				this._collaborationMode === "build"
				&& currentText.trim()
				&& !currentText.trimStart().startsWith("/")
				&& !process.env.METIS_PERFORMANCE_RUN_ID
			) {
				const directInvocation = this._parsePerformanceInvocation(proposalForExecution?.markdown ?? currentText);
				const mission = directInvocation.mission;
				if (!mission) throw new Error("Performance task is empty after removing runtime directives.");
				const activeTools = new Set(this.getActiveToolNames());
				// Minimal/custom SDK tool sets may intentionally omit native governance.
				// A built-in gate that is merely disabled is a safety failure, never a
				// silent fallback to ungoverned Build.
				const hasNativePerformanceGate = this.getAllTools().some((tool) => tool.name === "performance_gate");
				const requestsNativeBuild = ["read", "write", "edit", "bash", "spawn_agent"].some((tool) => activeTools.has(tool));
				if (hasNativePerformanceGate && requestsNativeBuild && !activeTools.has("performance_gate")) {
					throw new Error("Performance control capability is disabled; direct Build cannot start without performance_gate.");
				}
				if (hasNativePerformanceGate && requestsNativeBuild) {
					const activeRun = this._performanceRuntime.state;
					const run = activeRun?.status === "active"
						? this._performanceRuntime.steer(mission)
						: this._performanceRuntime.start({
							...(await this._resolvePerformanceStart(mission, directInvocation)),
							capabilities: {
								read: activeTools.has("read"),
								write: activeTools.has("write") || activeTools.has("edit"),
								run: activeTools.has("bash"),
							},
						});
					this._appendPerformanceRunEntry(run);
				}
			}
			const memoryOverview = this._memoryCoordinator?.getMemoryOverview();
			const memoryOverviewBlock = memoryOverview ? {
				id: "metis:memory-overview",
				channel: "developer" as const,
				content: memoryOverview,
				source: "memory:overview",
				trust: "memory" as const,
			} : undefined;
			const performanceContext = this._collaborationMode === "build" ? this._performanceRuntime.context() : undefined;

			const stepInstructions: InstructionStack = {
				base: this._instructionStack.base,
				memoryOverview: memoryOverviewBlock,
				developer: [
					...this._instructionStack.developer,
					...(beforeStep?.developerInstructions ?? []).map((entry, index) => ({
						...entry,
						id: `extension:step:developer:${index}:${entry.id}`,
						channel: "developer" as const,
						trust: "extension" as const,
					})),
				],
				context: [
					...this._instructionStack.context,
					...(performanceContext ? [{
						id: "runtime:performance",
						channel: "context" as const,
						content: performanceContext,
						source: "performance runtime",
						trust: "runtime" as const,
					}] : []),
					...(beforeStep?.context ?? []).map((entry, index) => ({
						...entry,
						id: `extension:step:context:${index}:${entry.id}`,
						channel: "context" as const,
						trust: "extension" as const,
					})),
				],
			};

			// Build messages with runtime/extension context before the actual user
			// message. User authority remains last in the model-visible input.
			messages = [];
			for (const entry of stepInstructions.context) {
				messages.push({
					role: "custom",
					customType: "workflow_context",
					content: `[Runtime context from ${entry.source}; not user instructions]\n${entry.content}`,
					display: false,
					timestamp: Date.now(),
				});
			}

			// Inject any pending next-turn messages as context.
			for (const msg of this._pendingNextTurnMessages) {
				messages.push(msg);
			}
			this._pendingNextTurnMessages = [];

			this._systemPromptOverride = undefined;
			this.agent.state.systemPrompt = this._baseSystemPrompt;

			const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: expandedText }];
			if (currentImages) userContent.push(...currentImages);
			messages.push({ role: "user", content: userContent, timestamp: Date.now() });
			const snapshot = this._freezeStepSnapshot([...this.agent.state.messages, ...messages], stepInstructions);
			this._activeRunInstructionStack = stepInstructions;
			this.agent.state.systemPrompt = this._workflowRuntime.compilePrivilegedInstructions(snapshot) ?? this._baseSystemPrompt;
		} catch (error) {
			if (proposalExecutionStarted) {
				this._workflowRuntime.endProposalExecution();
				this._appendWorkflowPlanReset();
			}
			preflightResult?.(false);
			throw error;
		}

		if (!messages) {
			return;
		}

		preflightResult?.(true);
		this._appendWorkflowCheckpoint("prompt_accepted");
		const isFirstUserPrompt = !this.messages.some((message) => message.role === "user");
		if (isFirstUserPrompt) {
			void this.ensureSessionName({ prompt: text });
		}
		try {
			await this._runAgentPrompt(messages);
		} finally {
			if (proposalExecutionStarted) this._workflowRuntime.endProposalExecution();
		}
	}

	/**
	 * Try to execute an extension command. Returns true if command was found and executed.
	 */
	private async _tryExecuteExtensionCommand(text: string): Promise<boolean> {
		// Parse command name and args
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

		const command = this._extensionRunner.getCommand(commandName);
		if (!command) return false;

		// Get command context from extension runner (includes session control methods)
		const ctx = this._extensionRunner.createCommandContext();

		try {
			await command.handler(args, ctx);
			return true;
		} catch (err) {
			// Emit error via extension runner
			this._extensionRunner.emitError({
				extensionPath: `command:${commandName}`,
				event: "command",
				error: err instanceof Error ? err.message : String(err),
			});
			return true;
		}
	}

	/**
	 * Expand skill commands (/skill:name args) to their full content.
	 * Returns the expanded text, or the original text if not a skill command or skill not found.
	 * Emits errors via extension runner if file read fails.
	 */
	private _expandSkillCommand(text: string): string {
		if (!text.startsWith("/skill:")) return text;

		const spaceIndex = text.indexOf(" ");
		const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

		const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
		if (!skill) return text; // Unknown skill, pass through

		try {
			const content = readFileSync(skill.filePath, "utf-8");
			const body = stripFrontmatter(content).trim();
			const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
			return args ? `${skillBlock}\n\n${args}` : skillBlock;
		} catch (err) {
			// Emit error like extension commands do
			this._extensionRunner.emitError({
				extensionPath: skill.filePath,
				event: "skill_expansion",
				error: err instanceof Error ? err.message : String(err),
			});
			return text; // Return original on error
		}
	}

	/**
	 * Queue a steering message while the agent is running.
	 * Delivered after the current assistant turn finishes executing its tool calls,
	 * before the next LLM call.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async steer(text: string, images?: ImageContent[]): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this._throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		let expandedText = this._expandSkillCommand(text);
		expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

		await this._queueSteer(expandedText, images);
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Delivered only when agent has no more tool calls or steering messages.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this._throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		let expandedText = this._expandSkillCommand(text);
		expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

		await this._queueFollowUp(expandedText, images);
	}

	/**
	 * Internal: Queue a steering message (already expanded, no extension command check).
	 */
	private async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
		const entry: QueuedSessionMessage = { text, images: images ? [...images] : undefined, timestamp: Date.now() };
		this._steeringMessages.push(text);
		this._steeringQueueEntries.push(entry);
		this._emitQueueUpdate();
		this.agent.steer(this._queuedEntryToAgentMessage(entry));
	}

	/**
	 * Internal: Queue a follow-up message (already expanded, no extension command check).
	 */
	private async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
		const entry: QueuedSessionMessage = { text, images: images ? [...images] : undefined, timestamp: Date.now() };
		this._followUpMessages.push(text);
		this._followUpQueueEntries.push(entry);
		this._emitQueueUpdate();
		this.agent.followUp(this._queuedEntryToAgentMessage(entry));
	}

	private _queuedEntryToAgentMessage(entry: QueuedSessionMessage): AgentMessage {
		const content: (TextContent | ImageContent)[] = [{ type: "text", text: entry.text }, ...(entry.images ?? [])];
		return { role: "user", content, timestamp: entry.timestamp };
	}

	private _rebuildAgentQueue(queue: "steering" | "followUp"): void {
		const entries = queue === "steering" ? this._steeringQueueEntries : this._followUpQueueEntries;
		if (queue === "steering") this.agent.clearSteeringQueue();
		else this.agent.clearFollowUpQueue();
		for (const entry of entries) {
			if (queue === "steering") this.agent.steer(this._queuedEntryToAgentMessage(entry));
			else this.agent.followUp(this._queuedEntryToAgentMessage(entry));
		}
	}

	/** Remove one queued message and return its complete payload. */
	removeQueuedMessage(queue: "steering" | "followUp", index: number): QueuedSessionMessage {
		const messages = queue === "steering" ? this._steeringMessages : this._followUpMessages;
		const entries = queue === "steering" ? this._steeringQueueEntries : this._followUpQueueEntries;
		if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
			throw new Error(`Queue item ${index} was not found in ${queue}`);
		}
		const [text] = messages.splice(index, 1);
		const [entry] = entries.splice(index, 1);
		this._rebuildAgentQueue(queue);
		this._emitQueueUpdate();
		return entry ?? { text: text ?? "", timestamp: Date.now() };
	}

	/** Move a follow-up message into the higher-priority steering queue. */
	promoteFollowUpMessage(index: number): QueuedSessionMessage {
		const messages = this._followUpMessages;
		if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
			throw new Error(`Queue item ${index} was not found in followUp`);
		}
		const [text] = messages.splice(index, 1);
		const [entry] = this._followUpQueueEntries.splice(index, 1);
		const promoted = entry ?? { text: text ?? "", timestamp: Date.now() };
		this._rebuildAgentQueue("followUp");
		this._steeringMessages.push(promoted.text);
		this._steeringQueueEntries.push(promoted);
		this.agent.steer(this._queuedEntryToAgentMessage(promoted));
		this._emitQueueUpdate();
		return promoted;
	}

	/**
	 * Throw an error if the text is an extension command.
	 */
	private _throwIfExtensionCommand(text: string): void {
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const command = this._extensionRunner.getCommand(commandName);

		if (command) {
			throw new Error(
				`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
			);
		}
	}

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queues message, processed when loop pulls from queue
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 *
	 * @param message Custom message with customType, content, display, details
	 * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
	 * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
	 */
	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		const appMessage = {
			role: "custom" as const,
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		} satisfies CustomMessage<T>;
		if (options?.deliverAs === "nextTurn") {
			this._pendingNextTurnMessages.push(appMessage);
		} else if (this.isStreaming) {
			if (options?.deliverAs === "followUp") {
				this.agent.followUp(appMessage);
			} else {
				this.agent.steer(appMessage);
			}
		} else if (options?.triggerTurn) {
			await this._runAgentPrompt(appMessage);
		} else {
			this.agent.state.messages.push(appMessage);
			this.sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
			this._emit({ type: "message_start", message: appMessage });
			this._emit({ type: "message_end", message: appMessage });
		}
	}

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 *
	 * @param content User message content (string or content array)
	 * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
	 */
	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		// Normalize content to text string + optional images
		let text: string;
		let images: ImageContent[] | undefined;

		if (typeof content === "string") {
			text = content;
		} else {
			const textParts: string[] = [];
			images = [];
			for (const part of content) {
				if (part.type === "text") {
					textParts.push(part.text);
				} else {
					images.push(part);
				}
			}
			text = textParts.join("\n");
			if (images.length === 0) images = undefined;
		}

		// Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
		await this.prompt(text, {
			expandPromptTemplates: false,
			streamingBehavior: options?.deliverAs,
			images,
			source: "extension",
		});
	}

	/**
	 * Clear all queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 * @returns Object with steering and followUp arrays
	 */
	clearQueue(): { steering: string[]; followUp: string[] } {
		const steering = [...this._steeringMessages];
		const followUp = [...this._followUpMessages];
		this._steeringMessages = [];
		this._followUpMessages = [];
		this._steeringQueueEntries = [];
		this._followUpQueueEntries = [];
		this.agent.clearAllQueues();
		this._emitQueueUpdate();
		return { steering, followUp };
	}

	/** Number of pending messages (includes both steering and follow-up) */
	get pendingMessageCount(): number {
		return this._steeringMessages.length + this._followUpMessages.length;
	}

	/** Get pending steering messages (read-only) */
	getSteeringMessages(): readonly string[] {
		return this._steeringMessages;
	}

	/** Get pending follow-up messages (read-only) */
	getFollowUpMessages(): readonly string[] {
		return this._followUpMessages;
	}

	get resourceLoader(): ResourceLoader {
		return this._resourceLoader;
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.abortRetry();
		this._memoryCoordinator?.abort();
		this._workflowRuntime.abortAllToolCalls();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	private async _emitModelSelect(
		nextModel: Model<any>,
		previousModel: Model<any> | undefined,
		source: "set" | "cycle" | "restore",
	): Promise<void> {
		if (modelsAreEqual(previousModel, nextModel)) return;
		await this._extensionRunner.emit({
			type: "model_select",
			model: nextModel,
			previousModel,
			source,
		});
	}

	/**
	 * Set model directly.
	 * Validates that auth is configured, saves to session and settings.
	 * @throws Error if no auth is configured for the model
	 */
	async setModel(model: Model<any>): Promise<void> {
		if (!this._modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		const previousModel = this.model;
		const thinkingLevel = this._getThinkingLevelForModelSwitch();
		this.agent.state.model = model;
		this.sessionManager.appendModelChange(model.provider, model.id);
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(model, previousModel, "set");
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this._scopedModels.length > 0) {
			return this._cycleScopedModel(direction);
		}
		return this._cycleAvailableModel(direction);
	}

	private async _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const scopedModels = this._scopedModels.filter((scoped) => this._modelRegistry.hasConfiguredAuth(scoped.model));
		if (scopedModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = scopedModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const next = scopedModels[nextIndex];
		const thinkingLevel = this._getThinkingLevelForModelSwitch(next.thinkingLevel);

		// Apply model
		this.agent.state.model = next.model;
		this.sessionManager.appendModelChange(next.model.provider, next.model.id);
		this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);

		// Apply thinking level.
		// - Explicit scoped model thinking level overrides current session level
		// - Undefined scoped model thinking level inherits the current session preference
		// setThinkingLevel clamps to model capabilities.
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(next.model, currentModel, "cycle");

		return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
	}

	private async _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const availableModels = await this._modelRegistry.getAvailable();
		if (availableModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = availableModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const nextModel = availableModels[nextIndex];

		const thinkingLevel = this._getThinkingLevelForModelSwitch();
		this.agent.state.model = nextModel;
		this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
		this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(nextModel, currentModel, "cycle");

		return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	/**
	 * Set thinking level.
	 * Clamps to model capabilities based on available thinking levels.
	 * Saves to session and settings only if the level actually changes.
	 */
	setThinkingLevel(level: ThinkingLevel): void {
		const availableLevels = this.getAvailableThinkingLevels();
		const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);

		// Only persist if actually changing
		const previousLevel = this.agent.state.thinkingLevel;
		const isChanging = effectiveLevel !== previousLevel;

		this.agent.state.thinkingLevel = effectiveLevel;

		if (isChanging) {
			this.sessionManager.appendThinkingLevelChange(effectiveLevel);
			if (this.supportsThinking() || effectiveLevel !== "off") {
				this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
			}
			this._emit({ type: "thinking_level_changed", level: effectiveLevel });
			void this._extensionRunner.emit({
				type: "thinking_level_select",
				level: effectiveLevel,
				previousLevel,
			});
		}
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | undefined {
		if (!this.supportsThinking()) return undefined;

		const levels = this.getAvailableThinkingLevels();
		const currentIndex = levels.indexOf(this.thinkingLevel);
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];

		this.setThinkingLevel(nextLevel);
		return nextLevel;
	}

	/**
	 * Get available thinking levels for current model.
	 * The provider will clamp to what the specific model supports internally.
	 */
	getAvailableThinkingLevels(): ThinkingLevel[] {
		if (!this.model) return THINKING_LEVELS;
		return getSupportedThinkingLevels(this.model) as ThinkingLevel[];
	}

	/** Provider-native labels and values for current model. */
	getAvailableThinkingOptions(): ThinkingOption[] {
		if (!this.model) return [];
		return getThinkingOptions(this.model);
	}

	/**
	 * Check if current model supports thinking/reasoning.
	 */
	supportsThinking(): boolean {
		return this.getAvailableThinkingOptions().some((option) => option.id !== "off");
	}

	private _getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel {
		if (explicitLevel !== undefined) {
			return explicitLevel;
		}
		if (!this.supportsThinking()) {
			return this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
		}
		return this.thinkingLevel;
	}

	private _clampThinkingLevel(level: ThinkingLevel, _availableLevels: ThinkingLevel[]): ThinkingLevel {
		return this.model ? (clampThinkingLevel(this.model, level) as ThinkingLevel) : "off";
	}

	// =========================================================================
	// Queue Mode Management
	// =========================================================================

	private syncQueueModesFromSettings(): void {
		this.agent.steeringMode = this.settingsManager.getSteeringMode();
		this.agent.followUpMode = this.settingsManager.getFollowUpMode();
	}

	/**
	 * Set steering message mode.
	 * Saves to settings.
	 */
	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.agent.steeringMode = mode;
		this.settingsManager.setSteeringMode(mode);
	}

	/**
	 * Set follow-up message mode.
	 * Saves to settings.
	 */
	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.agent.followUpMode = mode;
		this.settingsManager.setFollowUpMode(mode);
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	/**
	 * Manually compact the session context.
	 * Aborts current agent operation first.
	 * @param customInstructions Optional instructions for the compaction summary
	 */
	async compact(customInstructions?: string): Promise<CompactionResult> {
		this._disconnectFromAgent();
		await this.abort();
		this._compactionAbortController = new AbortController();
		this._emit({ type: "compaction_start", reason: "manual" });

		try {
			if (!this.model) {
				throw new Error(formatNoModelSelectedMessage());
			}

			const { apiKey, headers, env } = await this._getCompactionRequestAuth(this.model);

			const pathEntries = this.sessionManager.getBranch();
			const settings = this.settingsManager.getCompactionSettings();

			const preparation = prepareCompaction(pathEntries, settings);
			if (!preparation) {
				// Check why we can't compact
				const lastEntry = pathEntries[pathEntries.length - 1];
				if (lastEntry?.type === "compaction") {
					throw new Error("Already compacted");
				}
				throw new Error("Nothing to compact (session too small)");
			}

			let extensionCompaction: CompactionResult | undefined;
			let fromExtension = false;

			if (this._extensionRunner.hasHandlers("session_before_compact")) {
				const result = (await this._extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions,
					reason: "manual",
					willRetry: false,
					signal: this._compactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (result?.cancel) {
					throw new Error("Compaction cancelled");
				}

				if (result?.compaction) {
					extensionCompaction = result.compaction;
					fromExtension = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (extensionCompaction) {
				// Extension provided compaction content
				summary = extensionCompaction.summary;
				firstKeptEntryId = extensionCompaction.firstKeptEntryId;
				tokensBefore = extensionCompaction.tokensBefore;
				details = extensionCompaction.details;
			} else {
				// Generate compaction result
				const result = await compact(
					preparation,
					this.model,
					apiKey,
					headers,
					customInstructions,
					this._compactionAbortController.signal,
					this.thinkingLevel,
					this.agent.streamFn,
					env,
				);
				summary = result.summary;
				firstKeptEntryId = result.firstKeptEntryId;
				tokensBefore = result.tokensBefore;
				details = result.details;
			}

			if (this._compactionAbortController.signal.aborted) {
				throw new Error("Compaction cancelled");
			}

			this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.state.messages = sessionContext.messages;
			const estimatedTokensAfter = estimateMessagesTokens(this.agent.state.messages);

			// Get the saved compaction entry for the extension event
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._extensionRunner && savedCompactionEntry) {
				await this._extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
					reason: "manual",
					willRetry: false,
				});
			}

			const compactionResult: CompactionResult = {
				summary,
				firstKeptEntryId,
				tokensBefore,
				estimatedTokensAfter,
				details,
			};
			this._emit({
				type: "compaction_end",
				reason: "manual",
				result: compactionResult,
				aborted: false,
				willRetry: false,
			});
			return compactionResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const aborted = message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
			this._emit({
				type: "compaction_end",
				reason: "manual",
				result: undefined,
				aborted,
				willRetry: false,
				errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
			});
			throw error;
		} finally {
			this._compactionAbortController = undefined;
			this._reconnectToAgent();
		}
	}

	/**
	 * Cancel in-progress compaction (manual or auto).
	 */
	abortCompaction(): void {
		this._compactionAbortController?.abort();
		this._autoCompactionAbortController?.abort();
	}

	/**
	 * Cancel in-progress branch summarization.
	 */
	abortBranchSummary(): void {
		this._branchSummaryAbortController?.abort();
	}

	/**
	 * Check if compaction is needed and run it.
	 * Called after agent_end and before prompt submission.
	 *
	 * Two cases:
	 * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
	 * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 */
	private async _checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<boolean> {
		const settings = this.settingsManager.getCompactionSettings();
		if (!settings.enabled) return false;

		// Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
		if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;

		const contextWindow = this.model?.contextWindow ?? 0;

		// Skip overflow check if the message came from a different model.
		// This handles the case where user switched from a smaller-context model (e.g. opus)
		// to a larger-context model (e.g. codex) - the overflow error from the old model
		// shouldn't trigger compaction for the new model.
		const sameModel =
			this.model && assistantMessage.provider === this.model.provider && assistantMessage.model === this.model.id;

		// Skip compaction checks if this assistant message is older than the latest
		// compaction boundary. This prevents a stale pre-compaction usage/error
		// from retriggering compaction on the first prompt after compaction.
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
		const assistantIsFromBeforeCompaction =
			compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
		if (assistantIsFromBeforeCompaction) {
			return false;
		}

		// Case 1: Overflow - LLM returned context overflow error, or reported usage exceeded
		// the configured window. A successful response over the configured window should compact
		// but must not retry: the assistant answer already completed and agent.continue() cannot
		// continue from an assistant message.
		if (sameModel && isContextOverflow(assistantMessage, contextWindow)) {
			const willRetry = assistantMessage.stopReason !== "stop";

			if (!willRetry) {
				return await this._runAutoCompaction("overflow", false);
			}

			if (this._overflowRecoveryAttempted) {
				this._emit({
					type: "compaction_end",
					reason: "overflow",
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage:
						"Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
				});
				return false;
			}

			this._overflowRecoveryAttempted = true;
			// Remove the error message from agent state (it IS saved to session for history,
			// but we don't want it in context for the retry)
			const messages = this.agent.state.messages;
			if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
				this.agent.state.messages = messages.slice(0, -1);
			}
			return await this._runAutoCompaction("overflow", willRetry);
		}

		// Case 2: Threshold - context is getting large
		// For error messages or all-zero usage messages, estimate from the last valid response.
		// This ensures sessions that hit persistent API errors (e.g. 529) or malformed zero-usage
		// responses can still compact and do not reset context accounting.
		let contextTokens: number;
		const directContextTokens = assistantMessage.usage ? calculateContextTokens(assistantMessage.usage) : 0;
		if (assistantMessage.stopReason === "error" || directContextTokens === 0) {
			const messages = this.agent.state.messages;
			const estimate = estimateContextTokens(messages);
			if (estimate.lastUsageIndex === null) return false; // No usage data at all
			// Verify the usage source is post-compaction. Kept pre-compaction messages
			// have stale usage reflecting the old (larger) context and would falsely
			// trigger compaction right after one just finished.
			const usageMsg = messages[estimate.lastUsageIndex];
			if (
				compactionEntry &&
				usageMsg.role === "assistant" &&
				(usageMsg as AssistantMessage).timestamp <= new Date(compactionEntry.timestamp).getTime()
			) {
				return false;
			}
			contextTokens = estimate.tokens;
		} else {
			contextTokens = directContextTokens;
		}
		if (shouldCompact(contextTokens, contextWindow, settings)) {
			return await this._runAutoCompaction("threshold", false);
		}
		return false;
	}

	/**
	 * Internal: Run auto-compaction with events.
	 */
	private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
		const settings = this.settingsManager.getCompactionSettings();
		let started = false;

		try {
			if (!this.model) {
				return false;
			}

			let apiKey: string | undefined;
			let headers: Record<string, string> | undefined;
			let env: Record<string, string> | undefined;
			if (this.agent.streamFn === streamSimple) {
				const authResult = await this._modelRegistry.getApiKeyAndHeaders(this.model);
				if (!authResult.ok || !authResult.apiKey) {
					return false;
				}
				apiKey = authResult.apiKey;
				headers = authResult.headers;
				env = authResult.env;
			} else {
				({ apiKey, headers, env } = await this._getCompactionRequestAuth(this.model));
			}

			const pathEntries = this.sessionManager.getBranch();

			const preparation = prepareCompaction(pathEntries, settings);
			if (!preparation) {
				return false;
			}

			this._emit({ type: "compaction_start", reason });
			this._autoCompactionAbortController = new AbortController();
			started = true;

			let extensionCompaction: CompactionResult | undefined;
			let fromExtension = false;

			if (this._extensionRunner.hasHandlers("session_before_compact")) {
				const extensionResult = (await this._extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions: undefined,
					reason,
					willRetry,
					signal: this._autoCompactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (extensionResult?.cancel) {
					this._emit({
						type: "compaction_end",
						reason,
						result: undefined,
						aborted: true,
						willRetry: false,
					});
					return false;
				}

				if (extensionResult?.compaction) {
					extensionCompaction = extensionResult.compaction;
					fromExtension = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (extensionCompaction) {
				// Extension provided compaction content
				summary = extensionCompaction.summary;
				firstKeptEntryId = extensionCompaction.firstKeptEntryId;
				tokensBefore = extensionCompaction.tokensBefore;
				details = extensionCompaction.details;
			} else {
				// Generate compaction result
				const compactResult = await compact(
					preparation,
					this.model,
					apiKey,
					headers,
					undefined,
					this._autoCompactionAbortController.signal,
					this.thinkingLevel,
					this.agent.streamFn,
					env,
				);
				summary = compactResult.summary;
				firstKeptEntryId = compactResult.firstKeptEntryId;
				tokensBefore = compactResult.tokensBefore;
				details = compactResult.details;
			}

			if (this._autoCompactionAbortController.signal.aborted) {
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted: true,
					willRetry: false,
				});
				return false;
			}

			this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.state.messages = sessionContext.messages;
			const estimatedTokensAfter = estimateMessagesTokens(this.agent.state.messages);

			// Get the saved compaction entry for the extension event
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._extensionRunner && savedCompactionEntry) {
				await this._extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
					reason,
					willRetry,
				});
			}

			const result: CompactionResult = {
				summary,
				firstKeptEntryId,
				tokensBefore,
				estimatedTokensAfter,
				details,
			};
			this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

			if (willRetry) {
				const messages = this.agent.state.messages;
				const lastMsg = messages[messages.length - 1];
				if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
					this.agent.state.messages = messages.slice(0, -1);
				}
				return true;
			}

			// Auto-compaction can complete while follow-up/steering/custom messages are waiting.
			// Continue once so queued messages are delivered.
			return this.agent.hasQueuedMessages();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "compaction failed";
			if (started) {
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage:
						reason === "overflow"
							? `Context overflow recovery failed: ${errorMessage}`
							: `Auto-compaction failed: ${errorMessage}`,
				});
			}
			return false;
		} finally {
			this._autoCompactionAbortController = undefined;
		}
	}

	/**
	 * Toggle auto-compaction setting.
	 */
	setAutoCompactionEnabled(enabled: boolean): void {
		this.settingsManager.setCompactionEnabled(enabled);
	}

	/** Whether auto-compaction is enabled */
	get autoCompactionEnabled(): boolean {
		return this.settingsManager.getCompactionEnabled();
	}

	async bindExtensions(bindings: ExtensionBindings): Promise<void> {
		if (bindings.uiContext !== undefined) {
			this._extensionUIContext = bindings.uiContext;
		}
		if (bindings.mode !== undefined) {
			this._extensionMode = bindings.mode;
		}
		if (bindings.commandContextActions !== undefined) {
			this._extensionCommandContextActions = bindings.commandContextActions;
		}
		if (bindings.abortHandler !== undefined) {
			this._extensionAbortHandler = bindings.abortHandler;
		}
		if (bindings.shutdownHandler !== undefined) {
			this._extensionShutdownHandler = bindings.shutdownHandler;
		}
		if (bindings.onError !== undefined) {
			this._extensionErrorListener = bindings.onError;
		}

		this._applyExtensionBindings(this._extensionRunner);
		await this._extensionRunner.emit(this._sessionStartEvent);
		await this.extendResourcesFromExtensions(this._sessionStartEvent.reason === "reload" ? "reload" : "startup");
	}

	private async extendResourcesFromExtensions(reason: "startup" | "reload"): Promise<void> {
		if (!this._extensionRunner.hasHandlers("resources_discover")) {
			return;
		}

		const { skillPaths, promptPaths, themePaths } = await this._extensionRunner.emitResourcesDiscover(
			this._cwd,
			reason,
		);

		if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
			return;
		}

		const extensionPaths: ResourceExtensionPaths = {
			skillPaths: this.buildExtensionResourcePaths(skillPaths),
			promptPaths: this.buildExtensionResourcePaths(promptPaths),
			themePaths: this.buildExtensionResourcePaths(themePaths),
		};

		this._resourceLoader.extendResources(extensionPaths);
		this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	private buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>): Array<{
		path: string;
		metadata: { source: string; scope: "temporary"; origin: "top-level"; baseDir?: string };
	}> {
		return entries.map((entry) => {
			const source = this.getExtensionSourceLabel(entry.extensionPath);
			const baseDir = entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath);
			return {
				path: entry.path,
				metadata: {
					source,
					scope: "temporary",
					origin: "top-level",
					baseDir,
				},
			};
		});
	}

	private getExtensionSourceLabel(extensionPath: string): string {
		if (extensionPath.startsWith("<")) {
			return `extension:${extensionPath.replace(/[<>]/g, "")}`;
		}
		const base = basename(extensionPath);
		const name = base.replace(/\.(ts|js)$/, "");
		return `extension:${name}`;
	}

	private _applyExtensionBindings(runner: ExtensionRunner): void {
		runner.setUIContext(this._extensionUIContext, this._extensionMode);
		runner.bindCommandContext(this._extensionCommandContextActions);

		this._extensionErrorUnsubscriber?.();
		this._extensionErrorUnsubscriber = this._extensionErrorListener
			? runner.onError(this._extensionErrorListener)
			: undefined;
	}

	private _refreshCurrentModelFromRegistry(): void {
		const currentModel = this.model;
		if (!currentModel) {
			return;
		}

		const refreshedModel = this._modelRegistry.find(currentModel.provider, currentModel.id);
		if (!refreshedModel || refreshedModel === currentModel) {
			return;
		}

		this.agent.state.model = refreshedModel;
	}

	private _bindExtensionCore(runner: ExtensionRunner): void {
		const getCommands = (): SlashCommandInfo[] => {
			const extensionCommands: SlashCommandInfo[] = runner.getRegisteredCommands().map((command) => ({
				name: command.invocationName,
				description: command.description,
				source: "extension",
				sourceInfo: command.sourceInfo,
			}));

			const templates: SlashCommandInfo[] = this.promptTemplates.map((template) => ({
				name: template.name,
				description: template.description,
				source: "prompt",
				sourceInfo: template.sourceInfo,
			}));

			const skills: SlashCommandInfo[] = this._resourceLoader.getSkills().skills.map((skill) => ({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
				sourceInfo: skill.sourceInfo,
			}));

			return [...extensionCommands, ...templates, ...skills];
		};

		runner.bindCore(
			{
				sendMessage: (message, options) => {
					this.sendCustomMessage(message, options).catch((err) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_message",
							error: err instanceof Error ? err.message : String(err),
						});
					});
				},
				sendUserMessage: (content, options) => {
					this.sendUserMessage(content, options).catch((err) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_user_message",
							error: err instanceof Error ? err.message : String(err),
						});
					});
				},
				appendEntry: (customType, data) => {
					const entryId = this.sessionManager.appendCustomEntry(customType, data);
					const entry = this.sessionManager.getEntry(entryId);
					if (entry) {
						this._emit({ type: "entry_appended", entry });
					}
				},
				setSessionName: (name) => {
					this.setSessionName(name);
				},
				getSessionName: () => {
					return this.sessionManager.getSessionName();
				},
				setLabel: (entryId, label) => {
					this.sessionManager.appendLabelChange(entryId, label);
				},
				getActiveTools: () => this.getActiveToolNames(),
				getAllTools: () => this.getAllTools(),
				setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
				refreshTools: () => this._refreshToolRegistry(),
				getCommands,
				setModel: async (model) => {
					if (!this.modelRegistry.hasConfiguredAuth(model)) return false;
					await this.setModel(model);
					return true;
				},
				getThinkingLevel: () => this.thinkingLevel,
				setThinkingLevel: (level) => this.setThinkingLevel(level),
			},
			{
				getModel: () => this.model,
				isIdle: () => !this.isStreaming,
				isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
				getSignal: () => this.agent.signal,
				abort: () => {
					if (this._extensionAbortHandler) {
						this._extensionAbortHandler();
						return;
					}
					void this.abort();
				},
				hasPendingMessages: () => this.pendingMessageCount > 0,
				shutdown: () => {
					this._extensionShutdownHandler?.();
				},
				getContextUsage: () => this.getContextUsage(),
				compact: (options) => {
					void (async () => {
						try {
							const result = await this.compact(options?.customInstructions);
							options?.onComplete?.(result);
						} catch (error) {
							const err = error instanceof Error ? error : new Error(String(error));
							options?.onError?.(err);
						}
					})();
				},
				getSystemPrompt: () => this.systemPrompt,
				getSystemPromptOptions: () => this._baseSystemPromptOptions,
			},
			{
				registerProvider: (name, config) => {
					this._modelRegistry.registerProvider(name, config);
					this._refreshCurrentModelFromRegistry();
				},
				unregisterProvider: (name) => {
					this._modelRegistry.unregisterProvider(name);
					this._refreshCurrentModelFromRegistry();
				},
			},
		);
	}

	private _refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void {
		const previousRegistryNames = new Set(this._toolRegistry.keys());
		const previousActiveToolNames = this.getActiveToolNames();
		const allowedToolNames = this._allowedToolNames;
		const excludedToolNames = this._excludedToolNames;
		const isAllowedTool = (name: string): boolean =>
			(!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);

		const registeredTools = this._extensionRunner.getAllRegisteredTools();
		const allCustomTools = [
			...registeredTools,
			...this._customTools.map((definition) => ({
				definition,
				sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
			})),
		].filter((tool) => isAllowedTool(tool.definition.name));
		const definitionRegistry = new Map<string, ToolDefinitionEntry>(
			Array.from(this._baseToolDefinitions.entries())
				.filter(([name]) => isAllowedTool(name))
				.map(([name, definition]) => [
					name,
					{
						definition,
						sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
					},
				]),
		);
		for (const tool of allCustomTools) {
			definitionRegistry.set(tool.definition.name, {
				definition: tool.definition,
				sourceInfo: tool.sourceInfo,
			});
		}
		this._toolDefinitions = definitionRegistry;
		this._toolPromptSnippets = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const snippet = this._normalizePromptSnippet(definition.promptSnippet);
					return snippet ? ([definition.name, snippet] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string] => entry !== undefined),
		);
		this._toolPromptGuidelines = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
					return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string[]] => entry !== undefined),
		);
		const runner = this._extensionRunner;
		const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
		const wrappedBuiltInTools = wrapRegisteredTools(
			Array.from(this._baseToolDefinitions.values())
				.filter((definition) => isAllowedTool(definition.name))
				.map((definition) => ({
					definition,
					sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
				})),
			runner,
		);

		const rawToolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
		for (const tool of wrappedExtensionTools as AgentTool[]) {
			rawToolRegistry.set(tool.name, tool);
		}
		this._toolRegistry = new Map(
			Array.from(rawToolRegistry.entries()).map(([name, tool]) => [
				name,
				this._wrapWorkflowTool(tool, definitionRegistry.get(name)?.definition),
			]),
		);

		let nextActiveToolNames = (
			options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]
		).filter((name) => isAllowedTool(name));

		if (allowedToolNames) {
			for (const toolName of this._toolRegistry.keys()) {
				if (allowedToolNames.has(toolName)) {
					nextActiveToolNames.push(toolName);
				}
			}
		} else if (options?.includeAllExtensionTools) {
			for (const tool of wrappedExtensionTools) {
				nextActiveToolNames.push(tool.name);
			}
		} else if (!options?.activeToolNames) {
			for (const toolName of this._toolRegistry.keys()) {
				if (!previousRegistryNames.has(toolName)) {
					nextActiveToolNames.push(toolName);
				}
			}
		}

		const configuredBuildTools = [...new Set(nextActiveToolNames)];
		if (this._collaborationMode === "build" || !this._buildToolNames) {
			this._buildToolNames = configuredBuildTools;
		}
		if (this._collaborationMode === "plan") {
			nextActiveToolNames = configuredBuildTools.filter((name) => {
				const definition = this._toolDefinitions.get(name)?.definition;
				return this._workflowRuntime.canDispatchTool(name, definition, "plan");
			});
		}
		this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
	}

	private _buildRuntime(options: {
		activeToolNames?: string[];
		flagValues?: Map<string, boolean | string>;
		includeAllExtensionTools?: boolean;
	}): void {
		const autoResizeImages = this.settingsManager.getImageAutoResize();
		const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const baseToolDefinitions = this._baseToolsOverride
			? Object.fromEntries(
					Object.entries(this._baseToolsOverride).map(([name, tool]) => [
						name,
						createToolDefinitionFromAgentTool(tool),
					]),
				)
			: createAllToolDefinitions(this._cwd, {
					read: { autoResizeImages },
					bash: { commandPrefix: shellCommandPrefix, shellPath },
					spawnAgent: {
						getRuntimeContext: () => ({
							rootRunId: process.env.METIS_ROOT_RUN_ID,
							currentAgentId: process.env.METIS_AGENT_ID,
							currentAgentName: process.env.METIS_AGENT_NAME,
							currentDepth: process.env.METIS_AGENT_DEPTH ? parseInt(process.env.METIS_AGENT_DEPTH, 10) : 0,
							provider: this.model?.provider,
							model: this.model?.id,
							thinking: this.thinkingLevel,
							getChildModel: (childRole) => {
								const model = this._getPerformanceChildModel(childRole);
								return model ? { provider: model.provider, model: model.id } : undefined;
							},
							getChildThinking: (childRole) => this._getPerformanceChildThinking(childRole),
							skills: this._resourceLoader
								.getSkills()
								.skills.filter((s) => s.sourceInfo.source === "cli" || s.sourceInfo.scope === "temporary")
								.map((s) => s.filePath),
							env: this._performanceRuntime.state ? {
								METIS_PERFORMANCE_RUN_ID: this._performanceRuntime.state.runId,
								METIS_PERFORMANCE_GOVERNANCE_ROOT: this._performanceRuntime.state.governanceRoot,
								METIS_PERFORMANCE_NONCE: this._performanceRuntime.state.nonce,
								METIS_PERFORMANCE_MISSION_SHA256: this._performanceRuntime.state.missionSha256,
								METIS_PERFORMANCE_MISSION_BYTES: String(this._performanceRuntime.state.missionBytes),
							} : undefined,
						}),
						validateSpawn: (input, runtime, childAgentId) => {
							const decision = this._performanceRuntime.reserveSpawn(
								runtime?.currentAgentName ?? "root",
								input.agent,
								childAgentId,
							);
							return decision.valid ? undefined : decision.message;
						},
						releaseSpawn: (childAgentId) => this._performanceRuntime.releaseSpawn(childAgentId),
						onStatusChange: (jobId, running) => this._setSubagentRunning(jobId, running),
						sendMessage: (jobId, result) => this._queueSubagentResult(jobId, result),
					},
					updatePlan: {
						onUpdate: (plan) => {
							const current = this.workflowPlan;
							const taskId = this._activeWorkflowTaskId ?? current?.taskId ?? randomUUID();
							this._activeWorkflowTaskId = taskId;
							this._activeWorkflowProposalRevision ??= current?.proposalRevision;
							this._appendWorkflowPlanEntry({
								...plan,
								taskId,
								proposalRevision: this._activeWorkflowProposalRevision,
								phase: "active",
							});
						},
					},
					performanceGate: {
						runtime: () => this._performanceRuntime,
						actor: () => ({ id: process.env.METIS_AGENT_ID ?? "root", role: process.env.METIS_AGENT_NAME ?? "root" }),
					},
					askUser: { handler: () => (request, signal) => this._askUser(request, signal) },
					queryMemoryDb: { query: (sql, params) => this._memoryCoordinator?.query(sql, params) ?? [] },
				});

		this._baseToolDefinitions = new Map(
			Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool as ToolDefinition]),
		);

		const extensionsResult = this._resourceLoader.getExtensions();
		if (options.flagValues) {
			for (const [name, value] of options.flagValues) {
				extensionsResult.runtime.flagValues.set(name, value);
			}
		}

		this._extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			this._cwd,
			this.sessionManager,
			this._modelRegistry,
		);
		if (this._extensionRunnerRef) {
			this._extensionRunnerRef.current = this._extensionRunner;
		}
		this._bindExtensionCore(this._extensionRunner);
		this._applyExtensionBindings(this._extensionRunner);

		const defaultActiveToolNames = this._baseToolsOverride
			? Object.keys(this._baseToolsOverride)
			: ["read", "bash", "edit", "write", "spawn_agent", "websearch", "webfetch", "update_plan", "ask_user", "read_plan", "performance_gate", "query_memory_db"];
		const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
		this._refreshToolRegistry({
			activeToolNames: baseActiveToolNames,
			includeAllExtensionTools: options.includeAllExtensionTools,
		});
	}

	async reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void> {
		const previousFlagValues = this._extensionRunner.getFlagValues();
		await emitSessionShutdownEvent(this._extensionRunner, { type: "session_shutdown", reason: "reload" });
		await this.settingsManager.reload();
		this.syncQueueModesFromSettings();
		resetApiProviders();
		this.modelRegistry.refresh();
		this.syncModelFromRegistry();
		await this._resourceLoader.reload();
		this._buildRuntime({
			activeToolNames: this.getActiveToolNames(),
			flagValues: previousFlagValues,
			includeAllExtensionTools: true,
		});

		const hasBindings =
			this._extensionUIContext ||
			this._extensionCommandContextActions ||
			this._extensionShutdownHandler ||
			this._extensionErrorListener;
		if (hasBindings) {
			await options?.beforeSessionStart?.();
			await this._extensionRunner.emit({ type: "session_start", reason: "reload" });
			await this.extendResourcesFromExtensions("reload");
		}
	}

	/**
	 * Replace the session model with the registry copy for the same provider/id.
	 * If no model is currently selected (e.g. session started without credentials),
	 * auto-select the first available model in the refreshed registry.
	 * Needed after models.json changes (e.g. custom provider reasoning flag) so
	 * supportsThinking() and thinking levels reflect the refreshed definition.
	 */
	syncModelFromRegistry(): void {
		const current = this.model;
		if (!current) {
			const available = this._modelRegistry.getAll().filter((model) => this._modelRegistry.hasConfiguredAuth(model));
			if (available.length > 0) {
				let chosen = available[0];
				for (const provider of Object.keys(defaultModelPerProvider) as (keyof typeof defaultModelPerProvider)[]) {
					const defaultId = defaultModelPerProvider[provider];
					const match = available.find((m) => m.provider === provider && m.id === defaultId);
					if (match) {
						chosen = match;
						break;
					}
				}
				this.agent.state.model = chosen;
				this.setThinkingLevel(this._getThinkingLevelForModelSwitch());
				this.settingsManager.setDefaultModelAndProvider(chosen.provider, chosen.id);
			}
			return;
		}
		const refreshed = this._modelRegistry.find(current.provider, current.id);
		if (!refreshed) return;
		this.agent.state.model = refreshed;
		this.setThinkingLevel(this._getThinkingLevelForModelSwitch());
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 */
	private _isRetryableError(message: AssistantMessage): boolean {
		// Context overflow is handled by compaction, not retry.
		if (isContextOverflow(message, this.model?.contextWindow ?? 0)) return false;
		return isRetryableAssistantError(message);
	}

	/**
	 * Prepare a retryable error for continuation with exponential backoff.
	 * @returns true if the caller should continue the agent, false otherwise
	 */
	private async _prepareRetry(message: AssistantMessage): Promise<boolean> {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) {
			return false;
		}

		this._retryAttempt++;

		if (this._retryAttempt > settings.maxRetries) {
			// Preserve the completed attempt count so post-run handling can emit the final failure.
			this._retryAttempt--;
			return false;
		}

		const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

		this._emit({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
		});

		// Remove error message from agent state (keep in session for history)
		const messages = this.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			this.agent.state.messages = messages.slice(0, -1);
		}

		// Wait with exponential backoff (abortable)
		this._retryAbortController = new AbortController();
		try {
			await sleep(delayMs, this._retryAbortController.signal);
		} catch {
			// Aborted during sleep - emit end event so UI can clean up
			const attempt = this._retryAttempt;
			this._retryAttempt = 0;
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			return false;
		} finally {
			this._retryAbortController = undefined;
		}

		return true;
	}

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		this._retryAbortController?.abort();
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this._retryAbortController !== undefined;
	}

	/** Whether auto-retry is enabled */
	get autoRetryEnabled(): boolean {
		return this.settingsManager.getRetryEnabled();
	}

	/**
	 * Toggle auto-retry setting.
	 */
	setAutoRetryEnabled(enabled: boolean): void {
		this.settingsManager.setRetryEnabled(enabled);
	}

	// =========================================================================
	// Bash Execution
	// =========================================================================

	/**
	 * Execute a bash command.
	 * Adds result to agent context and session.
	 * @param command The bash command to execute
	 * @param onChunk Optional streaming callback for output
	 * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
	 * @param options.operations Custom BashOperations for remote execution
	 */
	async executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { excludeFromContext?: boolean; operations?: BashOperations },
	): Promise<BashResult> {
		this._bashAbortController = new AbortController();

		// Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
		const prefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const resolvedCommand = prefix ? `${prefix}\n${command}` : command;

		try {
			const result = await executeBashWithOperations(
				resolvedCommand,
				this.sessionManager.getCwd(),
				options?.operations ?? createLocalBashOperations({ shellPath }),
				{
					onChunk,
					signal: this._bashAbortController.signal,
				},
			);

			this.recordBashResult(command, result, options);
			return result;
		} finally {
			this._bashAbortController = undefined;
		}
	}

	/**
	 * Record a bash execution result in session history.
	 * Used by executeBash and by extensions that handle bash execution themselves.
	 */
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
		const bashMessage: BashExecutionMessage = {
			role: "bashExecution",
			command,
			output: result.output,
			exitCode: result.exitCode,
			cancelled: result.cancelled,
			truncated: result.truncated,
			fullOutputPath: result.fullOutputPath,
			timestamp: Date.now(),
			excludeFromContext: options?.excludeFromContext,
		};

		// If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
		if (this.isStreaming) {
			// Queue for later - will be flushed on agent_end
			this._pendingBashMessages.push(bashMessage);
		} else {
			// Add to agent state immediately
			this.agent.state.messages.push(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}
	}

	/**
	 * Cancel running bash command.
	 */
	abortBash(): void {
		this._bashAbortController?.abort();
	}

	/** Whether a bash command is currently running */
	get isBashRunning(): boolean {
		return this._bashAbortController !== undefined;
	}

	/** Whether there are pending bash messages waiting to be flushed */
	get hasPendingBashMessages(): boolean {
		return this._pendingBashMessages.length > 0;
	}

	/**
	 * Flush pending bash messages to agent state and session.
	 * Called after agent turn completes to maintain proper message ordering.
	 */
	private _flushPendingBashMessages(): void {
		if (this._pendingBashMessages.length === 0) return;

		for (const bashMessage of this._pendingBashMessages) {
			// Add to agent state
			this.agent.state.messages.push(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}

		this._pendingBashMessages = [];
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Set a display name for the current session.
	 */
	setSessionName(name: string): void {
		this.sessionManager.appendSessionInfo(name);
		const event = { type: "session_info_changed", name: this.sessionManager.getSessionName() } as const;
		this._emit(event);
		void this._extensionRunner.emit(event);
	}

	/**
	 * Ensure the session has a display name. If none is set, generate an AI summary title asynchronously.
	 */
	async ensureSessionName(
		options: { prompt?: string; signal?: AbortSignal; timeoutMs?: number } = {},
	): Promise<string | undefined> {
		if (this._sessionNameGenerationPromise) {
			return this._sessionNameGenerationPromise;
		}
		if (!this._autoSessionName || this.sessionName || this._sessionNameError) {
			return this.sessionName;
		}

		const firstUserMessage = this.messages.find((message) => message.role === "user");
		const prompt = options.prompt?.trim() || (firstUserMessage ? this._getUserMessageText(firstUserMessage).trim() : "");
		if (!prompt) {
			return undefined;
		}

		this._isGeneratingSessionName = true;
		this._sessionNameError = undefined;
		this._emit({ type: "session_name_generation", status: "started" });

		const generation = (async (): Promise<string | undefined> => {
			try {
				if (!this.model) {
					const fallbackName = generateFallbackSessionName([
						{ role: "user", content: prompt, timestamp: Date.now() },
					]);
					this.setSessionName(fallbackName);
					this._emit({ type: "session_name_generation", status: "completed", name: fallbackName });
					return fallbackName;
				}

				const name = await generateSessionName({
					model: this.model,
					modelRegistry: this._modelRegistry,
					prompt,
					signal: options.signal,
					timeoutMs: options.timeoutMs,
				});

				const resolvedName =
					name ?? generateFallbackSessionName([{ role: "user", content: prompt, timestamp: Date.now() }]);
				if (resolvedName && !this.sessionName) this.setSessionName(resolvedName);
				this._emit({ type: "session_name_generation", status: "completed", name: resolvedName });
				return this.sessionName ?? resolvedName;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const fallbackName = options.signal?.aborted
					? undefined
					: generateFallbackSessionName([{ role: "user", content: prompt, timestamp: Date.now() }]);
				if (fallbackName && !this.sessionName) {
					this.setSessionName(fallbackName);
					this._emit({ type: "session_name_generation", status: "completed", name: fallbackName });
					return fallbackName;
				}
				if (this.sessionName) return this.sessionName;
				this._sessionNameError = message;
				this._emit({ type: "session_name_generation", status: "failed", error: message });
				return undefined;
			}
		})();

		this._sessionNameGenerationPromise = generation;
		try {
			return await generation;
		} finally {
			this._isGeneratingSessionName = false;
			if (this._sessionNameGenerationPromise === generation) {
				this._sessionNameGenerationPromise = undefined;
			}
		}
	}

	// =========================================================================
	// Tree Navigation
	// =========================================================================

	/**
	 * Navigate to a different node in the session tree.
	 * Unlike fork() which creates a new session file, this stays in the same file.
	 *
	 * @param targetId The entry ID to navigate to
	 * @param options.summarize Whether user wants to summarize abandoned branch
	 * @param options.customInstructions Custom instructions for summarizer
	 * @param options.replaceInstructions If true, customInstructions replaces the default prompt
	 * @param options.label Label to attach to the branch summary entry
	 * @returns Result with editorText (if user message) and cancelled status
	 */
	async navigateTree(
		targetId: string,
		options: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string } = {},
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }> {
		const oldLeafId = this.sessionManager.getLeafId();

		// No-op if already at target
		if (targetId === oldLeafId) {
			return { cancelled: false };
		}

		// Model required for summarization
		if (options.summarize && !this.model) {
			throw new Error("No model available for summarization");
		}

		const targetEntry = this.sessionManager.getEntry(targetId);
		if (!targetEntry) {
			throw new Error(`Entry ${targetId} not found`);
		}

		// Collect entries to summarize (from old leaf to common ancestor)
		const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
			this.sessionManager,
			oldLeafId,
			targetId,
		);

		// Prepare event data - mutable so extensions can override
		let customInstructions = options.customInstructions;
		let replaceInstructions = options.replaceInstructions;
		let label = options.label;

		const preparation: TreePreparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize,
			userWantsSummary: options.summarize ?? false,
			customInstructions,
			replaceInstructions,
			label,
		};

		// Set up abort controller for summarization
		this._branchSummaryAbortController = new AbortController();

		try {
			let extensionSummary: { summary: string; details?: unknown } | undefined;
			let fromExtension = false;

			// Emit session_before_tree event
			if (this._extensionRunner.hasHandlers("session_before_tree")) {
				const result = (await this._extensionRunner.emit({
					type: "session_before_tree",
					preparation,
					signal: this._branchSummaryAbortController.signal,
				})) as SessionBeforeTreeResult | undefined;

				if (result?.cancel) {
					return { cancelled: true };
				}

				if (result?.summary && options.summarize) {
					extensionSummary = result.summary;
					fromExtension = true;
				}

				// Allow extensions to override instructions and label
				if (result?.customInstructions !== undefined) {
					customInstructions = result.customInstructions;
				}
				if (result?.replaceInstructions !== undefined) {
					replaceInstructions = result.replaceInstructions;
				}
				if (result?.label !== undefined) {
					label = result.label;
				}
			}

			// Run default summarizer if needed
			let summaryText: string | undefined;
			let summaryDetails: unknown;
			if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
				const model = this.model!;
				const { apiKey, headers, env } = await this._getRequiredRequestAuth(model);
				const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
				const result = await generateBranchSummary(entriesToSummarize, {
					model,
					apiKey,
					headers,
					env,
					signal: this._branchSummaryAbortController.signal,
					customInstructions,
					replaceInstructions,
					reserveTokens: branchSummarySettings.reserveTokens,
					streamFn: this.agent.streamFn,
				});
				if (result.aborted) {
					return { cancelled: true, aborted: true };
				}
				if (result.error) {
					throw new Error(result.error);
				}
				summaryText = result.summary;
				summaryDetails = {
					readFiles: result.readFiles || [],
					modifiedFiles: result.modifiedFiles || [],
				};
			} else if (extensionSummary) {
				summaryText = extensionSummary.summary;
				summaryDetails = extensionSummary.details;
			}

			// Determine the new leaf position based on target type
			let newLeafId: string | null;
			let editorText: string | undefined;

			if (targetEntry.type === "message" && targetEntry.message.role === "user") {
				// User message: leaf = parent (null if root), text goes to editor
				newLeafId = targetEntry.parentId;
				editorText = this._extractUserMessageText(targetEntry.message.content);
			} else if (targetEntry.type === "custom_message") {
				// Custom message: leaf = parent (null if root), text goes to editor
				newLeafId = targetEntry.parentId;
				editorText =
					typeof targetEntry.content === "string"
						? targetEntry.content
						: targetEntry.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("");
			} else {
				// Non-user message: leaf = selected node
				newLeafId = targetId;
			}

			// Switch leaf (with or without summary)
			// Summary is attached at the navigation target position (newLeafId), not the old branch
			let summaryEntry: BranchSummaryEntry | undefined;
			if (summaryText) {
				// Create summary at target position (can be null for root)
				const summaryId = this.sessionManager.branchWithSummary(
					newLeafId,
					summaryText,
					summaryDetails,
					fromExtension,
				);
				summaryEntry = this.sessionManager.getEntry(summaryId) as BranchSummaryEntry;

				// Attach label to the summary entry
				if (label) {
					this.sessionManager.appendLabelChange(summaryId, label);
				}
			} else if (newLeafId === null) {
				// No summary, navigating to root - reset leaf
				this.sessionManager.resetLeaf();
			} else {
				// No summary, navigating to non-root
				this.sessionManager.branch(newLeafId);
			}

			// Attach label to target entry when not summarizing (no summary entry to label)
			if (label && !summaryText) {
				this.sessionManager.appendLabelChange(targetId, label);
			}

			// Update agent state
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.state.messages = sessionContext.messages;

			// Emit session_tree event
			await this._extensionRunner.emit({
				type: "session_tree",
				newLeafId: this.sessionManager.getLeafId(),
				oldLeafId,
				summaryEntry,
				fromExtension: summaryText ? fromExtension : undefined,
			});

			// Emit to custom tools

			return { editorText, cancelled: false, summaryEntry };
		} finally {
			this._branchSummaryAbortController = undefined;
		}
	}

	/**
	 * Get all user messages from session for fork selector.
	 */
	getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
		const entries = this.sessionManager.getEntries();
		const result: Array<{ entryId: string; text: string }> = [];

		for (const entry of entries) {
			if (entry.type !== "message") continue;
			if (entry.message.role !== "user") continue;

			const text = this._extractUserMessageText(entry.message.content);
			if (text) {
				result.push({ entryId: entry.id, text });
			}
		}

		return result;
	}

	private _extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
		}
		return "";
	}

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		const state = this.state;
		const userMessages = state.messages.filter((m) => m.role === "user").length;
		const assistantMessages = state.messages.filter((m) => m.role === "assistant").length;
		const toolResults = state.messages.filter((m) => m.role === "toolResult").length;

		let toolCalls = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		return {
			sessionFile: this.sessionFile,
			sessionId: this.sessionId,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults,
			totalMessages: state.messages.length,
			tokens: {
				input: totalInput,
				output: totalOutput,
				cacheRead: totalCacheRead,
				cacheWrite: totalCacheWrite,
				total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
			},
			cost: totalCost,
			contextUsage: this.getContextUsage(),
		};
	}

	getContextUsage(): ContextUsage | undefined {
		const model = this.model;
		if (!model) return undefined;

		const contextWindow = model.contextWindow ?? 0;
		if (contextWindow <= 0) return undefined;

		// After compaction, the last assistant usage reflects pre-compaction context size.
		// We can only trust usage from an assistant that responded after the latest compaction.
		// If no such assistant exists, context token count is unknown until the next LLM response.
		const branchEntries = this.sessionManager.getBranch();
		const latestCompaction = getLatestCompactionEntry(branchEntries);

		if (latestCompaction) {
			// Check if there's a valid assistant usage after the compaction boundary
			const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
			let hasPostCompactionUsage = false;
			for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
				const entry = branchEntries[i];
				if (entry.type === "message" && entry.message.role === "assistant") {
					const assistant = entry.message;
					if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
						const contextTokens = calculateContextTokens(assistant.usage);
						if (contextTokens > 0) {
							hasPostCompactionUsage = true;
							break;
						}
					}
				}
			}

			if (!hasPostCompactionUsage) {
				return { tokens: null, contextWindow, percent: null };
			}
		}

		const estimate = estimateContextTokens(this.messages);
		const percent = (estimate.tokens / contextWindow) * 100;

		return {
			tokens: estimate.tokens,
			contextWindow,
			percent,
		};
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	async exportToHtml(outputPath?: string): Promise<string> {
		const configuredThemeName = this.settingsManager.getTheme();
		const themeName = configuredThemeName && getThemeByName(configuredThemeName) ? configuredThemeName : undefined;

		// Create tool renderer if we have an extension runner (for custom tool HTML rendering)
		const toolRenderer: ToolHtmlRenderer = createToolHtmlRenderer({
			getToolDefinition: (name) => this.getToolDefinition(name),
			theme,
			cwd: this.sessionManager.getCwd(),
		});

		return await exportSessionToHtml(this.sessionManager, this.state, {
			outputPath,
			themeName,
			toolRenderer,
		});
	}

	/**
	 * Export the current session branch to a JSONL file.
	 * Writes the session header followed by all entries on the current branch path.
	 * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
	 * @returns The resolved output file path.
	 */
	exportToJsonl(outputPath?: string): string {
		const filePath = resolvePath(
			outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
			process.cwd(),
		);
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: this.sessionManager.getSessionId(),
			timestamp: new Date().toISOString(),
			cwd: this.sessionManager.getCwd(),
		};

		const branchEntries = this.sessionManager.getBranch();
		const lines = [JSON.stringify(header)];

		// Re-chain parentIds to form a linear sequence
		let prevId: string | null = null;
		for (const entry of branchEntries) {
			const linear = { ...entry, parentId: prevId };
			lines.push(JSON.stringify(linear));
			prevId = entry.id;
		}

		writeFileSync(filePath, `${lines.join("\n")}\n`);
		return filePath;
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or undefined if no assistant message exists
	 */
	getLastAssistantText(): string | undefined {
		const lastAssistant = this.messages
			.slice()
			.reverse()
			.find((m) => {
				if (m.role !== "assistant") return false;
				const msg = m as AssistantMessage;
				// Skip aborted messages with no content
				if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
				return true;
			});

		if (!lastAssistant) return undefined;

		let text = "";
		for (const content of (lastAssistant as AssistantMessage).content) {
			if (content.type === "text") {
				text += content.text;
			}
		}

		return text.trim() || undefined;
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	createReplacedSessionContext(): ReplacedSessionContext {
		const context = Object.defineProperties(
			{},
			Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext()),
		) as ReplacedSessionContext;
		context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
		context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
		return context;
	}

	/**
	 * Check if extensions have handlers for a specific event type.
	 */
	hasExtensionHandlers(eventType: string): boolean {
		return this._extensionRunner.hasHandlers(eventType);
	}

	/**
	 * Get the extension runner (for setting UI context and error handlers).
	 */
	get extensionRunner(): ExtensionRunner {
		return this._extensionRunner;
	}
}
