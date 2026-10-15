import { CLASSIFIER_MODELS, IMAGE_MODELS, MODELS } from "../models.generated.ts";
import { type CreateModelsOptions, type MutableModels, type Provider } from "../models.ts";
import type { AnyModel, ClassifierModel, ImageModel, Model } from "../types.ts";
import { radiusProvider } from "./radius.ts";
export { radiusProvider };
/** Providers present in the generated catalog. `KnownProvider` additionally
 * includes purely dynamic providers (e.g. "radius") that have no static
 * catalog entry. */
export type BuiltinProvider = keyof typeof MODELS;
type BuiltinChatModelId<TProvider extends BuiltinProvider> = keyof (typeof MODELS)[TProvider];
type BuiltinImageModelId<TProvider extends BuiltinProvider> = keyof (typeof IMAGE_MODELS)[TProvider];
type BuiltinClassifierModelId<TProvider extends BuiltinProvider> = keyof (typeof CLASSIFIER_MODELS)[TProvider];
/** API ids of catalog entries. Built-in getters return `Model<Api>` shapes, not literal entry types. */
type CatalogApi<TEntry> = TEntry extends {
    api: infer TApi extends string;
} ? TApi : never;
/** Typed read of one generated built-in chat model. */
export declare function getBuiltinModel<TProvider extends BuiltinProvider, TModelId extends BuiltinChatModelId<TProvider>>(provider: TProvider, modelId: TModelId): Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>>;
/** Typed read of one generated built-in image model. */
export declare function getBuiltinImageModel<TProvider extends BuiltinProvider, TModelId extends BuiltinImageModelId<TProvider>>(provider: TProvider, modelId: TModelId): ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>>;
/** Typed read of one generated built-in classifier model. */
export declare function getBuiltinClassifierModel<TProvider extends BuiltinProvider, TModelId extends BuiltinClassifierModelId<TProvider>>(provider: TProvider, modelId: TModelId): ClassifierModel<CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>>;
export declare function getBuiltinProviders(): BuiltinProvider[];
/** Generation timestamp shared by all built-in provider catalogs. */
export declare function getBuiltinModelDataGeneratedAt(): number | undefined;
export declare function getBuiltinModels<TProvider extends BuiltinProvider>(provider: TProvider): Model<CatalogApi<(typeof MODELS)[TProvider][BuiltinChatModelId<TProvider>]>>[];
export declare function getBuiltinImageModels<TProvider extends BuiltinProvider>(provider: TProvider): ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][BuiltinImageModelId<TProvider>]>>[];
export declare function getBuiltinClassifierModels<TProvider extends BuiltinProvider>(provider: TProvider): ClassifierModel<CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][BuiltinClassifierModelId<TProvider>]>>[];
export declare function getAllBuiltinModels<TProvider extends BuiltinProvider>(provider: TProvider): AnyModel[];
/** All built-in providers, freshly constructed. */
export declare function builtinProviders(): Provider[];
/** A `Models` collection with every built-in provider registered. */
export declare function builtinModels(options?: CreateModelsOptions): MutableModels;
//# sourceMappingURL=all.d.ts.map