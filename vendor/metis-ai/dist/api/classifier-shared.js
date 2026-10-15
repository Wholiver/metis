import { calculateCost } from "../models.js";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.js";
import { retryProviderRequest } from "../utils/provider-retry.js";
function httpError(label, response, body) {
    const error = new Error(`${label} returned ${response.status}`);
    error.status = response.status;
    error.headers = response.headers;
    error.body = body;
    return error;
}
function timeoutError(timeoutMs) {
    const error = new Error(`Request timed out after ${timeoutMs}ms`);
    error.name = "TimeoutError";
    error.status = undefined;
    error.headers = undefined;
    error.body = "";
    return error;
}
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function requiredNumber(label, value, field) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${label} returned an invalid ${field}`);
    }
    return value;
}
function requestHeaders(model, apiKey, optionsHeaders) {
    return (providerHeadersToRecord({ authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, model.headers, optionsHeaders) ?? {});
}
/**
 * Posts one JSON classifier request with bearer auth, `onPayload`/`onResponse` hooks, a fresh
 * timeout per attempt, and provider retries. Returns the parsed response body; throws on failure.
 * `noRetryStatuses` lists HTTP statuses that fail at once although they are normally retried.
 */
export async function postClassifierRequest(label, url, model, body, options, noRetryStatuses) {
    if (!options?.apiKey)
        throw new Error(`No API key for provider: ${model.provider}`);
    const apiKey = options.apiKey;
    let payload = body;
    const transformed = await options.onPayload?.(payload, model);
    if (transformed !== undefined)
        payload = transformed;
    const requestFetch = options.fetch ?? globalThis.fetch;
    const { response, json } = await retryProviderRequest(async () => {
        const timeoutSignal = options.timeoutMs !== undefined ? AbortSignal.timeout(options.timeoutMs) : undefined;
        const signal = options.signal && timeoutSignal
            ? AbortSignal.any([options.signal, timeoutSignal])
            : (options.signal ?? timeoutSignal);
        try {
            const next = await requestFetch(url, {
                method: "POST",
                headers: requestHeaders(model, apiKey, options.headers),
                body: JSON.stringify(payload),
                signal,
            });
            if (!next.ok)
                throw httpError(label, next, await next.text());
            return { response: next, json: (await next.json()) };
        }
        catch (error) {
            if (timeoutSignal?.aborted && !options.signal?.aborted)
                throw timeoutError(options.timeoutMs);
            throw error;
        }
    }, {
        maxRetries: options.maxRetries ?? 2,
        maxRetryDelayMs: options.maxRetryDelayMs,
        signal: options.signal,
        noRetryStatuses,
    });
    await options.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
    return json;
}
function tokenCount(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
/**
 * Usage from a `{ input_tokens, output_tokens }` object, priced from the model catalog like chat
 * usage. A missing or malformed usage object leaves the result without usage instead of failing it.
 */
export function parseClassifierUsage(value, model) {
    if (!isRecord(value) || (value.input_tokens === undefined && value.output_tokens === undefined))
        return undefined;
    const input = tokenCount(value.input_tokens);
    const output = tokenCount(value.output_tokens);
    const usage = {
        input,
        output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input + output,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    calculateCost(model, usage);
    return usage;
}
//# sourceMappingURL=classifier-shared.js.map