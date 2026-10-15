import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { SimpleStreamOptions, StreamFunction } from "../types.ts";
import { type AzureEndpointOptions } from "./azure-openai-config.ts";
export interface AzureOpenAIResponsesOptions extends AzureEndpointOptions {
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    toolChoice?: ResponseCreateParamsStreaming["tool_choice"];
    reasoningSummary?: "auto" | "detailed" | "concise" | null;
}
/**
 * Generate function for Azure OpenAI Responses API
 */
export declare const stream: StreamFunction<"azure-openai-responses", AzureOpenAIResponsesOptions>;
export declare const streamSimple: StreamFunction<"azure-openai-responses", SimpleStreamOptions>;
//# sourceMappingURL=azure-openai-responses.d.ts.map