import { resolveAzureBaseUrl, resolveDeploymentName } from "../api/azure-openai-config.js";
import { azureOpenAIResponsesApi } from "../api/azure-openai-responses.lazy.js";
import { lazyStream } from "../api/lazy.js";
import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { AZURE_MODELS } from "./azure.models.js";
function resolveAzureModel(model, options) {
    return { ...model, baseUrl: resolveAzureBaseUrl(model, options) };
}
/** Send the deployment name as the request's model, keeping `model.id` as the catalog id. */
function withDeploymentName(model, options) {
    const deploymentName = resolveDeploymentName(model, options);
    if (deploymentName === model.id)
        return options;
    return {
        ...options,
        onPayload: async (payload, payloadModel) => {
            const params = { ...payload, model: deploymentName };
            return (await options?.onPayload?.(params, payloadModel)) ?? params;
        },
    };
}
/**
 * Resolve the Azure endpoint and deployment before dispatch, inside `lazyStream` so an
 * unconfigured endpoint errors on the stream instead of throwing out of `stream()`.
 */
function azureStreams(streams) {
    return {
        stream: (model, context, options) => lazyStream(model, async () => streams.stream(resolveAzureModel(model, options), context, withDeploymentName(model, options))),
        streamSimple: (model, context, options) => lazyStream(model, async () => streams.streamSimple(resolveAzureModel(model, options), context, withDeploymentName(model, options))),
    };
}
export function azureProvider() {
    return createProvider({
        id: "azure",
        name: "Azure",
        auth: { apiKey: envApiKeyAuth("Azure OpenAI API key", ["AZURE_OPENAI_API_KEY"]) },
        models: Object.values(AZURE_MODELS),
        api: {
            "azure-openai-responses": azureOpenAIResponsesApi(),
            "openai-completions": azureStreams(openAICompletionsApi()),
        },
    });
}
//# sourceMappingURL=azure.js.map