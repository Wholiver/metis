import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { aggregateDesktopWorkStats } from "../src/modes/server/desktop-work-stats.ts";

const require = createRequire(import.meta.url);
const rendererStats = require("../desktop/renderer/work-stats.js") as {
	buildCalendarDays: (stats: { rangeStart: string; rangeEnd: string; days: unknown[] }) => Array<{ date: string }>;
	formatTokens: (value: number, locale?: string) => string;
	heatmapProximityScale: (distance: number, radius?: number, peak?: number) => number;
	monthLabels: (days: Array<{ date: string }>, locale?: string) => Array<{ column: number; label: string }>;
	recentTokenDays: (stats: { rangeEnd: string; days: Array<{ date: string; totalTokens: number }> }) => Array<{ date: string; totalTokens: number }>;
	tokenLevel: (tokens: number, distribution: number[]) => number;
	workRhythm: (stats: { rangeEnd: string; currentStreak: number; days: Array<{ date: string; totalTokens: number }> }) => { key: string; tone: string };
};

function session(id: string, firstMessage: string, dailyActivity: NonNullable<SessionInfo["dailyActivity"]>): SessionInfo {
	return {
		path: `/sessions/${id}.jsonl`,
		id,
		cwd: "/workspace",
		created: new Date(2026, 7, 1),
		modified: new Date(2026, 7, 4),
		messageCount: 2,
		firstMessage,
		allMessagesText: firstMessage,
		dailyActivity,
	};
}

function day(date: string, userMessages: number, totalTokens: number) {
	return {
		date,
		userMessages,
		modelCalls: totalTokens > 0 ? 1 : 0,
		toolCalls: totalTokens > 50 ? 2 : 0,
		inputTokens: totalTokens * 0.5,
		outputTokens: totalTokens * 0.3,
		cacheReadTokens: totalTokens * 0.2,
		cacheWriteTokens: 0,
		totalTokens,
		cost: totalTokens / 1_000_000,
	};
}

describe("Desktop work statistics", () => {
	it("aggregates human work, token usage, and streaks while excluding background sessions", () => {
		const now = new Date(2026, 7, 4, 12);
		const stats = aggregateDesktopWorkStats([
			session("main", "Build the feature", [day("2026-08-02", 1, 20), day("2026-08-03", 1, 30), day("2026-08-04", 1, 100)]),
			session("second", "Review the result", [day("2026-08-04", 1, 50)]),
			session("dream", "[BACKGROUND DREAM TASK]\nExplore", [day("2026-08-04", 1, 10_000)]),
			session("subagent", "[SUBAGENT TASK]\nResearch", [day("2026-08-04", 1, 10_000)]),
		], now);

		expect(stats.currentStreak).toBe(3);
		expect(stats.longestStreak).toBe(3);
		expect(stats.activeDays).toBe(3);
		expect(stats.totalSessions).toBe(2);
		expect(stats.yearPrompts).toBe(4);
		expect(stats.yearModelCalls).toBe(4);
		expect(stats.yearToolCalls).toBe(2);
		expect(stats.todayTokens).toBe(150);
		expect(stats.yearTokens).toBe(200);
		expect(stats.days.find((item) => item.date === "2026-08-04")).toMatchObject({ sessions: 2, totalTokens: 150 });
	});

	it("keeps a streak current through yesterday until the current day ends", () => {
		const stats = aggregateDesktopWorkStats([
			session("main", "Build", [day("2026-08-02", 1, 10), day("2026-08-03", 1, 10)]),
		], new Date(2026, 7, 4, 8));

		expect(stats.currentStreak).toBe(2);
	});

});

describe("Desktop token heatmap", () => {
	it("builds a Sunday-aligned daily calendar and stable intensity levels", () => {
		const days = rendererStats.buildCalendarDays({ rangeStart: "2025-08-05", rangeEnd: "2026-08-04", days: [] });

		expect(new Date(`${days[0]!.date}T12:00:00`).getDay()).toBe(0);
		expect(days.at(-1)?.date).toBe("2026-08-04");
		expect(days.length).toBeGreaterThanOrEqual(365);
		expect(days.length).toBeLessThanOrEqual(371);
		const distribution = [100, 110, 120, 130, 140, 150, 160, 170];
		expect(rendererStats.tokenLevel(0, distribution)).toBe(0);
		expect(rendererStats.tokenLevel(100, distribution)).toBe(1);
		expect(rendererStats.tokenLevel(130, distribution)).toBe(2);
		expect(rendererStats.tokenLevel(150, distribution)).toBe(3);
		expect(rendererStats.tokenLevel(170, distribution)).toBe(4);
	});

	it("formats compact token values and lays out unique month labels", () => {
		const days = rendererStats.buildCalendarDays({ rangeStart: "2025-08-05", rangeEnd: "2026-08-04", days: [] });
		const labels = rendererStats.monthLabels(days, "zh-CN");

		expect(rendererStats.formatTokens(12_400, "en")).toMatch(/12\.4K/i);
		expect(labels.every((item, index) => index === 0 || item.label !== labels[index - 1]?.label)).toBe(true);
		expect(labels.length).toBeGreaterThanOrEqual(12);
	});

	it("fades heatmap magnification with distance from hovered cell", () => {
		const center = rendererStats.heatmapProximityScale(0);
		const near = rendererStats.heatmapProximityScale(1);
		const far = rendererStats.heatmapProximityScale(2);
		const edge = rendererStats.heatmapProximityScale(3.25);

		expect(center).toBeGreaterThan(near);
		expect(near).toBeGreaterThan(far);
		expect(far).toBeGreaterThan(edge);
		expect(center).toBeCloseTo(1.28, 2);
		expect(edge).toBe(1);
	});

	it("turns existing daily activity into a playful seven-day rhythm without server fields", () => {
		const recent = rendererStats.recentTokenDays({
			rangeEnd: "2026-08-04",
			days: [{ date: "2026-08-01", totalTokens: 100 }, { date: "2026-08-04", totalTokens: 400 }],
		});
		const rhythm = rendererStats.workRhythm({ rangeEnd: "2026-08-04", currentStreak: 4, days: recent });

		expect(recent).toHaveLength(7);
		expect(recent[0]?.date).toBe("2026-07-29");
		expect(recent.at(-1)).toEqual({ date: "2026-08-04", totalTokens: 400 });
		expect(rhythm).toMatchObject({ key: "workRhythmStreak", tone: "streak" });
	});

	it("keeps board data available without reserving main-chat composer space", () => {
		const html = readFileSync(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
			.replace(/<!--[\s\S]*?-->/g, "");
		const css = readFileSync(new URL("../desktop/renderer/styles.css", import.meta.url), "utf8");
		const app = readFileSync(new URL("../desktop/renderer/app.js", import.meta.url), "utf8");
		const composerStart = html.indexOf('data-purpose="composer-stack"');
		const board = html.indexOf('id="workInsights"');
		const composerEnd = html.indexOf("</main>", composerStart);

		expect(board).toBeGreaterThan(composerStart);
		expect(board).toBeLessThan(composerEnd);
		expect(css).toMatch(/\[data-purpose="main-chat"\] #workInsights\s*\{[\s\S]*?display:\s*none/);
		expect(css).toMatch(/#composerStatusRow:not\(:has\(.project-switcher:not\(\.hidden\)\)\):has\(#subagentDock\.collapsed:not\(\.running\)\)\s*\{[\s\S]*?display:\s*none/);
		expect(html).not.toContain('class="work-details"');
		expect(html).toContain('id="workRhythm"');
		expect(html).toContain('id="workRhythmBars"');
	});

});
