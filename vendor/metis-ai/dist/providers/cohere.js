import { openAICompletionsApi } from "../api/openai-completions.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { COHERE_MODELS } from "./cohere.models.js";
export function cohereProvider() {
    return createProvider({
        id: "cohere",
        name: "Cohere",
        baseUrl: "https://api.cohere.ai/compatibility/v1",
        auth: { apiKey: envApiKeyAuth("Cohere API key", ["COHERE_API_KEY"]) },
        models: Object.values(COHERE_MODELS),
        api: openAICompletionsApi(),
    });
}

