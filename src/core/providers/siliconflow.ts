/**
 * Bundled SiliconFlow providers.
 *
 * SiliconFlow runs two independent platforms. Accounts, API keys, and model
 * catalogs are not interchangeable:
 *
 * - siliconflow: international OpenAI-compatible API (api.siliconflow.com)
 * - siliconflow-cn: CN OpenAI-compatible API (api.siliconflow.cn)
 *
 * Transport uses Metis's OpenAI Chat Completions client (the `openai` SDK).
 */
import type { Api, Model, OpenAICompletionsCompat } from "@earendil-works/metis-ai/compat";

export const SILICONFLOW_PROVIDER_ID = "siliconflow";
export const SILICONFLOW_CN_PROVIDER_ID = "siliconflow-cn";

export const SILICONFLOW_BASE_URL = "https://api.siliconflow.com/v1";
export const SILICONFLOW_CN_BASE_URL = "https://api.siliconflow.cn/v1";

export const SILICONFLOW_API_KEY_ENV = "SILICONFLOW_API_KEY";
export const SILICONFLOW_CN_API_KEY_ENV = "SILICONFLOW_CN_API_KEY";

export const DEFAULT_SILICONFLOW_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash";

const SILICONFLOW_COMPAT: OpenAICompletionsCompat = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
};

type SiliconFlowModelSeed = {
	id: string;
	name: string;
	input?: Array<"text" | "image">;
	contextWindow: number;
	maxTokens: number;
	cost: Model<Api>["cost"];
};

/** Coding-oriented chat models shared by both SiliconFlow platforms. */
const SILICONFLOW_MODEL_SEEDS: SiliconFlowModelSeed[] = [
	{
		id: "deepseek-ai/DeepSeek-V4-Flash",
		name: "DeepSeek V4 Flash",
		contextWindow: 1_000_000,
		maxTokens: 384_000,
		cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 },
	},
	{
		id: "Pro/deepseek-ai/DeepSeek-V4-Flash",
		name: "DeepSeek V4 Flash (Pro)",
		contextWindow: 1_000_000,
		maxTokens: 384_000,
		cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 },
	},
	{
		id: "deepseek-ai/DeepSeek-V4-Pro",
		name: "DeepSeek V4 Pro",
		contextWindow: 1_000_000,
		maxTokens: 384_000,
		cost: { input: 0.435, output: 0.87, cacheRead: 0.087, cacheWrite: 0 },
	},
	{
		id: "Pro/moonshotai/Kimi-K2.6",
		name: "Kimi K2.6 (Pro)",
		input: ["text", "image"],
		contextWindow: 262_144,
		maxTokens: 131_072,
		cost: { input: 1.2, output: 4.5, cacheRead: 0.24, cacheWrite: 0 },
	},
	{
		id: "moonshotai/Kimi-K2.7-Code",
		name: "Kimi K2.7 Code",
		contextWindow: 262_144,
		maxTokens: 131_072,
		cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
	},
	{
		id: "zai-org/GLM-5.2",
		name: "GLM-5.2",
		contextWindow: 202_752,
		maxTokens: 163_840,
		cost: { input: 1.4, output: 4.4, cacheRead: 0.28, cacheWrite: 0 },
	},
	{
		id: "Pro/zai-org/GLM-5.2",
		name: "GLM-5.2 (Pro)",
		contextWindow: 202_752,
		maxTokens: 163_840,
		cost: { input: 1.4, output: 4.4, cacheRead: 0.28, cacheWrite: 0 },
	},
	{
		id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
		name: "Qwen3 Coder 480B",
		contextWindow: 262_144,
		maxTokens: 65_536,
		cost: { input: 0.22, output: 0.88, cacheRead: 0, cacheWrite: 0 },
	},
];

export type BundledSiliconFlowProvider = {
	id: typeof SILICONFLOW_PROVIDER_ID | typeof SILICONFLOW_CN_PROVIDER_ID;
	name: string;
	baseUrl: string;
	apiKeyEnv: string;
	apiKey: string;
	api: "openai-completions";
};

export const BUNDLED_SILICONFLOW_PROVIDERS: readonly BundledSiliconFlowProvider[] = [
	{
		id: SILICONFLOW_PROVIDER_ID,
		name: "SiliconFlow",
		baseUrl: SILICONFLOW_BASE_URL,
		apiKeyEnv: SILICONFLOW_API_KEY_ENV,
		apiKey: `$${SILICONFLOW_API_KEY_ENV}`,
		api: "openai-completions",
	},
	{
		id: SILICONFLOW_CN_PROVIDER_ID,
		name: "SiliconFlow (CN)",
		baseUrl: SILICONFLOW_CN_BASE_URL,
		apiKeyEnv: SILICONFLOW_CN_API_KEY_ENV,
		apiKey: `$${SILICONFLOW_CN_API_KEY_ENV}`,
		api: "openai-completions",
	},
];

export const BUNDLED_PROVIDER_IDS: ReadonlySet<string> = new Set(BUNDLED_SILICONFLOW_PROVIDERS.map((provider) => provider.id));

const BUNDLED_ENV_KEYS: Record<string, string[]> = {
	[SILICONFLOW_PROVIDER_ID]: [SILICONFLOW_API_KEY_ENV],
	[SILICONFLOW_CN_PROVIDER_ID]: [SILICONFLOW_CN_API_KEY_ENV],
};

export function isBundledProvider(providerId: string): boolean {
	return BUNDLED_PROVIDER_IDS.has(providerId);
}

export function getBundledProvider(providerId: string): BundledSiliconFlowProvider | undefined {
	return BUNDLED_SILICONFLOW_PROVIDERS.find((provider) => provider.id === providerId);
}

export function findBundledEnvKeys(provider: string, env: NodeJS.ProcessEnv = process.env): string[] | undefined {
	const names = BUNDLED_ENV_KEYS[provider];
	if (!names) return undefined;
	const found = names.filter((name) => Boolean(env[name]));
	return found.length > 0 ? found : undefined;
}

export function getBundledEnvApiKey(provider: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const keys = findBundledEnvKeys(provider, env);
	return keys?.[0] ? env[keys[0]] : undefined;
}

function expandModels(provider: BundledSiliconFlowProvider): Model<Api>[] {
	return SILICONFLOW_MODEL_SEEDS.map((seed) => ({
		id: seed.id,
		name: seed.name,
		api: "openai-completions",
		provider: provider.id,
		baseUrl: provider.baseUrl,
		reasoning: false,
		input: seed.input ?? ["text"],
		cost: seed.cost,
		contextWindow: seed.contextWindow,
		maxTokens: seed.maxTokens,
		compat: { ...SILICONFLOW_COMPAT },
	}));
}

export function getBundledSiliconFlowModels(): Model<Api>[] {
	return BUNDLED_SILICONFLOW_PROVIDERS.flatMap(expandModels);
}
