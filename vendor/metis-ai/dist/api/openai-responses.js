import OpenAI from "openai";
import { clampThinkingLevel } from "../models.js";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { headersToRecord } from "../utils/headers.js";
import { getPiUserAgent } from "../utils/pi-user-agent.js";
import { getProviderEnvValue } from "../utils/provider-env.js";
import { retryProviderRequest } from "../utils/provider-retry.js";
import { getDeclaredTools, resolveTranscript, resolveTranscriptTools } from "../utils/transcript.js";
import { createGrammarToolInputProperties } from "./constrained-sampling.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.js";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.js";
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from "./openai-responses-shared.js";
import { buildBaseOptions, resolveSamplingParams } from "./simple-options.js";
const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
// OpenAI Responses rejects max_output_tokens below 16: https://github.com/earendil-works/pi/issues/6265
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
/**
 * OpenAI API keys start with `sk-`; a different credential sent directly to OpenAI
 * is a Sign in with ChatGPT access token.
 */
function isChatGPTSignIn(model, apiKey) {
    return (model.provider === "openai" &&
        model.baseUrl === "https://api.openai.com/v1" &&
        apiKey !== undefined &&
        !apiKey.startsWith("sk-"));
}
function hasHeader(headers, name) {
    if (!headers)
        return false;
    const expected = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === expected && value !== null && value.trim().length > 0)
            return true;
    }
    return false;
}
function getClientApiKey(provider, apiKey, headers) {
    if (apiKey)
        return apiKey;
    if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization"))
        return "unused";
    throw new Error(`No API key for provider: ${provider}`);
}
function detectSessionAffinityFormat(model) {
    return model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai") ? "openrouter" : "openai";
}
/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention, env) {
    if (cacheRetention) {
        return cacheRetention;
    }
    if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
        return "long";
    }
    return "short";
}
function getCompat(model) {
    return {
        supportsDeveloperRole: model.compat?.supportsDeveloperRole ?? true,
        supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
        sessionAffinityFormat: model.compat?.sessionAffinityFormat ?? detectSessionAffinityFormat(model),
        supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
        supportsStrictMode: model.compat?.supportsStrictMode ?? false,
        supportsOpenAIGrammarTools: model.compat?.supportsOpenAIGrammarTools ?? false,
        supportsAdditionalTools: model.compat?.supportsAdditionalTools ?? false,
        supportsToolSearch: model.compat?.supportsToolSearch ?? false,
        supportsExplicitPromptCacheMode: model.compat?.supportsExplicitPromptCacheMode ?? false,
        supportsMaxOutputTokens: model.compat?.supportsMaxOutputTokens ?? true,
    };
}
function getPromptCacheRetention(compat, cacheRetention) {
    return cacheRetention === "long" && compat.supportsLongCacheRetention && !compat.supportsExplicitPromptCacheMode
        ? "24h"
        : undefined;
}
function getPromptCacheOptions(compat, cacheRetention) {
    if (!compat.supportsExplicitPromptCacheMode)
        return undefined;
    if (cacheRetention === "none")
        return { mode: "explicit" };
    if (cacheRetention === "long" && compat.supportsLongCacheRetention)
        return { ttl: "30m" };
    return undefined;
}
/**
 * Generate function for OpenAI Responses API
 */
