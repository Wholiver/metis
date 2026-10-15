import type { JsonObject } from "../types.ts";
export interface DiagnosticErrorInfo {
    name?: string;
    message: string;
    stack?: string;
    code?: string | number;
}
export interface AssistantMessageDiagnostic {
    type: string;
    timestamp: number;
    error?: DiagnosticErrorInfo;
    details?: JsonObject;
}
export declare function formatThrownValue(value: unknown): string;
export declare function extractDiagnosticError(error: unknown): DiagnosticErrorInfo;
export declare function createAssistantMessageDiagnostic(type: string, error: unknown, details?: JsonObject): AssistantMessageDiagnostic;
export declare function appendAssistantMessageDiagnostic<T extends {
    diagnostics?: AssistantMessageDiagnostic[];
}>(message: T, diagnostic: AssistantMessageDiagnostic): void;
//# sourceMappingURL=diagnostics.d.ts.map