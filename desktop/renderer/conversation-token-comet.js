(function (root) {
	const SHORT_TOKENS = 1_000_000;
	const MEDIUM_TOKENS = 5_000_000;
	const LONG_TOKENS = 30_000_000;
	const MAX_TOKENS = 100_000_000;
	const SHORT_LOG_SCALE = 500;
	const MIN_WIDTH = 30;
	const SHORT_WIDTH = 164;
	const MEDIUM_WIDTH = 205;
	const LONG_WIDTH = 242;
	const MAX_WIDTH = 278;

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

	function conversationTokenTotal(messages) {
		return (Array.isArray(messages) ? messages : []).reduce((total, message) => {
			if (message?.role !== "assistant") return total;
			return total + usageTokenTotal(message.usage);
		}, 0);
	}

	function interpolate(value, inputStart, inputEnd, outputStart, outputEnd) {
		const progress = Math.max(0, Math.min(1, (value - inputStart) / (inputEnd - inputStart)));
		return outputStart + (outputEnd - outputStart) * progress;
	}

	function tokenTrailMetrics(tokenTotal) {
		const tokens = finiteNonNegative(tokenTotal);
		if (tokens <= SHORT_TOKENS) {
			// Give small conversations most of the available visual resolution.
			// Log scaling keeps 1k, 10k, and 100k totals visibly distinct.
			const progress = Math.log1p(tokens / SHORT_LOG_SCALE)
				/ Math.log1p(SHORT_TOKENS / SHORT_LOG_SCALE);
			return { band: "short", width: MIN_WIDTH + (SHORT_WIDTH - MIN_WIDTH) * progress };
		}
		if (tokens <= MEDIUM_TOKENS) {
			return {
				band: "medium",
				width: interpolate(tokens, SHORT_TOKENS, MEDIUM_TOKENS, SHORT_WIDTH, MEDIUM_WIDTH),
			};
		}
		if (tokens < LONG_TOKENS) {
			return {
				band: "long",
				width: interpolate(tokens, MEDIUM_TOKENS, LONG_TOKENS, MEDIUM_WIDTH, LONG_WIDTH),
			};
		}
		return {
			band: "long",
			width: interpolate(tokens, LONG_TOKENS, MAX_TOKENS, LONG_WIDTH, MAX_WIDTH),
		};
	}

	const api = { conversationTokenTotal, tokenTrailMetrics, usageTokenTotal };
	root.metisConversationTokenComet = api;
	if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : globalThis);
