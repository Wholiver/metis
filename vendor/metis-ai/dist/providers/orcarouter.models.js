import values from "./data/orcarouter.json" with { type: "json" };
import { flattenChatModelCatalog } from "../model-catalog.js";
export const ORCAROUTER_MODELS = flattenChatModelCatalog("orcarouter", values);

