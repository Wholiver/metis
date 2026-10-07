/**
 * Prompt Compiler & Conflict Arbitration Engine.
 *
 * Compiles user preferences and architecture evolution into a unified,
 * conflict-free prompt block. Enforces a strict 4-tier precedence hierarchy:
 *
 * 1. Immutable Safety & Control-Plane Tools (highest, cannot be weakened)
 * 2. Immediate Turn Intent (overrides conflicting persistent preferences for this turn)
 * 3. User Preferences Profile (personal tastes, communication style, engineering conventions)
 * 4. Architecture Evolution (tactical playbooks and workflows, strictly subordinated to user preferences)
 */

import {
	CONTROL_PLANE_TOOLS,
	type UserPreferencesProfile,
	type ArchitectureEvolution,
	type CompiledPromptResult,
	type TacticalPlaybook,
} from "./types.ts";
import { assertMainWorkflowInvariance } from "./validate.ts";

export interface CompilePromptOptions {
	userPreferences?: UserPreferencesProfile;
	architecture?: ArchitectureEvolution;
	turnContext?: {
		userMessage?: string;
		activeToolNames?: string[];
		collaborationMode?: string;
	};
}

/** Check if immediate user message indicates a turn-specific preference override. */
function detectImmediateTurnOverrides(userMessage?: string): Set<string> {
	const overrides = new Set<string>();
	if (!userMessage) return overrides;

	const lower = userMessage.toLowerCase();

	// Brevity vs Detail overrides
	if (
		lower.includes("详细") ||
		lower.includes("展开说说") ||
		lower.includes("step by step") ||
		lower.includes("explain in detail") ||
		lower.includes("为什么")
	) {
		overrides.add("suppress_concise");
	}

	if (
		lower.includes("简短") ||
		lower.includes("简洁") ||
		lower.includes("别废话") ||
		lower.includes("只给代码") ||
		lower.includes("just the code") ||
		lower.includes("keep it brief")
	) {
		overrides.add("suppress_detailed");
	}

	// Language overrides
	if (lower.includes("用英文") || lower.includes("in english")) {
		overrides.add("override_lang_en");
	}
	if (lower.includes("用中文") || lower.includes("用汉语")) {
		overrides.add("override_lang_zh");
	}

	return overrides;
}

/**
 * Compile preferences and architecture into a clean, unified, conflict-free instruction block.
 */
