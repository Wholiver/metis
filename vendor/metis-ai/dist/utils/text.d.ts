import type { ImageContent, SystemMessage, TextContent, ThinkingContent, ToolCall } from "../types.ts";
type Content = TextContent | ImageContent | ThinkingContent | ToolCall;
/** Extract and join text from message content. */
export declare function contentText(content: string | readonly Content[], separator?: string): string;
/** Render a system message as a complete prompt: its content followed by its sections. */
export declare function getSystemMessageText(message: SystemMessage): string;
/**
 * Render a later system message for APIs that accept system messages mid-conversation.
 * Section changes are framed by name so the model can relate them to the leading prompt.
 * This framing is request-time only and may change between versions.
 */
export declare function renderSystemMessageUpdate(message: SystemMessage): string;
export {};
//# sourceMappingURL=text.d.ts.map