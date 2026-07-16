import {
	RESOLVED_UI_LANGUAGES,
	type ResolvedUiLanguage,
	type UiLanguage,
} from "../../../core/ui-language.ts";
import { CATALOGS, en, type MessageKey, type TranslationCatalog, type TranslationValue } from "./catalogs.ts";

export type TranslationParams = Record<string, string | number | boolean | undefined>;
type LanguageListener = (language: ResolvedUiLanguage, preference: UiLanguage) => void;

const resolvedLanguageSet = new Set<string>(RESOLVED_UI_LANGUAGES);
let currentPreference: UiLanguage = "auto";
let currentLanguage: ResolvedUiLanguage = "en";
const listeners = new Set<LanguageListener>();

function normalizeLocaleCandidate(candidate: string | undefined): ResolvedUiLanguage | undefined {
	if (!candidate) return undefined;
	const normalized = candidate.trim().replace(/\..*$/, "").replace(/@.*$/, "").replaceAll("_", "-");
	if (!normalized || normalized === "C" || normalized === "POSIX") return undefined;

	const parts = normalized.split("-");
	const language = parts[0]?.toLowerCase();
	if (language === "zh") {
		const qualifiers = new Set(parts.slice(1).map((part) => part.toLowerCase()));
		return qualifiers.has("hant") || qualifiers.has("tw") || qualifiers.has("hk") || qualifiers.has("mo")
			? "zh-TW"
			: "zh-CN";
	}
	if (language && resolvedLanguageSet.has(language)) return language as ResolvedUiLanguage;
	return undefined;
}

export function resolveUiLanguage(
	preference: UiLanguage,
	environment: NodeJS.ProcessEnv = process.env,
	intlLocale = Intl.DateTimeFormat().resolvedOptions().locale,
): ResolvedUiLanguage {
	if (preference !== "auto") return preference;
	for (const candidate of [environment.LC_ALL, environment.LC_MESSAGES, environment.LANG, intlLocale]) {
		if (!candidate) continue;
		const normalizedCandidate = candidate.trim();
		if (!normalizedCandidate || normalizedCandidate === "C" || normalizedCandidate === "POSIX") continue;
		return normalizeLocaleCandidate(candidate) ?? "en";
	}
	return "en";
}

export function setUiLanguage(
	preference: UiLanguage,
	environment: NodeJS.ProcessEnv = process.env,
	intlLocale?: string,
): ResolvedUiLanguage {
	const nextLanguage = resolveUiLanguage(preference, environment, intlLocale);
	const changed = nextLanguage !== currentLanguage || preference !== currentPreference;
	currentPreference = preference;
	currentLanguage = nextLanguage;
	if (changed) {
		for (const listener of listeners) listener(currentLanguage, currentPreference);
	}
	return currentLanguage;
}

export function getUiLanguage(): ResolvedUiLanguage {
	return currentLanguage;
}

export function getUiLanguagePreference(): UiLanguage {
	return currentPreference;
}

export function onUiLanguageChange(listener: LanguageListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function selectPlural(value: TranslationValue, count: number | undefined): string {
	if (typeof value === "string") return value;
	const numericCount = count ?? 0;
	const rule = new Intl.PluralRules(currentLanguage).select(numericCount);
	return value[rule] ?? value.other ?? en["common.none"];
}

export function t(key: MessageKey, params: TranslationParams = {}): string {
	const catalog = CATALOGS[currentLanguage] ?? en;
	const value = catalog[key] ?? en[key];
	const template = selectPlural(value, typeof params.count === "number" ? params.count : undefined);
	return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
		const replacement = params[name];
		return replacement === undefined ? match : String(replacement);
	});
}

export function formatUiNumber(value: number): string {
	return new Intl.NumberFormat(currentLanguage).format(value);
}

export function getCatalogs(): Readonly<Record<ResolvedUiLanguage, TranslationCatalog>> {
	return CATALOGS;
}

const BUILTIN_COMMAND_KEYS: Partial<Record<string, MessageKey>> = {
	settings: "command.settings", language: "command.language", model: "command.model",
	"scoped-models": "command.scoped-models", export: "command.export", import: "command.import",
	share: "command.share", copy: "command.copy", name: "command.name", session: "command.session",
	changelog: "command.changelog", hotkeys: "command.hotkeys", fork: "command.fork", clone: "command.clone",
	tree: "command.tree", trust: "command.trust", login: "command.login", logout: "command.logout",
	new: "command.new", compact: "command.compact", resume: "command.resume", reload: "command.reload", quit: "command.quit",
};

export function translateBuiltinCommandDescription(
	name: string,
	fallback: string,
	params: TranslationParams = {},
): string {
	const key = BUILTIN_COMMAND_KEYS[name];
	return key ? t(key, params) : fallback;
}
