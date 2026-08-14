(function initializeDesktopI18n(root, factory) {
	const catalogs = typeof module === "object" && module.exports
		? require("./i18n-catalogs.js")
		: root?.metisDesktopI18nCatalogs;
	const api = factory(catalogs, root);
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.metisDesktopI18n = api;
})(typeof window === "object" ? window : undefined, (catalogs, root) => {
	if (!catalogs?.en || !catalogs?.["zh-CN"]) throw new Error("Desktop translation catalogs are not loaded");

	const languageMetadata = [
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
	const languages = languageMetadata.map(({ code }) => code);
	const resolvedLanguages = languages.filter((language) => language !== "auto");
	const originalText = new WeakMap();
	const originalAttributes = new WeakMap();
	const explicitAttributeNames = ["aria-label", "title", "placeholder"];
	let activeLanguage = "auto";
	let observer;

	function browserLocales() {
		if (!root?.navigator) return [];
		return root.navigator.languages || [root.navigator.language];
	}

	function resolve(language = "auto", locales = browserLocales()) {
		if (language !== "auto" && catalogs[language]) return language;
		for (const locale of locales || []) {
			if (catalogs[locale]) return locale;
			const normalized = String(locale).toLowerCase();
			const base = normalized.split("-")[0];
			if (base === "zh") return normalized.includes("tw") || normalized.includes("hk") || normalized.includes("mo") ? "zh-TW" : "zh-CN";
			const match = resolvedLanguages.find((code) => code.toLowerCase() === base);
			if (match) return match;
		}
		return "en";
	}

	function t(key, language = "auto", variables = {}, locales) {
		const resolved = resolve(language, locales);
		const value = catalogs[resolved]?.[key];
		if (typeof value !== "string") return key;
		return value.replace(/\{(\w+)\}/g, (_match, name) => String(variables[name] ?? `{${name}}`));
	}

	function compileTemplate(key, value) {
		const names = [];
		let pattern = "";
		let cursor = 0;
		for (const match of value.matchAll(/\{(\w+)\}/g)) {
			pattern += escapeRegex(value.slice(cursor, match.index));
			pattern += "([\\s\\S]+?)";
			names.push(match[1]);
			cursor = match.index + match[0].length;
		}
		pattern += escapeRegex(value.slice(cursor));
		return { key, names, pattern: new RegExp(`^${pattern}$`) };
	}

	function escapeRegex(value) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	const exactSourceCandidates = new Map();
	const exactSources = new Map();
	const templateSources = [];
	for (const sourceLanguage of ["en", "zh-CN"]) {
		for (const [key, value] of Object.entries(catalogs[sourceLanguage])) {
			if (/\{\w+\}/.test(value)) templateSources.push(compileTemplate(key, value));
			else exactSourceCandidates.set(value, new Set([...(exactSourceCandidates.get(value) || []), key]));
		}
	}
	for (const [value, keys] of exactSourceCandidates) {
		const signatures = new Set([...keys].map((key) => resolvedLanguages.map((language) => catalogs[language][key]).join("\u0000")));
		if (signatures.size === 1) exactSources.set(value, [...keys][0]);
	}

	function matchSource(raw) {
		const trimmed = raw.trim();
		if (!trimmed) return undefined;
		const prefix = raw.slice(0, raw.indexOf(trimmed));
		const suffix = raw.slice(raw.indexOf(trimmed) + trimmed.length);
		const exactKey = exactSources.get(trimmed);
		if (exactKey) return { key: exactKey, variables: {}, prefix, suffix };
		for (const template of templateSources) {
			const match = template.pattern.exec(trimmed);
			if (!match) continue;
			const variables = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
			return { key: template.key, variables, prefix, suffix };
		}
		return undefined;
	}

	function shouldSkip(target) {
		if (!target) return false;
		const element = target.nodeType === 1 ? target : target.parentElement;
		return Boolean(element?.closest?.('[translate="no"], [data-no-translate]'));
	}

	function translateTextNode(node, language) {
		if (shouldSkip(node)) return;
		const raw = node.nodeValue || "";
		let source = originalText.get(node);
		if (!source || raw !== source.rendered) source = matchSource(raw);
		if (!source) {
			originalText.delete(node);
			return;
		}
		const rendered = `${source.prefix}${t(source.key, language, source.variables)}${source.suffix}`;
		source.rendered = rendered;
		originalText.set(node, source);
		if (raw !== rendered) node.nodeValue = rendered;
	}

	function explicitAttributeKey(element, attribute) {
		return element.getAttribute(`data-i18n-${attribute}`);
	}

	function translateAttribute(element, attribute, language) {
		if (shouldSkip(element)) return;
		const explicitKey = explicitAttributeKey(element, attribute);
		const raw = element.getAttribute(attribute);
		if (raw == null) return;
		let sources = originalAttributes.get(element);
		if (!sources) {
			sources = {};
			originalAttributes.set(element, sources);
		}
		let source = sources[attribute];
		if (explicitKey) source = { key: explicitKey, variables: {} };
		else if (!source || raw !== source.rendered) source = matchSource(raw);
		if (!source) {
			delete sources[attribute];
			return;
		}
		const rendered = t(source.key, language, source.variables);
		source.rendered = rendered;
		sources[attribute] = source;
		if (raw !== rendered) element.setAttribute(attribute, rendered);
	}

	function translateElement(element, language) {
		if (shouldSkip(element)) return;
		const explicitKey = element.getAttribute?.("data-i18n");
		if (explicitKey && element.childElementCount === 0) {
			const rendered = t(explicitKey, language);
			if (element.textContent !== rendered) element.textContent = rendered;
		}
		for (const attribute of explicitAttributeNames) translateAttribute(element, attribute, language);
	}

	function translateSubtree(target, language = activeLanguage) {
		if (!target || shouldSkip(target)) return;
		if (target.nodeType === 3) {
			translateTextNode(target, language);
			return;
		}
		if (target.nodeType !== 1 && target.nodeType !== 9 && target.nodeType !== 11) return;
		if (target.nodeType === 1) translateElement(target, language);
		const documentRef = target.ownerDocument || target;
		const walker = documentRef.createTreeWalker(target, (root?.NodeFilter || globalThis.NodeFilter).SHOW_ELEMENT | (root?.NodeFilter || globalThis.NodeFilter).SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			if (shouldSkip(node)) continue;
			if (node.nodeType === 3) translateTextNode(node, language);
			else translateElement(node, language);
		}
	}

	function translateDocument(language = activeLanguage) {
		activeLanguage = languages.includes(language) ? language : "auto";
		if (!root?.document?.body) return resolve(activeLanguage);
		translateSubtree(root.document.body, activeLanguage);
		return resolve(activeLanguage);
	}

	function observeDocument() {
		if (!root?.document?.body || observer) return;
		observer = new root.MutationObserver((records) => {
			for (const record of records) {
				if (shouldSkip(record.target)) continue;
				if (record.type === "characterData") translateTextNode(record.target, activeLanguage);
				else if (record.type === "attributes") translateAttribute(record.target, record.attributeName, activeLanguage);
				else for (const node of record.addedNodes) translateSubtree(node, activeLanguage);
			}
		});
		observer.observe(root.document.body, {
			attributes: true,
			attributeFilter: [...explicitAttributeNames, ...explicitAttributeNames.map((name) => `data-i18n-${name}`)],
			characterData: true,
			childList: true,
			subtree: true,
		});
	}

	function assertCatalogs() {
		const expectedKeys = Object.keys(catalogs.en).sort();
		for (const language of resolvedLanguages) {
			const actualKeys = Object.keys(catalogs[language] || {}).sort();
			if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error(`${language} Desktop catalog is incomplete`);
			for (const key of expectedKeys) {
				const expected = [...catalogs.en[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
				const actual = [...catalogs[language][key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
				if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${language}.${key} placeholders do not match English`);
			}
		}
		return true;
	}

	assertCatalogs();
	return { catalogs, languages, languageMetadata, resolve, t, matchSource, translateDocument, translateSubtree, observeDocument, assertCatalogs };
});
