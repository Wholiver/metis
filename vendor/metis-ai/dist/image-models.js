import { IMAGE_MODELS } from "./models.generated.js";
const imageModelsByProvider = new Map();
for (const [provider, models] of Object.entries(IMAGE_MODELS)) {
    const imageModels = new Map();
    for (const model of Object.values(models)) {
        imageModels.set(model.id, model);
    }
    if (imageModels.size > 0)
        imageModelsByProvider.set(provider, imageModels);
}
/** @deprecated Static catalog read. Use `getBuiltinImageModel` from "@earendil-works/pi-ai/providers/all" or `Models.getModelOfType("image", ...)`. */
export function getImageModel(provider, modelId) {
    return imageModelsByProvider.get(provider)?.get(modelId);
}
/** @deprecated Static catalog read. Use `Models.getProviders()`. */
export function getImageProviders() {
    return Array.from(imageModelsByProvider.keys());
}
/** @deprecated Static catalog read. Use `getBuiltinImageModels` from "@earendil-works/pi-ai/providers/all" or `Models.getModelsOfType("image")`. */
export function getImageModels(provider) {
    const models = imageModelsByProvider.get(provider);
    return models ? Array.from(models.values()) : [];
}
//# sourceMappingURL=image-models.js.map