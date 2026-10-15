import { AzureOpenAI } from "openai";
import { clampThinkingLevel } from "../models.js";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { headersToRecord } from "../utils/headers.js";
import { getPiUserAgent } from "../utils/pi-user-agent.js";
import { retryProviderRequest } from "../utils/provider-retry.js";
import { getDeclaredTools, resolveTranscript, resolveTranscriptTools } from "../utils/transcript.js";
import { resolveAzureConfig, resolveDeploymentName } from "./azure-openai-config.js";
import { createGrammarToolInputProperties } from "./constrained-sampling.js";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.js";
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from "./openai-responses-shared.js";
import { buildBaseOptions, resolveSamplingParams } from "./simple-options.js";
const AZURE_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode", "azure"]);
// OpenAI Responses rejects max_output_tokens below 16: https://github.com/earendil-works/pi/issues/6265
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
function formatAzureOpenAIError(error) {
    return formatProviderError(normalizeProviderError(error), "Azure OpenAI API error");
}
/**
 * Generate function for Azure OpenAI Responses API
 */
export const stream = (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    const normalizedContext = resolveTranscript(context, model.compat?.supportsMidConvoSystemMessages);
    // Start async processing
    (async () => {
        const deploymentName = resolveDeploymentName(model, options);
        const output = {
            role: "assistant",
            content: [],
            api: "azure-openai-responses",
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
            // Create Azure OpenAI client
            const apiKey = options?.apiKey;
            if (!apiKey) {
                throw new Error(`No API key for provider: ${model.provider}`);
            }
            const client = createClient(model, apiKey, options);
            const grammarToolInputProperties = createGrammarToolInputProperties(getDeclaredTools(normalizedContext.messages), model.compat?.supportsOpenAIGrammarTools ?? false);
            let params = buildParams(model, normalizedContext, options, deploymentName, grammarToolInputProperties);
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
                grammarToolInputProperties,
            });
            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }
            if (output.stopReason === "pending") {
                throw new Error("Azure OpenAI Responses stream ended without a stop reason");
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
            output.errorMessage = formatAzureOpenAIError(error);
            stream.push({ type: "error", reason: output.stopReason, error: output });
            stream.end();
        }
    })();
    return stream;
};
export const streamSimple = (model, context, options) => {
    const apiKey = options?.apiKey;
    if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`);
    }
    const base = {
        ...buildBaseOptions(model, context, options, apiKey),
        toolChoice: options?.toolChoice,
    };
    const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
    const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;
    return stream(model, context, {
        ...base,
        reasoningEffort,
    });
};
function createClient(model, apiKey, options) {
    const headers = { "User-Agent": getPiUserAgent(), ...model.headers };
    if (options?.headers) {
        Object.assign(headers, options.headers);
    }
    const { baseUrl, apiVersion } = resolveAzureConfig(model, options);
    return new AzureOpenAI({
        apiKey,
        apiVersion,
        dangerouslyAllowBrowser: true,
        fetch: options?.fetch,
        defaultHeaders: headers,
        baseURL: baseUrl,
    });
}
function buildParams(model, context, options, deploymentName, grammarToolInputProperties = createGrammarToolInputProperties(getDeclaredTools(context.messages), model.compat?.supportsOpenAIGrammarTools ?? false)) {
    const supportsAdditionalTools = model.compat?.supportsAdditionalTools ?? false;
    const supportsToolSearch = model.compat?.supportsToolSearch ?? false;
    const transcriptTools = resolveTranscriptTools(context.messages, supportsAdditionalTools || supportsToolSearch);
    const messages = convertResponsesMessages(model, context, AZURE_TOOL_CALL_PROVIDERS, {
        grammarToolInputProperties,
        supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
        supportsAdditionalTools,
        supportsToolSearch,
        toolOptions: {
            supportsStrictMode: model.compat?.supportsStrictMode ?? true,
            supportsOpenAIGrammarTools: model.compat?.supportsOpenAIGrammarTools ?? false,
        },
    });
    const params = {
        model: deploymentName,
        input: messages,
        stream: true,
        prompt_cache_key: clampOpenAIPromptCacheKey(options?.sessionId),
        store: false,
    };
    if (options?.maxTokens) {
        params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
    }
    if (options?.temperature !== undefined) {
        params.temperature = options?.temperature;
    }
    if (transcriptTools.requestTools.length > 0) {
        params.tools = convertResponsesTools(transcriptTools.requestTools, {
            supportsStrictMode: model.compat?.supportsStrictMode ?? true,
            supportsOpenAIGrammarTools: model.compat?.supportsOpenAIGrammarTools ?? false,
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
        else if (model.thinkingLevelMap?.off !== null) {
            params.reasoning = {
                effort: (model.thinkingLevelMap?.off ?? "none"),
            };
        }
    }
    // Last so model and request sampling parameters override named request fields.
    const samplingParams = resolveSamplingParams(model, reasoningEffort ?? "off", options?.samplingParams);
    if (samplingParams) {
        Object.assign(params, samplingParams);
    }
    return params;
}
//# sourceMappingURL=azure-openai-responses.js.map