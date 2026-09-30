import { CONTROL_PLANE_TOOLS } from "./types.ts";

export interface GuidelineTrigger {
	command?: string;
	commandPattern?: string;
	error?: string;
	errorPattern?: string;
	intent?: string;
	keyword?: string;
	regex?: string;
	filePattern?: string;
}

export interface CustomGuidelineItem {
	id?: string;
	text: string;
	trigger?: GuidelineTrigger;
	scope?: string;
}

export type CustomGuideline = string | CustomGuidelineItem;

export interface ArchitectureAdaptation {
	/** Tools that should not be exposed to models in ordinary turns. */
	hiddenTools?: string[];
	/** Custom coding/architectural guidelines appended to system prompt or recalled by trigger. */
	customGuidelines?: CustomGuideline[];
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
		if (!Array.isArray(raw.customGuidelines)) {
			throw new Error("customGuidelines must be an array");
		}
		result.customGuidelines = raw.customGuidelines.map((item, index) => {
			if (typeof item === "string") {
				return item;
			}
			if (typeof item === "object" && item !== null) {
				const obj = item as Record<string, unknown>;
				if (typeof obj.text !== "string" || !obj.text.trim()) {
					throw new Error(`customGuidelines[${index}].text is required and must be a non-empty string`);
				}
				const res: CustomGuidelineItem = {
					id: typeof obj.id === "string" ? obj.id : undefined,
					text: obj.text.trim(),
				};
				if (typeof obj.trigger === "object" && obj.trigger !== null) {
					const trig = obj.trigger as Record<string, unknown>;
					res.trigger = {
						command: typeof trig.command === "string" ? trig.command : (typeof trig.commandPattern === "string" ? trig.commandPattern : undefined),
						error: typeof trig.error === "string" ? trig.error : (typeof trig.errorPattern === "string" ? trig.errorPattern : undefined),
						intent: typeof trig.intent === "string" ? trig.intent : undefined,
						keyword: typeof trig.keyword === "string" ? trig.keyword : undefined,
						regex: typeof trig.regex === "string" ? trig.regex : undefined,
						filePattern: typeof trig.filePattern === "string" ? trig.filePattern : undefined,
					};
				} else if (typeof obj.trigger === "string") {
					res.trigger = { keyword: obj.trigger };
				}

				const hasValidTrigger = Boolean(
					(res.trigger?.keyword && res.trigger.keyword.trim()) ||
					(res.trigger?.regex && res.trigger.regex.trim()) ||
					(res.trigger?.intent && res.trigger.intent.trim()) ||
					(res.trigger?.command && res.trigger.command.trim()) ||
					(res.trigger?.filePattern && res.trigger.filePattern.trim()) ||
					(res.trigger?.error && res.trigger.error.trim())
				);
				if (!hasValidTrigger) {
					throw new Error(
						`customGuidelines[${index}] object must specify at least one trigger field (keyword, regex, intent, command, filePattern)`,
					);
				}
				return res;
			}
			throw new Error(`customGuidelines[${index}] must be a string or an object with text and trigger`);
		});
	}

	if (raw.preferredTools !== undefined) {
		if (!Array.isArray(raw.preferredTools) || !raw.preferredTools.every((p) => typeof p === "string")) {
			throw new Error("preferredTools must be an array of strings");
		}
		result.preferredTools = [...raw.preferredTools];
	}

	return result;
}

/**
 * Whether a guideline should be injected at the start of a turn.
 * Plain strings stay always-on. Object guidelines need a trigger that matches the user request,
 * so a cleanup note is not recalled while the user is publishing.
 */
export function guidelineMatchesPrompt(guideline: CustomGuideline, userText: string): boolean {
	if (typeof guideline === "string") return true;
	const trigger = guideline.trigger;
	if (!trigger) return false;
	const patterns = [
		trigger.keyword,
		trigger.intent,
		trigger.regex,
		trigger.filePattern,
		trigger.command,
		trigger.commandPattern,
		trigger.error,
		trigger.errorPattern,
	].filter((pattern): pattern is string => Boolean(pattern && pattern.trim()));
	for (const pattern of patterns) {
		try {
			if (new RegExp(pattern, "i").test(userText)) return true;
		} catch {
			if (userText.toLowerCase().includes(pattern.toLowerCase())) return true;
		}
	}
	return false;
}
