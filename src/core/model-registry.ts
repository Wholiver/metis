/**
 * Model registry - manages built-in and custom models, provides API key resolution.
 */

import {
	type AnthropicMessagesCompat,
	type Api,
	type AssistantMessageEventStream,
	type Context,
	getModels,
	getProviders,
	getSupportedThinkingLevels,
	type KnownProvider,
	type Model,
	type OAuthProviderInterface,
	type OpenAICompletionsCompat,
	type OpenAIResponsesCompat,
	registerApiProvider,
	resetApiProviders,
	type SimpleStreamOptions,
} from "@earendil-works/metis-ai/compat";
import { registerOAuthProvider, resetOAuthProviders } from "@earendil-works/metis-ai/oauth";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { getAgentDir } from "../config.ts";
import { stripJsonComments } from "../utils/json.ts";
import { normalizePath } from "../utils/paths.ts";
import type { AuthStatus, AuthStorage } from "./auth-storage.ts";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "./provider-display-names.ts";
import {
	clearConfigValueCache,
	getConfigValueEnvVarNames,
	isCommandConfigValue,
	isConfigValueConfigured,
	resolveConfigValueOrThrow,
	resolveConfigValueUncached,
	resolveHeadersOrThrow,
} from "./resolve-config-value.ts";

// Schema for OpenRouter routing preferences
const PercentileCutoffsSchema = Type.Object({
	p50: Type.Optional(Type.Number()),
	p75: Type.Optional(Type.Number()),
	p90: Type.Optional(Type.Number()),
	p99: Type.Optional(Type.Number()),
});

const OpenRouterRoutingSchema = Type.Object({
	allow_fallbacks: Type.Optional(Type.Boolean()),
	require_parameters: Type.Optional(Type.Boolean()),
	data_collection: Type.Optional(Type.Union([Type.Literal("deny"), Type.Literal("allow")])),
	zdr: Type.Optional(Type.Boolean()),
	enforce_distillable_text: Type.Optional(Type.Boolean()),
	order: Type.Optional(Type.Array(Type.String())),
	only: Type.Optional(Type.Array(Type.String())),
	ignore: Type.Optional(Type.Array(Type.String())),
	quantizations: Type.Optional(Type.Array(Type.String())),
	sort: Type.Optional(
		Type.Union([
			Type.String(),
			Type.Object({
				by: Type.Optional(Type.String()),
				partition: Type.Optional(Type.Union([Type.String(), Type.Null()])),
			}),
		]),
	),
	max_price: Type.Optional(
		Type.Object({
			prompt: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			completion: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			image: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			audio: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			request: Type.Optional(Type.Union([Type.Number(), Type.String()])),
		}),
	),
	preferred_min_throughput: Type.Optional(Type.Union([Type.Number(), PercentileCutoffsSchema])),
	preferred_max_latency: Type.Optional(Type.Union([Type.Number(), PercentileCutoffsSchema])),
});

// Schema for Vercel AI Gateway routing preferences
const VercelGatewayRoutingSchema = Type.Object({
	only: Type.Optional(Type.Array(Type.String())),
	order: Type.Optional(Type.Array(Type.String())),
});

// Schema for thinking level support and provider-specific values
const ThinkingLevelMapValueSchema = Type.Union([Type.String(), Type.Null()]);
const ThinkingLevelMapSchema = Type.Object({
	off: Type.Optional(ThinkingLevelMapValueSchema),
	minimal: Type.Optional(ThinkingLevelMapValueSchema),
	low: Type.Optional(ThinkingLevelMapValueSchema),
	medium: Type.Optional(ThinkingLevelMapValueSchema),
	high: Type.Optional(ThinkingLevelMapValueSchema),
	xhigh: Type.Optional(ThinkingLevelMapValueSchema),
	max: Type.Optional(ThinkingLevelMapValueSchema),
});

const ThinkingOptionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	label: Type.String({ minLength: 1 }),
	value: Type.String({ minLength: 1 }),
});

const ChatTemplateKwargScalarSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const ChatTemplateKwargVariableSchema = Type.Object({
	$var: Type.Union([Type.Literal("thinking.enabled"), Type.Literal("thinking.effort")]),
	omitWhenOff: Type.Optional(Type.Boolean()),
});
const ChatTemplateKwargSchema = Type.Union([ChatTemplateKwargScalarSchema, ChatTemplateKwargVariableSchema]);

const OpenAICompletionsCompatSchema = Type.Object({
	supportsStore: Type.Optional(Type.Boolean()),
	supportsDeveloperRole: Type.Optional(Type.Boolean()),
	supportsReasoningEffort: Type.Optional(Type.Boolean()),
	supportsUsageInStreaming: Type.Optional(Type.Boolean()),
	maxTokensField: Type.Optional(Type.Union([Type.Literal("max_completion_tokens"), Type.Literal("max_tokens")])),
	requiresToolResultName: Type.Optional(Type.Boolean()),
	requiresAssistantAfterToolResult: Type.Optional(Type.Boolean()),
	requiresThinkingAsText: Type.Optional(Type.Boolean()),
	requiresReasoningContentOnAssistantMessages: Type.Optional(Type.Boolean()),
	thinkingFormat: Type.Optional(
		Type.Union([
			Type.Literal("openai"),
			Type.Literal("openrouter"),
			Type.Literal("together"),
			Type.Literal("deepseek"),
			Type.Literal("zai"),
			Type.Literal("qwen"),
			Type.Literal("chat-template"),
			Type.Literal("qwen-chat-template"),
			Type.Literal("string-thinking"),
			Type.Literal("ant-ling"),
		]),
	),
	chatTemplateKwargs: Type.Optional(Type.Record(Type.String(), ChatTemplateKwargSchema)),
	cacheControlFormat: Type.Optional(Type.Literal("anthropic")),
	openRouterRouting: Type.Optional(OpenRouterRoutingSchema),
	vercelGatewayRouting: Type.Optional(VercelGatewayRoutingSchema),
	supportsStrictMode: Type.Optional(Type.Boolean()),
	supportsLongCacheRetention: Type.Optional(Type.Boolean()),
});

const OpenAIResponsesCompatSchema = Type.Object({
	supportsDeveloperRole: Type.Optional(Type.Boolean()),
	sendSessionIdHeader: Type.Optional(Type.Boolean()),
	supportsLongCacheRetention: Type.Optional(Type.Boolean()),
});

const AnthropicMessagesCompatSchema = Type.Object({
	supportsEagerToolInputStreaming: Type.Optional(Type.Boolean()),
	supportsLongCacheRetention: Type.Optional(Type.Boolean()),
	sendSessionAffinityHeaders: Type.Optional(Type.Boolean()),
	supportsCacheControlOnTools: Type.Optional(Type.Boolean()),
	forceAdaptiveThinking: Type.Optional(Type.Boolean()),
});

const ProviderCompatSchema = Type.Union([
	OpenAICompletionsCompatSchema,
	OpenAIResponsesCompatSchema,
	AnthropicMessagesCompatSchema,
]);

