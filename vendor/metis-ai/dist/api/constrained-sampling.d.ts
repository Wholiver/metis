import type { Tool } from "../types.ts";
/** Returns true when a provider's strict mode rejects this schema keyword with this value. */
export type UnsupportedStrictSchemaKeywordCheck = (key: string, value: unknown) => boolean;
/** Convert a tool schema to the strict subset expected by provider constrained sampling. */
export declare function makeStrictJsonSchema(schema: Tool["parameters"], isUnsupportedKeyword?: UnsupportedStrictSchemaKeywordCheck): Record<string, unknown>;
export declare function getJsonSchemaToolParameters(tool: Tool, strict: boolean | undefined): Tool["parameters"];
export interface GrammarConstrainedSampling {
    format: "lark" | "regex";
    definition: string;
    inputProperty: string;
}
export interface GrammarToolInputJsonBuffer {
    input: string;
    started: boolean;
    closed: boolean;
}
export declare function getGrammarToolInput(toolName: string, arguments_: Record<string, unknown>, inputProperty: string): string;
export declare function appendGrammarToolInputJsonDelta(buffer: GrammarToolInputJsonBuffer, inputProperty: string, nextInput: string, close: boolean): string | undefined;
/**
 * Decide whether a JSON-schema tool is sent in strict mode. `isUnsupportedKeyword` lets a provider
 * reject extra keywords its strict mode does not accept, so "prefer" tools fall back to non-strict.
 */
export declare function resolveJsonSchemaStrictSampling(tool: Tool, supportsStrictMode: boolean, isUnsupportedKeyword?: UnsupportedStrictSchemaKeywordCheck): boolean | undefined;
export declare function resolveGrammarConstrainedSampling(tool: Tool, supportsOpenAIGrammarTools: boolean): GrammarConstrainedSampling | undefined;
export declare function createGrammarToolInputProperties(tools: Tool[] | undefined, supportsOpenAIGrammarTools: boolean): ReadonlyMap<string, string>;
//# sourceMappingURL=constrained-sampling.d.ts.map