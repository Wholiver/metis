import { ModelsError } from "./models-error.js";
/** The type of a model. Models without `type` are chat models. */
export function getModelType(model) {
    return model.type ?? "chat";
}
/** Runtime-checked model type narrowing, including legacy chat models without `type`. */
export function isModelType(model, type) {
    return getModelType(model) === type;
}
export function assertChatModel(model) {
    if (!isModelType(model, "chat")) {
        throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not a chat model`);
    }
}
export function assertImageModel(model) {
    if (!isModelType(model, "image")) {
        throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not an image model`);
    }
}
export function assertClassifierModel(model) {
    if (!isModelType(model, "classifier")) {
        throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not a classifier model`);
    }
}
/** Rejects classifier images for models whose catalog entry does not accept image input. */
export function assertClassifierInputSupported(model, context) {
    if (context.images?.length && !model.input.includes("image")) {
        throw new ModelsError("provider", `Model ${model.provider}/${model.id} does not accept image input`);
    }
}
export function imageErrorResult(model, error, aborted = false) {
    return {
        api: model.api,
        provider: model.provider,
        model: model.id,
        output: [],
        stopReason: aborted ? "aborted" : "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
    };
}
export function classifierErrorResult(model, error, aborted = false) {
    return {
        api: model.api,
        provider: model.provider,
        model: model.id,
        answers: {},
        stopReason: aborted ? "aborted" : "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
    };
}
//# sourceMappingURL=model-operations.js.map