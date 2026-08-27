const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const path = require("node:path");
const { createInterface } = require("node:readline");

const cache = new Map();
const MAX_SESSION_PATHS = 1000;
const MAX_CONCURRENCY = 8;

function finiteNonNegative(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageTokenTotal(usage) {
	if (!usage || typeof usage !== "object") return 0;
	return finiteNonNegative(usage.totalTokens)
		|| finiteNonNegative(usage.input)
			+ finiteNonNegative(usage.output)
			+ finiteNonNegative(usage.cacheRead)
			+ finiteNonNegative(usage.cacheWrite);
}

function localDateKey(value) {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return undefined;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function emptySessionTokenStats() {
	return { tokenTotal: 0, dailyTokens: {} };
}

async function readSessionTokenStats(filePath) {
	const resolvedPath = path.resolve(String(filePath || ""));
	if (!path.isAbsolute(String(filePath || "")) || path.extname(resolvedPath).toLowerCase() !== ".jsonl") return emptySessionTokenStats();

	let fileStats;
	try {
		fileStats = await stat(resolvedPath);
	} catch {
		return emptySessionTokenStats();
	}
	if (!fileStats.isFile()) return emptySessionTokenStats();

	const cached = cache.get(resolvedPath);
	if (cached?.mtimeMs === fileStats.mtimeMs && cached?.size === fileStats.size) return cached.stats;

	let tokenTotal = 0;
	const dailyTokens = {};
	try {
		const lines = createInterface({
			input: createReadStream(resolvedPath, { encoding: "utf8" }),
			crlfDelay: Infinity,
		});
		for await (const line of lines) {
			let entry;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
			const tokens = usageTokenTotal(entry.message.usage);
			tokenTotal += tokens;
			const date = localDateKey(entry.timestamp ?? entry.message.timestamp);
			if (date && tokens > 0) dailyTokens[date] = (dailyTokens[date] || 0) + tokens;
		}
	} catch {
		return emptySessionTokenStats();
	}

	const stats = { tokenTotal, dailyTokens };
	cache.set(resolvedPath, { mtimeMs: fileStats.mtimeMs, size: fileStats.size, stats });
	return stats;
}

function normalizedSessionPaths(filePaths) {
	return [...new Set(Array.isArray(filePaths) ? filePaths : [])]
		.filter((filePath) => typeof filePath === "string" && filePath)
		.slice(0, MAX_SESSION_PATHS);
}

async function readSessionTokenActivity(filePaths) {
	const paths = normalizedSessionPaths(filePaths);
	const totals = {};
	const dailyTokens = {};
	let tokenTotal = 0;
	let cursor = 0;
	const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, paths.length) }, async () => {
		while (cursor < paths.length) {
			const index = cursor++;
			const filePath = paths[index];
			const stats = await readSessionTokenStats(filePath);
			totals[filePath] = stats.tokenTotal;
			tokenTotal += stats.tokenTotal;
			for (const [date, tokens] of Object.entries(stats.dailyTokens)) {
				dailyTokens[date] = (dailyTokens[date] || 0) + tokens;
			}
		}
	});
	await Promise.all(workers);
	return { totals, tokenTotal, dailyTokens };
}

async function readSessionTokenTotal(filePath) {
	return (await readSessionTokenStats(filePath)).tokenTotal;
}

async function readSessionTokenTotals(filePaths) {
	return (await readSessionTokenActivity(filePaths)).totals;
}

module.exports = {
	localDateKey,
	readSessionTokenActivity,
	readSessionTokenStats,
	readSessionTokenTotal,
	readSessionTokenTotals,
	usageTokenTotal,
};

