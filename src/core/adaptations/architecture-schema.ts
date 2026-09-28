import { CONTROL_PLANE_TOOLS } from "./types.ts";

export interface ArchitectureAdaptation {
	/** Tools that should not be exposed to models in ordinary turns. */
	hiddenTools?: string[];
	/** Custom coding/architectural guidelines appended to system prompt. */
	customGuidelines?: string[];
	/** Preferred tools for specific actions. */
	preferredTools?: string[];
}

export function validateArchitectureAdaptation(data: unknown): ArchitectureAdaptation {
	if (typeof data !== "object" || data === null) {
		throw new Error("Architecture adaptation must be a JSON object");
	}

	const raw = data as Record<string, unknown>;
	const result: ArchitectureAdaptation = {};

	if (raw.hiddenTools !== undefined) {
		if (!Array.isArray(raw.hiddenTools) || !raw.hiddenTools.every((t) => typeof t === "string")) {
			throw new Error("hiddenTools must be an array of strings");
		}
		// Baseline safety check: control plane tools can NEVER be hidden
		const forbidden = raw.hiddenTools.filter((tool) => CONTROL_PLANE_TOOLS.includes(tool));
		if (forbidden.length > 0) {
			throw new Error(
				`Cannot hide control plane tools: ${forbidden.join(", ")}. These are safety-critical baselines.`,
			);
		}
		result.hiddenTools = [...raw.hiddenTools];
	}

	if (raw.customGuidelines !== undefined) {
		if (!Array.isArray(raw.customGuidelines) || !raw.customGuidelines.every((g) => typeof g === "string")) {
			throw new Error("customGuidelines must be an array of strings");
		}
		result.customGuidelines = [...raw.customGuidelines];
	}

	if (raw.preferredTools !== undefined) {
		if (!Array.isArray(raw.preferredTools) || !raw.preferredTools.every((p) => typeof p === "string")) {
			throw new Error("preferredTools must be an array of strings");
		}
		result.preferredTools = [...raw.preferredTools];
	}

	return result;
}
