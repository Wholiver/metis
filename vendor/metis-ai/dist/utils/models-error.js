import { formatThrownValue } from "./diagnostics.js";
export class ModelsError extends Error {
    code;
    constructor(code, message, options) {
        super(withCauseDetail(message, options?.cause), options);
        this.name = "ModelsError";
        this.code = code;
    }
}
/** Callers surface `error.message` only, so keep the underlying reason in it. */
function withCauseDetail(message, cause) {
    if (cause === undefined || cause === null)
        return message;
    const detail = formatThrownValue(cause).trim();
    if (!detail || message.includes(detail))
        return message;
    return `${message}: ${detail}`;
}
//# sourceMappingURL=models-error.js.map