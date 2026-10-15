import { contentText, getSystemMessageText } from "./text.js";
/**
 * Build the leading system message for a prompt and tool set. Returns undefined when
 * both are empty, so an empty transcript stays empty.
 */
export function createInitialSystemMessage(systemPrompt, tools) {
    const hasSystemPrompt = systemPrompt !== undefined && systemPrompt.length > 0;
    const hasTools = tools !== undefined && tools.length > 0;
    if (!hasSystemPrompt && !hasTools)
        return undefined;
    return {
        role: "system",
        content: systemPrompt ?? "",
        ...(hasTools ? { toolsAdded: tools } : {}),
        timestamp: 0,
    };
}
/**
 * Fold `Context.systemPrompt` and `Context.tools` into a leading system message.
 * This is the only entry point that produces a {@link TranscriptContext}; every
 * provider-facing function expects the result.
 */
export function normalizeContext(context) {
    const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
    const messages = initialMessage ? [initialMessage, ...context.messages] : context.messages;
    const initialSystemPrompt = initialMessage && isSystemMessage(initialMessage)
        ? (typeof initialMessage.content === "string" ? initialMessage.content : undefined)
        : undefined;
    return { ...context, messages, systemPrompt: context.systemPrompt ?? initialSystemPrompt };
}
function isSystemMessage(message) {
    return message.role === "system";
}
/** Return the leading system message, if the transcript starts with one. */
export function getInitialSystemMessage(messages) {
    const first = messages[0];
    return first && isSystemMessage(first) ? first : undefined;
}
/** Drop the leading system message for APIs that carry the prompt outside the message list. */
export function withoutInitialSystemMessage(messages) {
    return getInitialSystemMessage(messages) ? messages.slice(1) : messages;
}
/** Resolve the tools available after applying every transcript delta in order. */
export function getCurrentTools(messages) {
    const tools = new Map();
    for (const message of messages) {
        if (!isSystemMessage(message))
            continue;
        for (const tool of message.toolsRemoved ?? [])
            tools.delete(tool.name);
        for (const tool of message.toolsAdded ?? [])
            tools.set(tool.name, tool);
    }
    return [...tools.values()];
}
/**
 * Replay every system message into one leading system message holding the current
 * prompt and tools. Later `content` is appended to the base prompt, `sections` are
 * patched by name, and tools are resolved with {@link getCurrentTools}.
 */
export function getCurrentSystemMessage(messages) {
    const content = [];
    const sections = new Map();
    let timestamp;
    for (const message of messages) {
        if (!isSystemMessage(message))
            continue;
        timestamp ??= message.timestamp;
        const text = contentText(message.content);
        if (text.length > 0)
            content.push(text);
        for (const [name, value] of Object.entries(message.sections ?? {})) {
            if (value === null)
                sections.delete(name);
            else
                sections.set(name, value);
        }
    }
    const tools = getCurrentTools(messages);
    if (timestamp === undefined && tools.length === 0)
        return undefined;
    return {
        role: "system",
        content: content.join("\n\n"),
        ...(sections.size > 0 ? { sections: Object.fromEntries(sections) } : {}),
        ...(tools.length > 0 ? { toolsAdded: tools } : {}),
        timestamp: timestamp ?? 0,
    };
}
/** Render the current system prompt text after replaying every system message. */
export function getCurrentSystemPrompt(messages) {
    const message = getCurrentSystemMessage(messages);
    return message ? getSystemMessageText(message) : "";
}
/**
 * Rebuild the transcript for APIs without mid-conversation system messages: the replayed
 * system message leads, and every later system message is dropped.
 */
