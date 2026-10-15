import { IMAGE_MODELS } from "./models.generated.ts";
import type { ImageApi, ImageModel } from "./types.ts";
/**
 * Compat reads of the generated catalog restricted to image models. New code
 * uses `Models.getModelOfType("image", ...)` or `getBuiltinImageModel()` from `providers/all`.
 */
type Catalog = typeof IMAGE_MODELS;
type ImageModelIds<TProvider extends keyof Catalog> = keyof Catalog[TProvider];
/** Built-in providers with at least one image model in the generated catalog. */
export type BuiltinImageProvider = {
    [TProvider in keyof Catalog]: [ImageModelIds<TProvider>] extends [never] ? never : TProvider;
}[keyof Catalog];
type BuiltinImageModel<TProvider extends BuiltinImageProvider, TModelId extends ImageModelIds<TProvider>> = Catalog[TProvider][TModelId] extends ImageModel<infer TApi extends ImageApi> ? ImageModel<TApi> : never;
/** @deprecated Static catalog read. Use `getBuiltinImageModel` from "@earendil-works/pi-ai/providers/all" or `Models.getModelOfType("image", ...)`. */
export declare function getImageModel<TProvider extends BuiltinImageProvider, TModelId extends ImageModelIds<TProvider>>(provider: TProvider, modelId: TModelId): BuiltinImageModel<TProvider, TModelId>;
/** @deprecated Static catalog read. Use `Models.getProviders()`. */
export declare function getImageProviders(): BuiltinImageProvider[];
/** @deprecated Static catalog read. Use `getBuiltinImageModels` from "@earendil-works/pi-ai/providers/all" or `Models.getModelsOfType("image")`. */
export declare function getImageModels<TProvider extends BuiltinImageProvider>(provider: TProvider): BuiltinImageModel<TProvider, ImageModelIds<TProvider>>[];
export {};
//# sourceMappingURL=image-models.d.ts.map