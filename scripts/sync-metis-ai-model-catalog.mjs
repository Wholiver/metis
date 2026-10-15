import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const DEFAULT_UPSTREAM_VERSION = "1.2.0";
const upstreamVersion = process.argv[2] ?? DEFAULT_UPSTREAM_VERSION;
const upstreamSpec = `@earendil-works/pi-ai@${upstreamVersion}`;
const projectRoot = resolve(import.meta.dirname, "..");
const targetDist = join(projectRoot, "vendor/metis-ai/dist");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "metis-ai-model-catalog-"));

function ensureAfter(source, anchor, addition, filePath) {
	if (source.includes(addition)) return source;
	if (!source.includes(anchor)) throw new Error(`Cannot patch ${filePath}: missing anchor: ${anchor}`);
	return source.replace(anchor, `${anchor}${addition}`);
}

function patchFile(relativePath, patch) {
	const filePath = join(targetDist, relativePath);
	const source = readFileSync(filePath, "utf8");
	writeFileSync(filePath, patch(source, filePath));
}

try {
	const packResult = JSON.parse(
		execFileSync("npm", ["pack", upstreamSpec, "--json", "--pack-destination", temporaryDirectory], {
			encoding: "utf8",
		}),
	);
	const tarball = join(temporaryDirectory, packResult[0].filename);
	execFileSync("tar", ["-xzf", tarball, "-C", temporaryDirectory]);

	const sourceRoot = join(temporaryDirectory, "package");
	const sourceDist = join(sourceRoot, "dist");
	const sourceProviders = join(sourceDist, "providers");
	const targetProviders = join(targetDist, "providers");

	// 1. Preserve Metis-specific files before updating
	const preservedFiles = new Map();
	const filesToPreserve = [
		"providers/data/orcarouter.json",
		"providers/orcarouter.js",
		"providers/orcarouter.js.map",
		"providers/orcarouter.d.ts",
		"providers/orcarouter.d.ts.map",
		"providers/orcarouter.models.js",
		"providers/orcarouter.models.js.map",
		"providers/orcarouter.models.d.ts",
		"providers/orcarouter.models.d.ts.map",
		"providers/cohere.js",
		"providers/cohere.js.map",
		"providers/cohere.d.ts",
		"providers/cohere.d.ts.map",
		"providers/cohere.models.js",
		"providers/cohere.models.js.map",
		"providers/cohere.models.d.ts",
		"providers/cohere.models.d.ts.map",
		"images-models.js",
		"images-models.js.map",
		"images-models.d.ts",
		"images-models.d.ts.map",
		// CRITICAL: NEVER update OAuth callback page! Metis custom branding must be preserved.
		"utils/oauth/oauth-page.js",
		"utils/oauth/oauth-page.d.ts",
		"utils/oauth/oauth-page.js.map",
		"utils/oauth/oauth-page.d.ts.map",
	];
	for (const rel of filesToPreserve) {
		const fullPath = join(targetDist, rel);
		if (existsSync(fullPath)) {
			preservedFiles.set(rel, readFileSync(fullPath));
		}
	}

	// 2. Copy all top-level files from source dist
	for (const entry of readdirSync(sourceDist)) {
		const sourceEntry = join(sourceDist, entry);
		const targetEntry = join(targetDist, entry);
		const stat = statSync(sourceEntry);
		if (!stat.isDirectory()) {
			cpSync(sourceEntry, targetEntry);
		}
	}

	// 3. Copy top-level directories
	for (const dirName of ["api", "auth", "compat"]) {
		const sourceDir = join(sourceDist, dirName);
		const targetDir = join(targetDist, dirName);
		if (existsSync(sourceDir)) {
			cpSync(sourceDir, targetDir, { recursive: true });
		}
	}

	// 4. Copy provider data directory
	const targetData = join(targetProviders, "data");
	rmSync(targetData, { recursive: true, force: true });
	cpSync(join(sourceProviders, "data"), targetData, { recursive: true });

	// 5. Copy provider adapters and models
	for (const name of readdirSync(sourceProviders)) {
		if (name === "data") continue;
		cpSync(join(sourceProviders, name), join(targetProviders, name), { recursive: true });
	}

	// 6. Copy utils (preserving oauth-page!)
	const targetUtils = join(targetDist, "utils");
	const sourceUtils = join(sourceDist, "utils");
	if (existsSync(sourceUtils)) {
		for (const name of readdirSync(sourceUtils)) {
			if (name.startsWith("oauth-page")) continue;
			cpSync(join(sourceUtils, name), join(targetUtils, name), { recursive: true });
		}
	}

	// 7. Restore preserved files (cohere, orcarouter, oauth-page)
	for (const [rel, content] of preservedFiles.entries()) {
		writeFileSync(join(targetDist, rel), content);
	}

	// Ensure top-level utils/oauth-page.js and utils/oauth-page.d.ts also match Metis branded page
	if (preservedFiles.has("utils/oauth/oauth-page.js")) {
		writeFileSync(join(targetDist, "utils/oauth-page.js"), preservedFiles.get("utils/oauth/oauth-page.js"));
	}
	if (preservedFiles.has("utils/oauth/oauth-page.d.ts")) {
		writeFileSync(join(targetDist, "utils/oauth-page.d.ts"), preservedFiles.get("utils/oauth/oauth-page.d.ts"));
	}

	// Update .manifest.json to acknowledge orcarouter
	const manifestPath = join(targetData, ".manifest.json");
	if (existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (manifest.files && !manifest.files["orcarouter.json"]) {
				manifest.files["orcarouter.json"] = "orcarouter";
				writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			}
		} catch { /* ignore manifest formatting */ }
	}

	// 8. Patch models.generated.js and models.generated.d.ts for cohere & orcarouter
	patchFile("models.generated.js", (source, filePath) => {
		let next = ensureAfter(
			source,
			'import { CEREBRAS_CLASSIFIER_MODELS, CEREBRAS_IMAGE_MODELS, CEREBRAS_MODELS } from "./providers/cerebras.models.js";\n',
			'import { COHERE_MODELS } from "./providers/cohere.models.js";\nimport { ORCAROUTER_MODELS } from "./providers/orcarouter.models.js";\n',
			filePath,
		);
		next = ensureAfter(
			next,
			'    "cerebras": CEREBRAS_MODELS,\n',
			'    "cohere": COHERE_MODELS,\n    "orcarouter": ORCAROUTER_MODELS,\n',
			filePath,
		);
		return next;
	});

	patchFile("models.generated.d.ts", (source, filePath) => {
		let next = ensureAfter(
			source,
			'import { CEREBRAS_CLASSIFIER_MODELS, CEREBRAS_IMAGE_MODELS, CEREBRAS_MODELS } from "./providers/cerebras.models.ts";\n',
			'import { COHERE_MODELS } from "./providers/cohere.models.ts";\nimport { ORCAROUTER_MODELS } from "./providers/orcarouter.models.ts";\n',
			filePath,
		);
		next = ensureAfter(
			next,
			'    readonly "cerebras": typeof CEREBRAS_MODELS;\n',
			'    readonly "cohere": typeof COHERE_MODELS;\n    readonly "orcarouter": typeof ORCAROUTER_MODELS;\n',
			filePath,
		);
		return next;
	});

	// 9. Patch providers/all.js
	patchFile("providers/all.js", (source, filePath) => {
		let next = ensureAfter(
			source,
			'import { openrouterProvider } from "./openrouter.js";\n',
			'import { orcarouterProvider } from "./orcarouter.js";\n',
			filePath,
		);
		next = ensureAfter(
			next,
			"        openrouterProvider(),\n",
			"        orcarouterProvider(),\n",
			filePath,
		);
		return next;
	});

	// 10. Patch env-api-keys.js
	patchFile("env-api-keys.js", (source, filePath) => {
		let next = source;
		if (!next.includes('orcarouter: "ORCAROUTER_API_KEY"')) {
			next = ensureAfter(
				next,
				'        openrouter: "OPENROUTER_API_KEY",\n',
				'        orcarouter: "ORCAROUTER_API_KEY",\n        cohere: "COHERE_API_KEY",\n',
				filePath,
			);
		}
		return next;
	});

	// 10.1 Patch model-catalog.js and model-catalog.d.ts
	patchFile("model-catalog.js", (source) => {
		let next = source;
		if (next.includes("function flattenModelCatalog(groups, type)")) {
			next = next.replaceAll("flattenModelCatalog(groups,", "_flattenModelCatalog(groups,");
			next = next.replace(
				"model.type === type",
				'model.type === type || (!model.type && type === "chat")',
			);
			next = `${next}
export function flattenModelCatalog(groupsOrProvider, typeOrGroups) {
    if (typeof typeOrGroups === "string") {
        return _flattenModelCatalog(groupsOrProvider, typeOrGroups);
    }
    return flattenChatModelCatalog(groupsOrProvider, typeOrGroups);
}
`;
		}
		return next;
	});

	patchFile("model-catalog.d.ts", (source) => {
		if (!source.includes("export declare function flattenModelCatalog")) {
			return `${source}\nexport type ModelCatalog<TGroups extends ModelGroups, TProvider extends ProviderId> = ChatModelCatalog<TGroups, TProvider>;\nexport declare function flattenModelCatalog<const TProvider extends ProviderId, const TGroups extends ModelGroups>(_provider: TProvider, groups: TGroups): ChatModelCatalog<TGroups, TProvider>;\n`;
		}
		return source;
	});

	// 10.2 Patch oauth.js and oauth.d.ts to re-export utils/oauth
	patchFile("oauth.js", () => 'export * from "./utils/oauth/index.js";\n');
	patchFile("oauth.d.ts", () => 'export * from "./utils/oauth/index.ts";\n');

	// 11. Patch types.d.ts
	patchFile("types.d.ts", (source) => {
		let next = source;
		const knownProviderMatch = next.match(/^export type KnownProvider = (.+);$/m);
		if (knownProviderMatch) {
			const providerIds = [...knownProviderMatch[1].matchAll(/"([^"]+)"/g)]
				.map((match) => match[1])
				.filter((provider) => provider !== "radius" && provider !== "typesafe");
			if (!providerIds.includes("cohere")) providerIds.unshift("cohere");
			if (!providerIds.includes("orcarouter")) providerIds.push("orcarouter");
			next = next.replace(
				/^export type KnownProvider = .+;$/m,
				`export type KnownProvider = ${providerIds.map((id) => `"${id}"`).join(" | ")};`,
			);
		}
		if (!next.includes("export interface ThinkingOption")) {
			next = next.replace(
				/export type \{ CacheRetention, ModelCost, ModelCostRates, ModelCostTier, ModelImageInputLimits, ModelImageResizeOptions, ModelInputLimits, ModelInputModality, ModelPromptCache, ModelThinkingLevel, ThinkingLevel, ThinkingLevelMap, \} from "\.\/providers\/model-schema\.ts";/,
				`export type { CacheRetention, ModelCost, ModelCostRates, ModelCostTier, ModelImageInputLimits, ModelImageResizeOptions, ModelInputLimits, ModelInputModality, ModelPromptCache, ThinkingLevelMap, } from "./providers/model-schema.ts";
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | (string & {});
export type ModelThinkingLevel = "off" | ThinkingLevel;
export interface ThinkingOption {
    id: string;
    label: string;
    value: string;
}`,
			);
			next = next.replace(
				'import type { CacheRetention, ModelCost, ModelInputLimits, ModelInputModality, ModelPromptCache, ModelThinkingLevel, ThinkingLevel, ThinkingLevelMap } from "./providers/model-schema.ts";',
				'import type { CacheRetention, ModelCost, ModelInputLimits, ModelInputModality, ModelPromptCache, ThinkingLevelMap } from "./providers/model-schema.ts";',
			);
		}
		if (!next.includes("thinkingOptions?: ThinkingOption[];")) {
			next = next.replace(
				"    thinkingLevelMap?: ThinkingLevelMap;",
				"    thinkingLevelMap?: ThinkingLevelMap;\n    /** Explicit provider-native thinking options. Empty means none were exposed. */\n    thinkingOptions?: ThinkingOption[];",
			);
		}
		if (next.includes("export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;")) {
			next = next.replace(
				"export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;",
				"export type Message = UserMessage | AssistantMessage | ToolResultMessage;\nexport type ExtendedMessage = SystemMessage | Message;",
			);
		}
		return next;
	});

	// 11.1 Patch index.d.ts to export images-models and OAuth types
	patchFile("index.d.ts", (source) => {
		let next = source;
		if (!next.includes('export * from "./images-models.ts";')) {
			next = next.replace(
				'export * from "./auth/types.ts";',
				`export * from "./auth/types.ts";
export * from "./images-models.ts";
export type {
    OAuthAuthInfo,
    OAuthCredentials,
    OAuthDeviceCodeInfo,
    OAuthLoginCallbacks,
    OAuthPrompt,
    OAuthProvider,
    OAuthProviderId,
    OAuthProviderInfo,
    OAuthProviderInterface,
    OAuthSelectOption,
    OAuthSelectPrompt,
} from "./utils/oauth/types.ts";`,
			);
			next = next.replace(
				/export type \{ OAuthAuthInfo, OAuthDeviceCodeInfo, OAuthLoginCallbacks, OAuthPrompt, OAuthSelectOption, OAuthSelectPrompt, \} from "\.\/compat\/extension-oauth-types\.ts";\n/,
				"",
			);
		}
		return next;
	});

	// 12. Patch models.js with getThinkingOptions & safe calculateCost guard
	patchFile("models.js", (source) => {
		let next = source;
		// Safe calculateCost guard
		if (!next.includes("if (!model.cost && !model.pricing)")) {
			next = next.replace(
				"export function calculateCost(model, usage) {\n    const rates = model.cost ?? model.pricing;\n    if (!rates) {\n        return undefined;\n    }",
				`export function calculateCost(model, usage) {
    if (!model.cost && !model.pricing) {
        usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        return usage.cost;
    }
    const rates = model.cost ?? model.pricing;
    if (!rates) {
        return undefined;
    }`,
			);
		}
		// Add getThinkingOptions
		if (!next.includes("export function getThinkingOptions")) {
			const thinkingOptionsCode = `
const titleCaseThinkingLevel = (value) => value.replace(/[_-]+/g, " ").replace(/\\b\\w/g, (letter) => letter.toUpperCase());
export function getThinkingOptions(model) {
    if (Array.isArray(model.thinkingOptions))
        return model.thinkingOptions
            .filter((option) => option && typeof option.id === "string" && typeof option.value === "string")
            .map((option) => ({ id: option.id, label: option.label || titleCaseThinkingLevel(option.value), value: option.value }));
    if (!model.reasoning)
        return [];
    const byValue = new Map();
    for (const level of EXTENDED_THINKING_LEVELS) {
        const mapped = model.thinkingLevelMap?.[level];
        if (mapped === null)
            continue;
        if ((level === "xhigh" || level === "max") && mapped === undefined)
            continue;
        const value = mapped ?? level;
        const option = { id: level, label: titleCaseThinkingLevel(value), value };
        const previous = byValue.get(value);
        if (!previous || level === value)
            byValue.set(value, option);
    }
    return [...byValue.values()];
}
`;
			next = next.replace(
				"const EXTENDED_THINKING_LEVELS = [\"off\", \"minimal\", \"low\", \"medium\", \"high\", \"xhigh\", \"max\"];",
				`const EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];${thinkingOptionsCode}`,
			);
		}
		return next;
	});

	// 13. Patch models.d.ts with getThinkingOptions declaration
	patchFile("models.d.ts", (source) => {
		if (!source.includes("export declare function getThinkingOptions")) {
			return source.replace(
				"export declare function getSupportedThinkingLevels",
				"export declare function getThinkingOptions<TApi extends Api>(model: Model<TApi>): ThinkingOption[];\nexport declare function getSupportedThinkingLevels",
			);
		}
		return source;
	});

	// 14. Patch compat.js & compat.d.ts to export thinking helpers
	patchFile("compat.js", (source) => {
		if (!source.includes("export { getThinkingOptions")) {
			return `${source}\nexport { getThinkingOptions, getSupportedThinkingLevels, clampThinkingLevel } from "./models.js";\n`;
		}
		return source;
	});

	patchFile("compat.d.ts", (source) => {
		if (!source.includes("export { getThinkingOptions")) {
			return `${source}\nexport { getThinkingOptions, getSupportedThinkingLevels, clampThinkingLevel } from "./models.js";\n`;
		}
		return source;
	});

	// 15. Patch api/openai-completions.js with model.baseUrl fallback
	patchFile("api/openai-completions.js", (source) => {
		return source.replace(
			"function detectCompat(model) {\n    const provider = model.provider;\n    const baseUrl = model.baseUrl;",
			"function detectCompat(model) {\n    const provider = model.provider;\n    const baseUrl = model.baseUrl || \"\";",
		);
	});

	// 16. Patch api/transform-messages.js with optional chaining on model.input
	patchFile("api/transform-messages.js", (source) => {
		return source.replace(
			"function downgradeUnsupportedImages(messages, model) {\n    if (model.input.includes(\"image\")) {",
			"function downgradeUnsupportedImages(messages, model) {\n    if (model.input?.includes(\"image\")) {",
		);
	});

	// 17. Patch utils/overflow.js with length-stop overflow logic
	patchFile("utils/overflow.js", (source) => {
		if (!source.includes("textTokens <=")) {
			return source.replace(
				/if \(contextWindow && message\.stopReason === "length" && message\.usage\.output === 0\) \{[\s\S]*?if \(inputTokens >= contextWindow \* 0\.99\) \{[\s\S]*?return true;[\s\S]*?\}[\s\S]*?\}/,
				`if (contextWindow && message.stopReason === "length" && message.usage) {
        const inputTokens = (message.usage.input || 0) + (message.usage.cacheRead || 0);
        const textTokens = (message.usage.output || 0) - (message.usage.reasoning || 0);
        if (inputTokens >= contextWindow * 0.98 && (message.usage.output <= 2 || textTokens <= 2)) {
            return true;
        }
    }`,
			);
		}
		return source;
	});

	// 18. Patch utils/transcript.js to preserve systemPrompt on normalized context
	patchFile("utils/transcript.js", (source) => {
		if (!source.includes("initialSystemPrompt")) {
			return source.replace(
				"export function normalizeContext(context) {\n    const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);\n    const messages = initialMessage ? [initialMessage, ...context.messages] : context.messages;\n    return { messages };\n}",
				`export function normalizeContext(context) {
    const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
    const messages = initialMessage ? [initialMessage, ...context.messages] : context.messages;
    const initialSystemPrompt = initialMessage && isSystemMessage(initialMessage)
        ? (typeof initialMessage.content === "string" ? initialMessage.content : undefined)
        : undefined;
    return { ...context, messages, systemPrompt: context.systemPrompt ?? initialSystemPrompt };
}`,
			);
		}
		return source;
	});

	// 19. Record upstream source in model-catalog.json
	writeFileSync(
		join(projectRoot, "vendor/metis-ai/model-catalog.json"),
		`${JSON.stringify({ source: "@earendil-works/pi-ai", version: upstreamVersion }, null, 2)}\n`,
	);

	console.log(`Synced Metis model catalog & provider adapters from ${upstreamSpec} (${basename(tarball)})`);
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}
