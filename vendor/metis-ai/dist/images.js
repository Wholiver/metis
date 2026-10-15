import "./providers/images/register-builtins.js";
import { getImagesApiProvider } from "./images-api-registry.js";
function resolveImagesApiProvider(api) {
    const provider = getImagesApiProvider(api);
    if (!provider) {
        throw new Error(`No API provider registered for api: ${api}`);
    }
    return provider;
}
/**
 * Global image generation dispatched on `model.api` through the images api
 * registry. Auth must be passed explicitly via `options.apiKey`; prefer
 * `Models.generateImages()`, which resolves provider auth.
 */
export async function generateImages(model, context, options) {
    const provider = resolveImagesApiProvider(model.api);
    return provider.generateImages(model, context, options);
}
//# sourceMappingURL=images.js.map