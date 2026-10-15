import { typesafeSystemOneApi } from "../api/typesafe-system-one.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { createProvider } from "../models.js";
import { TYPESAFE_CLASSIFIER_MODELS } from "./typesafe.models.js";
export function typesafeProvider() {
    return createProvider({
        id: "typesafe",
        name: "TypeSafe",
        auth: {
            apiKey: envApiKeyAuth("TypeSafe API key", ["TYPESAFE_API_KEY"]),
        },
        models: Object.values(TYPESAFE_CLASSIFIER_MODELS),
        classifiers: {
            "typesafe-system-one": typesafeSystemOneApi(),
        },
    });
}
//# sourceMappingURL=typesafe.js.map