// Schema for custom model definition
// Most fields are optional with sensible defaults for local models (Ollama, LM Studio, etc.)
const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	thinkingOptions: Type.Optional(Type.Array(ThinkingOptionSchema)),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Number(),
			output: Type.Number(),
			cacheRead: Type.Number(),
			cacheWrite: Type.Number(),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

// Schema for per-model overrides (all fields optional, merged with built-in model)
const ModelOverrideSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	thinkingOptions: Type.Optional(Type.Array(ThinkingOptionSchema)),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Optional(Type.Number()),
			output: Type.Optional(Type.Number()),
			cacheRead: Type.Optional(Type.Number()),
			cacheWrite: Type.Optional(Type.Number()),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

type ModelOverride = Static<typeof ModelOverrideSchema>;

const ProviderConfigSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	apiKey: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
	authHeader: Type.Optional(Type.Boolean()),
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
	modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
});

const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderConfigSchema),
});

const validateModelsConfig = Compile(ModelsConfigSchema);

type ModelsConfig = Static<typeof ModelsConfigSchema>;

function formatValidationPath(error: TLocalizedValidationError): string {
	if (error.keyword === "required") {
		const requiredProperties = (error.params as { requiredProperties?: string[] }).requiredProperties;
		const requiredProperty = requiredProperties?.[0];
		if (requiredProperty) {
			const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
			return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
		}
	}
	const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
	return path || "root";
}

/** Provider override config (baseUrl, compat) without request auth/headers */
interface ProviderOverride {
	baseUrl?: string;
	compat?: Model<Api>["compat"];
}

interface ProviderRequestConfig {
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
}

export type ResolvedRequestAuth =
	| {
			ok: true;
			apiKey?: string;
			headers?: Record<string, string>;
			env?: Record<string, string>;
	  }
	| {
			ok: false;
			error: string;
	  };

/** Result of loading custom models from models.json */
interface CustomModelsResult {
	models: Model<Api>[];
	/** Providers with baseUrl/headers/apiKey overrides for built-in models */
	overrides: Map<string, ProviderOverride>;
	/** Per-model overrides: provider -> modelId -> override */
	modelOverrides: Map<string, Map<string, ModelOverride>>;
	error: string | undefined;
}

function emptyCustomModelsResult(error?: string): CustomModelsResult {
	return { models: [], overrides: new Map(), modelOverrides: new Map(), error };
}

function mergeCompat(
	baseCompat: Model<Api>["compat"],
	overrideCompat: ModelOverride["compat"],
): Model<Api>["compat"] | undefined {
	if (!overrideCompat) return baseCompat;

	const base = baseCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat | undefined;
	const override = overrideCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;
	const merged = { ...base, ...override } as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;

	const baseCompletions = base as OpenAICompletionsCompat | undefined;
	const overrideCompletions = override as OpenAICompletionsCompat;
	const mergedCompletions = merged as OpenAICompletionsCompat;

	if (baseCompletions?.openRouterRouting || overrideCompletions.openRouterRouting) {
		mergedCompletions.openRouterRouting = {
			...baseCompletions?.openRouterRouting,
			...overrideCompletions.openRouterRouting,
		};
	}

	if (baseCompletions?.vercelGatewayRouting || overrideCompletions.vercelGatewayRouting) {
		mergedCompletions.vercelGatewayRouting = {
			...baseCompletions?.vercelGatewayRouting,
			...overrideCompletions.vercelGatewayRouting,
		};
	}

	if (baseCompletions?.chatTemplateKwargs || overrideCompletions.chatTemplateKwargs) {
		mergedCompletions.chatTemplateKwargs = {
			...baseCompletions?.chatTemplateKwargs,
			...overrideCompletions.chatTemplateKwargs,
		};
	}

	return merged as Model<Api>["compat"];
}

const THINKING_LEVEL_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const DIRECT_PROVIDER_PRIORITY = [
	"openai",
	"openai-codex",
	"anthropic",
	"google",
	"google-vertex",
	"zai",
	"zai-coding-cn",
	"deepseek",
	"xai",
	"mistral",
	"moonshotai",
	"moonshotai-cn",
	"minimax",
	"minimax-cn",
	"qwen-token-plan",
	"qwen-token-plan-cn",
	"xiaomi",
] as const;

interface CatalogThinkingCandidate {
	model: Model<Api>;
	provider: string;
	fullId: string;
	tailId: string;
}

interface ResolvedThinkingCapabilities {
	reasoning: boolean;
	thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
	thinkingOptions?: Model<Api>["thinkingOptions"];
	compat?: Model<Api>["compat"];
}

let thinkingCatalogCache: CatalogThinkingCandidate[] | undefined;

function normalizeCapabilityModelId(modelId: string): string {
	return modelId.trim().toLowerCase().replace(/:+(?:free|paid|latest)$/i, "");
}

function getThinkingCatalog(): CatalogThinkingCandidate[] {
	if (thinkingCatalogCache) return thinkingCatalogCache;
	thinkingCatalogCache = getProviders().flatMap((provider) =>
		(getModels(provider as KnownProvider) as Model<Api>[]).map((model) => {
			const fullId = normalizeCapabilityModelId(model.id);
			return { model, provider, fullId, tailId: fullId.split("/").at(-1) ?? fullId };
		}),
	);
	return thinkingCatalogCache;
}

function preferredProviderScore(provider: string, modelId: string): number {
	const familyPreferences: Array<[RegExp, readonly string[]]> = [
		[/glm/i, ["zai", "zai-coding-cn"]],
		[/deepseek|(?:^|\/)r1(?:-|$)/i, ["deepseek"]],
		[/qwen|qwq/i, ["qwen-token-plan", "qwen-token-plan-cn"]],
		[/claude/i, ["anthropic"]],
		[/gemini/i, ["google", "google-vertex"]],
		[/(?:^|\/)(?:gpt-|o[1-9](?:-|$))/i, ["openai", "openai-codex"]],
		[/grok/i, ["xai"]],
		[/kimi/i, ["moonshotai", "moonshotai-cn"]],
		[/minimax/i, ["minimax", "minimax-cn"]],
		[/magistral|mistral/i, ["mistral"]],
	];
	const family = familyPreferences.find(([pattern]) => pattern.test(modelId));
	const familyIndex = family?.[1].indexOf(provider) ?? -1;
	if (familyIndex >= 0) return 200 - familyIndex;
	const directIndex = DIRECT_PROVIDER_PRIORITY.indexOf(provider as (typeof DIRECT_PROVIDER_PRIORITY)[number]);
	return directIndex >= 0 ? 100 - directIndex : 0;
}