export function compileSelfLearningPrompt(options: CompilePromptOptions): CompiledPromptResult {
	const { userPreferences, architecture, turnContext } = options;

	const activePreferences: string[] = [];
	const activePlaybooks: string[] = [];
	const suppressedRules: string[] = [];

	const immediateOverrides = detectImmediateTurnOverrides(turnContext?.userMessage);

	const preferenceLines: string[] = [];

	// 1. Process User Preferences
	if (userPreferences) {
		// Communication
		if (userPreferences.communication) {
			for (const [key, item] of Object.entries(userPreferences.communication)) {
				if (!item || typeof item.value !== "string" || !item.value.trim() || item.status === "retired" || item.status === "overridden") continue;

				const lowerVal = item.value.toLowerCase();

				// Conflict checks with immediate turn overrides
				const isConciseRule = lowerVal.includes("concise") || lowerVal.includes("brief") || lowerVal.includes("简短") || lowerVal.includes("简洁");
				const isDetailedRule = lowerVal.includes("detail") || lowerVal.includes("thorough") || lowerVal.includes("step-by-step") || lowerVal.includes("详细");
				const isChineseRule = lowerVal.includes("chinese") || lowerVal.includes("中文") || lowerVal.includes("汉语") || lowerVal.includes("zh");
				const isEnglishRule = lowerVal.includes("english") || lowerVal.includes("英文") || lowerVal.includes("en");

				if ((key === "brevity" || key === "explanation") && isConciseRule && immediateOverrides.has("suppress_concise")) {
					suppressedRules.push(`communication.${key} (suppressed by immediate user prompt for detail)`);
					continue;
				}
				if ((key === "brevity" || key === "explanation") && isDetailedRule && immediateOverrides.has("suppress_detailed")) {
					suppressedRules.push(`communication.${key} (suppressed by immediate user prompt for brevity)`);
					continue;
				}
				if (key === "language" && isChineseRule && immediateOverrides.has("override_lang_en")) {
					suppressedRules.push(`communication.${key} (suppressed by immediate user prompt for English)`);
					continue;
				}
				if (key === "language" && isEnglishRule && immediateOverrides.has("override_lang_zh")) {
					suppressedRules.push(`communication.${key} (suppressed by immediate user prompt for Chinese)`);
					continue;
				}

				try {
					assertMainWorkflowInvariance(item.value);
					preferenceLines.push(`- [Communication] ${item.value}`);
					activePreferences.push(`communication.${key}`);
				} catch {
					suppressedRules.push(`communication.${key} (failed safety invariant)`);
				}
			}
		}

		// Engineering
		if (userPreferences.engineering) {
			for (const [key, item] of Object.entries(userPreferences.engineering)) {
				if (!item || item.status === "retired" || item.status === "overridden") continue;
				try {
					assertMainWorkflowInvariance(item.value);
					preferenceLines.push(`- [Engineering] ${item.value}`);
					activePreferences.push(`engineering.${key}`);
				} catch {
					suppressedRules.push(`engineering.${key} (failed safety invariant)`);
				}
			}
		}

		// Interaction
		if (userPreferences.interaction) {
			for (const [key, item] of Object.entries(userPreferences.interaction)) {
				if (!item || item.status === "retired" || item.status === "overridden") continue;
				try {
					assertMainWorkflowInvariance(item.value);
					preferenceLines.push(`- [Interaction] ${item.value}`);
					activePreferences.push(`interaction.${key}`);
				} catch {
					suppressedRules.push(`interaction.${key} (failed safety invariant)`);
				}
			}
		}
	}

	// 2. Process Tactical Playbooks
	const playbookLines: string[] = [];
	if (architecture?.playbooks?.length) {
		const userMsg = turnContext?.userMessage?.toLowerCase() ?? "";

		for (const pb of architecture.playbooks) {
			if (pb.status === "retired") continue;

			// Check trigger match
			const isMatch =
				!pb.triggerKeywords?.length ||
				pb.triggerKeywords.some((kw) => kw && userMsg.includes(kw.toLowerCase()));

			if (!isMatch) continue;

			// Verify invariant safety
			try {
				assertMainWorkflowInvariance(pb.strategy);
				playbookLines.push(`- [Tactic: ${pb.name}] ${pb.strategy}`);
				activePlaybooks.push(pb.id || pb.name);
			} catch {
				suppressedRules.push(`playbook.${pb.name} (failed safety invariant)`);
			}
		}
	}

	// 3. Process Macro Workflows
	const workflowLines: string[] = [];
	if (architecture?.macroWorkflows?.length) {
		for (const wf of architecture.macroWorkflows) {
			if (wf.status === "retired") continue;
			try {
				assertMainWorkflowInvariance(wf.description);
				workflowLines.push(`- [Macro Workflow: ${wf.name}] ${wf.description} (steps: ${wf.steps.map((s) => s.tool).join(" -> ")})`);
			} catch {
				suppressedRules.push(`workflow.${wf.name} (failed safety invariant)`);
			}
		}
	}

	// 4. Assemble compiled prompt
	if (preferenceLines.length === 0 && playbookLines.length === 0 && workflowLines.length === 0) {
		return {
			promptText: "",
			activePreferences,
			activePlaybooks,
			suppressedRules,
		};
	}

	const sections: string[] = [];
	sections.push("[Learned User Preferences & Self-Optimized Architecture]");
	sections.push("Adhere to the following learned user preferences and verified architectural strategies. If any tactic conflicts with user intent or system safety, user intent and system safety strictly supersede it.\n");

	if (preferenceLines.length > 0) {
		sections.push("### User Preferences & Taste");
		sections.push(preferenceLines.join("\n"));
		sections.push("");
	}

	if (playbookLines.length > 0) {
		sections.push("### Active Architectural Tactics");
		sections.push(playbookLines.join("\n"));
		sections.push("");
	}

	if (workflowLines.length > 0) {
		sections.push("### Available Macro Workflows");
		sections.push(workflowLines.join("\n"));
		sections.push("");
	}

	const promptText = sections.join("\n").trim();

	return {
		promptText,
		activePreferences,
		activePlaybooks,
		suppressedRules,
	};
}
