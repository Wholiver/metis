import { SessionManager, type SessionDailyActivity, type SessionInfo } from "../../core/session-manager.ts";

const DREAM_TASK_PATTERN = /^\[BACKGROUND DREAM (?:PHASE(?: TASK)?|TASK)\]/;
const SUBAGENT_TASK_PATTERN = /(?:^|\n)\[SUBAGENT TASK\](?:\r?\n|$)/;
const SUBAGENT_FILE_PATTERN = /^<file name="[^"]*[\\/]\.metis-subagent-[^"]+\.txt">/;
const RANGE_DAYS = 365;

export interface DesktopWorkDay extends SessionDailyActivity {
	sessions: number;
}

export interface DesktopWorkStats {
	generatedAt: string;
	rangeStart: string;
	rangeEnd: string;
	currentStreak: number;
	longestStreak: number;
	activeDays: number;
	totalSessions: number;
	yearPrompts: number;
	yearModelCalls: number;
	yearToolCalls: number;
	yearCost: number;
	todayTokens: number;
	yearTokens: number;
	days: DesktopWorkDay[];
}

function dateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function shiftDateKey(key: string, days: number): string {
	const [year, month, day] = key.split("-").map(Number);
	const date = new Date(year, month - 1, day, 12);
	date.setDate(date.getDate() + days);
	return dateKey(date);
}

function isBackgroundSession(session: SessionInfo): boolean {
	const prompt = session.firstMessage || "";
	return DREAM_TASK_PATTERN.test(prompt) || SUBAGENT_TASK_PATTERN.test(prompt) || SUBAGENT_FILE_PATTERN.test(prompt);
}

function blankDay(date: string): DesktopWorkDay {
	return {
		date,
		userMessages: 0,
		modelCalls: 0,
		toolCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		cost: 0,
		sessions: 0,
	};
}

function countCurrentStreak(activeDates: Set<string>, today: string): number {
	let cursor = today;
	if (!activeDates.has(cursor)) {
		cursor = shiftDateKey(cursor, -1);
		if (!activeDates.has(cursor)) return 0;
	}
	let streak = 0;
	while (activeDates.has(cursor)) {
		streak++;
		cursor = shiftDateKey(cursor, -1);
	}
	return streak;
}

function countLongestStreak(activeDates: Set<string>, start: string, end: string): number {
	let cursor = start;
	let current = 0;
	let longest = 0;
	while (cursor <= end) {
		if (activeDates.has(cursor)) {
			current++;
			longest = Math.max(longest, current);
		} else {
			current = 0;
		}
		cursor = shiftDateKey(cursor, 1);
	}
	return longest;
}

export function aggregateDesktopWorkStats(sessions: SessionInfo[], now = new Date()): DesktopWorkStats {
	const rangeEnd = dateKey(now);
	const rangeStart = shiftDateKey(rangeEnd, -(RANGE_DAYS - 1));
	const days = new Map<string, DesktopWorkDay>();
	const activeDates = new Set<string>();
	let totalSessions = 0;

	for (const session of sessions) {
		if (isBackgroundSession(session)) continue;
		const activity = session.dailyActivity || [];
		if (!activity.some((day) => day.userMessages > 0)) continue;

		let sessionInRange = false;
		for (const activityDay of activity) {
			if (activityDay.date < rangeStart || activityDay.date > rangeEnd) continue;
			if (activityDay.userMessages > 0) activeDates.add(activityDay.date);
			const hasActivity = activityDay.userMessages > 0 || activityDay.totalTokens > 0;
			if (!hasActivity) continue;
			sessionInRange = true;
			const day = days.get(activityDay.date) || blankDay(activityDay.date);
			day.userMessages += activityDay.userMessages;
			day.modelCalls += activityDay.modelCalls || 0;
			day.toolCalls += activityDay.toolCalls || 0;
			day.inputTokens += activityDay.inputTokens;
			day.outputTokens += activityDay.outputTokens;
			day.cacheReadTokens += activityDay.cacheReadTokens;
			day.cacheWriteTokens += activityDay.cacheWriteTokens;
			day.totalTokens += activityDay.totalTokens;
			day.cost += activityDay.cost;
			day.sessions++;
			days.set(activityDay.date, day);
		}
		if (sessionInRange) totalSessions++;
	}

	const sortedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
	const yearTokens = sortedDays.reduce((total, day) => total + day.totalTokens, 0);
	const yearPrompts = sortedDays.reduce((total, day) => total + day.userMessages, 0);
	const yearModelCalls = sortedDays.reduce((total, day) => total + day.modelCalls, 0);
	const yearToolCalls = sortedDays.reduce((total, day) => total + day.toolCalls, 0);
	const yearCost = sortedDays.reduce((total, day) => total + day.cost, 0);
	return {
		generatedAt: now.toISOString(),
		rangeStart,
		rangeEnd,
		currentStreak: countCurrentStreak(activeDates, rangeEnd),
		longestStreak: countLongestStreak(activeDates, rangeStart, rangeEnd),
		activeDays: activeDates.size,
		totalSessions,
		yearPrompts,
		yearModelCalls,
		yearToolCalls,
		yearCost,
		todayTokens: days.get(rangeEnd)?.totalTokens || 0,
		yearTokens,
		days: sortedDays,
	};
}

export async function loadDesktopWorkStats(sessionDir?: string): Promise<DesktopWorkStats> {
	const sessions = sessionDir ? await SessionManager.listAll(sessionDir) : await SessionManager.listAll();
	return aggregateDesktopWorkStats(sessions);
}

