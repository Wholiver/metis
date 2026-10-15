import { isRecord } from "./classifier-shared.js";
import { classifySystemOne } from "./system-one-shared.js";
/**
 * TypeSafe's native System One protocol. OpenRouter serves the same protocol,
 * so both providers use this API with different base URLs.
 */
const transport = {
    api: "typesafe-system-one",
    label: "System One API",
    url: (model) => new URL("systemone", `${model.baseUrl.replace(/\/+$/u, "")}/`),
    payload: (model, request) => ({ model: model.id, ...request }),
    output: (body) => {
        if (!isRecord(body))
            throw new Error("System One API returned an unexpected response");
        return body;
    },
};
/** TypeSafe System One classification with public `bool` values mapped to wire-level `noul`. */
export const classify = (model, context, options) => classifySystemOne(transport, model, context, options);
//# sourceMappingURL=typesafe-system-one.js.map