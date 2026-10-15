import { CLASSIFIER_MODELS, IMAGE_MODELS, MODELS } from "../models.generated.js";
import { createModels } from "../models.js";
import { amazonBedrockProvider } from "./amazon-bedrock.js";
import { antLingProvider } from "./ant-ling.js";
import { anthropicProvider } from "./anthropic.js";
import { azureProvider } from "./azure.js";
import { basetenProvider } from "./baseten.js";
import { cerebrasProvider } from "./cerebras.js";
import { cloudflareAIGatewayProvider } from "./cloudflare-ai-gateway.js";
import { cloudflareWorkersAIProvider } from "./cloudflare-workers-ai.js";
import modelDataManifest from "./data/.manifest.json" with { type: "json" };
import { deepseekProvider } from "./deepseek.js";
import { fireworksProvider } from "./fireworks.js";
import { githubCopilotProvider } from "./github-copilot.js";
import { googleProvider } from "./google.js";
import { googleVertexProvider } from "./google-vertex.js";
import { groqProvider } from "./groq.js";
import { huggingfaceProvider } from "./huggingface.js";
import { kimiCodingProvider } from "./kimi-coding.js";
import { metaProvider } from "./meta.js";
import { minimaxProvider } from "./minimax.js";
import { minimaxCnProvider } from "./minimax-cn.js";
import { mistralProvider } from "./mistral.js";
import { moonshotaiProvider } from "./moonshotai.js";
import { moonshotaiCnProvider } from "./moonshotai-cn.js";
import { nvidiaProvider } from "./nvidia.js";
import { openaiProvider } from "./openai.js";
import { openaiCodexProvider } from "./openai-codex.js";
import { opencodeProvider } from "./opencode.js";
import { opencodeGoProvider } from "./opencode-go.js";
import { openrouterProvider } from "./openrouter.js";
import { orcarouterProvider } from "./orcarouter.js";
import { qwenTokenPlanProvider } from "./qwen-token-plan.js";
import { qwenTokenPlanCnProvider } from "./qwen-token-plan-cn.js";
import { qwenTokenPlanIndividualProvider } from "./qwen-token-plan-individual.js";
import { radiusProvider } from "./radius.js";
import { togetherProvider } from "./together.js";
import { typesafeProvider } from "./typesafe.js";
import { vercelAIGatewayProvider } from "./vercel-ai-gateway.js";
import { xaiProvider } from "./xai.js";
import { xiaomiProvider } from "./xiaomi.js";
import { xiaomiTokenPlanAmsProvider } from "./xiaomi-token-plan-ams.js";
import { xiaomiTokenPlanCnProvider } from "./xiaomi-token-plan-cn.js";
import { xiaomiTokenPlanSgpProvider } from "./xiaomi-token-plan-sgp.js";
import { zaiProvider } from "./zai.js";
import { zaiCodingCnProvider } from "./zai-coding-cn.js";
export { radiusProvider };
/** Typed read of one generated built-in chat model. */
export function getBuiltinModel(provider, modelId) {
    return MODELS[provider]?.[modelId];
}
/** Typed read of one generated built-in image model. */
export function getBuiltinImageModel(provider, modelId) {
    return IMAGE_MODELS[provider]?.[modelId];
}
/** Typed read of one generated built-in classifier model. */
export function getBuiltinClassifierModel(provider, modelId) {
    return CLASSIFIER_MODELS[provider]?.[modelId];
}
export function getBuiltinProviders() {
    return Object.keys(MODELS);
}
/** Generation timestamp shared by all built-in provider catalogs. */
export function getBuiltinModelDataGeneratedAt() {
    const generatedAt = Date.parse(modelDataManifest.generatedAt);
    return Number.isNaN(generatedAt) ? undefined : generatedAt;
}
export function getBuiltinModels(provider) {
    const models = MODELS[provider];
    return Object.values(models ?? {});
}
export function getBuiltinImageModels(provider) {
    const models = IMAGE_MODELS[provider];
    return Object.values(models ?? {});
}
export function getBuiltinClassifierModels(provider) {
    const models = CLASSIFIER_MODELS[provider];
    return Object.values(models ?? {});
}
export function getAllBuiltinModels(provider) {
    return [...getBuiltinModels(provider), ...getBuiltinImageModels(provider), ...getBuiltinClassifierModels(provider)];
}
/** All built-in providers, freshly constructed. */
export function builtinProviders() {
    return [
        amazonBedrockProvider(),
        antLingProvider(),
        anthropicProvider(),
        azureProvider(),
        basetenProvider(),
        cerebrasProvider(),
        cloudflareAIGatewayProvider(),
        cloudflareWorkersAIProvider(),
        deepseekProvider(),
        fireworksProvider(),
        githubCopilotProvider(),
        googleProvider(),
        googleVertexProvider(),
        groqProvider(),
        huggingfaceProvider(),
        kimiCodingProvider(),
        metaProvider(),
        minimaxProvider(),
        minimaxCnProvider(),
        mistralProvider(),
        moonshotaiProvider(),
        moonshotaiCnProvider(),
        nvidiaProvider(),
        openaiProvider(),
        openaiCodexProvider(),
        opencodeProvider(),
        opencodeGoProvider(),
        openrouterProvider(),
        orcarouterProvider(),
        qwenTokenPlanProvider(),
        qwenTokenPlanCnProvider(),
        qwenTokenPlanIndividualProvider(),
        radiusProvider(),
        togetherProvider(),
        typesafeProvider(),
        vercelAIGatewayProvider(),
        xaiProvider(),
        xiaomiProvider(),
        xiaomiTokenPlanAmsProvider(),
        xiaomiTokenPlanCnProvider(),
        xiaomiTokenPlanSgpProvider(),
        zaiProvider(),
        zaiCodingCnProvider(),
    ];
}
/** A `Models` collection with every built-in provider registered. */
export function builtinModels(options) {
    const models = createModels(options);
    for (const provider of builtinProviders()) {
        models.setProvider(provider);
    }
    return models;
}
//# sourceMappingURL=all.js.map