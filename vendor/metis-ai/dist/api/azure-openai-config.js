import { getProviderEnvValue } from "../utils/provider-env.js";
const DEFAULT_AZURE_API_VERSION = "v1";
function parseDeploymentNameMap(value) {
    const map = new Map();
    if (!value)
        return map;
    for (const entry of value.split(",")) {
        const trimmed = entry.trim();
        if (!trimmed)
            continue;
        const [modelId, deploymentName] = trimmed.split("=", 2);
        if (!modelId || !deploymentName)
            continue;
        map.set(modelId.trim(), deploymentName.trim());
    }
    return map;
}
export function resolveDeploymentName(model, options) {
    if (options?.azureDeploymentName) {
        return options.azureDeploymentName;
    }
    const mappedDeployment = parseDeploymentNameMap(getProviderEnvValue("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", options?.env)).get(model.id);
    return mappedDeployment || model.id;
}
function normalizeAzureBaseUrl(baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error(`Invalid Azure OpenAI base URL: ${baseUrl}`);
    }
    const isAzureHost = url.hostname.endsWith(".openai.azure.com") ||
        url.hostname.endsWith(".cognitiveservices.azure.com") ||
        url.hostname.endsWith(".ai.azure.com");
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    // Ensure Azure hosts have /openai/v1 as base path so the AzureOpenAI SDK
    // can append /deployments/<model>/... and ?api-version=v1 correctly.
    if (isAzureHost &&
        (normalizedPath === "" ||
            normalizedPath === "/" ||
            normalizedPath === "/openai" ||
            normalizedPath === "/openai/v1/responses")) {
        url.pathname = "/openai/v1";
        url.search = "";
    }
    return url.toString().replace(/\/+$/, "");
}
function buildDefaultBaseUrl(resourceName) {
    return `https://${resourceName}.openai.azure.com/openai/v1`;
}
export function resolveAzureBaseUrl(model, options) {
    const baseUrl = options?.azureBaseUrl?.trim() || getProviderEnvValue("AZURE_OPENAI_BASE_URL", options?.env)?.trim() || undefined;
    const resourceName = options?.azureResourceName || getProviderEnvValue("AZURE_OPENAI_RESOURCE_NAME", options?.env);
    let resolvedBaseUrl = baseUrl;
    if (!resolvedBaseUrl && resourceName) {
        resolvedBaseUrl = buildDefaultBaseUrl(resourceName);
    }
    if (!resolvedBaseUrl && model.baseUrl) {
        resolvedBaseUrl = model.baseUrl;
    }
    if (!resolvedBaseUrl) {
        throw new Error("Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.");
    }
    return normalizeAzureBaseUrl(resolvedBaseUrl);
}
export function resolveAzureConfig(model, options) {
    return {
        baseUrl: resolveAzureBaseUrl(model, options),
        apiVersion: options?.azureApiVersion ||
            getProviderEnvValue("AZURE_OPENAI_API_VERSION", options?.env) ||
            DEFAULT_AZURE_API_VERSION,
    };
}
//# sourceMappingURL=azure-openai-config.js.map