export function collapseSystemMessages(context) {
    const head = getCurrentSystemMessage(context.messages);
    const messages = context.messages.filter((message) => message.role !== "system");
    return { messages: head ? [head, ...messages] : messages };
}
/** Keep later system messages in place when the model accepts them; otherwise collapse them. */
export function resolveTranscript(context, supportsMidConvoSystemMessages) {
    return supportsMidConvoSystemMessages ? context : collapseSystemMessages(context);
}
/** Strip executable and display-only fields from a tool before transcript comparison or persistence. */
export function toToolDeclaration(tool) {
    return {
        name: tool.name,
        description: tool.description,
        parameters: JSON.parse(JSON.stringify(tool.parameters)),
        ...(tool.constrainedSampling === undefined ? {} : { constrainedSampling: tool.constrainedSampling }),
    };
}
/**
 * Whether two tools declare the same interface to the model.
 *
 * Both sides go through {@link toToolDeclaration} first: its JSON round-trip drops the
 * typebox symbol keys and `undefined` fields that a structural comparison would see, and
 * builds both objects with the same key order, so comparing the serialized declarations
 * is exact. This avoids a deep-equal dependency in a browser-safe package.
 */
export function declarationsEqual(left, right) {
    return JSON.stringify(toToolDeclaration(left)) === JSON.stringify(toToolDeclaration(right));
}
/** Compare two complete tool states. A changed definition is a removal followed by an addition. */
export function getToolStateChanges(previous, current) {
    const previousTools = new Map(previous.map((tool) => [tool.name, tool]));
    const currentTools = new Map(current.map((tool) => [tool.name, tool]));
    return {
        toolsAdded: current
            .filter((tool) => {
            const previousTool = previousTools.get(tool.name);
            return previousTool === undefined || !declarationsEqual(previousTool, tool);
        })
            .map(toToolDeclaration),
        toolsRemoved: previous
            .filter((tool) => {
            const currentTool = currentTools.get(tool.name);
            return currentTool === undefined || !declarationsEqual(tool, currentTool);
        })
            .map((tool) => ({ name: tool.name })),
    };
}
/** Every definition referenced by transcript tool state, in first-declaration order. */
export function getDeclaredTools(messages) {
    const definitions = new Map();
    for (const message of messages) {
        if (!isSystemMessage(message))
            continue;
        for (const tool of message.toolsAdded ?? [])
            definitions.set(tool.name, tool);
    }
    return [...definitions.values()];
}
/**
 * Whether a tool name was declared twice with different definitions. A transport that can
 * only reference previously declared tools by name cannot replay such a history.
 *
 * @deprecated No built-in transport needs this anymore: Anthropic expresses redefinitions with
 * inline `tool_definition` blocks. Kept for API compatibility and will be removed in a future release.
 */
export function hasToolRedefinitions(messages) {
    const declared = new Map();
    for (const message of messages) {
        if (!isSystemMessage(message))
            continue;
        for (const tool of message.toolsAdded ?? []) {
            const previous = declared.get(tool.name);
            if (previous !== undefined && !declarationsEqual(previous, tool))
                return true;
            declared.set(tool.name, tool);
        }
    }
    return false;
}
/** Whether tool history contains a removal or same-name redeclaration that an addition-only transport cannot replay. */
export function hasNonAdditiveToolChanges(messages) {
    const declared = new Set();
    for (const message of messages) {
        if (!isSystemMessage(message))
            continue;
        if ((message.toolsRemoved?.length ?? 0) > 0)
            return true;
        for (const tool of message.toolsAdded ?? []) {
            if (declared.has(tool.name))
                return true;
            declared.add(tool.name);
        }
    }
    return false;
}
/**
 * Split tool declarations between the top-level request field and in-place additions.
 * Transports that can anchor additions at a system message keep the initial tools at the
 * top and load later ones where they appear; that only works when no tool was removed or
 * redeclared, so everything else sends the current tool list.
 */
export function resolveTranscriptTools(messages, supportsToolAdditions) {
    const anchorsAdditions = supportsToolAdditions && !hasNonAdditiveToolChanges(messages);
    return {
        requestTools: anchorsAdditions
            ? (getInitialSystemMessage(messages)?.toolsAdded ?? [])
            : getCurrentTools(messages),
        anchorsAdditions,
    };
}
//# sourceMappingURL=transcript.js.map