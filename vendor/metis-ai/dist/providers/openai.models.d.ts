import values from "./data/openai.json";
import { type ChatModelCatalog, type ClassifierModelCatalog, type ImageModelCatalog } from "../model-catalog.ts";
export declare const OPENAI_MODELS: ChatModelCatalog<typeof values, "openai">;
export declare const OPENAI_IMAGE_MODELS: ImageModelCatalog<typeof values, "openai">;
export declare const OPENAI_CLASSIFIER_MODELS: ClassifierModelCatalog<typeof values, "openai">;
//# sourceMappingURL=openai.models.d.ts.map