function findCatalogThinkingCandidate(modelId: string): CatalogThinkingCandidate | undefined {
	const fullId = normalizeCapabilityModelId(modelId);
	const tailId = fullId.split("/").at(-1) ?? fullId;
	let best: { candidate: CatalogThinkingCandidate; score: number } | undefined;
	for (const candidate of getThinkingCatalog()) {
		let score = -1;
		if (candidate.fullId === fullId) score = 1000;
		else if (candidate.tailId === tailId) score = 700;
		if (score < 0) continue;
		if (candidate.model.reasoning) score += 250;
		score += preferredProviderScore(candidate.provider, modelId);
		if (!best || score > best.score) best = { candidate, score };
	}
	return best?.candidate;
}

function inferReasoningFromModelId(modelId: string): boolean {
	const id = normalizeCapabilityModelId(modelId);
	return [
		/(?:^|[\/_-])glm-(?:4\.[5-9]|[5-9])(?:[.\/_-]|$)/,
		/(?:^|[\/_-])deepseek-(?:r1|reasoner|v[3-9])(?:[.\/_-]|$)/,
		/(?:^|[\/_-])qwq(?:[.\/_-]|$)/,
		/(?:^|[\/_-])qwen3(?:\.[5-9])?(?:[.\/_-]|$)/,
		/(?:^|[\/_-])gpt-[5-9](?:[.\/_-]|$)/,
		/(?:^|[\/_-])o[1-9](?:[.\/_-]|$)/,
		/(?:^|[\/_-])claude-(?:3[.-]7|[4-9])(?:[.\/_-]|$)/,
		/(?:^|[\/_-])gemini-(?:2[.-]5|[3-9])(?:[.\/_-]|$)/,
		/(?:^|[\/_-])grok-(?:3|[4-9])(?:[.\/_-]|$)/,
		/(?:^|[\/_-])kimi-(?:k2[.-](?:5|6|7)|k3|.*thinking)(?:[.\/_-]|$)/,
		/(?:^|[\/_-])minimax-m(?:2[.-][5-9]|[3-9])(?:[.\/_-]|$)/,
		/(?:^|[\/_-])magistral(?:[.\/_-]|$)/,
	].some((pattern) => pattern.test(id));
}

function adaptThinkingLevelMap(candidate: Model<Api>, api: Api): Model<Api>["thinkingLevelMap"] {
	if (candidate.api === api) return candidate.thinkingLevelMap ? { ...candidate.thinkingLevelMap } : undefined;
	const supported = new Set(getSupportedThinkingLevels(candidate));
	const result: Record<string, string | null> = {};
	for (const level of THINKING_LEVEL_NAMES) {
		if (!supported.has(level)) result[level] = null;
		else if (level === "xhigh") result[level] = "xhigh";
	}
	return result as Model<Api>["thinkingLevelMap"];
}

function selectThinkingCompat(candidate: Model<Api> | undefined, api: Api, modelId: string, baseUrl: string): Model<Api>["compat"] {
	if (candidate?.api === api && candidate.compat) {
		const source = candidate.compat as Record<string, unknown>;
		const selected: Record<string, unknown> = {};
		for (const key of [
			"supportsReasoningEffort",
			"requiresThinkingAsText",
			"requiresReasoningContentOnAssistantMessages",
			"thinkingFormat",
			"forceReasoning",
			"forceAdaptiveThinking",
		]) {
			if (source[key] !== undefined) selected[key] = source[key];
		}
		if (Object.keys(selected).length > 0) return selected as Model<Api>["compat"];
	}

	if (api !== "openai-completions") return undefined;
	const url = baseUrl.toLowerCase();
	if (/openrouter|together\.ai|api\.z\.ai|open\.bigmodel\.cn/.test(url)) return undefined;
	const id = normalizeCapabilityModelId(modelId);
	if (/glm/.test(id)) return { thinkingFormat: "zai" } as Model<Api>["compat"];
	if (/deepseek|(?:^|\/)r1(?:-|$)|kimi/.test(id)) {
		return {
			thinkingFormat: "deepseek",
			requiresReasoningContentOnAssistantMessages: true,
		} as Model<Api>["compat"];
	}
	if (/qwen|qwq/.test(id)) return { thinkingFormat: "qwen" } as Model<Api>["compat"];
	return undefined;
}

function resolveThinkingCapabilities(options: {
	modelId: string;
	api: Api;
	baseUrl: string;
	isCustomProvider?: boolean;
	modelReasoning?: boolean;
	providerReasoning?: boolean;
	modelThinkingLevelMap?: Model<Api>["thinkingLevelMap"];
	providerThinkingLevelMap?: Model<Api>["thinkingLevelMap"];
	modelThinkingOptions?: Model<Api>["thinkingOptions"];
	modelCompat?: Model<Api>["compat"];
	providerCompat?: Model<Api>["compat"];
}): ResolvedThinkingCapabilities {
	const modelThinkingOptions = Array.isArray(options.modelThinkingOptions) && options.modelThinkingOptions.length > 0
		? options.modelThinkingOptions
		: undefined;

	if (options.isCustomProvider) {
		if (options.modelReasoning === false) {
			return {
				reasoning: false,
				thinkingLevelMap: undefined,
				thinkingOptions: undefined,
				compat: mergeCompat(options.providerCompat, options.modelCompat),
			};
		}
		const configuredMap = options.modelThinkingLevelMap
			? { ...options.providerThinkingLevelMap, ...options.modelThinkingLevelMap }
			: options.providerThinkingLevelMap;
		const hasDiscoveredThinking = Boolean(
			modelThinkingOptions && modelThinkingOptions.some((option) => option.id !== "off"),
		);
		if (hasDiscoveredThinking || configuredMap) {
			const thinkingLevelMap =
				configuredMap ??
				Object.fromEntries(modelThinkingOptions!.map((option) => [option.id, option.value]));
			return {
				reasoning: true,
				thinkingLevelMap,
				thinkingOptions: modelThinkingOptions,
				compat: mergeCompat(options.providerCompat, options.modelCompat),
			};
		}
		return {
			reasoning: false,
			thinkingLevelMap: undefined,
			thinkingOptions: undefined,
			compat: mergeCompat(options.providerCompat, options.modelCompat),
		};
	}

	const candidate = findCatalogThinkingCandidate(options.modelId);
	// Desktop versions before capability fallback persisted an absent /models
	// capability as an explicit opt-out. Treat that exact generated shape as
	// unknown; a deliberate opt-out remains `reasoning: false` without `[]`.
	const legacyEmptyDiscovery = options.modelReasoning === false
		&& Array.isArray(options.modelThinkingOptions)
		&& options.modelThinkingOptions.length === 0
		&& options.modelThinkingLevelMap === undefined;
	const modelReasoning = legacyEmptyDiscovery ? undefined : options.modelReasoning;
	const configuredMap = options.modelThinkingLevelMap
		? { ...options.providerThinkingLevelMap, ...options.modelThinkingLevelMap }
		: options.providerThinkingLevelMap;
	const reasoning =
		modelReasoning ??
		options.providerReasoning ??
		(modelThinkingOptions ? modelThinkingOptions.some((option) => option.id !== "off") : configuredMap ? true : candidate?.model.reasoning ?? inferReasoningFromModelId(options.modelId));
	const inferredMap = reasoning && candidate ? adaptThinkingLevelMap(candidate.model, options.api) : undefined;
	const inferredCompat = reasoning
		? selectThinkingCompat(candidate?.model, options.api, options.modelId, options.baseUrl)
		: undefined;
	return {
		reasoning,
		thinkingLevelMap: configuredMap ?? inferredMap,
		thinkingOptions: modelThinkingOptions,
		compat: mergeCompat(mergeCompat(inferredCompat, options.providerCompat), options.modelCompat),
	};
}

