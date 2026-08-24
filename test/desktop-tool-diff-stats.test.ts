import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "desktop/renderer/styles.css"), "utf8");
const app = readFileSync(resolve(process.cwd(), "desktop/renderer/app.js"), "utf8");

describe("desktop tool diff stats", () => {
	it("defines styles for tool-diff-stats, added, and removed lines with nowrap header", () => {
		expect(styles).toContain(".tool-diff-stats");
		expect(styles).toContain(".tool-diff-added");
		expect(styles).toContain(".tool-diff-removed");
		expect(styles).toMatch(/--diff-stat-added:\s*#3fb950;/);
		expect(styles).toMatch(/--diff-stat-removed:\s*#f85149;/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.tool-diff-stats/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.tool-header-bar\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
	});

	it("defines styles for turn files summary card", () => {
		expect(styles).toContain(".turn-files-summary");
		expect(styles).toContain(".turn-files-summary-header");
		expect(styles).toContain(".turn-files-summary-title");
		expect(styles).toContain(".turn-files-summary-chevron");
		expect(styles).toContain(".turn-files-summary-list");
		expect(styles).toContain(".turn-files-summary-item");
		expect(styles).toContain(".turn-files-item-path");
		expect(styles).not.toContain("transition: all");
	});

	it("includes computeToolDiffStats, getTurnModifiedFiles and renderTurnFilesSummary in app.js", () => {
		expect(app).toContain("function computeToolDiffStats(part, status)");
		expect(app).toContain("function getTurnModifiedFiles(turnArticles, messages");
		expect(app).toContain("function renderTurnFilesSummary(parentBody, modifiedFiles)");
		expect(app).toContain("turn-files-summary");
		expect(app).toContain("showDiff(file.path)");
	});

	it("computes correct diff stats only for completed and non-zero changes", () => {
		// Extract only computeToolDiffStats function from app.js to test in isolation
		const match = app.match(/function computeToolDiffStats\([\s\S]*?\n\}/);
		expect(match).toBeTruthy();
		const evalFn = new Function(`${match![0]}; return computeToolDiffStats;`)();

		// Edit with edits array - completed
		const editPart = {
			name: "edit",
			arguments: {
				path: "app.ts",
				edits: [
					{ oldText: "line1\nline2", newText: "line1_mod" },
					{ oldText: "line3", newText: "line3_a\nline3_b\nline3_c" },
				],
			},
		};
		expect(evalFn(editPart, "Completed")).toEqual({ added: 4, removed: 3 });

		// Running status -> should not show
		expect(evalFn(editPart, "Running")).toBeNull();
		// Error status -> should not show
		expect(evalFn(editPart, "Error")).toBeNull();
		// Denied status -> should not show
		expect(evalFn(editPart, "Denied")).toBeNull();

		// Edit with single oldText/newText
		const editSingle = {
			name: "edit",
			arguments: {
				path: "app.ts",
				oldText: "a\nb",
				newText: "c",
			},
		};
		expect(evalFn(editSingle, "Completed")).toEqual({ added: 1, removed: 2 });

		// Write tool
		const writePart = {
			name: "write",
			arguments: {
				path: "new.ts",
				content: "line1\nline2\nline3",
			},
		};
		expect(evalFn(writePart, "Completed")).toEqual({ added: 3, removed: 0 });

		// Zero changes -> should return null (don't display)
		const writeEmpty = {
			name: "write",
			arguments: {
				path: "empty.ts",
				content: "",
			},
		};
		expect(evalFn(writeEmpty, "Completed")).toBeNull();

		const editNoChange = {
			name: "edit",
			arguments: {
				path: "same.ts",
				oldText: "",
				newText: "",
			},
		};
		expect(evalFn(editNoChange, "Completed")).toBeNull();

		// Non-edit/write tool
		const readPart = {
			name: "read",
			arguments: { path: "foo.ts" },
		};
		expect(evalFn(readPart, "Completed")).toBeNull();
	});
});
