import type { ClassifierApi, ClassifierModel, ClassifierOptions, Usage } from "../types.ts";
/** An HTTP failure in the shape `retryProviderRequest` and `normalizeProviderError` understand. */
export interface ClassifierHttpError extends Error {
    status: number | undefined;
    headers: Headers | undefined;
    body: string;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function requiredNumber(label: string, value: unknown, field: string): number;
/**
 * Posts one JSON classifier request with bearer auth, `onPayload`/`onResponse` hooks, a fresh
 * timeout per attempt, and provider retries. Returns the parsed response body; throws on failure.
 * `noRetryStatuses` lists HTTP statuses that fail at once although they are normally retried.
 */
export declare function postClassifierRequest(label: string, url: URL, model: ClassifierModel<ClassifierApi>, body: unknown, options: ClassifierOptions | undefined, noRetryStatuses?: readonly number[]): Promise<unknown>;
/**
 * Usage from a `{ input_tokens, output_tokens }` object, priced from the model catalog like chat
 * usage. A missing or malformed usage object leaves the result without usage instead of failing it.
 */
export declare function parseClassifierUsage(value: unknown, model: ClassifierModel<ClassifierApi>): Usage | undefined;
//# sourceMappingURL=classifier-shared.d.ts.map