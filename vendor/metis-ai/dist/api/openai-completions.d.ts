import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { Model, OpenAICompletionsCompat, SimpleStreamOptions, StreamFunction, StreamOptions, ThinkingBudgets } from "../types.ts";
import { type TranscriptContext } from "../utils/transcript.ts";
export interface OpenAICompletionsOptions extends StreamOptions {
    toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    /** Token budgets per thinking level. Used when `compat.thinkingTokenBudgetField` or `compat.supportsThinkingTokenBudget` is set, or by `{ "$var": "thinking.budget" }`. */
    thinkingBudgets?: ThinkingBudgets;
}
export interface ConvertCompletionsMessagesOptions {
    grammarToolInputProperties?: ReadonlyMap<string, string>;
}
type ResolvedOpenAICompletionsCompat = Omit<Required<OpenAICompletionsCompat>, "cacheControlFormat" | "supportsThinkingTokenBudget" | "thinkingTokenBudgetField" | "supportsMidConvoSystemMessages" | "supportsMidConvoToolAdditions" | "vllmPriority"> & {
    cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
    supportsThinkingTokenBudget?: OpenAICompletionsCompat["supportsThinkingTokenBudget"];
    thinkingTokenBudgetField?: OpenAICompletionsCompat["thinkingTokenBudgetField"];
    supportsMidConvoSystemMessages?: OpenAICompletionsCompat["supportsMidConvoSystemMessages"];
    supportsMidConvoToolAdditions?: OpenAICompletionsCompat["supportsMidConvoToolAdditions"];
    vllmPriority?: OpenAICompletionsCompat["vllmPriority"];
};
export declare const stream: StreamFunction<"openai-completions", OpenAICompletionsOptions>;
export declare const streamSimple: StreamFunction<"openai-completions", SimpleStreamOptions>;
export declare function convertMessages(model: Model<"openai-completions">, context: TranscriptContext, compat: ResolvedOpenAICompletionsCompat, options?: ConvertCompletionsMessagesOptions): ChatCompletionMessageParam[];
export {};
//# sourceMappingURL=openai-completions.d.ts.map