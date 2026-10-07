/**
 * Online Fast Learner.
 *
 * Runs at the end of interactive turns in an online fast loop (no background daemon).
 * Extracts candidate user preferences and architectural improvements.
 * Uses `ask_user` to interactively confirm any new preference or tool with the user
 * before persisting to disk.
 */

import type { AgentMessage } from "@earendil-works/metis-agent-core";
import {
	extractUserPreferenceSignals,
	applyPreferenceUpdate,
	type ExtractedPreferenceCandidate,
} from "./preference-engine.ts";
import {
	getUserPreferences,
	saveUserPreferences,
	getArchitectureEvolution,
	saveArchitectureEvolution,
} from "./store.ts";
import { getAgentDir } from "../../config.ts";
import type { AskUserRequest, AskUserResponse } from "../ask-user.ts";
import { createRoutineHostFromEnv, type RoutineHostClient } from "../routine-host.ts";
import {
	detectScheduleOpportunity,
	proposeAndCreateSchedule,
	extractLastUserPrompt,
} from "./schedule-learner.ts";

export interface FastLearnerOptions {
	session: any;
	mode?: string;
	messages?: AgentMessage[];
	isProjectTrusted?: boolean;
	routineHost?: RoutineHostClient;
}

export interface FastLearnerResult {
	success: boolean;
	learnedPreferencesCount: number;
	learnedTacticsCount: number;
	createdScheduleCount?: number;
	userCancelled?: boolean;
}

/**
 * Execute the online fast learning loop after an interactive turn.
 */
export async function runOnlineFastLearner(options: FastLearnerOptions): Promise<FastLearnerResult> {
	const { session, mode = "tui" } = options;

	if (mode === "print" || mode === "json") {
		return { success: true, learnedPreferencesCount: 0, learnedTacticsCount: 0 };
	}

	if (!session?.isSelfLearningActive?.()) {
		return { success: true, learnedPreferencesCount: 0, learnedTacticsCount: 0 };
	}

	const agentDir = session.agentDir ?? getAgentDir();
	const cwd = session.sessionManager?.getCwd?.() ?? process.cwd();
	const messages: AgentMessage[] = options.messages ?? session.agent?.state?.messages ?? [];

	let learnedPreferencesCount = 0;
	let learnedTacticsCount = 0;

	// 1. Extract preference candidates
	const candidates = extractUserPreferenceSignals(messages);
	if (candidates.length > 0) {
		let currentProfile = getUserPreferences(agentDir);

		for (const cand of candidates) {
			// Check if already active and matches
			const existing = currentProfile[cand.dimension]?.[cand.key];
			if (existing && existing.status === "active" && existing.value === cand.value) {
				continue;
			}

			// If interactive askUser handler is available, confirm with user
			if (typeof session.askUser === "function") {
				const reqId = `pref-confirm-${Date.now()}`;
				const request: AskUserRequest = {
					requestId: reqId,
					toolCallId: `call_${Date.now()}`,
					questions: [
						{
							id: "confirm_preference",
							header: "偏好学习确认",
							question: `检测到您的习惯与偏好：“${cand.value}”，是否将其记录为您的长期个人偏好？`,
							options: [
								{
									label: "确认采纳并保存",
									description: "持久化保存为个人偏好并在后续交互中生效",
									recommended: true,
								},
								{
									label: "忽略本次",
									description: "不保存该偏好",
								},
							],
						},
					],
				};

				try {
					const response: AskUserResponse = await session.askUser(request);
					if (response.cancelled) {
						continue;
					}

					const answer = response.answers.find((a) => a.id === "confirm_preference");
					const selected = answer?.selectedLabel || answer?.value;

					if (selected === "确认采纳并保存" || answer?.value?.includes("确认") || answer?.value?.includes("采纳")) {
						currentProfile = applyPreferenceUpdate(currentProfile, cand);
						saveUserPreferences(agentDir, currentProfile);
						learnedPreferencesCount++;
						await session.refreshAdaptations?.({ action: "learned", kind: "preference", name: cand.key });
					}
				} catch {
					// User input unavailable or timed out, do not force-write
				}
			} else {
				// Non-interactive or test fallback
				currentProfile = applyPreferenceUpdate(currentProfile, cand);
				saveUserPreferences(agentDir, currentProfile);
				learnedPreferencesCount++;
			}
		}
	}

	let createdScheduleCount = 0;

	// 2. Desktop-only self-learning routine/schedule detection
	const routineHost = options.routineHost ?? createRoutineHostFromEnv();
	if (routineHost && typeof session.askUser === "function") {
		const lastPrompt = extractLastUserPrompt(messages);
		if (lastPrompt) {
			try {
				const opportunity = await detectScheduleOpportunity({
					userPrompt: lastPrompt,
					cwd,
					agentDir,
					routineHost,
				});
				if (opportunity) {
					const scheduleRes = await proposeAndCreateSchedule(
						opportunity,
						session.askUser.bind(session),
						routineHost,
						agentDir,
					);
					if (scheduleRes.created) {
						createdScheduleCount++;
						await session.refreshAdaptations?.({
							action: "learned",
							kind: "schedule",
							name: opportunity.title,
						});
					}
				}
			} catch (err) {
				console.warn("[fast-learner] Failed to process schedule opportunity:", err);
			}
		}
	}

	return {
		success: true,
		learnedPreferencesCount,
		learnedTacticsCount,
		createdScheduleCount,
	};
}
