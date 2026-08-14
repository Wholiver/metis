import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const view = require("../desktop/renderer/memory-state.js") as {
	createMemoryStatusView: (state: Record<string, unknown>, options?: { formatDate?: (value: string) => string }) => Record<string, any>;
};
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Desktop Memory status dashboard", () => {
	it("turns pending MemoryState into a readable, scoped status view", () => {
		const result = view.createMemoryStatusView({
			enabled: true,
			phase: "idle",
			globalCount: 0,
			projectCount: 9,
			pendingJobs: 51,
			nextEligibleAt: "2026-08-14T20:49:42.000Z",
			lastRunProcessed: 3,
			lastRunAdded: 3,
			lastRunSkipped: 0,
			lastExtractionMethod: "model",
		}, { formatDate: () => "Aug 14, 20:49" });

		expect(result).toMatchObject({
			tone: "waiting",
			labelKey: "settingsMemoryStateWaiting",
			summaryKey: "settingsMemorySummaryPendingAt",
			records: 9,
			recordsDetailVariables: { global: 0, project: 9 },
			pendingJobs: 51,
			lastRunValue: "+3",
			lastRunDetailVariables: { processed: 3, skipped: 0 },
			methodKey: "settingsMemoryMethodModel",
			nextEligibleAt: "Aug 14, 20:49",
		});
	});

	it("surfaces fallback failures and disabled state without ambiguous phase text", () => {
		const warning = view.createMemoryStatusView({ enabled: true, phase: "retry_wait", fallbackUsed: true, modelFailureReason: "No model credentials" });
		expect(warning).toMatchObject({ tone: "warning", labelKey: "settingsMemoryStateAttention", methodKey: "settingsMemoryMethodFallback", failure: "No model credentials" });
		const disabled = view.createMemoryStatusView({ enabled: false, phase: "idle", pendingJobs: 8 });
		expect(disabled).toMatchObject({ tone: "disabled", labelKey: "settingsMemoryStateOff", summaryKey: "settingsMemorySummaryOff" });
	});

	it("distinguishes ready, extracting, and consolidating phases", () => {
		expect(view.createMemoryStatusView({ enabled: true, phase: "idle", projectCount: 2 })).toMatchObject({ tone: "ready", labelKey: "settingsMemoryStateReady", summaryKey: "settingsMemorySummaryReady" });
		expect(view.createMemoryStatusView({ enabled: true, phase: "extracting" })).toMatchObject({ tone: "working", labelKey: "settingsMemoryStateExtracting", summaryKey: "settingsMemorySummaryExtracting" });
		expect(view.createMemoryStatusView({ enabled: true, phase: "consolidating" })).toMatchObject({ tone: "working", labelKey: "settingsMemoryStateConsolidating", summaryKey: "settingsMemorySummaryConsolidating" });
	});

	it("loads the helper before app.js and renders semantic, responsive status regions", () => {
		const html = read("desktop/renderer/index.html");
		const styles = read("desktop/renderer/styles.css");
		const app = read("desktop/renderer/app.js");
		const main = read("desktop/main.cjs");
		expect(html.indexOf('src="memory-state.js"')).toBeLessThan(html.indexOf('src="app.js"'));
		for (const id of ["settingsMemoryDashboard", "settingsMemoryStateLabel", "settingsMemorySummary", "settingsMemoryRecordCount", "settingsMemoryPendingCount", "settingsMemoryLastRunValue", "settingsMemoryMethod", "settingsMemoryNextRun", "settingsMemoryLastCompleted", "settingsMemoryError", "settingsMemoryRunHint"]) {
			expect(html).toContain(`id="${id}"`);
		}
		expect(html).toContain('aria-live="polite"');
		expect(app).toContain("function renderMemoryStatus()");
		expect(app).toContain("memoryStateView.createMemoryStatusView");
		expect(styles).toMatch(/\.memory-metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,/);
		expect(styles).toMatch(/\.memory-metric > strong\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/);
		expect(styles).toMatch(/\.memory-run-control \.settings-secondary-button\s*\{[\s\S]*?min-height:\s*42px/);
		expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.memory-metrics\s*\{[\s\S]*?minmax\(0, 1fr\)/);
		expect(styles).not.toMatch(/\.memory-[^{]+\{[^}]*transition:\s*all/);
		expect(main).toContain("METIS_DESKTOP_CAPTURE_MEMORY");
		expect(main).toContain("[capture:memory]");
	});
});
