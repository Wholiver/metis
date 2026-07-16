import { setKeybindings } from "@earendil-works/metis-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { LanguageSelectorComponent } from "../src/modes/interactive/components/language-selector.ts";
import { setUiLanguage } from "../src/modes/interactive/i18n/index.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("LanguageSelectorComponent", () => {
	beforeAll(() => initTheme("dark"));
	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
		setUiLanguage("en");
	});

	it("renders automatic plus eleven supported languages and marks current", () => {
		const selector = new LanguageSelectorComponent("zh-CN", () => {}, () => {});
		const output = stripAnsi(selector.render(100).join("\n"));
		expect(output).toContain("Interface Language");
		expect(output).toContain("Automatic");
		expect(output).toContain("✓ 简体中文");
		expect(output).toContain("Italiano");
		expect(output).not.toContain("العربية");
	});

	it("reports the selected language", () => {
		const selected: string[] = [];
		const selector = new LanguageSelectorComponent("en", (language) => selected.push(language), () => {});
		selector.getSelectList().handleInput("\r");
		expect(selected).toEqual(["en"]);
	});

	it("renders non-Latin UI text", () => {
		setUiLanguage("ja");
		const selector = new LanguageSelectorComponent("ja", () => {}, () => {});
		const output = stripAnsi(selector.render(40).join("\n"));
		expect(output).toContain("表示言語");
		expect(output).toContain("✓ 日本語");
	});
});
