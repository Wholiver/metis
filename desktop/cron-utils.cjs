/**
 * Lightweight, dependency-free 5-field Cron parser, matcher, and humanizer.
 * Supports standard syntax: `minute hour day-of-month month day-of-week`
 */

/**
 * Parse a single field of a cron expression.
 * Returns a Set of allowed numbers, or null if invalid.
 */
function parseField(field, min, max) {
	const raw = String(field || "").trim();
	if (!raw) return null;
	const values = new Set();

	const subparts = raw.split(",");
	for (const sub of subparts) {
		const part = sub.trim();
		if (!part) return null;

		if (part === "*") {
			for (let i = min; i <= max; i++) values.add(i);
			continue;
		}

		if (part.startsWith("*/")) {
			const stepStr = part.slice(2);
			if (!/^\d+$/.test(stepStr)) return null;
			const step = Number.parseInt(stepStr, 10);
			if (!Number.isInteger(step) || step <= 0 || step > max) return null;
			for (let i = min; i <= max; i += step) values.add(i);
			continue;
		}

		const stepMatch = part.match(/^(\d+)-(\d+)\/(\d+)$/);
		if (stepMatch) {
			const start = Number.parseInt(stepMatch[1], 10);
			const end = Number.parseInt(stepMatch[2], 10);
			const step = Number.parseInt(stepMatch[3], 10);
			if (start < min || end > max || start > end || step <= 0) return null;
			for (let i = start; i <= end; i += step) values.add(i);
			continue;
		}

		const rangeMatch = part.match(/^(\d+)-(\d+)$/);
		if (rangeMatch) {
			const start = Number.parseInt(rangeMatch[1], 10);
			const end = Number.parseInt(rangeMatch[2], 10);
			if (start < min || end > max || start > end) return null;
			for (let i = start; i <= end; i++) values.add(i);
			continue;
		}

		const num = Number.parseInt(part, 10);
		if (Number.isInteger(num) && String(num) === part && num >= min && num <= max) {
			values.add(num);
			continue;
		}

		return null;
	}

	return values;
}

/**
 * Validate a 5-field cron expression.
 */
function isValidCron(cron) {
	if (typeof cron !== "string") return false;
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return false;

	const [minStr, hourStr, domStr, monthStr, dowStr] = parts;
	const mins = parseField(minStr, 0, 59);
	const hours = parseField(hourStr, 0, 23);
	const dom = parseField(domStr, 1, 31);
	const months = parseField(monthStr, 1, 12);
	const dow = parseField(dowStr, 0, 7);

	return Boolean(mins && hours && dom && months && dow);
}

/**
 * Check if a Date matches the 5-field cron expression.
 * Accuracy is at minute level.
 */
function matchesCron(cron, date = new Date()) {
	if (typeof cron !== "string") return false;
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return false;

	const [minStr, hourStr, domStr, monthStr, dowStr] = parts;
	const mins = parseField(minStr, 0, 59);
	const hours = parseField(hourStr, 0, 23);
	const dom = parseField(domStr, 1, 31);
	const months = parseField(monthStr, 1, 12);
	const dow = parseField(dowStr, 0, 7);

	if (!mins || !hours || !dom || !months || !dow) return false;

	const minute = date.getMinutes();
	const hour = date.getHours();
	const dayOfMonth = date.getDate();
	const month = date.getMonth() + 1;
	let dayOfWeek = date.getDay(); // 0 is Sunday
	// Normalize 7 to 0 for Sunday
	if (dow.has(7)) dow.add(0);
	if (dow.has(0)) dow.add(7);

	if (!mins.has(minute)) return false;
	if (!hours.has(hour)) return false;
	if (!months.has(month)) return false;

	// In standard cron, if both DOM and DOW are specified (neither is *), match either.
	// If one is *, match the other.
	const domRestricted = domStr !== "*";
	const dowRestricted = dowStr !== "*";

	if (domRestricted && dowRestricted) {
		return dom.has(dayOfMonth) || dow.has(dayOfWeek);
	}
	if (domRestricted) {
		return dom.has(dayOfMonth);
	}
	if (dowRestricted) {
		return dow.has(dayOfWeek);
	}

	return true;
}

/**
 * Get the next run Date for a 5-field cron expression starting after fromDate.
 * Returns null if invalid or no match found within 1 year.
 */
