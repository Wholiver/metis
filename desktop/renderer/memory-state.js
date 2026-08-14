(function initializeMemoryStateView(root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.metisMemoryState = api;
})(typeof window === "object" ? window : undefined, () => {
	const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
	const date = (value, formatDate) => value ? formatDate(value) : undefined;

	function createMemoryStatusView(memoryState = {}, options = {}) {
		const formatDate = options.formatDate || ((value) => String(value));
		const enabled = Boolean(memoryState.enabled);
		const phase = enabled ? String(memoryState.phase || "idle") : "disabled";
		const globalCount = count(memoryState.globalCount);
		const projectCount = count(memoryState.projectCount);
		const pendingJobs = count(memoryState.pendingJobs);
		const lastRunProcessed = memoryState.lastRunProcessed === undefined ? undefined : count(memoryState.lastRunProcessed);
		const lastRunAdded = count(memoryState.lastRunAdded);
		const lastRunSkipped = count(memoryState.lastRunSkipped);
		const nextEligibleAt = date(memoryState.nextEligibleAt, formatDate);
		const nextRetryAt = date(memoryState.nextRetryAt, formatDate);
		const lastCompletedAt = date(memoryState.lastConsolidatedAt || memoryState.lastExtractedAt, formatDate);
		const failure = memoryState.modelFailureReason || memoryState.error;

		let tone = "ready";
		let labelKey = "settingsMemoryStateReady";
		let summaryKey = globalCount + projectCount ? "settingsMemorySummaryReady" : "settingsMemorySummaryEmpty";
		let summaryVariables = { records: globalCount + projectCount };
		if (!enabled) {
			tone = "disabled";
			labelKey = "settingsMemoryStateOff";
			summaryKey = "settingsMemorySummaryOff";
		} else if (phase === "extracting" || phase === "consolidating") {
			tone = "working";
			labelKey = phase === "extracting" ? "settingsMemoryStateExtracting" : "settingsMemoryStateConsolidating";
			summaryKey = phase === "extracting" ? "settingsMemorySummaryExtracting" : "settingsMemorySummaryConsolidating";
		} else if (phase === "retry_wait" || failure) {
			tone = "warning";
			labelKey = "settingsMemoryStateAttention";
			summaryKey = nextRetryAt ? "settingsMemorySummaryRetryAt" : "settingsMemorySummaryRetry";
			summaryVariables = { time: nextRetryAt || "" };
		} else if (pendingJobs > 0) {
			tone = "waiting";
			labelKey = "settingsMemoryStateWaiting";
			summaryKey = nextEligibleAt ? "settingsMemorySummaryPendingAt" : "settingsMemorySummaryPending";
			summaryVariables = { pending: pendingJobs, time: nextEligibleAt || "" };
		}

		const totalRecords = globalCount + projectCount;
		const globalPercent = totalRecords > 0 ? Math.round((globalCount / totalRecords) * 100) : 0;
		const projectPercent = totalRecords > 0 ? Math.max(0, 100 - globalPercent) : 0;
		const pendingPercent = pendingJobs > 0 ? Math.min(100, Math.max(12, Math.min(100, Math.round((pendingJobs / 50) * 100)))) : 0;
		const processedCount = lastRunProcessed !== undefined ? lastRunProcessed : (lastRunAdded + lastRunSkipped);
		const addedPercent = processedCount > 0 ? Math.round((lastRunAdded / processedCount) * 100) : (lastRunAdded > 0 ? 100 : 0);
		const skippedPercent = processedCount > 0 ? Math.max(0, Math.min(100 - addedPercent, Math.round((lastRunSkipped / processedCount) * 100))) : 0;

		const method = memoryState.fallbackUsed || memoryState.lastExtractionMethod === "fallback"
			? "fallback"
			: memoryState.lastExtractionMethod === "model" ? "model" : "none";
		return {
			enabled,
			phase,
			tone,
			labelKey,
			summaryKey,
			summaryVariables,
			records: totalRecords,
			recordsDetailVariables: { global: globalCount, project: projectCount },
			globalPercent,
			projectPercent,
			pendingJobs,
			pendingPercent,
			pendingDetailKey: pendingJobs ? (nextEligibleAt ? "settingsMemoryPendingEligible" : "settingsMemoryPendingWaiting") : "settingsMemoryPendingNone",
			pendingDetailVariables: { time: nextEligibleAt || "" },
			lastRunValue: lastRunProcessed === undefined ? "—" : `+${lastRunAdded}`,
			lastRunDetailKey: lastRunProcessed === undefined ? "settingsMemoryLastRunNever" : "settingsMemoryLastRunDetail",
			lastRunDetailVariables: { processed: lastRunProcessed || 0, skipped: lastRunSkipped },
			addedPercent,
			skippedPercent,
			method,
			methodKey: method === "model" ? "settingsMemoryMethodModel" : method === "fallback" ? "settingsMemoryMethodFallback" : "settingsMemoryMethodNone",
			nextEligibleAt,
			lastCompletedAt,
			failure: failure ? String(failure) : "",
		};
	}

	return { createMemoryStatusView };
});
