import { type Static, type TProperties, Type } from "typebox";
export declare const SessionAffinityFormatSchema: Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openai-nosession">, Type.TLiteral<"openrouter">]>;
export declare const ThinkingTokenBudgetFieldSchema: Type.TUnion<[Type.TLiteral<"thinking_token_budget">, Type.TLiteral<"thinking_budget">, Type.TLiteral<"thinking_budget_tokens">]>;
export declare const ChatTemplateKwargValueSchema: Type.TUnion<[Type.TString, Type.TNumber, Type.TBoolean, Type.TNull, Type.TObject<{
    $var: Type.TUnion<[Type.TLiteral<"thinking.enabled">, Type.TLiteral<"thinking.effort">, Type.TLiteral<"thinking.budget">]>;
    omitWhenOff: Type.TOptional<Type.TBoolean>;
}>]>;
export declare const OpenRouterRoutingSchema: Type.TObject<{
    allow_fallbacks: Type.TOptional<Type.TBoolean>;
    require_parameters: Type.TOptional<Type.TBoolean>;
    data_collection: Type.TOptional<Type.TUnion<[Type.TLiteral<"deny">, Type.TLiteral<"allow">]>>;
    zdr: Type.TOptional<Type.TBoolean>;
    enforce_distillable_text: Type.TOptional<Type.TBoolean>;
    order: Type.TOptional<Type.TArray<Type.TString>>;
    only: Type.TOptional<Type.TArray<Type.TString>>;
    ignore: Type.TOptional<Type.TArray<Type.TString>>;
    quantizations: Type.TOptional<Type.TArray<Type.TString>>;
    sort: Type.TOptional<Type.TUnion<[Type.TString, Type.TObject<{
        by: Type.TOptional<Type.TString>;
        partition: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    }>]>>;
    max_price: Type.TOptional<Type.TObject<{
        prompt: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
        completion: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
        image: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
        audio: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
        request: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
    }>>;
    preferred_min_throughput: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TObject<{
        p50: Type.TOptional<Type.TNumber>;
        p75: Type.TOptional<Type.TNumber>;
        p90: Type.TOptional<Type.TNumber>;
        p99: Type.TOptional<Type.TNumber>;
    }>]>>;
    preferred_max_latency: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TObject<{
        p50: Type.TOptional<Type.TNumber>;
        p75: Type.TOptional<Type.TNumber>;
        p90: Type.TOptional<Type.TNumber>;
        p99: Type.TOptional<Type.TNumber>;
    }>]>>;
}>;
export declare const VercelGatewayRoutingSchema: Type.TObject<{
    only: Type.TOptional<Type.TArray<Type.TString>>;
    order: Type.TOptional<Type.TArray<Type.TString>>;
}>;
export declare const AnthropicAllowedFallbackModelSchema: Type.TObject<{
    provider: Type.TString;
    model: Type.TString;
    cost: Type.TObject<{
        input: Type.TNumber;
        output: Type.TNumber;
        cacheRead: Type.TNumber;
        cacheWrite: Type.TNumber;
        tiers: Type.TOptional<Type.TArray<Type.TObject<{
            input: Type.TNumber;
            output: Type.TNumber;
            cacheRead: Type.TNumber;
            cacheWrite: Type.TNumber;
            inputTokensAbove: Type.TNumber;
        }>>>;
    }>;
}>;
export declare const OpenAICompletionsCompatSchema: Type.TObject<{
    supportsStore: Type.TOptional<Type.TBoolean>;
    supportsDeveloperRole: Type.TOptional<Type.TBoolean>;
    supportsReasoningEffort: Type.TOptional<Type.TBoolean>;
    supportsUsageInStreaming: Type.TOptional<Type.TBoolean>;
    supportsFinishReason: Type.TOptional<Type.TBoolean>;
    maxTokensField: Type.TOptional<Type.TUnion<[Type.TLiteral<"max_completion_tokens">, Type.TLiteral<"max_tokens">]>>;
    requiresToolResultName: Type.TOptional<Type.TBoolean>;
    requiresAssistantAfterToolResult: Type.TOptional<Type.TBoolean>;
    requiresThinkingAsText: Type.TOptional<Type.TBoolean>;
    requiresReasoningContentOnAssistantMessages: Type.TOptional<Type.TBoolean>;
    thinkingFormat: Type.TOptional<Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openrouter">, Type.TLiteral<"deepseek">, Type.TLiteral<"together">, Type.TLiteral<"baseten">, Type.TLiteral<"zai">, Type.TLiteral<"qwen">, Type.TLiteral<"chat-template">, Type.TLiteral<"qwen-chat-template">, Type.TLiteral<"string-thinking">, Type.TLiteral<"ant-ling">]>>;
    chatTemplateKwargs: Type.TOptional<Type.TRecord<"^.*$", Type.TUnion<[Type.TString, Type.TNumber, Type.TBoolean, Type.TNull, Type.TObject<{
        $var: Type.TUnion<[Type.TLiteral<"thinking.enabled">, Type.TLiteral<"thinking.effort">, Type.TLiteral<"thinking.budget">]>;
        omitWhenOff: Type.TOptional<Type.TBoolean>;
    }>]>>>;
    chatTemplateArgs: Type.TOptional<Type.TRecord<"^.*$", Type.TUnion<[Type.TString, Type.TNumber, Type.TBoolean, Type.TNull, Type.TObject<{
        $var: Type.TUnion<[Type.TLiteral<"thinking.enabled">, Type.TLiteral<"thinking.effort">, Type.TLiteral<"thinking.budget">]>;
        omitWhenOff: Type.TOptional<Type.TBoolean>;
    }>]>>>;
    openRouterRouting: Type.TOptional<Type.TObject<{
        allow_fallbacks: Type.TOptional<Type.TBoolean>;
        require_parameters: Type.TOptional<Type.TBoolean>;
        data_collection: Type.TOptional<Type.TUnion<[Type.TLiteral<"deny">, Type.TLiteral<"allow">]>>;
        zdr: Type.TOptional<Type.TBoolean>;
        enforce_distillable_text: Type.TOptional<Type.TBoolean>;
        order: Type.TOptional<Type.TArray<Type.TString>>;
        only: Type.TOptional<Type.TArray<Type.TString>>;
        ignore: Type.TOptional<Type.TArray<Type.TString>>;
        quantizations: Type.TOptional<Type.TArray<Type.TString>>;
        sort: Type.TOptional<Type.TUnion<[Type.TString, Type.TObject<{
            by: Type.TOptional<Type.TString>;
            partition: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
        }>]>>;
        max_price: Type.TOptional<Type.TObject<{
            prompt: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            completion: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            image: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            audio: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            request: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
        }>>;
        preferred_min_throughput: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TObject<{
            p50: Type.TOptional<Type.TNumber>;
            p75: Type.TOptional<Type.TNumber>;
            p90: Type.TOptional<Type.TNumber>;
            p99: Type.TOptional<Type.TNumber>;
        }>]>>;
        preferred_max_latency: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TObject<{
            p50: Type.TOptional<Type.TNumber>;
            p75: Type.TOptional<Type.TNumber>;
            p90: Type.TOptional<Type.TNumber>;
            p99: Type.TOptional<Type.TNumber>;
        }>]>>;
    }>>;
    vercelGatewayRouting: Type.TOptional<Type.TObject<{
        only: Type.TOptional<Type.TArray<Type.TString>>;
        order: Type.TOptional<Type.TArray<Type.TString>>;
    }>>;
    zaiToolStream: Type.TOptional<Type.TBoolean>;
    thinkingTokenBudgetField: Type.TOptional<Type.TUnion<[Type.TLiteral<"thinking_token_budget">, Type.TLiteral<"thinking_budget">, Type.TLiteral<"thinking_budget_tokens">]>>;
    supportsThinkingTokenBudget: Type.TOptional<Type.TBoolean>;
    supportsOpenAIGrammarTools: Type.TOptional<Type.TBoolean>;
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
    supportsMidConvoToolAdditions: Type.TOptional<Type.TBoolean>;
    supportsStrictMode: Type.TOptional<Type.TBoolean>;
    cacheControlFormat: Type.TOptional<Type.TLiteral<"anthropic">>;
    sendSessionAffinityHeaders: Type.TOptional<Type.TBoolean>;
    sessionAffinityFormat: Type.TOptional<Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openai-nosession">, Type.TLiteral<"openrouter">]>>;
    supportsLongCacheRetention: Type.TOptional<Type.TBoolean>;
    vllmPriority: Type.TOptional<Type.TNumber>;
}>;
export declare const OpenAIResponsesCompatSchema: Type.TObject<{
    supportsDeveloperRole: Type.TOptional<Type.TBoolean>;
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
    sessionAffinityFormat: Type.TOptional<Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openai-nosession">, Type.TLiteral<"openrouter">]>>;
    supportsLongCacheRetention: Type.TOptional<Type.TBoolean>;
    supportsStrictMode: Type.TOptional<Type.TBoolean>;
    supportsOpenAIGrammarTools: Type.TOptional<Type.TBoolean>;
    supportsAdditionalTools: Type.TOptional<Type.TBoolean>;
    supportsToolSearch: Type.TOptional<Type.TBoolean>;
    supportsExplicitPromptCacheMode: Type.TOptional<Type.TBoolean>;
    supportsMaxOutputTokens: Type.TOptional<Type.TBoolean>;
}>;
export declare const AnthropicMessagesCompatSchema: Type.TObject<{
    supportsEagerToolInputStreaming: Type.TOptional<Type.TBoolean>;
    supportsLongCacheRetention: Type.TOptional<Type.TBoolean>;
    sendSessionAffinityHeaders: Type.TOptional<Type.TBoolean>;
    sessionAffinityFormat: Type.TOptional<Type.TLiteral<"openrouter">>;
    supportsCacheControlOnTools: Type.TOptional<Type.TBoolean>;
    supportsTemperature: Type.TOptional<Type.TBoolean>;
    forceAdaptiveThinking: Type.TOptional<Type.TBoolean>;
    allowEmptySignature: Type.TOptional<Type.TBoolean>;
    supportsStrictTools: Type.TOptional<Type.TBoolean>;
    supportsMidConvoEffort: Type.TOptional<Type.TBoolean>;
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
    supportsMidConvoToolChanges: Type.TOptional<Type.TBoolean>;
    allowedFallbackModels: Type.TOptional<Type.TArray<Type.TObject<{
        provider: Type.TString;
        model: Type.TString;
        cost: Type.TObject<{
            input: Type.TNumber;
            output: Type.TNumber;
            cacheRead: Type.TNumber;
            cacheWrite: Type.TNumber;
            tiers: Type.TOptional<Type.TArray<Type.TObject<{
                input: Type.TNumber;
                output: Type.TNumber;
                cacheRead: Type.TNumber;
                cacheWrite: Type.TNumber;
                inputTokensAbove: Type.TNumber;
            }>>>;
        }>;
    }>>>;
}>;
export declare const BedrockCompatSchema: Type.TObject<{
    supportsStrictMode: Type.TOptional<Type.TBoolean>;
}>;
export declare const MistralConversationsCompatSchema: Type.TObject<{
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
}>;
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Intersection) => void ? Intersection : never;
type MergedCompatProperties<PropertyGroups extends readonly TProperties[], Overrides extends TProperties> = Omit<UnionToIntersection<PropertyGroups[number]>, keyof Overrides> & Overrides;
export declare const ProviderCompatSchema: Type.TObject<MergedCompatProperties<({
    supportsStore: Type.TOptional<Type.TBoolean>;
    supportsDeveloperRole: Type.TOptional<Type.TBoolean>;
    supportsReasoningEffort: Type.TOptional<Type.TBoolean>;
    supportsUsageInStreaming: Type.TOptional<Type.TBoolean>;
    supportsFinishReason: Type.TOptional<Type.TBoolean>;
    maxTokensField: Type.TOptional<Type.TUnion<[Type.TLiteral<"max_completion_tokens">, Type.TLiteral<"max_tokens">]>>;
    requiresToolResultName: Type.TOptional<Type.TBoolean>;
    requiresAssistantAfterToolResult: Type.TOptional<Type.TBoolean>;
    requiresThinkingAsText: Type.TOptional<Type.TBoolean>;
    requiresReasoningContentOnAssistantMessages: Type.TOptional<Type.TBoolean>;
    thinkingFormat: Type.TOptional<Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openrouter">, Type.TLiteral<"deepseek">, Type.TLiteral<"together">, Type.TLiteral<"baseten">, Type.TLiteral<"zai">, Type.TLiteral<"qwen">, Type.TLiteral<"chat-template">, Type.TLiteral<"qwen-chat-template">, Type.TLiteral<"string-thinking">, Type.TLiteral<"ant-ling">]>>;
    chatTemplateKwargs: Type.TOptional<Type.TRecord<"^.*$", Type.TUnion<[Type.TString, Type.TNumber, Type.TBoolean, Type.TNull, Type.TObject<{
        $var: Type.TUnion<[Type.TLiteral<"thinking.enabled">, Type.TLiteral<"thinking.effort">, Type.TLiteral<"thinking.budget">]>;
        omitWhenOff: Type.TOptional<Type.TBoolean>;
    }>]>>>;
    chatTemplateArgs: Type.TOptional<Type.TRecord<"^.*$", Type.TUnion<[Type.TString, Type.TNumber, Type.TBoolean, Type.TNull, Type.TObject<{
        $var: Type.TUnion<[Type.TLiteral<"thinking.enabled">, Type.TLiteral<"thinking.effort">, Type.TLiteral<"thinking.budget">]>;
        omitWhenOff: Type.TOptional<Type.TBoolean>;
    }>]>>>;
    openRouterRouting: Type.TOptional<Type.TObject<{
        allow_fallbacks: Type.TOptional<Type.TBoolean>;
        require_parameters: Type.TOptional<Type.TBoolean>;
        data_collection: Type.TOptional<Type.TUnion<[Type.TLiteral<"deny">, Type.TLiteral<"allow">]>>;
        zdr: Type.TOptional<Type.TBoolean>;
        enforce_distillable_text: Type.TOptional<Type.TBoolean>;
        order: Type.TOptional<Type.TArray<Type.TString>>;
        only: Type.TOptional<Type.TArray<Type.TString>>;
        ignore: Type.TOptional<Type.TArray<Type.TString>>;
        quantizations: Type.TOptional<Type.TArray<Type.TString>>;
        sort: Type.TOptional<Type.TUnion<[Type.TString, Type.TObject<{
            by: Type.TOptional<Type.TString>;
            partition: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
        }>]>>;
        max_price: Type.TOptional<Type.TObject<{
            prompt: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            completion: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            image: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            audio: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
            request: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TString]>>;
        }>>;
        preferred_min_throughput: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TObject<{
            p50: Type.TOptional<Type.TNumber>;
            p75: Type.TOptional<Type.TNumber>;
            p90: Type.TOptional<Type.TNumber>;
            p99: Type.TOptional<Type.TNumber>;
        }>]>>;
        preferred_max_latency: Type.TOptional<Type.TUnion<[Type.TNumber, Type.TObject<{
            p50: Type.TOptional<Type.TNumber>;
            p75: Type.TOptional<Type.TNumber>;
            p90: Type.TOptional<Type.TNumber>;
            p99: Type.TOptional<Type.TNumber>;
        }>]>>;
    }>>;
    vercelGatewayRouting: Type.TOptional<Type.TObject<{
        only: Type.TOptional<Type.TArray<Type.TString>>;
        order: Type.TOptional<Type.TArray<Type.TString>>;
    }>>;
    zaiToolStream: Type.TOptional<Type.TBoolean>;
    thinkingTokenBudgetField: Type.TOptional<Type.TUnion<[Type.TLiteral<"thinking_token_budget">, Type.TLiteral<"thinking_budget">, Type.TLiteral<"thinking_budget_tokens">]>>;
    supportsThinkingTokenBudget: Type.TOptional<Type.TBoolean>;
    supportsOpenAIGrammarTools: Type.TOptional<Type.TBoolean>;
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
    supportsMidConvoToolAdditions: Type.TOptional<Type.TBoolean>;
    supportsStrictMode: Type.TOptional<Type.TBoolean>;
    cacheControlFormat: Type.TOptional<Type.TLiteral<"anthropic">>;
    sendSessionAffinityHeaders: Type.TOptional<Type.TBoolean>;
    sessionAffinityFormat: Type.TOptional<Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openai-nosession">, Type.TLiteral<"openrouter">]>>;
    supportsLongCacheRetention: Type.TOptional<Type.TBoolean>;
    vllmPriority: Type.TOptional<Type.TNumber>;
} | {
    supportsDeveloperRole: Type.TOptional<Type.TBoolean>;
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
    sessionAffinityFormat: Type.TOptional<Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openai-nosession">, Type.TLiteral<"openrouter">]>>;
    supportsLongCacheRetention: Type.TOptional<Type.TBoolean>;
    supportsStrictMode: Type.TOptional<Type.TBoolean>;
    supportsOpenAIGrammarTools: Type.TOptional<Type.TBoolean>;
    supportsAdditionalTools: Type.TOptional<Type.TBoolean>;
    supportsToolSearch: Type.TOptional<Type.TBoolean>;
    supportsExplicitPromptCacheMode: Type.TOptional<Type.TBoolean>;
    supportsMaxOutputTokens: Type.TOptional<Type.TBoolean>;
} | {
    supportsEagerToolInputStreaming: Type.TOptional<Type.TBoolean>;
    supportsLongCacheRetention: Type.TOptional<Type.TBoolean>;
    sendSessionAffinityHeaders: Type.TOptional<Type.TBoolean>;
    sessionAffinityFormat: Type.TOptional<Type.TLiteral<"openrouter">>;
    supportsCacheControlOnTools: Type.TOptional<Type.TBoolean>;
    supportsTemperature: Type.TOptional<Type.TBoolean>;
    forceAdaptiveThinking: Type.TOptional<Type.TBoolean>;
    allowEmptySignature: Type.TOptional<Type.TBoolean>;
    supportsStrictTools: Type.TOptional<Type.TBoolean>;
    supportsMidConvoEffort: Type.TOptional<Type.TBoolean>;
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
    supportsMidConvoToolChanges: Type.TOptional<Type.TBoolean>;
    allowedFallbackModels: Type.TOptional<Type.TArray<Type.TObject<{
        provider: Type.TString;
        model: Type.TString;
        cost: Type.TObject<{
            input: Type.TNumber;
            output: Type.TNumber;
            cacheRead: Type.TNumber;
            cacheWrite: Type.TNumber;
            tiers: Type.TOptional<Type.TArray<Type.TObject<{
                input: Type.TNumber;
                output: Type.TNumber;
                cacheRead: Type.TNumber;
                cacheWrite: Type.TNumber;
                inputTokensAbove: Type.TNumber;
            }>>>;
        }>;
    }>>>;
} | {
    supportsStrictMode: Type.TOptional<Type.TBoolean>;
} | {
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
})[], {
    supportsDeveloperRole: Type.TOptional<Type.TBoolean>;
    supportsMidConvoSystemMessages: Type.TOptional<Type.TBoolean>;
    sessionAffinityFormat: Type.TOptional<Type.TUnion<[Type.TLiteral<"openai">, Type.TLiteral<"openai-nosession">, Type.TLiteral<"openrouter">]>>;
    supportsLongCacheRetention: Type.TOptional<Type.TBoolean>;
    supportsStrictMode: Type.TOptional<Type.TBoolean>;
    supportsOpenAIGrammarTools: Type.TOptional<Type.TBoolean>;
    sendSessionAffinityHeaders: Type.TOptional<Type.TBoolean>;
}>>;
export type ChatTemplateKwargValue = Static<typeof ChatTemplateKwargValueSchema>;
/** Top-level request field used to cap reasoning tokens on OpenAI-compatible servers. */
export type ThinkingTokenBudgetField = Static<typeof ThinkingTokenBudgetFieldSchema>;
export type SessionAffinityFormat = Static<typeof SessionAffinityFormatSchema>;
/** OpenRouter provider routing preferences. */
export interface OpenRouterRouting extends Static<typeof OpenRouterRoutingSchema> {
}
/** Vercel AI Gateway routing preferences. */
export interface VercelGatewayRouting extends Static<typeof VercelGatewayRoutingSchema> {
}
/** An Anthropic server-side refusal fallback model with local pricing metadata. */
export interface AnthropicAllowedFallbackModel extends Static<typeof AnthropicAllowedFallbackModelSchema> {
}
/** Compatibility settings for OpenAI-compatible completions APIs. */
export interface OpenAICompletionsCompat extends Static<typeof OpenAICompletionsCompatSchema> {
}
/** Compatibility settings for OpenAI Responses APIs. */
export interface OpenAIResponsesCompat extends Static<typeof OpenAIResponsesCompatSchema> {
}
/** Compatibility settings for Anthropic Messages-compatible APIs. */
export interface AnthropicMessagesCompat extends Static<typeof AnthropicMessagesCompatSchema> {
}
/** Compatibility settings for Amazon Bedrock models. */
export interface BedrockCompat extends Static<typeof BedrockCompatSchema> {
}
/** Compatibility settings for the Mistral chat API. */
export interface MistralConversationsCompat extends Static<typeof MistralConversationsCompatSchema> {
}
export {};
//# sourceMappingURL=compat-schema.d.ts.map