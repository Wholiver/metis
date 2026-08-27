import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { WORK_PROGRESS_LABELS } from "../desktop/src/lib/work-progress-copy";

const require = createRequire(import.meta.url);
const i18n = require("../desktop/i18n.cjs") as {
	catalogs: Record<string, Record<string, string>>;
	languages: string[];
	resolve: (language: string, locales?: string[]) => string;
	t: (key: string, language: string, variables?: Record<string, unknown>) => string;
};
const menu = require("../desktop/main-menu.cjs") as {
	createApplicationMenuTemplate: (platform: string, appName?: string, text?: (key: string, variables?: Record<string, unknown>) => string) => Array<{ label?: string; role?: string; submenu?: Array<{ label?: string; role?: string }> }>;
	createEditorContextMenuTemplate: (params: Record<string, unknown>, text?: (key: string) => string) => Array<{ label?: string; role?: string }>;
};

const resolvedLanguages = i18n.languages.filter((language) => language !== "auto");
const legitimateCognates = new Set([
	"agent",
	"apiKey",
	"browser",
	"customProviderBaseUrl",
	"general",
	"interaction",
	"optional",
	"onboardingProviderTabApiKey",
	"onboardingProviderTabOAuth",
	"onboardingSetting",
	"projectColorShort",
	"projectNameShort",
	"proposedPlanProcess",
	"session",
	"settingsDesktopSection",
	"settingsMemoryStatus",
	"thoughts",
	"thinkingMinimal",
	"timelineMessage",
	"tokenCache",
	"message",
	"messageForTitle",
	"userProfileName",
	"version",
	"reactSettingsDesktop",
	"workProgressSubagent",
	"chatHomeSuffix",
	"tokensUnit",
]);