export const stream = (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    const normalizedContext = resolveTranscript(context, getCompat(model).supportsMidConvoSystemMessages);
    // Start async processing
    (async () => {
        const output = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "pending",
            timestamp: Date.now(),
        };
        try {
            // Create OpenAI client
            const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
            const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
            const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
            const compat = getCompat(model);
            const grammarToolInputProperties = createGrammarToolInputProperties(getDeclaredTools(normalizedContext.messages), compat.supportsOpenAIGrammarTools);
            const client = createClient(model, normalizedContext, apiKey, options?.headers, options?.fetch, cacheSessionId);
            let params = buildParams(model, normalizedContext, options, compat, grammarToolInputProperties);
            const nextParams = await options?.onPayload?.(params, model);
            if (nextParams !== undefined) {
                params = nextParams;
            }
            const requestOptions = {
                ...(options?.signal ? { signal: options.signal } : {}),
                ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
                maxRetries: 0,
            };
            const { data: openaiStream, response } = await retryProviderRequest(() => client.responses.create(params, requestOptions).withResponse(), {
                maxRetries: options?.maxRetries,
                maxRetryDelayMs: options?.maxRetryDelayMs,
                signal: options?.signal,
            });
            await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
            stream.push({ type: "start", partial: output });
            await processResponsesStream(openaiStream, output, stream, model, {
                onProviderStreamEvent: options?.onProviderStreamEvent,
                serviceTier: options?.serviceTier,
                grammarToolInputProperties,
                applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model),
            });
            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }
            if (output.stopReason === "pending") {
                throw new Error("OpenAI Responses stream ended without a stop reason");
            }
            if (output.stopReason === "aborted" || output.stopReason === "error") {
                throw new Error(output.errorMessage || "An unknown error occurred");
            }
            stream.push({ type: "done", reason: output.stopReason, message: output });
            stream.end();
        }
        catch (error) {
            for (const block of output.content) {
                delete block.index;
                // Streaming scratch buffers are only used during parsing; never persist them.
                delete block.partialJson;
                delete block.customInput;
            }
            output.stopReason = options?.signal?.aborted ? "aborted" : "error";
            const errorMessage = formatProviderError(normalizeProviderError(error), `${model.provider === "openai" ? "OpenAI" : model.provider} API error`);
            // Sign in with ChatGPT shares the subscription's usage limit with other apps.
            output.errorMessage = errorMessage.includes("subscription_sharing_usage_limit_exceeded")
                ? `${errorMessage}\nCheck your ChatGPT usage: ${CHATGPT_USAGE_URL}`
                : errorMessage;
            stream.push({ type: "error", reason: output.stopReason, error: output });
            stream.end();
        }
    })();
    return stream;
};
export const streamSimple = (model, context, options) => {
    getClientApiKey(model.provider, options?.apiKey, options?.headers);
    const base = {
        ...buildBaseOptions(model, context, options, options?.apiKey),
        toolChoice: options?.toolChoice,
    };
    const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
    const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;
    return stream(model, context, {
        ...base,
        reasoningEffort,
    });
};
function createClient(model, context, apiKey, optionsHeaders, fetch, sessionId) {
    const compat = getCompat(model);
    const headers = { "User-Agent": getPiUserAgent(), ...model.headers };
    if (model.provider === "github-copilot") {
        const hasImages = hasCopilotVisionInput(context.messages);
        const copilotHeaders = buildCopilotDynamicHeaders({
            messages: context.messages,
            hasImages,
        });
        Object.assign(headers, copilotHeaders);
    }
    if (sessionId) {
        if (compat.sessionAffinityFormat === "openrouter") {
            headers["x-session-id"] = sessionId;
        }
        else {
            if (compat.sessionAffinityFormat === "openai") {
                headers.session_id = sessionId;
            }
            headers["x-client-request-id"] = sessionId;
        }
    }
    // Merge options headers last so they can override defaults
    if (optionsHeaders) {
        Object.assign(headers, optionsHeaders);
    }
    return new OpenAI({
        apiKey,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        fetch,
        defaultHeaders: headers,
    });
}
function buildParams(model, context, options, compat = getCompat(model), grammarToolInputProperties = createGrammarToolInputProperties(getDeclaredTools(context.messages), compat.supportsOpenAIGrammarTools)) {
    const transcriptTools = resolveTranscriptTools(context.messages, compat.supportsAdditionalTools || compat.supportsToolSearch);
    const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
        grammarToolInputProperties,
        supportsMidConvoSystemMessages: compat.supportsMidConvoSystemMessages,
        supportsAdditionalTools: compat.supportsAdditionalTools,
        supportsToolSearch: compat.supportsToolSearch,
        toolOptions: {
            supportsStrictMode: compat.supportsStrictMode,
            supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
        },
    });
    const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
    // Sign in with ChatGPT rejects these request fields.
    const omitUnsupportedFields = isChatGPTSignIn(model, options?.apiKey);
    const params = {
        model: model.id,
        input: messages,
        stream: true,
        prompt_cache_key: cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId),
        prompt_cache_retention: omitUnsupportedFields ? undefined : getPromptCacheRetention(compat, cacheRetention),
        prompt_cache_options: omitUnsupportedFields ? undefined : getPromptCacheOptions(compat, cacheRetention),
        store: false,
    };
    if (options?.maxTokens && compat.supportsMaxOutputTokens && !omitUnsupportedFields) {
        params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
    }
    if (options?.temperature !== undefined && !omitUnsupportedFields) {
        params.temperature = options?.temperature;
    }
    if (options?.serviceTier !== undefined) {
        params.service_tier = options.serviceTier;
    }
    if (transcriptTools.requestTools.length > 0) {
        params.tools = convertResponsesTools(transcriptTools.requestTools, {
            supportsStrictMode: compat.supportsStrictMode,
            supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
        });
    }
    if (options?.toolChoice !== undefined) {
        params.tool_choice = options.toolChoice;
    }
    const reasoningEffort = options?.reasoningEffort ?? (options?.reasoningSummary ? "medium" : undefined);
    if (model.reasoning) {
        if (reasoningEffort) {
            const effort = options?.reasoningEffort
                ? (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort)
                : reasoningEffort;
            params.reasoning = {
                effort: effort,
                summary: options?.reasoningSummary || "auto",
            };
            params.include = ["reasoning.encrypted_content"];
        }
        else if (model.provider !== "github-copilot" && model.thinkingLevelMap?.off !== null) {
            params.reasoning = {
                effort: (model.thinkingLevelMap?.off ?? "none"),
            };
        }
        if (model.provider === "xai")
            params.include = ["reasoning.encrypted_content"];
    }
    // Last so model and request sampling parameters override named request fields.
    const samplingParams = resolveSamplingParams(model, reasoningEffort ?? "off", options?.samplingParams);
    if (samplingParams) {
        Object.assign(params, samplingParams);
    }
    return params;
}
function getServiceTierCostMultiplier(model, serviceTier) {
    switch (serviceTier) {
        case "flex":
            return 0.5;
        case "priority":
        case "fast":
            return model.id === "gpt-5.5" ? 2.5 : 2;
        default:
            return 1;
    }
}
function applyServiceTierPricing(usage, serviceTier, model) {
    const multiplier = getServiceTierCostMultiplier(model, serviceTier);
    if (multiplier === 1)
        return;
    usage.cost.input *= multiplier;
    usage.cost.output *= multiplier;
    usage.cost.cacheRead *= multiplier;
    usage.cost.cacheWrite *= multiplier;
    usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
//# sourceMappingURL=openai-responses.js.map