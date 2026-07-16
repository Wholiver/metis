import { afterEach, describe, expect, it } from "vitest";
import {
	getCatalogs,
	getUiLanguage,
	resolveUiLanguage,
	setUiLanguage,
	t,
} from "../src/modes/interactive/i18n/index.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import {
	getSettingLabelCatalogs,
	translateSettingLabel,
} from "../src/modes/interactive/i18n/settings-labels.ts";

function placeholders(value: string): string[] {
	return [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]!).sort();
}

describe("TUI language", () => {
	afterEach(() => setUiLanguage("en"));

	it("resolves locale environment variables in priority order", () => {
		expect(resolveUiLanguage("auto", { LC_ALL: "ja_JP.UTF-8", LANG: "de_DE.UTF-8" }, "fr-FR")).toBe("ja");
		expect(resolveUiLanguage("auto", { LC_MESSAGES: "zh_TW.UTF-8" }, "en-US")).toBe("zh-TW");
		expect(resolveUiLanguage("auto", { LANG: "zh_Hans_CN.UTF-8" }, "en-US")).toBe("zh-CN");
		expect(resolveUiLanguage("auto", { LANG: "nl_NL.UTF-8" }, "nl-NL")).toBe("en");
	});

	it("honors an explicit language", () => {
		expect(resolveUiLanguage("it", { LANG: "ja_JP.UTF-8" }, "ja-JP")).toBe("it");
	});

	it("switches catalogs and interpolates named values", () => {
		setUiLanguage("zh-CN");
		expect(getUiLanguage()).toBe("zh-CN");
		expect(t("language.selected", { language: "日本語" })).toBe("界面语言：日本語");
	});

	it("uses locale-aware plural rules", () => {
		setUiLanguage("ru");
		expect(t("common.itemCount", { count: 1 })).toBe("1 элемент");
		expect(t("common.itemCount", { count: 2 })).toBe("2 элемента");
		expect(t("common.itemCount", { count: 5 })).toBe("5 элементов");
	});

	it("registers /language as a built-in command", () => {
		expect(BUILTIN_SLASH_COMMANDS.find((command) => command.name === "language")?.description).toBe(
			"Select interface language",
		);
	});

	it("provides complete localized settings labels", () => {
		const catalogs = getSettingLabelCatalogs();
		const expectedKeys = Object.keys(catalogs.en).sort();
		for (const [locale, catalog] of Object.entries(catalogs)) {
			expect(Object.keys(catalog).sort(), locale).toEqual(expectedKeys);
		}
		setUiLanguage("zh-CN");
		expect(translateSettingLabel("theme", "Theme")).toBe("主题");
		expect(translateSettingLabel("extension-defined", "Extension value")).toBe("Extension value");
	});

	it("keeps every catalog complete with matching placeholders", () => {
		const catalogs = getCatalogs();
		const english = catalogs.en;
		for (const [locale, catalog] of Object.entries(catalogs)) {
			expect(Object.keys(catalog).sort(), locale).toEqual(Object.keys(english).sort());
			for (const key of Object.keys(english) as Array<keyof typeof english>) {
				const expected = english[key];
				const actual = catalog[key];
				expect(typeof actual, `${locale}:${key}`).toBe(typeof expected);
				if (typeof expected === "string" && typeof actual === "string") {
					expect(placeholders(actual), `${locale}:${key}`).toEqual(placeholders(expected));
				} else if (typeof expected === "object" && typeof actual === "object") {
					const expectedPlaceholders = new Set(Object.values(expected).flatMap((value) => placeholders(value ?? "")));
					const actualPlaceholders = new Set(Object.values(actual).flatMap((value) => placeholders(value ?? "")));
					expect(actualPlaceholders, `${locale}:${key}`).toEqual(expectedPlaceholders);
				}
			}
		}
	});
});