/**
 * Deep merge a model override into a model.
 * Handles nested objects (cost, compat) by merging rather than replacing.
 */
function applyModelOverride(model: Model<Api>, override: ModelOverride): Model<Api> {
	const result = { ...model };

	// Simple field overrides
	if (override.name !== undefined) result.name = override.name;
	if (override.reasoning !== undefined) result.reasoning = override.reasoning;
	if (override.thinkingLevelMap !== undefined) {
		result.thinkingLevelMap = { ...model.thinkingLevelMap, ...override.thinkingLevelMap };
	}
	if (override.thinkingOptions !== undefined) result.thinkingOptions = override.thinkingOptions.map((option) => ({ ...option }));
	if (override.input !== undefined) result.input = override.input as ("text" | "image")[];
	if (override.contextWindow !== undefined) result.contextWindow = override.contextWindow;
	if (override.maxTokens !== undefined) result.maxTokens = override.maxTokens;

	// Merge cost (partial override)
	if (override.cost) {
		result.cost = {
			input: override.cost.input ?? model.cost.input,
			output: override.cost.output ?? model.cost.output,
			cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
			cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
		};
	}

	// Deep merge compat
	result.compat = mergeCompat(model.compat, override.compat);

	return result;
}

/** Clear the config value command cache. Exported for testing. */
export const clearApiKeyCache = clearConfigValueCache;

/**
 * Model registry - loads and manages models, resolves API keys via AuthStorage.
 */
export class ModelRegistry {
	private models: Model<Api>[] = [];
	private providerRequestConfigs: Map<string, ProviderRequestConfig> = new Map();
	private modelRequestHeaders: Map<string, Record<string, string>> = new Map();
	private registeredProviders: Map<string, ProviderConfigInput> = new Map();
	private providerDisplayNames: Map<string, string> = new Map();
	private loadError: string | undefined = undefined;
	readonly authStorage: AuthStorage;
	private modelsJsonPath: string | undefined;

	private constructor(authStorage: AuthStorage, modelsJsonPath: string | undefined) {
		this.authStorage = authStorage;
		this.modelsJsonPath = modelsJsonPath ? normalizePath(modelsJsonPath) : undefined;
		this.loadModels();
	}

	static create(authStorage: AuthStorage, modelsJsonPath: string = join(getAgentDir(), "models.json")): ModelRegistry {
		return new ModelRegistry(authStorage, modelsJsonPath);
	}

	static inMemory(authStorage: AuthStorage): ModelRegistry {
		return new ModelRegistry(authStorage, undefined);
	}

	getModelsJsonPath(): string | undefined {
		return this.modelsJsonPath;
	}

	/**
	 * Reload models from disk (built-in + custom from models.json).
	 */
	refresh(): void {
		this.providerRequestConfigs.clear();
		this.modelRequestHeaders.clear();
		this.providerDisplayNames.clear();
		this.loadError = undefined;

		// Ensure dynamic API/OAuth registrations are rebuilt from current provider state.
		resetApiProviders();
		resetOAuthProviders();

		this.loadModels();

		for (const [providerName, config] of this.registeredProviders.entries()) {
			this.applyProviderConfig(providerName, config);
		}
	}

	/**
	 * Get any error from loading models.json (undefined if no error).
	 */
	getError(): string | undefined {
		return this.loadError;
	}

	private loadModels(): void {
		// Load custom models and overrides from models.json
		const {
			models: customModels,
			overrides,
			modelOverrides,
			error,
		} = this.modelsJsonPath ? this.loadCustomModels(this.modelsJsonPath) : emptyCustomModelsResult();

		if (error) {
			this.loadError = error;
			// Keep built-in models even if custom models failed to load
		}

		const builtInModels = this.loadBuiltInModels(overrides, modelOverrides);
		let combined = this.mergeCustomModels(builtInModels, customModels);

		// Let OAuth providers modify their models (e.g., update baseUrl)
		for (const oauthProvider of this.authStorage.getOAuthProviders()) {
			const cred = this.authStorage.get(oauthProvider.id);
			if (cred?.type === "oauth" && oauthProvider.modifyModels) {
				combined = oauthProvider.modifyModels(combined, cred);
			}
		}

		this.models = combined;
	}

	/** Load built-in models and apply provider/model overrides */
	private loadBuiltInModels(
		overrides: Map<string, ProviderOverride>,
		modelOverrides: Map<string, Map<string, ModelOverride>>,
	): Model<Api>[] {
		const models = getProviders().flatMap((provider) => {
			const models = getModels(provider as KnownProvider) as Model<Api>[];
			const providerOverride = overrides.get(provider);
			const perModelOverrides = modelOverrides.get(provider);

			return models.map((m) => {
				let model = m;

				// Apply provider-level baseUrl/headers/compat override
				if (providerOverride) {
					model = {
						...model,
						baseUrl: providerOverride.baseUrl ?? model.baseUrl,
						compat: mergeCompat(model.compat, providerOverride.compat),
					};
				}

				// Apply per-model override
				const modelOverride = perModelOverrides?.get(m.id);
				if (modelOverride) {
					model = applyModelOverride(model, modelOverride);
				}

				return model;
			});
		});

		// The Codex subscription catalog can expose newly entitled models before
		// the vendored transport package publishes a static registry update. Keep
		// this local overlay intentionally narrow: it reuses the known-good Codex
		// Responses transport/capabilities from gpt-5.5 and is still authenticated
		// through AuthStorage like every other built-in model.
		if (!models.some((model) => model.provider === "openai-codex" && model.id === "gpt-5.6-luna")) {
			const codexBase = models.find((model) => model.provider === "openai-codex" && model.id === "gpt-5.5");
			if (codexBase) {
				models.push({
					...codexBase,
					id: "gpt-5.6-luna",
					name: "GPT-5.6-Luna",
					reasoning: true,
					contextWindow: 272_000,
					maxTokens: 128_000,
				});
			}
		}

		return models;
	}

	/** Merge custom models into built-in list by provider+id (custom wins on conflicts). */
	private mergeCustomModels(builtInModels: Model<Api>[], customModels: Model<Api>[]): Model<Api>[] {
		const merged = [...builtInModels];
		for (const customModel of customModels) {
			const existingIndex = merged.findIndex((m) => m.provider === customModel.provider && m.id === customModel.id);
			if (existingIndex >= 0) {
				merged[existingIndex] = customModel;
			} else {
				merged.push(customModel);
			}
		}
		return merged;
	}

