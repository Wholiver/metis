import values from "./data/huggingface.json";
import { type ChatModelCatalog, type ClassifierModelCatalog, type ImageModelCatalog } from "../model-catalog.ts";
export declare const HUGGINGFACE_MODELS: ChatModelCatalog<typeof values, "huggingface">;
export declare const HUGGINGFACE_IMAGE_MODELS: ImageModelCatalog<typeof values, "huggingface">;
export declare const HUGGINGFACE_CLASSIFIER_MODELS: ClassifierModelCatalog<typeof values, "huggingface">;
//# sourceMappingURL=huggingface.models.d.ts.map