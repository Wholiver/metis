import values from "./data/orcarouter.json" with { type: "json" };
import { flattenModelCatalog } from "../model-catalog.js";
export const ORCAROUTER_MODELS = flattenModelCatalog("orcarouter", values);

