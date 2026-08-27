const source = require("./src/i18n-catalogs.cjs");

function resolveLocale(preference, localeCandidates = []) {
  if (preference && preference !== "auto") {
    if (source[preference]) return preference;
    const short = preference.split("-")[0];
    if (source[short]) return short;
  }
  for (const candidate of localeCandidates) {
    if (!candidate) continue;
    if (source[candidate]) return candidate;
    if (/^zh-(HK|MO|TW)$/i.test(candidate) && source["zh-TW"]) return "zh-TW";
    if (/^zh-(CN|SG)$/i.test(candidate) && source["zh-CN"]) return "zh-CN";
    const short = candidate.split("-")[0];
    if (source[short]) return short;
  }
  return "en";
}

function interpolate(template, variables) {
  if (!variables || typeof variables !== "object") return template;
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return key in variables ? String(variables[key]) : `{${key}}`;
  });
}

function t(key, language = "en", variables = {}, localeCandidates = []) {
  const locale = resolveLocale(language, localeCandidates);
  const catalog = source[locale] || source.en || {};
  const fallback = source.en || {};
  const raw = catalog[key] ?? fallback[key] ?? key;
  return interpolate(raw, variables);
}

module.exports = {
	t,
	resolve: resolveLocale,
	resolveLocale,
	languages: ["auto", ...Object.keys(source)],
	catalogs: source,
};

