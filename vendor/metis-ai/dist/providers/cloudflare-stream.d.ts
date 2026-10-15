import type { ProviderClassifier, ProviderEnv, ProviderStreams } from "../types.ts";
export declare function resolveCloudflareModel<TModel extends {
    baseUrl: string;
}>(model: TModel, env: ProviderEnv | undefined): TModel;
/**
 * Wrap an API implementation so Cloudflare account/gateway endpoint
 * placeholders materialize from the resolved provider env before dispatch.
 */
export declare function cloudflareStreams(streams: ProviderStreams): ProviderStreams;
/** Classifier counterpart of {@link cloudflareStreams}. */
export declare function cloudflareClassifier(classifier: ProviderClassifier): ProviderClassifier;
//# sourceMappingURL=cloudflare-stream.d.ts.map