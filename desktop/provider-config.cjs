const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const CUSTOM_PROVIDER_ID_PREFIX = "custom-";

function isCustomProviderId(providerId) {
	return providerId === "other" || providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX);
}

function stripJsonComments(input) {
	return input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => match[0] === '"' ? match : "")
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail) => tail ?? (match[0] === '"' ? match : ""));
}

async function readModelsConfig(modelsPath, translate = (key, variables) => variables?.message || key) {
	let modelsConfig = { providers: {} };
	if (!fs.existsSync(modelsPath)) return modelsConfig;
	const source = await fsp.readFile(modelsPath, "utf8");
	try {
		modelsConfig = JSON.parse(stripJsonComments(source));
	} catch (error) {
		throw new Error(translate("modelsJsonParseFailed", { message: error.message }));
	}
	if (!modelsConfig || typeof modelsConfig !== "object" || Array.isArray(modelsConfig)) modelsConfig = { providers: {} };
	if (!modelsConfig.providers || typeof modelsConfig.providers !== "object" || Array.isArray(modelsConfig.providers)) {
		modelsConfig.providers = {};
	}
	return modelsConfig;
}

function normalizeModelIds(modelIds) {
	return [...new Set((Array.isArray(modelIds) ? modelIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
}

function normalizeThinkingOption(value) {
	if (typeof value === "string" && value.trim()) {
		const raw = value.trim();
		return { id: /^(?:off|none|disabled)$/i.test(raw) ? "off" : raw, label: raw, value: raw };
	}
	if (!value || typeof value !== "object") return undefined;
	const raw = [value.value, value.id, value.name].find((candidate) => typeof candidate === "string" && candidate.trim());
	if (!raw) return undefined;
	return {
		id: /^(?:off|none|disabled)$/i.test(raw) ? "off" : raw.trim(),
		label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : raw.trim(),
		value: raw.trim(),
	};
}

const DEFAULT_CUSTOM_CONTEXT_WINDOW = 256_000;

function extractProviderContextWindow(item) {
	if (!item || typeof item !== "object") return undefined;
	const candidates = [
		item.context_length,
		item.max_model_len,
		item.context_window,
		item.max_context_length,
		item.max_context_tokens,
		item.context_tokens,
		item.contextWindow,
		item.capabilities?.context_length,
		item.capabilities?.context_window,
	];
	for (const candidate of candidates) {
		const parsed = typeof candidate === "number" ? candidate : typeof candidate === "string" ? parseInt(candidate, 10) : NaN;
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

function extractProviderThinkingOptions(item) {
	if (!item || typeof item !== "object") return [];
	const candidates = [
		item.supported_reasoning_efforts, item.reasoning_efforts,
		item.supported_thinking_levels, item.thinking_levels,
		item.capabilities?.reasoning?.efforts, item.capabilities?.reasoning?.levels,
		item.capabilities?.thinking?.levels, item.reasoning?.efforts,
		item.reasoning?.levels, item.thinking?.levels,
	];
	const exposed = candidates.find(Array.isArray);
	if (!exposed) return [];
	const byId = new Map();
	for (const value of exposed) {
		const option = normalizeThinkingOption(value);
		if (option && !byId.has(option.id)) byId.set(option.id, option);
	}
	return [...byId.values()];
}

function summarizeProvider(providerId, provider, modelsPath) {
	const models = Array.isArray(provider.models) ? provider.models : [];
	return {
		exists: true,
		provider: providerId,
		name: String(provider.name || providerId).trim(),
		baseUrl: String(provider.baseUrl || "").trim(),
		reasoning: models.some((model) => model && typeof model === "object" && model.reasoning === true),
		models: models.map((model) => ({
			id: typeof model === "string" ? model : String(model?.id || ""),
			thinkingOptions: Array.isArray(model?.thinkingOptions) ? model.thinkingOptions : [],
			contextWindow: typeof model === "object" && typeof model?.contextWindow === "number" ? model.contextWindow : DEFAULT_CUSTOM_CONTEXT_WINDOW,
		})).filter((model) => model.id),
		modelIds: normalizeModelIds(models.map((model) => typeof model === "string" ? model : model?.id)),
		modelsPath,
	};
}

function allocateProviderId(name, providers) {
	const slug = String(name || "")
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "provider";
	const base = `${CUSTOM_PROVIDER_ID_PREFIX}${slug}`;
	let providerId = base;
	let suffix = 2;
	while (providers[providerId]) {
		providerId = `${base}-${suffix}`;
		suffix += 1;
	}
	return providerId;
}

function normalizeBaseUrl(baseUrl, translate) {
	const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
	let parsedUrl;
	try {
		parsedUrl = new URL(normalized);
	} catch {
		throw new Error(translate("baseUrlInvalid"));
	}
	if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error(translate("baseUrlProtocol"));
	return normalized;
}

async function writeModelsConfig(agentDir, modelsPath, modelsConfig) {
	await fsp.mkdir(agentDir, { recursive: true });
	const temporaryPath = `${modelsPath}.${process.pid}.${Date.now()}.tmp`;
	await fsp.writeFile(temporaryPath, `${JSON.stringify(modelsConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await fsp.rename(temporaryPath, modelsPath);
}

async function listCustomProviderConfigs(agentDir, options = {}) {
	const modelsPath = path.join(agentDir, "models.json");
	const modelsConfig = await readModelsConfig(modelsPath, options.translate);
	return Object.entries(modelsConfig.providers)
		.filter(([providerId, provider]) => isCustomProviderId(providerId) && provider && typeof provider === "object" && !Array.isArray(provider))
		.map(([providerId, provider]) => summarizeProvider(providerId, provider, modelsPath))
		.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverCustomProviderModels(baseUrl, apiKey, options = {}) {
	const translate = options.translate || ((key) => key);
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl, translate);
	const urls = normalizedBaseUrl.endsWith("/v1")
		? [`${normalizedBaseUrl}/models`]
		: [`${normalizedBaseUrl}/v1/models`, `${normalizedBaseUrl}/models`];
	for (const url of urls) {
		try {
			const headers = { "User-Agent": "metis-desktop" };
			if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
			const response = await (options.fetchImpl || fetch)(url, {
				headers,
				signal: AbortSignal.timeout(options.timeoutMs || 5_000),
			});
			if (!response.ok) continue;
			const data = await response.json();
			const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
			const models = items.map((item) => {
				const id = typeof item === "string" ? item.trim() : typeof item?.id === "string" ? item.id.trim() : "";
				const contextWindow = extractProviderContextWindow(item);
				return {
					id,
					thinkingOptions: extractProviderThinkingOptions(item),
					...(contextWindow ? { contextWindow } : {}),
				};
			}).filter((model) => model.id);
			if (models.length > 0) {
				const byId = new Map();
				for (const model of models) if (!byId.has(model.id)) byId.set(model.id, model);
				return [...byId.values()];
			}
		} catch {}
	}
	return [];
}

async function fetchSingleModelDetails(baseUrl, apiKey, modelId, options = {}) {
	const translate = options.translate || ((key) => key);
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl, translate);
	const encodedId = encodeURIComponent(modelId);
	const urls = normalizedBaseUrl.endsWith("/v1")
		? [`${normalizedBaseUrl}/models/${encodedId}`]
		: [`${normalizedBaseUrl}/v1/models/${encodedId}`, `${normalizedBaseUrl}/models/${encodedId}`];
	for (const url of urls) {
		try {
			const headers = { "User-Agent": "metis-desktop" };
			if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
			const response = await (options.fetchImpl || fetch)(url, {
				headers,
				signal: AbortSignal.timeout(options.timeoutMs || 3_000),
			});
			if (!response.ok) continue;
			const data = await response.json();
			const item = data && typeof data === "object" ? (data.data || data) : undefined;
			if (item && typeof item === "object") {
				const contextWindow = extractProviderContextWindow(item);
				const thinkingOptions = extractProviderThinkingOptions(item);
				return {
					id: modelId,
					thinkingOptions: Array.isArray(thinkingOptions) ? thinkingOptions : [],
					...(contextWindow ? { contextWindow } : {}),
				};
			}
		} catch {}
	}
	return undefined;
}

async function saveCustomProviderConfig(agentDir, config = {}, options = {}) {
	const translate = options.translate || ((key) => key);
	const name = String(config.name || "").trim();
	const apiKey = String(config.apiKey || "").trim();
	const reasoning = Boolean(config.reasoning);
	if (!name) throw new Error(translate("providerNameRequired"));
	const baseUrl = normalizeBaseUrl(config.baseUrl, translate);

	const modelsPath = path.join(agentDir, "models.json");
	const modelsConfig = await readModelsConfig(modelsPath, translate);
	let providerId = String(config.providerId || "").trim();
	if (providerId) {
		if (!isCustomProviderId(providerId) || !modelsConfig.providers[providerId]) {
			throw new Error(translate("customProviderNotFound"));
		}
	} else {
		providerId = allocateProviderId(name, modelsConfig.providers);
	}

	const existing = modelsConfig.providers[providerId] && typeof modelsConfig.providers[providerId] === "object"
		? modelsConfig.providers[providerId]
		: {};
	const existingModels = Array.isArray(existing.models) ? existing.models : [];
	let modelIds = normalizeModelIds(config.modelIds);
	let discoveredModels = Array.isArray(config.discoveredModels) && config.discoveredModels.length > 0
		? config.discoveredModels
		: undefined;
	if (discoveredModels === undefined) {
		discoveredModels = await discoverCustomProviderModels(baseUrl, apiKey, options);
		if (modelIds.length === 0) modelIds = discoveredModels.map((model) => model.id);
	}
	if (modelIds.length === 0) modelIds = normalizeModelIds(existingModels.map((model) => typeof model === "string" ? model : model?.id));
	if (modelIds.length === 0) modelIds = ["default"];
	const modelsById = new Map(existingModels.filter((model) => model && typeof model === "object").map((model) => [model.id, model]));
	const discoveredById = new Map((discoveredModels || []).map((model) => [model.id, model]));
	const models = await Promise.all(modelIds.map(async (id) => {
		const existingModel = modelsById.get(id) || {};
		let discovered = discoveredById.get(id);
		if (!discovered && apiKey) {
			discovered = await fetchSingleModelDetails(baseUrl, apiKey, id, options);
		}
		const contextWindow = discovered?.contextWindow ?? existingModel.contextWindow ?? DEFAULT_CUSTOM_CONTEXT_WINDOW;
		const model = { ...existingModel, id, input: existingModel.input || ["text", "image"], contextWindow };
		const thinkingOptions = discovered?.thinkingOptions ?? existingModel.thinkingOptions;
		if (thinkingOptions && thinkingOptions.length > 0 && thinkingOptions.some((option) => option.id !== "off")) {
			model.reasoning = true;
			model.thinkingOptions = thinkingOptions;
			model.thinkingLevelMap = Object.fromEntries(thinkingOptions.map((option) => [option.id, option.value]));
		} else {
			delete model.thinkingOptions;
			delete model.thinkingLevelMap;
			delete model.reasoning;
		}
		return model;
	}));

	modelsConfig.providers[providerId] = {
		...existing,
		name,
		baseUrl,
		api: existing.api || "openai-completions",
		models,
	};
	await writeModelsConfig(agentDir, modelsPath, modelsConfig);
	return summarizeProvider(providerId, modelsConfig.providers[providerId], modelsPath);
}

async function deleteCustomProviderConfig(agentDir, providerId, options = {}) {
	const modelsPath = path.join(agentDir, "models.json");
	const modelsConfig = await readModelsConfig(modelsPath, options.translate);
	if (!isCustomProviderId(providerId) || !modelsConfig.providers[providerId]) return false;
	delete modelsConfig.providers[providerId];
	await writeModelsConfig(agentDir, modelsPath, modelsConfig);
	return true;
}

module.exports = {
	CUSTOM_PROVIDER_ID_PREFIX,
	deleteCustomProviderConfig,
	discoverCustomProviderModels,
	extractProviderThinkingOptions,
	isCustomProviderId,
	listCustomProviderConfigs,
	saveCustomProviderConfig,
};
