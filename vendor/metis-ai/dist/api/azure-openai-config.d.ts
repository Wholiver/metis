import type { Api, Model, StreamOptions } from "../types.ts";
/** Azure models ship without a baseUrl: one resource per user, resolved per request. */
export interface AzureEndpointOptions extends StreamOptions {
    azureApiVersion?: string;
    azureResourceName?: string;
    azureBaseUrl?: string;
    azureDeploymentName?: string;
}
export declare function resolveDeploymentName(model: Pick<Model<Api>, "id">, options?: AzureEndpointOptions): string;
export declare function resolveAzureBaseUrl(model: Pick<Model<Api>, "baseUrl">, options?: AzureEndpointOptions): string;
export declare function resolveAzureConfig(model: Pick<Model<Api>, "baseUrl">, options?: AzureEndpointOptions): {
    baseUrl: string;
    apiVersion: string;
};
//# sourceMappingURL=azure-openai-config.d.ts.map