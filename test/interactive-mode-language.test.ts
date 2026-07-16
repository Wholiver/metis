import { setKeybindings } from "@earendil-works/metis-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { UiLanguage } from "../src/core/ui-language.ts";
import { LanguageSelectorComponent } from "../src/modes/interactive/components/language-selector.ts";
import { setUiLanguage } from "../src/modes/interactive/i18n/index.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

interface LanguageModePrototype {
	showLanguageSelector(this: Record<string, unknown>): void;
}

describe("InteractiveMode /language", () => {
	beforeAll(() => initTheme("dark"));
	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
		setUiLanguage("en");
	});

	it("persists selection, switches locale, and invalidates visible UI", () => {
		let component: LanguageSelectorComponent | undefined;
		let saved: UiLanguage | undefined;
		let doneCalls = 0;
		let autocompleteRefreshes = 0;
		let footerInvalidations = 0;
		let uiInvalidations = 0;
		let renders = 0;
		const statuses: string[] = [];
		const fakeMode = {
			settingsManager: {
				getUiLanguage: () => "en" as UiLanguage,
				setUiLanguage: (language: UiLanguage) => {
					saved = language;
				},
			},
			showSelector: (factory: (done: () => void) => { component: LanguageSelectorComponent }) => {
				const result = factory(() => doneCalls++);
				component = result.component;
			},
			setupAutocompleteProvider: () => autocompleteRefreshes++,
			builtInHeader: undefined,
			localizedResourceSections: [],
			footer: { invalidate: () => footerInvalidations++ },
			ui: {
				invalidate: () => uiInvalidations++,
				requestRender: () => renders++,
			},
			showStatus: (status: string) => statuses.push(status),
		};

		(InteractiveMode.prototype as unknown as LanguageModePrototype).showLanguageSelector.call(fakeMode);
		expect(component).toBeInstanceOf(LanguageSelectorComponent);
		component!.getSelectList().setSelectedIndex(2);
		component!.getSelectList().handleInput("\r");

		expect(saved).toBe("zh-CN");
		expect(doneCalls).toBe(1);
		expect(autocompleteRefreshes).toBe(1);
		expect(footerInvalidations).toBe(1);
		expect(uiInvalidations).toBe(1);
		expect(renders).toBe(1);
		expect(statuses).toEqual(["界面语言：简体中文"]);
	});
});