function getNextRunTime(cron, fromDate = new Date()) {
	if (!isValidCron(cron)) return null;

	const parts = cron.trim().split(/\s+/);
	const [minStr, hourStr, domStr, monthStr, dowStr] = parts;
	const mins = parseField(minStr, 0, 59);
	const hours = parseField(hourStr, 0, 23);
	const dom = parseField(domStr, 1, 31);
	const months = parseField(monthStr, 1, 12);
	const dow = parseField(dowStr, 0, 7);
	if (!mins || !hours || !dom || !months || !dow) return null;

	if (dow.has(7)) dow.add(0);
	if (dow.has(0)) dow.add(7);

	const domRestricted = domStr !== "*";
	const dowRestricted = dowStr !== "*";

	const current = new Date(fromDate.getTime());
	current.setSeconds(0, 0);
	// Start from next minute
	current.setMinutes(current.getMinutes() + 1);

	const maxSteps = 525600; // 1 year of minutes
	let steps = 0;

	while (steps < maxSteps) {
		const month = current.getMonth() + 1;
		if (!months.has(month)) {
			// Jump to first day of next month
			current.setMonth(current.getMonth() + 1, 1);
			current.setHours(0, 0, 0, 0);
			steps += 1440;
			continue;
		}

		const dayOfMonth = current.getDate();
		const dayOfWeek = current.getDay();
		const dayMatch = (domRestricted && dowRestricted)
			? (dom.has(dayOfMonth) || dow.has(dayOfWeek))
			: domRestricted
				? dom.has(dayOfMonth)
				: dowRestricted
					? dow.has(dayOfWeek)
					: true;

		if (!dayMatch) {
			// Jump to next day 00:00
			current.setDate(current.getDate() + 1);
			current.setHours(0, 0, 0, 0);
			steps += 1440;
			continue;
		}

		const hour = current.getHours();
		if (!hours.has(hour)) {
			// Jump to next hour at minute 0
			current.setHours(current.getHours() + 1, 0, 0, 0);
			steps += 60;
			continue;
		}

		const minute = current.getMinutes();
		if (!mins.has(minute)) {
			current.setMinutes(current.getMinutes() + 1);
			steps += 1;
			continue;
		}

		return current;
	}

	return null;
}

const CRON_PRESETS = [
	{ id: "daily-9am", labelZh: "每天 09:00", labelEn: "Every day at 09:00", cron: "0 9 * * *" },
	{ id: "daily-6pm", labelZh: "每天 18:00", labelEn: "Every day at 18:00", cron: "0 18 * * *" },
	{ id: "weekdays-9am", labelZh: "工作日 09:00", labelEn: "Weekdays at 09:00", cron: "0 9 * * 1-5" },
	{ id: "weekdays-6pm", labelZh: "工作日 18:00", labelEn: "Weekdays at 18:00", cron: "0 18 * * 1-5" },
	{ id: "hourly", labelZh: "每小时整点", labelEn: "Every hour", cron: "0 * * * *" },
	{ id: "weekly-mon-9am", labelZh: "每周一 09:00", labelEn: "Every Monday at 09:00", cron: "0 9 * * 1" },
	{ id: "every-30m", labelZh: "每 30 分钟", labelEn: "Every 30 minutes", cron: "*/30 * * * *" },
];

/**
 * Format a cron expression to human-readable text.
 */
function describeCron(cron, locale = "zh-CN") {
	const trimmed = String(cron || "").trim();
	const isZh = locale.startsWith("zh");

	const matchedPreset = CRON_PRESETS.find((p) => p.cron === trimmed);
	if (matchedPreset) {
		return isZh ? matchedPreset.labelZh : matchedPreset.labelEn;
	}

	const parts = trimmed.split(/\s+/);
	if (parts.length !== 5) return trimmed;

	const [min, hour, dom, month, dow] = parts;

	// Every N minutes
	if (min.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
		const step = min.slice(2);
		return isZh ? `每 ${step} 分钟` : `Every ${step} minutes`;
	}

	// Every N hours
	if (min === "0" && hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
		const step = hour.slice(2);
		return isZh ? `每 ${step} 小时` : `Every ${step} hours`;
	}

	// Specific time daily
	if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && month === "*") {
		const hh = hour.padStart(2, "0");
		const mm = min.padStart(2, "0");
		if (dow === "*") {
			return isZh ? `每天 ${hh}:${mm}` : `Every day at ${hh}:${mm}`;
		}
		if (dow === "1-5") {
			return isZh ? `工作日 ${hh}:${mm}` : `Weekdays at ${hh}:${mm}`;
		}
		if (dow === "0,6" || dow === "6,0") {
			return isZh ? `周末 ${hh}:${mm}` : `Weekends at ${hh}:${mm}`;
		}
		const daysZh = ["周日", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
		const daysEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
		const dNum = Number.parseInt(dow, 10);
		if (!Number.isNaN(dNum) && dNum >= 0 && dNum <= 7) {
			return isZh ? `每${daysZh[dNum]} ${hh}:${mm}` : `Every ${daysEn[dNum]} at ${hh}:${mm}`;
		}
	}

	return trimmed;
}

module.exports = {
	parseField,
	isValidCron,
	matchesCron,
	getNextRunTime,
	describeCron,
	CRON_PRESETS,
};
