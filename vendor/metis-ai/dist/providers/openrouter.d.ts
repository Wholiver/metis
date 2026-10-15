import { type Provider, type RefreshModelsContext } from "../models.ts";
import type { AnyModel } from "../types.ts";
/**
 * Restrict an OpenRouter catalog to the chat models the key may use, with the key's limits and
 * prices from `GET /models/user`. Image and classifier models are returned unchanged. A missing
 * limit keeps the catalog value. The request uses the provider's configured base URL, so regional
 * endpoints such as `https://us.openrouter.ai/api/v1` apply their region's filtering. When the
 * endpoint rejects the key (401/403) or does not exist (404), for example with a proxy configured
 * in models.json, the catalog is returned unchanged.
 */
export declare function personalizeOpenRouterCatalog(catalog: readonly AnyModel[], context: RefreshModelsContext): Promise<readonly AnyModel[]>;
export declare function openrouterProvider(): Provider<"anthropic-messages" | "openai-completions">;
//# sourceMappingURL=openrouter.d.ts.map