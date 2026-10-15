import "./providers/images/register-builtins.ts";
import type { AssistantImages, ImageApi, ImageModel, ImagesContext, ProviderImagesOptions } from "./types.ts";
/**
 * Global image generation dispatched on `model.api` through the images api
 * registry. Auth must be passed explicitly via `options.apiKey`; prefer
 * `Models.generateImages()`, which resolves provider auth.
 */
export declare function generateImages(model: ImageModel<ImageApi>, context: ImagesContext, options?: ProviderImagesOptions): Promise<AssistantImages>;
//# sourceMappingURL=images.d.ts.map