	private loadCustomModels(modelsJsonPath: string): CustomModelsResult {
		if (!existsSync(modelsJsonPath)) {
			return emptyCustomModelsResult();
		}

		try {
			const content = readFileSync(modelsJsonPath, "utf-8");
			const parsed = JSON.parse(stripJsonComments(content)) as unknown;

			if (!validateModelsConfig.Check(parsed)) {
				const errors =
					validateModelsConfig
						.Errors(parsed)
						.map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
						.join("\n") || "Unknown schema error";
				return emptyCustomModelsResult(`Invalid models.json schema:\n${errors}\n\nFile: ${modelsJsonPath}`);
			}

			const config = parsed as ModelsConfig;

			// Additional validation
			this.validateConfig(config);

			const overrides = new Map<string, ProviderOverride>();
			const modelOverrides = new Map<string, Map<string, ModelOverride>>();

			for (const [providerName, providerConfig] of Object.entries(config.providers)) {
				if (providerConfig.name) {
					this.providerDisplayNames.set(providerName, providerConfig.name);
				}

				if (providerConfig.baseUrl || providerConfig.compat) {
					overrides.set(providerName, {
						baseUrl: providerConfig.baseUrl,
						compat: providerConfig.compat,
					});
				}

				this.storeProviderRequestConfig(providerName, providerConfig);

				if (providerConfig.modelOverrides) {
					modelOverrides.set(providerName, new Map(Object.entries(providerConfig.modelOverrides)));
					for (const [modelId, modelOverride] of Object.entries(providerConfig.modelOverrides)) {
						this.storeModelHeaders(providerName, modelId, modelOverride.headers);
					}
				}
			}

			return { models: this.parseModels(config), overrides, modelOverrides, error: undefined };
		} catch (error) {
			if (error instanceof SyntaxError) {
				return emptyCustomModelsResult(`Failed to parse models.json: ${error.message}\n\nFile: ${modelsJsonPath}`);
			}
			return emptyCustomModelsResult(
				`Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${modelsJsonPath}`,
			);
		}
	}

