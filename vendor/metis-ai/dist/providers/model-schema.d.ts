import { type Static, Type } from "typebox";
export declare const THINKING_LEVELS: readonly ["minimal", "low", "medium", "high", "xhigh", "max"];
export declare const MODEL_THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export declare const MODEL_INPUT_MODALITIES: readonly ["text", "image"];
export declare const CACHE_RETENTIONS: readonly ["none", "short", "long"];
export declare const MODEL_PROMPT_CACHE_RETENTIONS: readonly ["short", "long"];
export declare const ThinkingLevelSchema: Type.TEnum<["minimal", "low", "medium", "high", "xhigh", "max"]>;
export declare const ModelThinkingLevelSchema: Type.TEnum<["off", "minimal", "low", "medium", "high", "xhigh", "max"]>;
export declare const ModelInputModalitySchema: Type.TEnum<["text", "image"]>;
export declare const CacheRetentionSchema: Type.TEnum<["none", "short", "long"]>;
export declare const ThinkingLevelMapSchema: Type.TObject<{
    high: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    low: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    max: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    medium: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    minimal: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    off: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    xhigh: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
}>;
export declare const ModelPromptCacheSchema: Type.TObject<{
    long: Type.TOptional<Type.TNumber>;
    short: Type.TOptional<Type.TNumber>;
}>;
export declare const ModelCostRatesSchema: Type.TObject<{
    input: Type.TNumber;
    output: Type.TNumber;
    cacheRead: Type.TNumber;
    cacheWrite: Type.TNumber;
}>;
export declare const ModelCostTierSchema: Type.TObject<{
    input: Type.TNumber;
    output: Type.TNumber;
    cacheRead: Type.TNumber;
    cacheWrite: Type.TNumber;
    inputTokensAbove: Type.TNumber;
}>;
export declare const ModelCostSchema: Type.TObject<{
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
export declare const ModelImageResizeOptionsSchema: Type.TObject<{
    maxWidth: Type.TOptional<Type.TInteger>;
    maxHeight: Type.TOptional<Type.TInteger>;
    maxBytes: Type.TOptional<Type.TInteger>;
    jpegQuality: Type.TOptional<Type.TInteger>;
}>;
export declare const ModelImageInputLimitsSchema: Type.TObject<{
    resize: Type.TOptional<Type.TObject<{
        maxWidth: Type.TOptional<Type.TInteger>;
        maxHeight: Type.TOptional<Type.TInteger>;
        maxBytes: Type.TOptional<Type.TInteger>;
        jpegQuality: Type.TOptional<Type.TInteger>;
    }>>;
    maxPerMessage: Type.TOptional<Type.TInteger>;
    maxPerRequest: Type.TOptional<Type.TInteger>;
}>;
export declare const ModelInputLimitsSchema: Type.TObject<{
    maxRequestBytes: Type.TOptional<Type.TInteger>;
    images: Type.TOptional<Type.TObject<{
        resize: Type.TOptional<Type.TObject<{
            maxWidth: Type.TOptional<Type.TInteger>;
            maxHeight: Type.TOptional<Type.TInteger>;
            maxBytes: Type.TOptional<Type.TInteger>;
            jpegQuality: Type.TOptional<Type.TInteger>;
        }>>;
        maxPerMessage: Type.TOptional<Type.TInteger>;
        maxPerRequest: Type.TOptional<Type.TInteger>;
    }>>;
}>;
export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;
export type ModelThinkingLevel = Static<typeof ModelThinkingLevelSchema>;
export type ThinkingLevelMap = Static<typeof ThinkingLevelMapSchema>;
export type ModelInputModality = Static<typeof ModelInputModalitySchema>;
export type CacheRetention = Static<typeof CacheRetentionSchema>;
export type ModelPromptCache = Static<typeof ModelPromptCacheSchema>;
export type ModelCostRates = Static<typeof ModelCostRatesSchema>;
export type ModelCostTier = Static<typeof ModelCostTierSchema>;
export type ModelCost = Static<typeof ModelCostSchema>;
export type ModelImageResizeOptions = Static<typeof ModelImageResizeOptionsSchema>;
export type ModelImageInputLimits = Static<typeof ModelImageInputLimitsSchema>;
export type ModelInputLimits = Static<typeof ModelInputLimitsSchema>;
//# sourceMappingURL=model-schema.d.ts.map