import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { ORCAROUTER_MODELS } from "./orcarouter.models.js";
export function orcarouterProvider() {
    return createProvider({
        id: "orcarouter",
        name: "OrcaRouter",
        baseUrl: "https://api.orcarouter.ai/v1",
        auth: { apiKey: envApiKeyAuth("OrcaRouter API key", ["ORCAROUTER_API_KEY"]) },
        models: Object.values(ORCAROUTER_MODELS),
        api: openAICompletionsApi(),
    });
}
