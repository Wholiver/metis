import type { ModelCost } from "../types.ts";
/** OpenRouter's per-token prices, as decimal strings. */
export interface OpenRouterPricing {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    overrides?: OpenRouterPricingOverride[];
}
/**
 * A conditional price. `min_prompt_tokens` selects prompt-length pricing; `utc_*` fields select
 * time-of-day or weekday pricing. Missing rates keep the base price.
 */
export interface OpenRouterPricingOverride {
    min_prompt_tokens?: number;
    utc_start?: number;
    utc_end?: number;
    utc_days?: string[];
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
}
/** The fields pi reads from a model in OpenRouter's `GET /models` and `GET /models/user`. */
export interface OpenRouterModel {
    id: string;
    context_length?: number | null;
    top_provider?: {
        context_length?: number | null;
        max_completion_tokens?: number | null;
    };
    pricing?: OpenRouterPricing;
}
/**
 * Convert OpenRouter's $/token prices to pi's $/1M tokens. Missing, invalid and negative base
 * prices are 0. Prompt-length overrides become request-wide tiers; a rate a tier does not list
 * keeps the base price. Time-of-day overrides are skipped because ModelCost cannot express them.
 */
export declare function openRouterCost(pricing: OpenRouterPricing | undefined): ModelCost;
//# sourceMappingURL=openrouter-api.d.ts.map