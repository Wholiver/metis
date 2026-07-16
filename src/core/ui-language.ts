export const RESOLVED_UI_LANGUAGES = [
	"en",
	"zh-CN",
	"zh-TW",
	"ja",
	"ko",
	"es",
	"fr",
	"de",
	"pt",
	"ru",
	"it",
] as const;

export type ResolvedUiLanguage = (typeof RESOLVED_UI_LANGUAGES)[number];
export type UiLanguage = "auto" | ResolvedUiLanguage;

export interface UiLanguageMetadata {
	code: UiLanguage;
	nativeName: string;
}

export const SUPPORTED_UI_LANGUAGES: ReadonlyArray<UiLanguageMetadata> = [
	{ code: "auto", nativeName: "Automatic" },
	{ code: "en", nativeName: "English" },
	{ code: "zh-CN", nativeName: "简体中文" },
	{ code: "zh-TW", nativeName: "繁體中文" },
	{ code: "ja", nativeName: "日本語" },
	{ code: "ko", nativeName: "한국어" },
	{ code: "es", nativeName: "Español" },
	{ code: "fr", nativeName: "Français" },
	{ code: "de", nativeName: "Deutsch" },
	{ code: "pt", nativeName: "Português" },
	{ code: "ru", nativeName: "Русский" },
	{ code: "it", nativeName: "Italiano" },
];

const UI_LANGUAGE_SET = new Set<UiLanguage>(SUPPORTED_UI_LANGUAGES.map((language) => language.code));

export function isUiLanguage(value: unknown): value is UiLanguage {
	return typeof value === "string" && UI_LANGUAGE_SET.has(value as UiLanguage);
}
