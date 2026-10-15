/**
 * Convert one $/token price to $/1M tokens. 0 means free. Missing, invalid and negative prices use
 * the fallback: OpenRouter reports -1 for router models such as `openrouter/auto`, whose price
 * depends on the model they pick.
 */
function perMillion(value, fallback) {
    const perToken = Number.parseFloat(value ?? "");
    return perToken >= 0 ? Number((perToken * 1_000_000).toFixed(6)) : fallback;
}
/**
 * Convert OpenRouter's $/token prices to pi's $/1M tokens. Missing, invalid and negative base
 * prices are 0. Prompt-length overrides become request-wide tiers; a rate a tier does not list
 * keeps the base price. Time-of-day overrides are skipped because ModelCost cannot express them.
 */
export function openRouterCost(pricing) {
    const base = {
        input: perMillion(pricing?.prompt, 0),
        output: perMillion(pricing?.completion, 0),
        cacheRead: perMillion(pricing?.input_cache_read, 0),
        cacheWrite: perMillion(pricing?.input_cache_write, 0),
    };
    const tiers = (pricing?.overrides ?? []).flatMap((override) => {
        if (override.min_prompt_tokens === undefined ||
            override.utc_start !== undefined ||
            override.utc_end !== undefined ||
            override.utc_days !== undefined) {
            return [];
        }
        return [
            {
                inputTokensAbove: override.min_prompt_tokens,
                input: perMillion(override.prompt, base.input),
                output: perMillion(override.completion, base.output),
                cacheRead: perMillion(override.input_cache_read, base.cacheRead),
                cacheWrite: perMillion(override.input_cache_write, base.cacheWrite),
            },
        ];
    });
    return tiers.length > 0 ? { ...base, tiers } : base;
}
//# sourceMappingURL=openrouter-api.js.map