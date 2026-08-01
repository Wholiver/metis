import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const i18n = require("../desktop/renderer/i18n.js") as {
	catalogs: Record<string, Record<string, string>>;
	languages: string[];
	assertCatalogs: () => boolean;
	matchSource: (value: string) => { key: string; variables: Record<string, string> } | undefined;
	resolve: (language: string, locales?: string[]) => string;
	t: (key: string, language: string, variables?: Record<string, unknown>) => string;
	translateSubtree: (target: { nodeType: number; nodeValue: string }, language: string) => void;
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
	"onboardingSetting",
	"session",
	"thinkingMinimal",
	"timelineMessage",
	"version",
]);

describe("Desktop translation catalogs", () => {
	it("provides every key and matching placeholders in every selectable language", () => {
		expect(i18n.assertCatalogs()).toBe(true);
		const expectedKeys = Object.keys(i18n.catalogs.en).sort();
		expect(expectedKeys.length).toBeGreaterThan(350);
		for (const language of resolvedLanguages) {
			expect(Object.keys(i18n.catalogs[language]).sort(), language).toEqual(expectedKeys);
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

	it("resolves Automatic consistently for Windows and macOS locale forms", () => {
		expect(i18n.resolve("auto", ["zh-HK"])).toBe("zh-TW");
		expect(i18n.resolve("auto", ["zh-SG"])).toBe("zh-CN");
		expect(i18n.resolve("auto", ["fr-CA"])).toBe("fr");
		expect(i18n.resolve("auto", ["unknown"])).toBe("en");
	});

	it("retranslates reused dynamic nodes without retaining a previous language", () => {
		const node = { nodeType: 3, nodeValue: "正在保存…" };
		i18n.translateSubtree(node, "fr");
		expect(node.nodeValue).toBe(i18n.t("saving", "fr"));
		i18n.translateSubtree(node, "de");
		expect(node.nodeValue).toBe(i18n.t("saving", "de"));
		node.nodeValue = "已完成。";
		i18n.translateSubtree(node, "ja");
		expect(node.nodeValue).toBe(i18n.t("completed", "ja"));
	});
});

describe("Desktop translation coverage", () => {
	it("maps every visible HTML text and attribute to an unambiguous translation key", () => {
		const html = readFileSync(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
		const $ = load(html);
		$("script, style, svg").remove();
		const allowedStatic = new Set(["Metis", "metis_v2", "Subagent", "HTML", "JSONL", "gh", "OAuth", "Metis Server", "Metis Desktop"]);
		const sourceKeys = new Map<string, string[]>();
		for (const [key, value] of Object.entries(i18n.catalogs["zh-CN"])) sourceKeys.set(value, [...(sourceKeys.get(value) || []), key]);
		const ambiguousSources = new Set([...sourceKeys].filter(([, keys]) => (
			new Set(keys.map((key) => i18n.catalogs.en[key])).size > 1
		)).map(([value]) => value));
		const unresolved: string[] = [];
		$("*").each((_index, element) => {
			if ($(element).closest("#settingsLanguageSelect").length) return;
			for (const node of $(element).contents().toArray()) {
				if (node.type !== "text") continue;
				const value = node.data.trim();
				if (!value || allowedStatic.has(value) || /^[-+✕—·\d.%/:]+$/.test(value) || /^https?:/.test(value)) continue;
				if (!$(element).attr("data-i18n") && !i18n.matchSource(value)) unresolved.push(value);
				if (ambiguousSources.has(value) && !$(element).attr("data-i18n")) unresolved.push(`ambiguous=${value}`);
			}
			for (const attribute of ["aria-label", "title", "placeholder"]) {
				const value = $(element).attr(attribute)?.trim();
				if (!value || allowedStatic.has(value) || /^https?:/.test(value)) continue;
				if (!$(element).attr(`data-i18n-${attribute}`) && !i18n.matchSource(value)) unresolved.push(`${attribute}=${value}`);
				if (ambiguousSources.has(value) && !$(element).attr(`data-i18n-${attribute}`)) unresolved.push(`ambiguous-${attribute}=${value}`);
			}
		});
		expect([...new Set(unresolved)]).toEqual([]);
	});

	it("keeps Chinese literals out of renderer and main-process UI code", () => {
		const sources = [
			"../desktop/renderer/app.js",
			"../desktop/renderer/onboarding.js",
			"../desktop/main.cjs",
			"../desktop/main-menu.cjs",
		].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
		const allowedInternalPatterns = [
			/文件 .* 的内容如下/,
			/已添加\(视频\|文件\)/,
			/match\[1\] === "视频"/,
			/runStateText\.includes\("确认"\).*includes\("审批"\)/,
		];
		const remaining = sources.flatMap((source) => source.split("\n"))
			.filter((line) => /[一-鿿]/.test(line))
			.filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
			.filter((line) => !allowedInternalPatterns.some((pattern) => pattern.test(line)));
		expect(remaining).toEqual([]);
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

describe("Desktop settings platform parity", () => {
	it("keeps the Windows settings layout aligned with the macOS baseline", () => {
		const css = readFileSync(new URL("../desktop/renderer/styles.css", import.meta.url), "utf8");
		const platformSettingsRules = [...css.matchAll(/body\.platform-(?:darwin|win32)[^{]*\.settings-[^{]*\{[^}]*\}/g)]
			.map(([rule]) => rule.replace(/\s+/g, " ").trim());
		expect(platformSettingsRules).toEqual([
			"body.platform-win32 .settings-main-drag { right: var(--titlebar-overlay-width); }",
		]);
	});
});
