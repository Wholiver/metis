export type ModelsErrorCode = "model_source" | "model_validation" | "provider" | "stream" | "auth" | "oauth";
export declare class ModelsError extends Error {
    readonly code: ModelsErrorCode;
    constructor(code: ModelsErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
//# sourceMappingURL=models-error.d.ts.map