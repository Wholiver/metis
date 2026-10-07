import { describe, expect, it } from "vitest";

const {
	isValidCron,
	matchesCron,
	getNextRunTime,
	describeCron,
	parseField,
	CRON_PRESETS,
} = require("../desktop/cron-utils.cjs") as {
	isValidCron: (cron: string) => boolean;
	matchesCron: (cron: string, date?: Date) => boolean;
	getNextRunTime: (cron: string, fromDate?: Date) => Date | null;
	describeCron: (cron: string, locale?: string) => string;
	parseField: (field: string, min: number, max: number) => Set<number> | null;
	CRON_PRESETS: Array<{ id: string; labelZh: string; labelEn: string; cron: string }>;
};

describe("desktop cron-utils", () => {
	it("parses valid and invalid fields", () => {
		const wild = parseField("*", 0, 59);
		expect(wild?.size).toBe(60);

		const step = parseField("*/15", 0, 59);
		expect(step).toEqual(new Set([0, 15, 30, 45]));

		const range = parseField("1-5", 0, 7);
		expect(range).toEqual(new Set([1, 2, 3, 4, 5]));

		const rangeStep = parseField("0-30/10", 0, 59);
		expect(rangeStep).toEqual(new Set([0, 10, 20, 30]));

		const list = parseField("1,15,30", 0, 59);
		expect(list).toEqual(new Set([1, 15, 30]));

		expect(parseField("invalid", 0, 59)).toBeNull();
		expect(parseField("60", 0, 59)).toBeNull();
		expect(parseField("-1", 0, 59)).toBeNull();
		expect(parseField("*/2foo", 0, 59)).toBeNull();
		expect(parseField("*/0", 0, 59)).toBeNull();
		expect(parseField("*/-5", 0, 59)).toBeNull();
	});

	it("validates 5-field cron syntax", () => {
		expect(isValidCron("0 9 * * *")).toBe(true);
		expect(isValidCron("0 18 * * 1-5")).toBe(true);
		expect(isValidCron("*/5 * * * *")).toBe(true);
		expect(isValidCron("0 0 1 1 *")).toBe(true);
		expect(isValidCron("0 9 * * 7")).toBe(true);

		expect(isValidCron("")).toBe(false);
		expect(isValidCron("0 9 * *")).toBe(false); // only 4 fields
		expect(isValidCron("0 9 * * * *")).toBe(false); // 6 fields
		expect(isValidCron("60 9 * * *")).toBe(false); // minute out of range
		expect(isValidCron("0 24 * * *")).toBe(false); // hour out of range
	});

	it("matches cron against dates", () => {
		// 2026-10-04 is a Sunday (day 0)
		const sunday9am = new Date("2026-10-04T09:00:00");
		expect(matchesCron("0 9 * * *", sunday9am)).toBe(true);
		expect(matchesCron("0 9 * * 0", sunday9am)).toBe(true);
		expect(matchesCron("0 9 * * 7", sunday9am)).toBe(true); // 7 is Sunday
		expect(matchesCron("0 9 * * 1-5", sunday9am)).toBe(false); // Sunday is not 1-5

		const sunday901 = new Date("2026-10-04T09:01:00");
		expect(matchesCron("0 9 * * *", sunday901)).toBe(false);

		// Monday 2026-10-05 18:00
		const monday6pm = new Date("2026-10-05T18:00:00");
		expect(matchesCron("0 18 * * 1-5", monday6pm)).toBe(true);
	});

	it("calculates next run time correctly", () => {
		const fromDate = new Date("2026-10-04T08:30:00"); // 8:30am
		const nextRun = getNextRunTime("0 9 * * *", fromDate);
		expect(nextRun).not.toBeNull();
		expect(nextRun?.getHours()).toBe(9);
		expect(nextRun?.getMinutes()).toBe(0);
		expect(nextRun?.getDate()).toBe(4);

		// After 9am today, next run should be tomorrow at 9am
		const after9am = new Date("2026-10-04T09:30:00");
		const tomorrowRun = getNextRunTime("0 9 * * *", after9am);
		expect(tomorrowRun?.getDate()).toBe(5);
		expect(tomorrowRun?.getHours()).toBe(9);
		expect(tomorrowRun?.getMinutes()).toBe(0);

		// Weekday test: from Sunday 09:30, next weekday 9am is Monday 10-05 09:00
		const weekdayRun = getNextRunTime("0 9 * * 1-5", after9am);
		expect(weekdayRun?.getDate()).toBe(5);
		expect(weekdayRun?.getDay()).toBe(1); // Monday
		expect(weekdayRun?.getHours()).toBe(9);
	});

	it("generates human-readable descriptions in Chinese and English", () => {
		expect(describeCron("0 9 * * *", "zh-CN")).toBe("每天 09:00");
		expect(describeCron("0 9 * * *", "en-US")).toBe("Every day at 09:00");
		expect(describeCron("0 18 * * 1-5", "zh-CN")).toBe("工作日 18:00");
		expect(describeCron("0 18 * * 1-5", "en-US")).toBe("Weekdays at 18:00");
		expect(describeCron("0 * * * *", "zh-CN")).toBe("每小时整点");
		expect(describeCron("0 * * * *", "en-US")).toBe("Every hour");
		expect(describeCron("*/15 * * * *", "zh-CN")).toBe("每 15 分钟");
		expect(describeCron("*/15 * * * *", "en-US")).toBe("Every 15 minutes");
	});

	it("exports presets with valid cron expressions", () => {
		for (const preset of CRON_PRESETS) {
			expect(isValidCron(preset.cron)).toBe(true);
		}
	});
});
