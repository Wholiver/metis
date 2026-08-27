export declare const COHERE_MODELS: Record<string, {
    id: string;
    name: string;
    api: "openai-completions";
    provider: string;
    baseUrl: string;
    compat: {
        supportsStore: false;
        supportsDeveloperRole: false;
        supportsReasoningEffort: false;
        maxTokensField: "max_tokens";
        supportsStrictMode: false;
    };
    reasoning: false;
    input: ("image" | "text")[];
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
}>;

