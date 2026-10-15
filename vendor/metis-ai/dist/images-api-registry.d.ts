import type { AssistantImages, ImageApi, ImageModel, ImagesContext, ImagesFunction, ImagesOptions } from "./types.ts";
export type ImagesApiFunction = (model: ImageModel<ImageApi>, context: ImagesContext, options?: ImagesOptions) => Promise<AssistantImages>;
export interface ImagesApiProvider<TApi extends ImageApi = ImageApi, TOptions extends ImagesOptions = ImagesOptions> {
    api: TApi;
    generateImages: ImagesFunction<TOptions>;
}
interface ImagesApiProviderInternal {
    api: ImageApi;
    generateImages: ImagesApiFunction;
}
export declare function registerImagesApiProvider<TApi extends ImageApi, TOptions extends ImagesOptions>(provider: ImagesApiProvider<TApi, TOptions>, sourceId?: string): void;
export declare function getImagesApiProvider(api: ImageApi): ImagesApiProviderInternal | undefined;
export {};
//# sourceMappingURL=images-api-registry.d.ts.map