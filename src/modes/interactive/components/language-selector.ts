import {
	Container,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	Spacer,
	Text,
} from "@earendil-works/metis-tui";
import {
	SUPPORTED_UI_LANGUAGES,
	type UiLanguage,
} from "../../../core/ui-language.ts";
import { getUiLanguage, t } from "../i18n/index.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const LANGUAGE_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 18,
	maxPrimaryColumnWidth: 32,
};

export class LanguageSelectorComponent extends Container {
	private readonly selectList: SelectList;

	constructor(currentLanguage: UiLanguage, onSelect: (language: UiLanguage) => void, onCancel: () => void) {
		super();
		const detectedLanguage = SUPPORTED_UI_LANGUAGES.find((language) => language.code === getUiLanguage());
		const items: SelectItem[] = SUPPORTED_UI_LANGUAGES.map((language) => {
			const isCurrent = language.code === currentLanguage;
			const descriptionParts: string[] = [];
			if (isCurrent) descriptionParts.push(`(${t("common.current")})`);
			if (language.code === "auto" && detectedLanguage) {
				descriptionParts.push(t("language.detected", { language: detectedLanguage.nativeName }));
			}
			return {
				value: language.code,
				label: `${isCurrent ? "✓ " : "  "}${language.code === "auto" ? t("language.automatic") : language.nativeName}`,
				description: descriptionParts.join(" · ") || undefined,
			};
		});

		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.fg("accent", `  ${t("language.title")}`), 0, 0));
		this.addChild(new Spacer(1));
		this.selectList = new SelectList(items, 12, getSelectListTheme(), LANGUAGE_SELECT_LIST_LAYOUT);
		const currentIndex = SUPPORTED_UI_LANGUAGES.findIndex((language) => language.code === currentLanguage);
		if (currentIndex >= 0) this.selectList.setSelectedIndex(currentIndex);
		this.selectList.onSelect = (item) => onSelect(item.value as UiLanguage);
		this.selectList.onCancel = onCancel;
		this.addChild(this.selectList);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", `  ${t("language.hint")}`), 0, 0));
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
