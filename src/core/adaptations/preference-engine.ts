/**
 * User Preferences Engine.
 *
 * Extracts, updates, and structures user preferences across three orthogonal dimensions:
 * - communication (tone, brevity, language, explanation style)
 * - engineering (frameworks, conventions, typing, test style)
 * - interaction (autonomy, confirmation threshold, change granularity)
 *
 * Ensures newer preferences supersede conflicting older preferences cleanly.
 */

import type { AgentMessage } from "@earendil-works/metis-agent-core";
import type {
	PreferenceDimension,
	PreferenceItem,
	UserPreferencesProfile,
} from "./types.ts";
import { assertMainWorkflowInvariance } from "./validate.ts";

export interface ExtractedPreferenceCandidate {
	dimension: PreferenceDimension;
	key: string;
	value: string;
	confidence: number;
	evidence: string;
}

export function createEmptyPreferencesProfile(): UserPreferencesProfile {
	return {
		communication: {},
		engineering: {},
		interaction: {},
		updatedAt: new Date().toISOString(),
		version: 1,
	};
}

/** Extract text content from message. */
function getMessageText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part): part is { type: "text"; text: string } =>
				Boolean(part) && (part as { type?: string }).type === "text" && typeof (part as { text?: unknown }).text === "string",
			)
			.map((part) => part.text)
			.join(" ");
	}
	return "";
}

/**
 * Scan recent dialogue messages for explicit user preference signals.
 */
export function extractUserPreferenceSignals(messages: AgentMessage[]): ExtractedPreferenceCandidate[] {
	const candidates: ExtractedPreferenceCandidate[] = [];
	if (!messages || messages.length === 0) return candidates;

	// Focus on the most recent user messages
	const userMessages = messages.filter((m) => m.role === "user");
	if (userMessages.length === 0) return candidates;

	const latestUserMsg = userMessages[userMessages.length - 1];
	const latestText = getMessageText(latestUserMsg).trim();
	if (!latestText) return candidates;

	const lower = latestText.toLowerCase();

	// 1. Communication: Brevity / Conciseness
	if (
		lower.includes("不要废话") ||
		lower.includes("别废话") ||
		lower.includes("简短点") ||
		lower.includes("简洁一点") ||
		lower.includes("只给代码") ||
		lower.includes("keep it brief") ||
		lower.includes("be concise") ||
		lower.includes("no fluff")
	) {
		candidates.push({
			dimension: "communication",
			key: "brevity",
			value: "Keep responses concise and direct; focus on the code and avoid conversational fluff.",
			confidence: 0.9,
			evidence: latestText.slice(0, 150),
		});
	} else if (
		lower.includes("详细解释") ||
		lower.includes("详细点") ||
		lower.includes("为什么这么做") ||
		lower.includes("explain in detail") ||
		lower.includes("explain step by step")
	) {
		candidates.push({
			dimension: "communication",
			key: "brevity",
			value: "Explain solutions thoroughly with step-by-step reasoning and background rationale.",
			confidence: 0.85,
			evidence: latestText.slice(0, 150),
		});
	}

	// 2. Communication: Language
	if (
		lower.includes("请说中文") ||
		lower.includes("用中文回答") ||
		lower.includes("请使用中文") ||
		lower.includes("always speak chinese")
	) {
		candidates.push({
			dimension: "communication",
			key: "language",
			value: "Always respond and communicate in Chinese (中文).",
			confidence: 0.95,
			evidence: latestText.slice(0, 150),
		});
	} else if (
		lower.includes("reply in english") ||
		lower.includes("use english") ||
		lower.includes("用英文回答")
	) {
		candidates.push({
			dimension: "communication",
			key: "language",
			value: "Always respond and communicate in English.",
			confidence: 0.95,
			evidence: latestText.slice(0, 150),
		});
	}

	// 3. Engineering: Testing preferences
	if (
		lower.includes("用 vitest") ||
		lower.includes("使用 vitest") ||
		lower.includes("prefer vitest") ||
		lower.includes("不要用 jest")
	) {
		candidates.push({
			dimension: "engineering",
			key: "test_framework",
			value: "Use Vitest as the primary test runner; do not use Jest.",
			confidence: 0.9,
			evidence: latestText.slice(0, 150),
		});
	}

	// 4. Engineering: Code comments & formatting
	if (
		lower.includes("注释用中文") ||
		lower.includes("写中文注释")
	) {
		candidates.push({
			dimension: "engineering",
			key: "comments",
			value: "Write code comments and documentation in Chinese.",
			confidence: 0.9,
			evidence: latestText.slice(0, 150),
		});
	} else if (
		lower.includes("注释用英文") ||
		lower.includes("write english comments")
	) {
		candidates.push({
			dimension: "engineering",
			key: "comments",
			value: "Write code comments in English.",
			confidence: 0.9,
			evidence: latestText.slice(0, 150),
		});
	}

	// 5. Engineering: TypeScript / Type Safety
	if (
		lower.includes("严格类型") ||
		lower.includes("不要用 any") ||
		lower.includes("no any") ||
		lower.includes("strict typescript")
	) {
		candidates.push({
			dimension: "engineering",
			key: "type_safety",
			value: "Enforce strict TypeScript typing; avoid using 'any' unless strictly necessary.",
			confidence: 0.9,
			evidence: latestText.slice(0, 150),
		});
	}

	// 6. Interaction: Autonomy & Confirmation
	if (
		lower.includes("改动前先问我") ||
		lower.includes("不要擅自改") ||
		lower.includes("先问一下") ||
		lower.includes("ask me before changing")
	) {
		candidates.push({
			dimension: "interaction",
			key: "confirmation",
			value: "Ask for user confirmation or clarification before making broad architectural or file changes.",
			confidence: 0.9,
			evidence: latestText.slice(0, 150),
		});
	}

	// Filter out any candidates that violate safety invariance
	return candidates.filter((c) => {
		try {
			assertMainWorkflowInvariance(c.value);
			return true;
		} catch {
			return false;
		}
	});
}