	private validateConfig(config: ModelsConfig): void {
		const builtInProviders = new Set<string>(getProviders());

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const isBuiltIn = builtInProviders.has(providerName);
			const hasProviderApi = !!providerConfig.api;
			const models = providerConfig.models ?? [];
			const hasModelOverrides =
				providerConfig.modelOverrides && Object.keys(providerConfig.modelOverrides).length > 0;

			if (models.length === 0) {
				// Override-only config: needs baseUrl, headers, compat, modelOverrides, or some combination.
				if (!providerConfig.baseUrl && !providerConfig.headers && !providerConfig.compat && !hasModelOverrides) {
					throw new Error(
						`Provider ${providerName}: must specify "baseUrl", "headers", "compat", "modelOverrides", or "models".`,
					);
				}
			} else if (!isBuiltIn) {
				// Non-built-in providers with custom models require an endpoint.
				// Auth can come from auth.json, --api-key, or provider request config.
				if (!providerConfig.baseUrl) {
					throw new Error(`Provider ${providerName}: "baseUrl" is required when defining custom models.`);
				}
			}
			// Built-in providers with custom models: baseUrl/apiKey/api are optional,
			// inherited from built-in models. Auth comes from env vars / auth storage.

			for (const modelDef of models) {
				const hasModelApi = !!modelDef.api;

				if (!hasProviderApi && !hasModelApi && !isBuiltIn) {
					throw new Error(
						`Provider ${providerName}, model ${modelDef.id}: no "api" specified. Set at provider or model level.`,
					);
				}
				// For built-in providers, api is optional — inherited from built-in models.

				if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
				// Validate contextWindow/maxTokens only if provided (they have defaults)
				if (modelDef.contextWindow !== undefined && modelDef.contextWindow <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
				if (modelDef.maxTokens !== undefined && modelDef.maxTokens <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid maxTokens`);
			}
		}
	}

	private parseModels(config: ModelsConfig): Model<Api>[] {
		const models: Model<Api>[] = [];
		const builtInProviders = new Set<string>(getProviders());

		// Cache built-in defaults (api, baseUrl) per provider, extracted from first model.
		const builtInDefaultsCache = new Map<string, { api: string; baseUrl: string }>();
		const getBuiltInDefaults = (providerName: string): { api: string; baseUrl: string } | undefined => {
			if (!builtInProviders.has(providerName)) return undefined;
			if (builtInDefaultsCache.has(providerName)) return builtInDefaultsCache.get(providerName);
			const builtIn = getModels(providerName as KnownProvider) as Model<Api>[];
			if (builtIn.length === 0) return undefined;
			const defaults = { api: builtIn[0].api, baseUrl: builtIn[0].baseUrl };
			builtInDefaultsCache.set(providerName, defaults);
			return defaults;
		};

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const modelDefs = providerConfig.models ?? [];
			if (modelDefs.length === 0) continue; // Override-only, no custom models

			const builtInDefaults = getBuiltInDefaults(providerName);

			const isCustomProvider = isCustomProviderId(providerName) || !builtInProviders.has(providerName);

			for (const modelDef of modelDefs) {
				const api = modelDef.api ?? providerConfig.api ?? builtInDefaults?.api;
				if (!api) continue;

				const baseUrl = modelDef.baseUrl ?? providerConfig.baseUrl ?? builtInDefaults?.baseUrl;
				if (!baseUrl) continue;

				const thinking = resolveThinkingCapabilities({
					modelId: modelDef.id,
					api: api as Api,
					baseUrl,
					isCustomProvider,
					modelReasoning: modelDef.reasoning,
					providerReasoning: providerConfig.reasoning,
					modelThinkingLevelMap: modelDef.thinkingLevelMap,
					providerThinkingLevelMap: providerConfig.thinkingLevelMap,
					modelThinkingOptions: modelDef.thinkingOptions,
					modelCompat: modelDef.compat,
					providerCompat: providerConfig.compat,
				});
				this.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

				const defaultCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
				models.push({
					id: modelDef.id,
					name: modelDef.name ?? modelDef.id,
					api: api as Api,
					provider: providerName,
					baseUrl,
					reasoning: thinking.reasoning,
					thinkingLevelMap: thinking.thinkingLevelMap,
					thinkingOptions: thinking.thinkingOptions,
					// OpenAI-compatible custom endpoints generally do not publish input
					// capabilities. Default to multimodal so image tool results are not
					// silently discarded; explicitly set ["text"] for text-only models.
					input: (modelDef.input ?? ["text", "image"]) as ("text" | "image")[],
					cost: modelDef.cost ?? defaultCost,
					contextWindow: modelDef.contextWindow ?? (isCustomProvider ? 256000 : 128000),
					maxTokens: modelDef.maxTokens ?? 16384,
					headers: undefined,
					compat: thinking.compat,
				} as Model<Api>);
			}
		}

		return models;
	}

	/**
	 * Get all models (built-in + custom).
	 * If models.json had errors, returns only built-in models.
	 */
	getAll(): Model<Api>[] {
		return this.models;
	}

	/**
	 * Get only models that have auth configured.
	 * This is a fast check that doesn't refresh OAuth tokens.
	 */
	getAvailable(): Model<Api>[] {
		return this.models.filter((m) => this.hasConfiguredAuth(m));
	}

	/**
	 * Find a model by provider and ID.
	 */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find((m) => m.provider === provider && m.id === modelId);
	}

	/**
	 * Get API key for a model.
	 */
	hasConfiguredAuth(model: Model<Api>): boolean {
		const providerApiKey = this.providerRequestConfigs.get(model.provider)?.apiKey;
		return (
			this.authStorage.hasAuth(model.provider) ||
			(providerApiKey !== undefined && isConfigValueConfigured(providerApiKey))
		);
	}

	private getModelRequestKey(provider: string, modelId: string): string {
		return `${provider}:${modelId}`;
	}

	private storeProviderRequestConfig(
		providerName: string,
		config: {
			apiKey?: string;
			headers?: Record<string, string>;
			authHeader?: boolean;
		},
	): void {
		if (!config.apiKey && !config.headers && !config.authHeader) {
			return;
		}

		this.providerRequestConfigs.set(providerName, {
			apiKey: config.apiKey,
			headers: config.headers,
			authHeader: config.authHeader,
		});
	}

	private storeModelHeaders(providerName: string, modelId: string, headers?: Record<string, string>): void {
		const key = this.getModelRequestKey(providerName, modelId);
		if (!headers || Object.keys(headers).length === 0) {
			this.modelRequestHeaders.delete(key);
			return;
		}
		this.modelRequestHeaders.set(key, headers);
	}

	/**
	 * Get API key and request headers for a model.
	 */
	async getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth> {
		try {
			const providerConfig = this.providerRequestConfigs.get(model.provider);
			const providerEnv = this.authStorage.getProviderEnv(model.provider);
			const apiKeyFromAuthStorage = await this.authStorage.getApiKey(model.provider, { includeFallback: false });
			const apiKey =
				apiKeyFromAuthStorage ??
				(providerConfig?.apiKey
					? resolveConfigValueOrThrow(
							providerConfig.apiKey,
							`API key for provider "${model.provider}"`,
							providerEnv,
						)
					: undefined);

			const providerHeaders = resolveHeadersOrThrow(
				providerConfig?.headers,
				`provider "${model.provider}"`,
				providerEnv,
			);
			const modelHeaders = resolveHeadersOrThrow(
				this.modelRequestHeaders.get(this.getModelRequestKey(model.provider, model.id)),
				`model "${model.provider}/${model.id}"`,
				providerEnv,
			);

			let headers =
				model.headers || providerHeaders || modelHeaders
					? { ...model.headers, ...providerHeaders, ...modelHeaders }
					: undefined;

			if (providerConfig?.authHeader) {
				if (!apiKey) {
					return { ok: false, error: `No API key found for "${model.provider}"` };
				}
				headers = { ...headers, Authorization: `Bearer ${apiKey}` };
			}

			return {
				ok: true,
				apiKey,
				headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
				env: providerEnv && Object.keys(providerEnv).length > 0 ? providerEnv : undefined,
			};
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Return auth status for a provider, including request auth configured in models.json.
	 * This intentionally does not execute command-backed config values.
	 */
	getProviderAuthStatus(provider: string): AuthStatus {
		const authStatus = this.authStorage.getAuthStatus(provider);
		if (authStatus.source) {
			return authStatus;
		}

		const providerApiKey = this.providerRequestConfigs.get(provider)?.apiKey;
		if (!providerApiKey) {
			return authStatus;
		}

		if (isCommandConfigValue(providerApiKey)) {
			return { configured: true, source: "models_json_command" };
		}

		const envVarNames = getConfigValueEnvVarNames(providerApiKey);
		if (envVarNames.length > 0) {
			return isConfigValueConfigured(providerApiKey)
				? { configured: true, source: "environment", label: envVarNames.join(", ") }
				: { configured: false };
		}

		return { configured: true, source: "models_json_key" };
	}

	/**
	 * Get display name for a provider.
	 */
	getProviderDisplayName(provider: string): string {
		const registeredProvider = this.registeredProviders.get(provider);
		const oauthProvider = this.authStorage.getOAuthProviders().find((p) => p.id === provider);

		return (
			this.providerDisplayNames.get(provider) ??
			registeredProvider?.name ??
			registeredProvider?.oauth?.name ??
			oauthProvider?.name ??
			BUILT_IN_PROVIDER_DISPLAY_NAMES[provider] ??
			provider
		);
	}

	/**
	 * Get API key for a provider.
	 */
	async getApiKeyForProvider(provider: string): Promise<string | undefined> {
		const apiKey = await this.authStorage.getApiKey(provider);
		if (apiKey !== undefined) {
			return apiKey;
		}

		const providerApiKey = this.providerRequestConfigs.get(provider)?.apiKey;
		return providerApiKey
			? resolveConfigValueUncached(providerApiKey, this.authStorage.getProviderEnv(provider))
			: undefined;
	}

	/**
	 * Check if a model is using OAuth credentials (subscription).
	 */
	isUsingOAuth(model: Model<Api>): boolean {
		const cred = this.authStorage.get(model.provider);
		return cred?.type === "oauth";
	}

	/**
	 * Register a provider dynamically (from extensions).
	 *
	 * If provider has models: replaces all existing models for this provider.
	 * If provider has only baseUrl/headers: overrides existing models' URLs.
	 * If provider has oauth: registers OAuth provider for /login support.
	 */
	registerProvider(providerName: string, config: ProviderConfigInput): void {
		this.validateProviderConfig(providerName, config);
		this.applyProviderConfig(providerName, config);
		this.upsertRegisteredProvider(providerName, config);
	}

	/**
	 * Unregister a previously registered provider.
	 *
	 * Removes the provider from the registry and reloads models from disk so that
	 * built-in models overridden by this provider are restored to their original state.
	 * Also resets dynamic OAuth and API stream registrations before reapplying
	 * remaining dynamic providers.
	 * Has no effect if the provider was never registered.
	 */
	unregisterProvider(providerName: string): void {
		if (!this.registeredProviders.has(providerName)) return;
		this.registeredProviders.delete(providerName);
		this.refresh();
	}

	/**
	 * Upsert a provider config into registeredProviders.
	 * If the provider is already registered, defined values in the incoming config
	 * override existing ones; undefined values are preserved from the stored config.
	 * If the provider is not registered, the incoming config is stored as-is.
	 */
	private upsertRegisteredProvider(providerName: string, config: ProviderConfigInput): void {
		const existing = this.registeredProviders.get(providerName);
		if (!existing) {
			this.registeredProviders.set(providerName, config);
			return;
		}
		for (const k of Object.keys(config) as (keyof ProviderConfigInput)[]) {
			if (config[k] !== undefined) {
				(existing as Record<string, unknown>)[k] = config[k];
			}
		}
	}

	private validateProviderConfig(providerName: string, config: ProviderConfigInput): void {
		if (config.streamSimple && !config.api) {
			throw new Error(`Provider ${providerName}: "api" is required when registering streamSimple.`);
		}

		if (!config.models || config.models.length === 0) {
			return;
		}

		if (!config.baseUrl) {
			throw new Error(`Provider ${providerName}: "baseUrl" is required when defining models.`);
		}
		if (!config.apiKey && !config.oauth) {
			throw new Error(`Provider ${providerName}: "apiKey" or "oauth" is required when defining models.`);
		}

		for (const modelDef of config.models) {
			const api = modelDef.api || config.api;
			if (!api) {
				throw new Error(`Provider ${providerName}, model ${modelDef.id}: no "api" specified.`);
			}
		}
	}

	private applyProviderConfig(providerName: string, config: ProviderConfigInput): void {
		// Register OAuth provider if provided
		if (config.oauth) {
			// Ensure the OAuth provider ID matches the provider name
			const oauthProvider: OAuthProviderInterface = {
				...config.oauth,
				id: providerName,
			};
			registerOAuthProvider(oauthProvider);
		}

		if (config.streamSimple) {
			const streamSimple = config.streamSimple;
			registerApiProvider(
				{
					api: config.api!,
					stream: (model, context, options) => streamSimple(model, context, options as SimpleStreamOptions),
					streamSimple,
				},
				`provider:${providerName}`,
			);
		}

		this.storeProviderRequestConfig(providerName, config);

		const builtInProviders = new Set<string>(getProviders());
		const isCustomProvider = isCustomProviderId(providerName) || !builtInProviders.has(providerName);

		if (config.models && config.models.length > 0) {
			// Full replacement: remove existing models for this provider
			this.models = this.models.filter((m) => m.provider !== providerName);

			// Parse and add new models
			for (const modelDef of config.models) {
				const api = modelDef.api || config.api;
				const baseUrl = modelDef.baseUrl ?? config.baseUrl!;
				const thinking = resolveThinkingCapabilities({
					modelId: modelDef.id,
					api: api as Api,
					baseUrl,
					isCustomProvider,
					modelReasoning: modelDef.reasoning,
					providerReasoning: config.reasoning,
					modelThinkingLevelMap: modelDef.thinkingLevelMap,
					providerThinkingLevelMap: config.thinkingLevelMap,
					modelThinkingOptions: modelDef.thinkingOptions,
					modelCompat: modelDef.compat,
					providerCompat: config.compat,
				});
				this.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

				this.models.push({
					id: modelDef.id,
					name: modelDef.name,
					api: api as Api,
					provider: providerName,
					baseUrl,
					reasoning: thinking.reasoning,
					thinkingLevelMap: thinking.thinkingLevelMap,
					thinkingOptions: thinking.thinkingOptions,
					input: modelDef.input as ("text" | "image")[],
					cost: modelDef.cost,
					contextWindow: modelDef.contextWindow ?? (isCustomProvider ? 256000 : 128000),
					maxTokens: modelDef.maxTokens,
					headers: undefined,
					compat: thinking.compat,
				} as Model<Api>);
			}

			// Apply OAuth modifyModels if credentials exist (e.g., to update baseUrl)
			if (config.oauth?.modifyModels) {
				const cred = this.authStorage.get(providerName);
				if (cred?.type === "oauth") {
					this.models = config.oauth.modifyModels(this.models, cred);
				}
			}
		} else if (config.baseUrl || config.headers) {
			// Override-only: update baseUrl for existing models. Request headers are resolved per request.
			this.models = this.models.map((m) => {
				if (m.provider !== providerName) return m;
				return {
					...m,
					baseUrl: config.baseUrl ?? m.baseUrl,
				};
			});
		}
	}
}

/**
 * Input type for registerProvider API.
 */
export interface ProviderConfigInput {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: Api;
	/** Default thinking capability for models that do not declare it. */
	reasoning?: boolean;
	/** Default supported thinking levels for models that do not declare them. */
	thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
	compat?: Model<Api>["compat"];
	streamSimple?: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
	headers?: Record<string, string>;
	authHeader?: boolean;
	/** OAuth provider for /login support */
	oauth?: Omit<OAuthProviderInterface, "id">;
	models?: Array<{
		id: string;
		name: string;
		api?: Api;
		baseUrl?: string;
		reasoning?: boolean;
		thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
		thinkingOptions?: Model<Api>["thinkingOptions"];
		input: ("text" | "image")[];
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow: number;
		maxTokens: number;
		headers?: Record<string, string>;
		compat?: Model<Api>["compat"];
	}>;
}

export const DEFAULT_CUSTOM_CONTEXT_WINDOW = 256_000;

export interface DiscoveredProviderModel {
	id: string;
	thinkingOptions: NonNullable<Model<Api>["thinkingOptions"]>;
	contextWindow?: number;
}

function thinkingOptionId(value: string): string {
	return /^(?:off|none|disabled)$/i.test(value) ? "off" : value;
}

function normalizeThinkingOption(value: unknown): NonNullable<Model<Api>["thinkingOptions"]>[number] | undefined {
	if (typeof value === "string" && value.trim()) {
		const raw = value.trim();
		return { id: thinkingOptionId(raw), label: raw, value: raw };
	}
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	const raw = [item.value, item.id, item.name].find((candidate) => typeof candidate === "string" && candidate.trim()) as string | undefined;
	if (!raw) return undefined;
	const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : raw.trim();
	return { id: thinkingOptionId(raw.trim()), label, value: raw.trim() };
}

export function extractProviderContextWindow(item: unknown): number | undefined {
	if (!item || typeof item !== "object") return undefined;
	const model = item as Record<string, any>;
	const candidates = [
		model.context_length,
		model.max_model_len,
		model.context_window,
		model.max_context_length,
		model.max_context_tokens,
		model.context_tokens,
		model.contextWindow,
		model.capabilities?.context_length,
		model.capabilities?.context_window,
	];
	for (const candidate of candidates) {
		const parsed = typeof candidate === "number" ? candidate : typeof candidate === "string" ? parseInt(candidate, 10) : NaN;
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

export function extractProviderThinkingOptions(item: unknown): NonNullable<Model<Api>["thinkingOptions"]> {
	if (!item || typeof item !== "object") return [];
	const model = item as Record<string, any>;
	const candidates = [
		model.supported_reasoning_efforts,
		model.reasoning_efforts,
		model.supported_thinking_levels,
		model.thinking_levels,
		model.capabilities?.reasoning?.efforts,
		model.capabilities?.reasoning?.levels,
		model.capabilities?.thinking?.levels,
		model.reasoning?.efforts,
		model.reasoning?.levels,
		model.thinking?.levels,
	];
	const exposed = candidates.find(Array.isArray) as unknown[] | undefined;
	if (!exposed) return [];
	const byId = new Map<string, NonNullable<Model<Api>["thinkingOptions"]>[number]>();
	for (const value of exposed) {
		const option = normalizeThinkingOption(value);
		if (option && !byId.has(option.id)) byId.set(option.id, option);
	}
	return [...byId.values()];
}

/** Fetch model IDs and provider-native thinking metadata from an OpenAI-compatible endpoint. */
export async function fetchOtherProviderModelCatalog(baseUrl: string, apiKey?: string): Promise<DiscoveredProviderModel[]> {
	const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, "");
	const urlsToTry: string[] = [];

	if (cleanBaseUrl.endsWith("/v1")) {
		urlsToTry.push(`${cleanBaseUrl}/models`);
	} else {
		urlsToTry.push(`${cleanBaseUrl}/v1/models`);
		urlsToTry.push(`${cleanBaseUrl}/models`);
	}

	const headers: Record<string, string> = {
		"User-Agent": "metis",
	};
	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`;
	}

	for (const url of urlsToTry) {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000);

			const res = await fetch(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			clearTimeout(timeoutId);

			if (!res.ok) continue;

			const data = (await res.json()) as any;
			const items = Array.isArray(data)
				? data
				: Array.isArray(data?.data)
					? data.data
					: Array.isArray(data?.models)
						? data.models
						: [];

			const models = items
				.map((item: any) => {
					const id = typeof item === "string" ? item.trim() : typeof item?.id === "string" ? item.id.trim() : "";
					const contextWindow = extractProviderContextWindow(item);
					return {
						id,
						thinkingOptions: extractProviderThinkingOptions(item),
						...(contextWindow ? { contextWindow } : {}),
					};
				})
				.filter((model: DiscoveredProviderModel) => model.id.length > 0);

			if (models.length > 0) {
				const byId = new Map<string, DiscoveredProviderModel>();
				for (const model of models as DiscoveredProviderModel[]) if (!byId.has(model.id)) byId.set(model.id, model);
				return [...byId.values()];
			}
		} catch {
			// Try next candidate URL
		}
	}

	return [];
}

/** Backward-compatible model-ID-only discovery API. */
export async function fetchOtherProviderModels(baseUrl: string, apiKey?: string): Promise<string[]> {
	return (await fetchOtherProviderModelCatalog(baseUrl, apiKey)).map((model) => model.id);
}

export const CUSTOM_PROVIDER_ID_PREFIX = "custom-";

export interface SavedCustomProviderConfig {
	providerId: string;
	name: string;
	baseUrl: string;
	modelIds: string[];
	reasoning: boolean;
}

function readProviderConfigFile(modelsPath: string): { providers: Record<string, any>; [key: string]: any } {
	let config: { providers?: Record<string, any>; [key: string]: any } = { providers: {} };
	if (existsSync(modelsPath)) {
		try {
			const content = readFileSync(modelsPath, "utf-8");
			const parsed = JSON.parse(stripJsonComments(content));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				config = parsed as { providers?: Record<string, any> };
			}
		} catch {
			config = { providers: {} };
		}
	}
	return { ...config, providers: config.providers ?? {} };
}

function normalizeCustomModelIds(modelIds: string[]): string[] {
	return Array.from(new Set(modelIds.map((id) => id.trim()).filter(Boolean)));
}

export function isCustomProviderId(providerId: string): boolean {
	return providerId === "other" || providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX);
}

