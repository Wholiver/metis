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

function summarizeProvider(providerId, provider, modelsPath) {
	const models = Array.isArray(provider.models) ? provider.models : [];
	return {
		exists: true,
		provider: providerId,
		name: String(provider.name || providerId).trim(),
		baseUrl: String(provider.baseUrl || "").trim(),
		reasoning: models.some((model) => model && typeof model === "object" && model.reasoning === true),
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
			const modelIds = normalizeModelIds(items.map((item) => typeof item === "string" ? item : item?.id));
			if (modelIds.length > 0) return modelIds;
		} catch {}
	}
	return [];
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
	if (modelIds.length === 0 && apiKey) modelIds = await discoverCustomProviderModels(baseUrl, apiKey, options);
	if (modelIds.length === 0) modelIds = normalizeModelIds(existingModels.map((model) => typeof model === "string" ? model : model?.id));
	if (modelIds.length === 0) modelIds = ["default"];
	const modelsById = new Map(existingModels.filter((model) => model && typeof model === "object").map((model) => [model.id, model]));
	const models = modelIds.map((id) => {
		const model = { ...(modelsById.get(id) || {}), id, input: modelsById.get(id)?.input || ["text", "image"] };
		if (reasoning) model.reasoning = true;
		else delete model.reasoning;
		return model;
	});

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
	isCustomProviderId,
	listCustomProviderConfigs,
	saveCustomProviderConfig,
};