describe("Desktop translation catalogs", () => {
	it("provides every key and matching placeholders in every selectable language", () => {
		const expectedKeys = Object.keys(i18n.catalogs.en).sort();
		expect(expectedKeys.length).toBeGreaterThan(650);
		for (const language of resolvedLanguages) {
			expect(Object.keys(i18n.catalogs[language]).sort(), language).toEqual(expectedKeys);
			for (const key of expectedKeys) {
				const sourceVariables = [...i18n.catalogs.en[key].matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
				const translatedVariables = [...i18n.catalogs[language][key].matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
				expect(translatedVariables, `${language}:${key}`).toEqual(sourceVariables);
			}
		}
	});

	it("does not silently fall back to English for localized copy", () => {
		for (const language of resolvedLanguages.filter((language) => language !== "en")) {
			const unexpected = Object.keys(i18n.catalogs.en).filter((key) => (
				i18n.catalogs[language][key] === i18n.catalogs.en[key] && !legitimateCognates.has(key)
			));
			expect(unexpected, language).toEqual([]);
		}
	});

	it("keeps Desktop proposal actions aligned with CLI durable-plan semantics", () => {
		for (const language of resolvedLanguages) {
			expect(i18n.catalogs[language].proposedPlanProcessPrompt, language).toContain("read_plan");
		}
		expect(i18n.catalogs.en.proposedPlanProcessPrompt).toBe(
			"Call read_plan first to load the latest proposal and execution progress. Then MUST call update_plan to create or refresh a concise implementation and verification checklist before any other tool. Keep the checklist current through completion, provide concise visible progress updates in my language, and continue until every step is verified.",
		);
		expect(i18n.catalogs["zh-CN"].proposedPlanProcessPrompt).toContain("update_plan");
	});

	it("resolves Automatic consistently for Windows and macOS locale forms", () => {
		expect(i18n.resolve("auto", ["zh-HK"])).toBe("zh-TW");
		expect(i18n.resolve("auto", ["zh-SG"])).toBe("zh-CN");
		expect(i18n.resolve("auto", ["fr-CA"])).toBe("fr");
		expect(i18n.resolve("auto", ["unknown"])).toBe("en");
	});

});

describe("Desktop translation coverage", () => {
	it("ships browser and main-process catalogs from same generated source", () => {
		const browserCatalogs = require("../desktop/src/i18n-catalogs.cjs") as Record<string, Record<string, string>>;
		expect(browserCatalogs).toEqual(i18n.catalogs);
		expect(i18n.t("general", "ja")).toBe("一般");
		expect(i18n.t("general", "zh-CN")).toBe("常规");
	});

	it("covers user-visible React settings copy with the canonical catalog", () => {
		const path = resolve(process.cwd(), "desktop/src/components/settings/SettingsDialog.tsx");
		const source = readFileSync(path, "utf8");
		const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
		const values = new Set<string>();
		const add = (value: string) => { if (value.trim()) values.add(value.trim()); };
		const localizedAttributes = new Set(["label", "description", "placeholder", "aria-label"]);
		const localizedCalls = new Set(["run", "updateSession", "window.prompt", "window.confirm", "requireDesktop"]);
		const visit = (node: ts.Node) => {
			if (ts.isJsxText(node)) add(node.getText(file));
			if (ts.isJsxAttribute(node) && localizedAttributes.has(node.name.getText(file)) && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text);
			if (ts.isPropertyAssignment(node) && ["label", "group", "nativeName"].includes(node.name.getText(file)) && ts.isStringLiteral(node.initializer)) add(node.initializer.text);
			if (ts.isCallExpression(node) && localizedCalls.has(node.expression.getText(file))) {
				for (const argument of node.arguments) if (ts.isStringLiteral(argument)) add(argument.text);
			}
			ts.forEachChild(node, visit);
		};
		visit(file);
		for (const value of [
			"Unknown source",
			"Memory enabled",
			"Memory is ready to collect reusable knowledge from completed work.",
			"No sources reported",
			"Loading version…",
			"Remove this memory?",
			"Delete {provider}?",
			"{name} is unavailable in this Desktop build.",
		]) add(value);
		const intentionallyStable = new Set(["简体中文", "https://api.example.com/v1", "⌘ N", "Enter", "Shift Enter", "Esc", "HTML", "JSONL", "Metis Desktop", "Metis", "·", "%", "+", "—", "6", "12", "24", "48"]);
		const english = new Set(Object.values(i18n.catalogs.en));
		const missing = [...values].filter((value) => !intentionallyStable.has(value) && !english.has(value)).sort();
		expect(missing).toEqual([]);
	});

	it("covers user-visible copy across every React Desktop surface", () => {
		const componentRoot = resolve(process.cwd(), "desktop/src/components");
		const files = [resolve(process.cwd(), "desktop/src/App.tsx")];
		const collectFiles = (directory: string) => {
			for (const name of readdirSync(directory)) {
				const path = resolve(directory, name);
				if (statSync(path).isDirectory()) collectFiles(path);
				else if (path.endsWith(".tsx")) files.push(path);
			}
		};
		collectFiles(componentRoot);

		const values = new Set<string>();
		const add = (value: string) => { if (value.trim()) values.add(value.replace(/\s+/g, " ").trim()); };
		const localizedAttributes = new Set(["aria-label", "placeholder", "title", "alt", "label", "description"]);
		const localizedProperties = new Set(["label", "title", "description", "subtitle", "placeholder", "emptyText", "ariaLabel"]);
		const collectExpression = (expression: ts.Expression | undefined) => {
			if (!expression) return;
			if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) add(expression.text);
			else if (ts.isConditionalExpression(expression)) {
				collectExpression(expression.whenTrue);
				collectExpression(expression.whenFalse);
			} else if (ts.isParenthesizedExpression(expression)) collectExpression(expression.expression);
			else if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) collectExpression(expression.right);
		};

		for (const path of files) {
			const source = readFileSync(path, "utf8");
			const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
			const visit = (node: ts.Node) => {
				if (ts.isJsxText(node)) add(node.getText(file));
				if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) collectExpression(node.expression);
				if (ts.isJsxAttribute(node) && localizedAttributes.has(node.name.getText(file)) && node.initializer) {
					if (ts.isStringLiteral(node.initializer)) add(node.initializer.text);
					else if (ts.isJsxExpression(node.initializer)) collectExpression(node.initializer.expression);
				}
				if (!path.endsWith("/App.tsx") && ts.isPropertyAssignment(node) && localizedProperties.has(node.name.getText(file))) collectExpression(node.initializer);
				ts.forEachChild(node, visit);
			};
			visit(file);
		}

		for (const labels of Object.values(WORK_PROGRESS_LABELS)) for (const label of labels) add(label);
		for (const value of [
			"Choose an option or write your answer.",
			"Could not send your answer. Try again.",
			"Could not cancel this question. Try again.",
			"assigned task",
			"Preparing the next step…",
			"Recovering from a failed tool call…",
			"Subagent",
			"Checking the latest tool result…",
			"Waiting for an agent…",
			"Sending context to an agent…",
			"Checking agent status…",
			"Waiting for your input…",
			"Searching the web…",
			"Searching the codebase…",
			"Reading the current plan…",
			"Checking memory…",
			"Fetching a source…",
			"Reading project files…",
			"Editing files…",
			"Running a command…",
			"Updating the plan…",
			"Running a tool…",
			"{actor} failed; recovering…",
			"{actor} is working: {task}…",
			"Reviewing {actor}’s result…",
			"{actor} is starting: {task}…",
			"Waiting for {actor}…",
			"Sending context to {actor}…",
		]) add(value);

		const intentionallyStable = new Set([
			"简体中文", "https://api.example.com/v1", "⌘ N", "Enter", "Shift Enter", "Esc", "HTML", "JSONL",
			"Metis Desktop", "Metis", "·", "%", "+", "—", "PDF", "ID #", "calendar.google.com", "M",
			"bloub 动画头像", "my-awesome-project",
		]);
		const english = new Set(Object.values(i18n.catalogs.en));
		const missing = [...values].filter((value) => !intentionallyStable.has(value) && /[A-Za-z]/.test(value) && !english.has(value)).sort();
		expect(missing).toEqual([]);
	});
});

describe("Desktop native menu localization", () => {
	it("uses identical translated edit commands on Windows and macOS", () => {
		for (const language of resolvedLanguages) {
			const text = (key: string, variables?: Record<string, unknown>) => i18n.t(key, language, variables);
			const windows = menu.createApplicationMenuTemplate("win32", "Metis", text);
			const mac = menu.createApplicationMenuTemplate("darwin", "Metis", text);
			const macEdit = mac.find((item) => item.submenu?.some((entry) => entry.role === "paste"));
			expect(windows[0].label, language).toBe(text("menuEdit"));
			expect(macEdit?.label, language).toBe(windows[0].label);
			expect(mac.find((item) => item.role === "windowMenu")?.label, language).toBe(text("menuWindow"));
			const context = menu.createEditorContextMenuTemplate({ isEditable: true, editFlags: {} }, text);
			expect(context.find((item) => item.role === "copy")?.label, language).toBe(text("menuCopy"));
		}
	});
});