/**
 * Apply a preference candidate update to the profile.
 * Automatically supersedes older conflicting entries for the same key.
 */
export function applyPreferenceUpdate(
	profile: UserPreferencesProfile,
	candidate: ExtractedPreferenceCandidate,
): UserPreferencesProfile {
	const now = new Date().toISOString();
	const next: UserPreferencesProfile = {
		...profile,
		communication: { ...profile.communication },
		engineering: { ...profile.engineering },
		interaction: { ...profile.interaction },
		updatedAt: now,
		version: (profile.version ?? 1) + 1,
	};

	const item: PreferenceItem = {
		id: candidate.key,
		value: candidate.value,
		confidence: candidate.confidence,
		updatedAt: now,
		evidence: candidate.evidence,
		status: "active",
	};

	switch (candidate.dimension) {
		case "communication":
			next.communication[candidate.key] = item;
			break;
		case "engineering":
			next.engineering[candidate.key] = item;
			break;
		case "interaction":
			next.interaction[candidate.key] = item;
			break;
	}

	return next;
}

/**
 * Format a human-readable summary of current active preferences.
 */
export function formatPreferencesSummary(profile?: UserPreferencesProfile): string {
	if (!profile) return "No learned preferences yet.";

	const lines: string[] = [];

	const comm = Object.values(profile.communication || {}).filter((i) => i.status === "active");
	if (comm.length > 0) {
		lines.push("Communication:");
		comm.forEach((i) => lines.push(`  - ${i.id}: ${i.value}`));
	}

	const eng = Object.values(profile.engineering || {}).filter((i) => i.status === "active");
	if (eng.length > 0) {
		lines.push("Engineering:");
		eng.forEach((i) => lines.push(`  - ${i.id}: ${i.value}`));
	}

	const inter = Object.values(profile.interaction || {}).filter((i) => i.status === "active");
	if (inter.length > 0) {
		lines.push("Interaction:");
		inter.forEach((i) => lines.push(`  - ${i.id}: ${i.value}`));
	}

	return lines.length > 0 ? lines.join("\n") : "No learned preferences yet.";
}