export function listCustomProviderConfigs(modelsPath: string): SavedCustomProviderConfig[] {
	const config = readProviderConfigFile(modelsPath);
	return Object.entries(config.providers)
		.filter(([providerId, provider]) => isCustomProviderId(providerId) && provider && typeof provider === "object")
		.map(([providerId, provider]) => {
			const models = Array.isArray(provider.models) ? provider.models : [];
			return {
				providerId,
				name: String(provider.name || providerId),
				baseUrl: String(provider.baseUrl || ""),
				modelIds: normalizeCustomModelIds(
					models.map((model: any) => (typeof model === "string" ? model : String(model?.id || ""))),
				),
				reasoning: models.some((model: any) => model && typeof model === "object" && model.reasoning === true),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function createCustomProviderId(modelsPath: string, name: string): string {
	const config = readProviderConfigFile(modelsPath);
	const slug = name
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "provider";
	const base = `${CUSTOM_PROVIDER_ID_PREFIX}${slug}`;
	let providerId = base;
	let suffix = 2;
	while (config.providers[providerId]) {
		providerId = `${base}-${suffix}`;
		suffix += 1;
	}
	return providerId;
}

export function deleteCustomProviderConfig(modelsPath: string, providerId: string): boolean {
	if (!isCustomProviderId(providerId)) return false;
	const config = readProviderConfigFile(modelsPath);
	if (!Object.hasOwn(config.providers, providerId)) return false;
	delete config.providers[providerId];
	writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
	return true;
}

/**
 * Save an OpenAI-compatible custom provider to models.json.
 * The historical function name is retained for public compatibility.
 */
export function saveOtherProviderConfig(
	modelsPath: string,
	providerId: string,
	name: string,
	baseUrl: string,
	modelIds: string[] = [],
	reasoning = false,
	discoveredModels?: DiscoveredProviderModel[],
): void {
	const config = readProviderConfigFile(modelsPath);
	if (!existsSync(modelsPath)) {
		const dir = dirname(modelsPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	const existingProvider = config.providers[providerId] || {};
	const existingModels = new Map(
		(Array.isArray(existingProvider.models) ? existingProvider.models : [])
			.filter((model: any) => model && typeof model === "object" && typeof model.id === "string")
			.map((model: any) => [model.id, model]),
	);
	const finalModelIds = normalizeCustomModelIds(modelIds).length > 0 ? normalizeCustomModelIds(modelIds) : ["default"];
	const discoveredById = new Map((discoveredModels ?? []).map((model) => [model.id, model]));
	const modelEntries = finalModelIds.map((id) => {
		const existingModel = existingModels.get(id) as any;
		const discovered = discoveredById.get(id);
		const contextWindow = discovered?.contextWindow ?? existingModel?.contextWindow ?? DEFAULT_CUSTOM_CONTEXT_WINDOW;
		const entry: any = { ...(existingModel || {}), id, input: existingModel?.input || ["text", "image"], contextWindow };
		const options = discovered?.thinkingOptions ?? existingModel?.thinkingOptions;
		if (options && options.length > 0 && options.some((option: any) => option.id !== "off")) {
			entry.reasoning = true;
			entry.thinkingOptions = options;
			entry.thinkingLevelMap = Object.fromEntries(options.map((option: any) => [option.id, option.value]));
		} else {
			delete entry.thinkingOptions;
			delete entry.thinkingLevelMap;
			delete entry.reasoning;
		}
		return entry;
	});

	config.providers[providerId] = {
		...existingProvider,
		name,
		baseUrl,
		api: existingProvider.api || "openai-completions",
		models: modelEntries,
	};

	writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}
