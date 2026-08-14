import { join } from "node:path";
import { createHash } from "node:crypto";
import { Agent, type AgentMessage, type ThinkingLevel } from "@earendil-works/metis-agent-core";
import { clampThinkingLevel, type Message, type Model, streamSimple } from "@earendil-works/metis-ai/compat";
import { getAgentDir } from "../config.ts";
import { resolvePath } from "../utils/paths.ts";
import { AgentSession } from "./agent-session.ts";
import { formatNoModelsAvailableMessage } from "./auth-guidance.ts";
import { AuthStorage } from "./auth-storage.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type { CollaborationMode } from "./workflow-runtime.ts";
import type { AskUserHandler } from "./ask-user.ts";
import type { ExtensionRunner, LoadExtensionsResult, SessionStartEvent, ToolDefinition } from "./extensions/index.ts";
import { convertToLlm } from "./messages.ts";
import { ModelRegistry } from "./model-registry.ts";
import { findInitialModel } from "./model-resolver.ts";
import { mergeProviderAttributionHeaders } from "./provider-attribution.ts";
import { withRawReasoningPreference } from "./raw-reasoning-stream.ts";
import { MemoryCoordinator, type MemoryCandidate, type MemoryCategory, type MemoryExtractionResult, type MemoryRecordSummary, type MemoryScope, type SessionMemoryCheckpoint } from "./memory-coordinator.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { DefaultResourceLoader } from "./resource-loader.ts";
import { getDefaultSessionDir, SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";
import { time } from "./timings.ts";
import {
	createBashTool,
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createLogTool,
	createRememberUserIntentTool,
	createUserIntentTool,
	createReadOnlyTools,
	createReadTool,
	createVideoTool,
	createSubagentTool,
	createWebSearchTool,
	createWebFetchTool,
	createAskUserTool,
	createReadPlanTool,
	createQueryMemoryDbToolDefinition,
	createWriteTool,
	type ToolName,
	withFileMutationQueue,
} from "./tools/index.ts";

const MEMORY_EXTRACTION_PROMPT = `Extract durable coding-agent memory from this checkpoint and maintain an up-to-date Memory Map catalog.

All extracted memory records and the Memory Map MUST be written in English, regardless of the conversation or checkpoint language.

Standard Categories:
- tech_stack: Runtime environment (e.g. Node 22+), language, core dependencies, package name.
- architecture_patterns: Directory structure, module boundaries, system design principles.
- project_conventions: Code conventions, style guidelines, Git commit/branch rules.
- domain_knowledge: Domain logic, key business terms, background facts.
- workflows_and_commands: Common CLI commands, build/test/verification procedures.
- known_failures_and_fixes: Known error causes, debugging solutions, pitfalls to avoid.
- deployment_and_infra: Deployment target, env config, release pipeline.
- user_preferences: User personal preferences, language preference, collaboration style.

Instructions:
1. Determine the relevant category for new durable knowledge from the checkpoint.
2. Use query_memory_db to inspect existing records (e.g. \`SELECT id, category, content FROM memory_records WHERE category = '...'\`).
3. Apply 3-Way Deduplication Decision:
   - SKIP (Redundant): If an existing record already covers the fact/rule with equivalent or sufficient information, DO NOT extract it (skip completely).
   - MERGE / UPDATE (Supersedes): If the checkpoint provides more complete, updated, or corrected information that refines one or more existing records, extract the consolidated English text and set "supersedes": ["<existing-id-1>", ...] with the ID(s) of the superseded record(s).
   - NEW (Novel knowledge): If the knowledge is genuinely new and uncovered by existing records, extract as a new candidate in English without "supersedes".
4. Maintain the Memory Map (memoryMap):
   - Review the existing Memory Map provided in the context (if any).
   - Produce an updated, high-density Markdown document indexing where different categories and kinds of memories are organized across scopes (Global vs Projects) and their thematic ranges/summaries.
   - Example structure:
     # Memory Map
     ## Global Memories
     - **[user_preferences]** (Global): Key preferences, rules...
     ## Projects
     ### <project / checkout>
     - **[tech_stack]**: Runtime, dependencies, package overview...
     - **[workflows_and_commands]**: Build, test, run commands...
     - **[known_failures_and_fixes]**: Recurring pitfalls and fixes...

Return strict JSON only. The JSON object format is:
{
  "candidates": [
    {
      "scope": "global" | "project" | "checkout",
      "category": "tech_stack" | "architecture_patterns" | "project_conventions" | "domain_knowledge" | "workflows_and_commands" | "known_failures_and_fixes" | "deployment_and_infra" | "user_preferences",
      "kind": "preference" | "fact" | "procedure" | "failure",
      "content": "string (concise, clear, durable knowledge written strictly in English)",
      "confidence": 0-1,
      "supersedes": ["optional array of superseded record IDs"]
    }
  ],
  "memoryMap": "string (updated Markdown document of the Memory Map)"
}

(Returning an array of candidate objects is also accepted for backward compatibility.)

Exclude temporary tasks, guesses, secrets, and unexecuted plans.`;

export async function extractMemoryCandidates(
	model: Model<any> | undefined,
	modelRegistry: ModelRegistry,
	checkpoint: SessionMemoryCheckpoint,
	queryMemoryDb: (sql: string, params?: Array<string | number | null | undefined>) => Array<Record<string, unknown>> = () => [],
	signal?: AbortSignal,
	stream: typeof streamSimple = streamSimple,
	existingMemoryMap?: string,
): Promise<MemoryExtractionResult> {
	if (!model) return { candidates: [], failureReason: "No model is available for background memory extraction." };
	try {
		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) return { candidates: [], failureReason: "No authentication is available for the background memory model." };
		const tool = createQueryMemoryDbToolDefinition();
		let userPromptText = `Checkpoint:\n${JSON.stringify(checkpoint)}`;
		if (existingMemoryMap && existingMemoryMap.trim().length > 0) {
			userPromptText += `\n\nExisting Memory Map:\n${existingMemoryMap.trim()}`;
		}
		const messages: Message[] = [{ role: "user", content: [{ type: "text", text: userPromptText }], timestamp: Date.now() }];
		while (true) {
			if (signal?.aborted) throw new Error("Background memory extraction aborted.");
			const response = await stream(model, {
				systemPrompt: MEMORY_EXTRACTION_PROMPT,
				messages,
				tools: [{ name: tool.name, description: tool.description, parameters: tool.parameters }],
			}, {
				apiKey: auth.apiKey,
				env: auth.env,
				headers: auth.headers,
				signal,
				...(model.reasoning === true ? { reasoning: "low" as const } : {}),
			}).result();
			if (signal?.aborted || response.stopReason === "aborted") throw new Error("Background memory extraction aborted.");
			if (response.stopReason === "error") return { candidates: [], failureReason: "Background memory extraction stopped: error." };

			const toolCalls = response.content.filter((part) => part.type === "toolCall");
			if (toolCalls.length > 0) {
				messages.push(response);
				for (const toolCall of toolCalls) {
					if (toolCall.name !== "query_memory_db") return { candidates: [], failureReason: `Background memory model requested unknown tool: ${toolCall.name}.` };
					const args = toolCall.arguments as Record<string, unknown> | undefined;
					const sql = typeof args?.sql === "string" ? args.sql.trim() : "";
					if (!sql) return { candidates: [], failureReason: "Background memory query arguments were invalid: sql is required." };
					const params = Array.isArray(args?.params) ? args.params : [];
					let formattedText = "No matching records found.";
					try {
						const rows = queryMemoryDb(sql, params);
						if (rows.length > 0) {
							formattedText = `Query returned ${rows.length} row${rows.length > 1 ? "s" : ""}:\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``;
						}
					} catch (error) {
						formattedText = `Query error: ${error instanceof Error ? error.message : String(error)}`;
					}
					messages.push({
						role: "toolResult",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						content: [{ type: "text", text: formattedText }],
						isError: false,
						timestamp: Date.now(),
					});
				}
				continue;
			}
			if (response.stopReason === "toolUse") return { candidates: [], failureReason: "Background memory model stopped for tool use without a tool call." };
			const text = response.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n").trim();
			const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
			const parsed = JSON.parse(json) as unknown;
			let candidateList: unknown[];
			let memoryMapText: string | undefined;
			if (Array.isArray(parsed)) {
				candidateList = parsed;
			} else if (parsed && typeof parsed === "object") {
				const obj = parsed as Record<string, unknown>;
				if (!Array.isArray(obj.candidates)) {
					return { candidates: [], failureReason: "Background memory model returned JSON object without candidates array." };
				}
				candidateList = obj.candidates;
				if (typeof obj.memoryMap === "string" && obj.memoryMap.trim().length > 0) {
					memoryMapText = obj.memoryMap.trim();
				}
			} else {
				return { candidates: [], failureReason: "Background memory model returned invalid JSON structure." };
			}
			const candidates: MemoryCandidate[] = [];
			for (const value of candidateList) {
				if (!value || typeof value !== "object") return { candidates: [], failureReason: "Background memory model returned an invalid candidate object." };
				const candidate = value as Record<string, unknown>;
				const scope = String(candidate.scope ?? "project");
				const kind = String(candidate.kind ?? "fact");
				const category = candidate.category ? String(candidate.category) : undefined;
				const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
				const confidence = typeof candidate.confidence === "number" ? candidate.confidence : 0;

				if (!["global", "project", "checkout"].includes(scope)
					|| !["preference", "fact", "procedure", "failure"].includes(kind)
					|| (category && !["tech_stack", "architecture_patterns", "project_conventions", "domain_knowledge", "workflows_and_commands", "known_failures_and_fixes", "deployment_and_infra", "user_preferences"].includes(category))
					|| content.length < 8
					|| !Number.isFinite(confidence)
					|| confidence < 0 || confidence > 1) {
					return { candidates: [], failureReason: "Background memory model returned a candidate that failed schema validation." };
				}

				let supersedes: string[] | undefined;
				if (Array.isArray(candidate.supersedes)) {
					supersedes = candidate.supersedes.map((id) => String(id).trim()).filter((id) => id.length > 0);
				} else if (typeof candidate.supersedes === "string" && candidate.supersedes.trim().length > 0) {
					supersedes = [candidate.supersedes.trim()];
				}

				if (confidence >= 0.75) {
					candidates.push({
						scope: scope as any,
						kind: kind as any,
						category: category as any,
						content,
						confidence,
						...(supersedes && supersedes.length > 0 ? { supersedes } : {}),
					});
				}
			}
			return {
				candidates: candidates.slice(0, 6),
				...(memoryMapText ? { memoryMap: memoryMapText } : {}),
			};
		}
	} catch (error) {
		if (signal?.aborted) throw error;
		return { candidates: [], failureReason: `Background memory extraction failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export interface CreateAgentSessionOptions {
	/** Working directory for project-local discovery. Default: process.cwd() */
	cwd?: string;
	/** Global config directory. Default: ~/.metis/agent */
	agentDir?: string;

	/** Auth storage for credentials. Default: AuthStorage.create(agentDir/auth.json) */
	authStorage?: AuthStorage;
	/** Model registry. Default: ModelRegistry.create(authStorage, agentDir/models.json) */
	modelRegistry?: ModelRegistry;

	/** Model to use. Default: from settings, else first available */
	model?: Model<any>;
	/** Thinking level. Default: from settings, else 'medium' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Workflow policy. Build is default; Plan exposes read-only tools only. */
	collaborationMode?: CollaborationMode;
	/** Optional interactive bridge for model-initiated clarifying questions. */
	askUserHandler?: AskUserHandler;
	/** Models available for cycling (Ctrl+P in interactive mode) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

	/**
	 * Optional default tool suppression mode when no explicit allowlist is provided.
	 *
	 * - "all": start with no tools enabled
	 * - "builtin": disable the default built-in tools (read, bash, edit, write, log)
	  *   but keep extension/custom tools enabled
	 */
	noTools?: "all" | "builtin";
	/**
	 * Optional allowlist of tool names.
	 *
	 * When omitted, metis enables the default built-in tools (read, bash, edit, write, log)
	  * and leaves extension/custom tools enabled unless `noTools` changes that default.
	 * When provided, only the listed tool names are enabled.
	 */
	tools?: string[];
	/** Optional denylist of tool names to disable. Applies after `tools` when both are provided. */
	excludeTools?: string[];
	/** Custom tools to register (in addition to built-in tools). */
	customTools?: ToolDefinition[];

	/** Resource loader. When omitted, DefaultResourceLoader is used. */
	resourceLoader?: ResourceLoader;

	/** Whether to automatically generate an AI-summarized session title. Default: true */
	autoSessionName?: boolean;
	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
	settingsManager?: SettingsManager;
	/** Session start event metadata for extension runtime startup. */
	sessionStartEvent?: SessionStartEvent;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Extensions result (for UI context setup in interactive mode) */
	extensionsResult: LoadExtensionsResult;
	/** Warning if session was restored with a different model than saved */
	modelFallbackMessage?: string;
}

// Re-exports

export * from "./agent-session-runtime.ts";
export type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	SlashCommandInfo,
	SlashCommandSource,
	ToolDefinition,
} from "./extensions/index.ts";
export type { PromptTemplate } from "./prompt-templates.ts";
export type { Skill } from "./skills.ts";
export type { Tool } from "./tools/index.ts";

export {
	withFileMutationQueue,
	// Tool factories (for custom cwd)
	createCodingTools,
	createReadOnlyTools,
	createReadTool,
	createVideoTool,
	createBashTool,
	createEditTool,
	createLogTool,
	createRememberUserIntentTool,
	createUserIntentTool,
	createWriteTool,
	createGrepTool,
	createFindTool,
	createLsTool,
	createSubagentTool,
	createWebSearchTool,
	createWebFetchTool,
	createAskUserTool,
	createReadPlanTool,
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@earendil-works/metis-ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const loader = new DefaultResourceLoader({
 *   cwd: process.cwd(),
 *   agentDir: getAgentDir(),
 *   settingsManager: SettingsManager.create(),
 * });
 * await loader.reload();
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   tools: ["read", "bash"],
 *   resourceLoader: loader,
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
	const agentDir = options.agentDir ? resolvePath(options.agentDir) : getDefaultAgentDir();
	let resourceLoader = options.resourceLoader;

	// Use provided or create AuthStorage and ModelRegistry
	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const authStorage = options.authStorage ?? AuthStorage.create(authPath);
	const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, modelsPath);

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));

	if (!resourceLoader) {
		resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			extensionFactories: [],
		});
		await resourceLoader.reload();
		time("resourceLoader.reload");
	}

	// Check if session has existing data to restore
	const existingSession = sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const collaborationMode = options.collaborationMode ?? existingSession.collaborationMode;
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");

	let model = options.model;
	let modelFallbackMessage: string | undefined;

	// If session has data, try to restore model from it
	if (!model && hasExistingSession && existingSession.model) {
		const restoredModel = modelRegistry.find(existingSession.model.provider, existingSession.model.modelId);
		if (restoredModel && modelRegistry.hasConfiguredAuth(restoredModel)) {
			model = restoredModel;
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${existingSession.model.provider}/${existingSession.model.modelId}`;
		}
	}

	// If still no model, use findInitialModel (checks settings default, then provider defaults)
	if (!model) {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: hasExistingSession,
			defaultProvider: settingsManager.getDefaultProvider(),
			defaultModelId: settingsManager.getDefaultModel(),
			defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			modelRegistry,
		});
		model = result.model;
		if (!model) {
			modelFallbackMessage = formatNoModelsAvailableMessage();
		} else if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
		}
	}

	let thinkingLevel = options.thinkingLevel;

	// If session has data, restore thinking level from it
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingSession.thinkingLevel as ThinkingLevel)
			: (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
	}

	// Fall back to settings default
	if (thinkingLevel === undefined) {
		thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}

	// Clamp to model capabilities
	if (!model) {
		thinkingLevel = "off";
	} else {
		thinkingLevel = clampThinkingLevel(model, thinkingLevel) as ThinkingLevel;
	}

	// Legacy memory/log bookkeeping tools remain explicit-only. query_memory_db is
	// active so the model can retrieve durable knowledge on demand in any host.
	const defaultActiveToolNames: ToolName[] = ["read", "bash", "edit", "write", "subagent", "websearch", "webfetch", "video", "update_plan", "ask_user", "read_plan", "query_memory_db"];
	const allowedToolNames = options.tools ?? (options.noTools === "all" ? [] : undefined);
	const excludedToolNames = options.excludeTools;
	const excludedToolNameSet = excludedToolNames ? new Set(excludedToolNames) : undefined;
	const initialActiveToolNames: string[] = (
		options.tools ? [...options.tools] : options.noTools ? [] : defaultActiveToolNames
	).filter((name) => !excludedToolNameSet?.has(name));

	let agent: Agent;

	// Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlm(messages);
		// Check setting dynamically so mid-session changes take effect
		if (!settingsManager.getBlockImages()) {
			return converted;
		}
		// Filter out ImageContent from all messages, replacing with text placeholder
		return converted.map((msg) => {
			if (msg.role === "user" || msg.role === "toolResult") {
				const content = msg.content;
				if (Array.isArray(content)) {
					const hasImages = content.some((c) => c.type === "image");
					if (hasImages) {
						const filteredContent = content
							.map((c) =>
								c.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : c,
							)
							.filter(
								(c, i, arr) =>
									// Dedupe consecutive "Image reading is disabled." texts
									!(
										c.type === "text" &&
										c.text === "Image reading is disabled." &&
										i > 0 &&
										arr[i - 1].type === "text" &&
										(arr[i - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
									),
							);
						return { ...msg, content: filteredContent };
					}
				}
			}
			return msg;
		});
	};

	const extensionRunnerRef: { current?: ExtensionRunner } = {};

	agent = new Agent({
		initialState: {
			systemPrompt: "",
			model,
			thinkingLevel,
			tools: [],
		},
		convertToLlm: convertToLlmWithBlockImages,
		streamFn: async (model, context, options) => {
			const auth = await modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				throw new Error(auth.error);
			}
			const env = auth.env || options?.env ? { ...(auth.env ?? {}), ...(options?.env ?? {}) } : undefined;
			const providerRetrySettings = settingsManager.getProviderRetrySettings();
			const httpIdleTimeoutMs = settingsManager.getHttpIdleTimeoutMs();
			// SDKs treat timeout=0 as 0ms (immediate timeout), not "no timeout".
			// Use max int32 to effectively disable the timeout.
			const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
			const timeoutMs = options?.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs;
			const websocketConnectTimeoutMs =
				options?.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs();
			const mergedHeaders = mergeProviderAttributionHeaders(
				model,
				settingsManager,
				options?.sessionId,
				auth.headers,
				options?.headers,
			) ?? {};
			const baseHeaders = Object.fromEntries(
				Object.entries(mergedHeaders).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
			);
			const runner = extensionRunnerRef.current;
			const semanticFingerprint = createHash("sha256")
				.update(JSON.stringify({
					model: `${model.provider}/${model.id}`,
					systemPrompt: context.systemPrompt,
					messages: context.messages,
					tools: context.tools?.map((tool) => tool.name),
				}))
				.digest("hex")
				.slice(0, 16);
			const transport = runner?.hasHandlers("before_transport_request")
				? await runner.emitBeforeTransportRequest({
						type: "before_transport_request",
						semanticFingerprint,
						headers: baseHeaders,
						timeoutMs,
					})
				: { headers: baseHeaders, timeoutMs, providerTuning: undefined };
			const providerStream = streamSimple(model, context, {
				...options,
				apiKey: auth.apiKey,
				env,
				timeoutMs: transport.timeoutMs ?? timeoutMs,
				websocketConnectTimeoutMs,
				maxRetries: options?.maxRetries ?? providerRetrySettings.maxRetries,
				maxRetryDelayMs: options?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
				headers: transport.headers,
				...(transport.providerTuning ?? {}),
			});
			return withRawReasoningPreference(providerStream, model);
		},
		onResponse: async (response, _model) => {
			const runner = extensionRunnerRef.current;
			if (!runner?.hasHandlers("after_provider_response")) {
				return;
			}
			await runner.emit({
				type: "after_provider_response",
				status: response.status,
				headers: response.headers,
			});
		},
		sessionId: sessionManager.getSessionId(),
		transformContext: async (messages) => {
			const runner = extensionRunnerRef.current;
			if (!runner) return messages;
			return runner.emitContext(messages);
		},
		steeringMode: settingsManager.getSteeringMode(),
		followUpMode: settingsManager.getFollowUpMode(),
		transport: settingsManager.getTransport(),
		thinkingBudgets: settingsManager.getThinkingBudgets(),
		maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
	});

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.state.messages = existingSession.messages;
		if (!hasThinkingEntry) {
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		if (model) {
			sessionManager.appendModelChange(model.provider, model.id);
		}
		sessionManager.appendThinkingLevelChange(thinkingLevel);
		sessionManager.appendCollaborationModeChange(collaborationMode);
	}

	let memoryCoordinator: MemoryCoordinator | undefined;
	if (sessionManager.isPersistent()) {
		memoryCoordinator = new MemoryCoordinator({
			agentDir,
			cwd,
			trusted: () => settingsManager.isProjectTrusted(),
			settings: () => settingsManager.getMemorySettings(),
			extract: async (checkpoint, signal, existingMemoryMap) => extractMemoryCandidates(
				agent.state.model,
				modelRegistry,
				checkpoint,
				(sql, params) => memoryCoordinator?.query(sql, params) ?? [],
				signal,
				streamSimple,
				existingMemoryMap,
			),
		});
	}
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd,
		scopedModels: options.scopedModels,
		resourceLoader,
		customTools: options.customTools,
		modelRegistry,
		collaborationMode,
		initialActiveToolNames,
		allowedToolNames,
		excludedToolNames,
		extensionRunnerRef,
		sessionStartEvent: options.sessionStartEvent,
		autoSessionName: options.autoSessionName ?? true,
		memoryCoordinator,
		askUserHandler: options.askUserHandler,
	});
	const extensionsResult = resourceLoader.getExtensions();

	return {
		session,
		extensionsResult,
		modelFallbackMessage,
	};
}
