/** Extract and join text from message content. */
export function contentText(content, separator = "\n") {
    if (typeof content === "string")
        return content;
    return content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(separator);
}
/** Render a system message as a complete prompt: its content followed by its sections. */
export function getSystemMessageText(message) {
    const parts = [contentText(message.content)];
    for (const text of Object.values(message.sections ?? {})) {
        if (text !== null)
            parts.push(text);
    }
    return parts.filter((part) => part.length > 0).join("\n\n");
}
/**
 * Render a later system message for APIs that accept system messages mid-conversation.
 * Section changes are framed by name so the model can relate them to the leading prompt.
 * This framing is request-time only and may change between versions.
 */
export function renderSystemMessageUpdate(message) {
    const parts = [];
    const text = contentText(message.content);
    if (text.length > 0)
        parts.push(text);
    for (const [name, value] of Object.entries(message.sections ?? {})) {
        parts.push(value === null
            ? `Removed system prompt section "${name}".`
            : `Updated system prompt section "${name}":\n\n${value}`);
    }
    return parts.join("\n\n");
}
//# sourceMappingURL=text.js.map