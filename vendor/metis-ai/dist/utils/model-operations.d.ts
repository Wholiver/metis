import type { AnyModel, Api, AssistantImages, ClassifierApi, ClassifierContext, ClassifierModel, ClassifierResult, ImageApi, ImageModel, Model, ModelType, ModelTypeMap } from "../types.ts";
/** The type of a model. Models without `type` are chat models. */
export declare function getModelType(model: AnyModel): ModelType;
/** Runtime-checked model type narrowing, including legacy chat models without `type`. */
export declare function isModelType<TType extends ModelType>(model: AnyModel, type: TType): model is ModelTypeMap[TType];
export declare function assertChatModel(model: AnyModel): asserts model is Model<Api>;
export declare function assertImageModel(model: AnyModel): asserts model is ImageModel<ImageApi>;
export declare function assertClassifierModel(model: AnyModel): asserts model is ClassifierModel<ClassifierApi>;
/** Rejects classifier images for models whose catalog entry does not accept image input. */
export declare function assertClassifierInputSupported(model: ClassifierModel<ClassifierApi>, context: ClassifierContext): void;
export declare function imageErrorResult(model: ImageModel<ImageApi>, error: unknown, aborted?: boolean): AssistantImages;
export declare function classifierErrorResult(model: ClassifierModel<ClassifierApi>, error: unknown, aborted?: boolean): ClassifierResult;
//# sourceMappingURL=model-operations.d.ts.map