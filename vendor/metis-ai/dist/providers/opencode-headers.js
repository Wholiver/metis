const OPENCODE_SESSION_HEADER = "x-opencode-session";
function hasHeader(headers, name) {
    const expected = name.toLowerCase();
    return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected);
}
function withSessionHeader(options) {
    if (!options?.sessionId || hasHeader(options.headers, OPENCODE_SESSION_HEADER))
        return options;
    return {
        ...options,
        headers: { ...options.headers, [OPENCODE_SESSION_HEADER]: options.sessionId },
    };
}
/** Adds OpenCode's required per-conversation routing header before API dispatch. */
export function withOpenCodeSessionHeader(streams) {
    return {
        ...streams,
        stream: (model, context, options) => streams.stream(model, context, withSessionHeader(options)),
        streamSimple: (model, context, options) => streams.streamSimple(model, context, withSessionHeader(options)),
    };
}
//# sourceMappingURL=opencode-headers.js.map