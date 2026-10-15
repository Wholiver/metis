function buildProviderErrorPattern(patterns) {
    return new RegExp(patterns.join("|"), "i");
}
const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
    // OpenCode Go/free-tier limits returned as 429 JSON error types by OpenCode's
    // Zen API. These are subscription/account limits, not transient throttles.
    "GoUsageLimitError",
    "FreeUsageLimitError",
    // OpenCode Go subscription-limit text asks users to enable available-balance
    // usage after rolling/weekly/monthly limits are reached.
    "Monthly usage limit reached",
    "available balance",
    // Generic quota/budget/billing exhaustion. `insufficient_quota` is OpenAI's
    // quota/billing error code; the other strings cover common gateway wording.
    "insufficient_quota",
    "out of budget",
    "quota exceeded",
    "billing",
    // Sign in with ChatGPT: the subscription's shared usage limit, which resets
    // after hours rather than seconds.
    "subscription_sharing_usage_limit_exceeded",
]);
const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
    // Generic provider load, HTTP status, and server-side transient failures.
    "overloaded",
    "server_busy",
    "servers are currently busy",
    "currently experiencing high demand",
    "model is at capacity",
    "rate.?limit",
    "too many requests",
    "429",
    "500",
    "502",
    "503",
    "504",
    "520",
    "524",
    "service.?unavailable",
    "server.?error",
    "internal.?error",
    // Wrapper/provider text for transient upstream failures, including OpenRouter
    // "Provider returned error" responses (#2264) and gateway wording such as
    // "The upstream provider returned an error" (#10842).
    "provider.?returned.?(?:an.?)?error",
    "exceeded request buffer limit while retrying upstream",
    // Network, proxy, and fetch transport failures. This includes OpenAI Codex
    // raw-fetch failures such as "upstream connect", "connection refused", and
    // "reset before headers" (#733), plus OpenRouter connection drops (#3317).
    "network.?error",
    "connection.?error",
    "connection.?refused",
    "connection.?lost",
    "other side closed",
    "fetch failed",
    "getaddrinfo",
    "ENOTFOUND",
    "EAI_AGAIN",
    "upstream.?connect",
    "reset before headers",
    "socket hang up",
    "socket connection was closed",
    "timed? out",
    "timeout",
    "terminated",
    // WebSocket transports can report close/error text instead of HTTP/fetch text.
    "websocket.?closed",
    "websocket.?error",
    // Premature stream endings from SDKs and transports. Anthropic can throw
    // "stream ended without ..." and "Anthropic stream ended before message_stop"
    // (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
    "ended without",
    "stream ended before message_stop",
    "stream ended before a terminal response event",
    "http2 request did not get a response",
    // Node ERR_HTTP2_STREAM_CANCEL: the HTTP/2 session died before the request was
    // sent, e.g. after the Bedrock SDK's 5-minute session timeout (#10379).
    "pending stream has been canceled",
    // Provider-requested retry delay cap failures should flow through the outer
    // retry policy so callers can surface/abort the backoff (#1123).
    "retry delay",
    // Explicit retry guidance emitted mid-stream by OpenAI Responses and Bedrock
    // stream exceptions (#6019).
    "you can retry your request",
    "try your request again",
    "please retry your request",
    // gRPC based providers (e.g. NVIDIA NIM)
    "ResourceExhausted",
    // Sign in with ChatGPT: usage or user data temporarily unavailable. Usage
    // failures can arrive mid-stream without an HTTP 503 in the message.
    "subscription_sharing_usage_unavailable",
    "subscription_sharing_user_unavailable",
]);
export const DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000;
export function retryDelayMs(policy, attempt) {
    const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
    const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
    return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);
}
class RetrySleepAbortError extends Error {
    constructor() {
        super("Aborted");
    }
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new RetrySleepAbortError());
            return;
        }
        const timeout = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new RetrySleepAbortError());
        }, { once: true });
    });
}
/**
 * Run a single assistant-producing call with bounded retry on transient errors.
 *
 * Behavior:
 * - A successful response is returned immediately. Aborts are terminal and never
 *   retried, but reported as unsuccessful if they happen after a retry was scheduled.
 *   Aborts during the backoff sleep are normalized to an aborted `AssistantMessage`
 *   too, so callers do not need to care when cancellation happened.
 * - A non-retryable error (per {@link isRetryableAssistantError}, including quota/
 *   billing exhaustion) is returned immediately so deterministic errors fail fast.
 * - Otherwise retries up to `maxRetries` times with exponential backoff, emitting
 *   `onRetryScheduled` before each sleep, `onRetryAttemptStart` after each sleep before
 *   the retried call starts, and `onRetryFinished` once at the end (whether the loop
 *   ends in success, exhausted retries, or an aborted backoff).
 *
 * When `policy` is undefined or disabled, the first response is returned unchanged
 * (equivalent to calling `produce()` directly).
 */
export async function retryAssistantCall(produce, policy, signal, callbacks) {
    const maxAttempts = policy?.enabled ? policy.maxRetries : 0;
    let attempt = 0;
    let lastRetry;
    for (;;) {
        const response = await produce();
        // Abort: terminal but not successful. Never retry an aborted message.
        if (response.stopReason === "aborted") {
            if (lastRetry)
                await callbacks?.onRetryFinished?.(false, lastRetry.attempt);
            return response;
        }
        // Success: non-error, non-abort responses return as-is.
        if (response.stopReason !== "error") {
            if (lastRetry)
                await callbacks?.onRetryFinished?.(true, lastRetry.attempt);
            return response;
        }
        // Non-retryable, or budget exhausted: return the final error message.
        if (attempt >= maxAttempts || !isRetryableAssistantError(response)) {
            if (lastRetry)
                await callbacks?.onRetryFinished?.(false, lastRetry.attempt, response.errorMessage);
            return response;
        }
        attempt++;
        lastRetry = { attempt, errorMessage: response.errorMessage || "Unknown error" };
        const delayMs = retryDelayMs(policy, attempt);
        await callbacks?.onRetryScheduled?.(attempt, maxAttempts, delayMs, lastRetry.errorMessage);
        // Normalize aborts during retry backoff to the same AssistantMessage shape as
        // provider stream aborts, so callers do not need to care when cancellation happened.
        try {
            await sleep(delayMs, signal);
        }
        catch (error) {
            await callbacks?.onRetryFinished?.(false, attempt, lastRetry.errorMessage);
            if (error instanceof RetrySleepAbortError) {
                const { errorMessage: _errorMessage, ...rest } = response;
                return { ...rest, stopReason: "aborted" };
            }
            throw error;
        }
        await callbacks?.onRetryAttemptStart?.();
    }
}
/**
 * Classifies whether a failed assistant message looks like a transient provider
 * or transport error, so callers can decide if the last assistant turn should be
 * restarted.
 *
 * This does not implement retry policy. Callers should first handle context
 * overflow separately, then apply their own retry budget, backoff, and reporting
 * before restarting the assistant turn.
 */
export function isRetryableAssistantError(message) {
    if (message.stopReason !== "error" || !message.errorMessage)
        return false;
    const errorMessage = message.errorMessage;
    if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage))
        return false;
    return RETRYABLE_PROVIDER_ERROR_PATTERN.test(errorMessage);
}
//# sourceMappingURL=retry.js.map