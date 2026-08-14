(function (root) {
	function parseDateKey(key) {
		const [year, month, day] = String(key).split("-").map(Number);
		return new Date(year, month - 1, day, 12);
	}

	function dateKey(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	function addDays(date, count) {
		const next = new Date(date);
		next.setDate(next.getDate() + count);
		return next;
	}

	function formatTokens(value, locale = "en") {
		const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
		if (amount < 1_000) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
		return new Intl.NumberFormat(locale, {
			notation: "compact",
			compactDisplay: "short",
			maximumFractionDigits: amount < 100_000 ? 1 : 0,
		}).format(amount);
	}

	function tokenLevel(tokens, distribution) {
		const amount = Number(tokens) || 0;
		if (!(amount > 0)) return 0;
		const values = (Array.isArray(distribution) ? distribution : [distribution])
			.map(Number)
			.filter((value) => value > 0)
			.sort((a, b) => a - b);
		if (!values.length) return 0;
		if (values.length === 1) return 4;
		let upperRank = 0;
		while (upperRank < values.length && values[upperRank] <= amount) upperRank++;
		const percentile = Math.max(0, upperRank - 1) / (values.length - 1);
		return Math.max(1, Math.min(4, Math.floor(percentile * 4) + 1));
	}

	function buildCalendarDays(stats) {
		if (!stats?.rangeStart || !stats?.rangeEnd) return [];
		const rangeStart = parseDateKey(stats.rangeStart);
		const rangeEnd = parseDateKey(stats.rangeEnd);
		const calendarStart = addDays(rangeStart, -rangeStart.getDay());
		const daysByDate = new Map((stats.days || []).map((day) => [day.date, day]));
		const result = [];
		for (let cursor = calendarStart; cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
			const key = dateKey(cursor);
			result.push({
				date: key,
				inRange: cursor >= rangeStart,
				...(daysByDate.get(key) || { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
			});
		}
		return result;
	}

	function monthLabels(days, locale = "en") {
		const formatter = new Intl.DateTimeFormat(locale, { month: "short" });
		const labels = [];
		let previousMonth = -1;
		for (let index = 0; index < days.length; index += 7) {
			const week = days.slice(index, index + 7);
			const representative = week.find((day) => parseDateKey(day.date).getDate() <= 7) || week[0];
			const date = parseDateKey(representative.date);
			if (date.getMonth() === previousMonth) continue;
			previousMonth = date.getMonth();
			labels.push({ column: Math.floor(index / 7) + 1, label: formatter.format(date) });
		}
		return labels;
	}

	function recentTokenDays(stats, count = 7) {
		if (!stats?.rangeEnd) return [];
		const end = parseDateKey(stats.rangeEnd);
		const daysByDate = new Map((stats.days || []).map((day) => [day.date, day]));
		return Array.from({ length: count }, (_value, index) => {
			const date = addDays(end, index - (count - 1));
			const key = dateKey(date);
			return { date: key, totalTokens: Number(daysByDate.get(key)?.totalTokens) || 0 };
		});
	}

	function workRhythm(stats) {
		const recent = recentTokenDays(stats);
		const values = recent.map((day) => day.totalTokens);
		const today = values.at(-1) || 0;
		const activeDays = values.filter((value) => value > 0).length;
		const previousThree = values.slice(1, 4).reduce((total, value) => total + value, 0);
		const latestThree = values.slice(4).reduce((total, value) => total + value, 0);
		if ((stats?.currentStreak || 0) >= 3) return { key: "workRhythmStreak", tone: "streak", recent };
		if (today > 0 && activeDays > 1 && today >= Math.max(...values)) return { key: "workRhythmPeak", tone: "peak", recent };
		if (latestThree > 0 && latestThree >= previousThree * 1.25) return { key: "workRhythmRising", tone: "rising", recent };
		if (activeDays >= 5) return { key: "workRhythmSteady", tone: "steady", recent };
		if (today > 0) return { key: "workRhythmWarming", tone: "warming", recent };
		return { key: "workRhythmQuiet", tone: "quiet", recent };
	}

	function renderWorkRhythm(stats, text, locale) {
		const rhythm = document.querySelector("#workRhythm");
		const label = document.querySelector("#workRhythmText");
		const bars = document.querySelector("#workRhythmBars");
		if (!rhythm || !label || !bars) return;
		const result = workRhythm(stats);
		const distribution = result.recent.map((day) => day.totalTokens).filter((value) => value > 0);
		rhythm.dataset.tone = result.tone;
		label.textContent = text(result.key, { streak: stats.currentStreak || 0 });
		bars.replaceChildren(...result.recent.map((day) => {
			const bar = document.createElement("span");
			bar.dataset.level = String(tokenLevel(day.totalTokens, distribution));
			bar.title = `${day.date} · ${formatTokens(day.totalTokens, locale)} tokens`;
			return bar;
		}));
		rhythm.classList.remove("hidden");
	}

	function heatmapProximityScale(distance, radius = 3.25, peak = 1.28) {
		if (!Number.isFinite(distance) || distance < 0) return 1;
		if (distance >= radius) return 1;
		const falloff = Math.max(0, 1 - distance / radius);
		return 1 + (peak - 1) * Math.pow(falloff, 0.82);
	}

	function render(stats, { locale = "en", text = (key) => key } = {}) {
		const board = document.querySelector("#workInsights");
		if (!board) return;
		const status = document.querySelector("#workInsightsStatus");
		if (!stats) {
			board.classList.add("is-loading");
			if (status) status.textContent = text("workStatsLoading");
			document.querySelector("#workRhythm")?.classList.add("hidden");
			return;
		}

		board.classList.remove("is-loading");
		if (status) status.textContent = "";
		const assign = (selector, value) => {
			const element = document.querySelector(selector);
			if (element) element.textContent = value;
		};
		assign("#workStreakValue", String(stats.currentStreak || 0));
		assign("#workTodayTokensValue", formatTokens(stats.todayTokens, locale));
		assign("#workYearTokensValue", formatTokens(stats.yearTokens, locale));
		assign("#workActiveDaysValue", String(stats.activeDays || 0));
		renderWorkRhythm(stats, text, locale);

		const calendarDays = buildCalendarDays(stats);
		const tokenDistribution = calendarDays.map((day) => Number(day.totalTokens) || 0).filter((total) => total > 0);
		const columnCount = Math.max(1, Math.ceil(calendarDays.length / 7));
		const grid = document.querySelector("#tokenHeatmapGrid");
		if (grid) {
			if (!grid.dataset.hasProximity) {
				grid.dataset.hasProximity = "true";
				let active = new Set();
				let currentCenter = -1;
				const clear = () => {
					if (active.size === 0) return;
					for (const cell of active) {
						cell.style.transform = "";
						cell.style.zIndex = "";
						cell.style.boxShadow = "";
					}
					active.clear();
					currentCenter = -1;
				};
				const onOver = (e) => {
					const target = e.target;
					if (!target || !target.classList.contains("token-heatmap-cell")) {
						clear();
						return;
					}
					const children = grid.children;
					const total = children.length;
					if (total === 0) return;
					const centerIndex = Array.prototype.indexOf.call(children, target);
					if (centerIndex < 0 || centerIndex === currentCenter) return;
					currentCenter = centerIndex;
					const rows = 7;
					const cols = Math.ceil(total / rows);
					const centerCol = Math.floor(centerIndex / rows);
					const centerRow = centerIndex % rows;
					const next = new Set();
					const radius = 3.25;
					for (let dc = -3; dc <= 3; dc += 1) {
						for (let dr = -3; dr <= 3; dr += 1) {
							const c = centerCol + dc;
							const r = centerRow + dr;
							const distance = Math.hypot(dc, dr);
							if (distance > radius) continue;
							if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
							const idx = c * rows + r;
							if (idx < 0 || idx >= total) continue;
							const neighbor = children[idx];
							if (!neighbor) continue;
							const scale = heatmapProximityScale(distance, radius);
							const emphasis = Math.max(0, 1 - distance / radius);
							neighbor.style.transform = `scale(${scale.toFixed(3)})`;
							neighbor.style.zIndex = String(Math.max(1, Math.ceil(emphasis * 10)));
							neighbor.style.boxShadow = distance === 0
								? "0 0 0 1px #f6f7f9, 0 2px 5px rgba(15, 23, 42, 0.16)"
								: `0 0 0 ${(0.35 + emphasis * 0.65).toFixed(2)}px #f6f7f9, 0 1px ${(1 + emphasis * 3).toFixed(1)}px rgba(15, 23, 42, ${(0.035 + emphasis * 0.08).toFixed(3)})`;
							next.add(neighbor);
						}
					}
					for (const cell of active) {
						if (!next.has(cell)) {
							cell.style.transform = "";
							cell.style.zIndex = "";
							cell.style.boxShadow = "";
						}
					}
					active = next;
				};
				grid.addEventListener("mouseover", onOver);
				grid.addEventListener("mouseleave", clear);
			}
			grid.style.setProperty("--heatmap-columns", String(columnCount));
			grid.replaceChildren(...calendarDays.map((day) => {
				const cell = document.createElement("span");
				const total = Number(day.totalTokens) || 0;
				cell.className = "token-heatmap-cell";
				cell.dataset.level = String(day.inRange ? tokenLevel(total, tokenDistribution) : 0);
				if (!day.inRange) cell.classList.add("outside-range");
				const detail = text("tokenDayDetail", {
					date: day.date,
					total: formatTokens(total, locale),
					input: formatTokens(day.inputTokens, locale),
					output: formatTokens(day.outputTokens, locale),
					cache: formatTokens((Number(day.cacheReadTokens) || 0) + (Number(day.cacheWriteTokens) || 0), locale),
				});
				cell.title = detail;
				cell.setAttribute("role", "gridcell");
				cell.setAttribute("aria-label", detail);
				return cell;
			}));
		}

		const labels = document.querySelector("#tokenMonthLabels");
		if (labels) {
			labels.style.setProperty("--heatmap-columns", String(columnCount));
			labels.replaceChildren(...monthLabels(calendarDays, locale).map(({ column, label }) => {
				const month = document.createElement("span");
				month.style.gridColumn = String(column);
				month.textContent = label;
				return month;
			}));
		}
	}

	const api = { buildCalendarDays, formatTokens, heatmapProximityScale, monthLabels, recentTokenDays, render, tokenLevel, workRhythm };
	root.metisDesktopWorkStats = api;
	if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : globalThis);
