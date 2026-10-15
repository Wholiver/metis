import type { Tool as OpenAITool, ResponseCreateParamsStreaming, ResponseInput, ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { Api, AssistantMessage, Model, StreamOptions, Tool, TranscriptContext, Usage } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
export interface OpenAIResponsesStreamOptions {
    onProviderStreamEvent?: StreamOptions["onProviderStreamEvent"];
    serviceTier?: ResponseCreateParamsStreaming["service_tier"];
    grammarToolInputProperties?: ReadonlyMap<string, string>;
    resolveServiceTier?: (responseServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined, requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined) => ResponseCreateParamsStreaming["service_tier"] | undefined;
    applyServiceTierPricing?: (usage: Usage, serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined) => void;
}
export interface ConvertResponsesMessagesOptions {
    includeSystemPrompt?: boolean;
    grammarToolInputProperties?: ReadonlyMap<string, string>;
    /** Whether later system messages are sent in place; otherwise they are folded into the leading prompt. */
    supportsMidConvoSystemMessages?: boolean;
    supportsAdditionalTools?: boolean;
    supportsToolSearch?: boolean;
    toolOptions?: ConvertResponsesToolsOptions;
}
export interface ConvertResponsesToolsOptions {
    strict?: boolean | null;
    supportsStrictMode?: boolean;
    supportsOpenAIGrammarTools?: boolean;
    toolSearchResult?: boolean;
}
export declare function convertResponsesMessages<TApi extends Api>(model: Model<TApi>, context: TranscriptContext, allowedToolCallProviders: ReadonlySet<string>, options?: ConvertResponsesMessagesOptions): ResponseInput;
export declare function convertResponsesTools(tools: readonly Tool[], options?: ConvertResponsesToolsOptions): OpenAITool[];
export declare function processResponsesStream<TApi extends Api>(openaiStream: AsyncIterable<ResponseStreamEvent>, output: AssistantMessage, stream: AssistantMessageEventStream, model: Model<TApi>, options?: OpenAIResponsesStreamOptions): Promise<void>;
//# sourceMappingURL=openai-responses-shared.d.ts.map