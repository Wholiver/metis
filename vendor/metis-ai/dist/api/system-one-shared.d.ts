import type { ClassifierApi, ClassifierContext, ClassifierModel, ClassifierOptions, ClassifierResult } from "../types.ts";
/** TypeSafe System One request body without the transport-specific envelope. */
export interface SystemOneWireRequest {
    state: ClassifierContext["state"];
    questions: Record<string, unknown>;
}
/** Differences between services that serve System One models. */
export interface SystemOneTransport {
    /** Classifier API implemented by this transport. */
    api: ClassifierApi;
    /** Service name used in error messages. */
    label: string;
    /** Absolute request URL. */
    url(model: ClassifierModel<ClassifierApi>): URL;
    /** Wraps the System One request in the service's request envelope. */
    payload(model: ClassifierModel<ClassifierApi>, request: SystemOneWireRequest): unknown;
    /** Extracts the System One output (`{ answers, usage }`) from the service's response envelope. */
    output(body: unknown): Record<string, unknown>;
}
/** Runs one System One classification over the given transport. */
export declare function classifySystemOne(transport: SystemOneTransport, model: ClassifierModel<ClassifierApi>, context: ClassifierContext, options: ClassifierOptions | undefined): Promise<ClassifierResult>;
//# sourceMappingURL=system-one-shared.d.ts.map