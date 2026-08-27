import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const DEFAULT_UPSTREAM_VERSION = "0.84.3";
const upstreamVersion = process.argv[2] ?? DEFAULT_UPSTREAM_VERSION;
const upstreamSpec = `@earendil-works/pi-ai@${upstreamVersion}`;
const projectRoot = resolve(import.meta.dirname, "..");
const targetDist = join(projectRoot, "vendor/metis-ai/dist");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "metis-ai-model-catalog-"));

function ensureAfter(source, anchor, addition, filePath) {
	if (source.includes(addition)) return source;
	if (!source.includes(anchor)) throw new Error(`Cannot patch ${filePath}: missing ${anchor}`);
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

	for (const name of [
		"model-catalog.js",
		"model-catalog.js.map",
		"model-catalog.d.ts",
		"model-catalog.d.ts.map",
		"models.generated.js",
		"models.generated.js.map",
		"models.generated.d.ts",
		"models.generated.d.ts.map",
	]) {
		cpSync(join(sourceDist, name), join(targetDist, name));
	}

	const targetData = join(targetProviders, "data");
	rmSync(targetData, { recursive: true, force: true });
	cpSync(join(sourceProviders, "data"), targetData, { recursive: true });

	for (const name of readdirSync(sourceProviders)) {
		if (/\.models\.(?:js(?:\.map)?|d\.ts(?:\.map)?)$/.test(name)) {
			cpSync(join(sourceProviders, name), join(targetProviders, name));
		}
	}

	const addedProviders = ["baseten", "qwen-token-plan", "qwen-token-plan-cn", "qwen-token-plan-individual"];
	for (const provider of addedProviders) {
		for (const suffix of [".js", ".js.map", ".d.ts", ".d.ts.map"]) {
			cpSync(join(sourceProviders, `${provider}${suffix}`), join(targetProviders, `${provider}${suffix}`));
		}
	}

	patchFile("models.generated.js", (source, filePath) => {
		let next = ensureAfter(
			source,
			'import { CEREBRAS_MODELS } from "./providers/cerebras.models.js";\n',
			'import { COHERE_MODELS } from "./providers/cohere.models.js";\n',
			filePath,
		);
		next = ensureAfter(next, '    "cerebras": CEREBRAS_MODELS,\n', '    "cohere": COHERE_MODELS,\n', filePath);
		return next;
	});

	patchFile("models.generated.d.ts", (source, filePath) => {
		let next = ensureAfter(
			source,
			'import { CEREBRAS_MODELS } from "./providers/cerebras.models.ts";\n',
			'import { COHERE_MODELS } from "./providers/cohere.models.ts";\n',
			filePath,
		);
		next = ensureAfter(
			next,
			'    readonly "cerebras": typeof CEREBRAS_MODELS;\n',
			'    readonly "cohere": typeof COHERE_MODELS;\n',
			filePath,
		);
		return next;
	});

	patchFile("providers/all.js", (source, filePath) => {
		const imports = [
			['import { azureOpenAIResponsesProvider } from "./azure-openai-responses.js";\n', 'import { basetenProvider } from "./baseten.js";\n'],
			['import { openrouterImagesProvider } from "./openrouter-images.js";\n', 'import { qwenTokenPlanProvider } from "./qwen-token-plan.js";\nimport { qwenTokenPlanCnProvider } from "./qwen-token-plan-cn.js";\nimport { qwenTokenPlanIndividualProvider } from "./qwen-token-plan-individual.js";\n'],
		];
		let next = source;
		for (const [anchor, addition] of imports) next = ensureAfter(next, anchor, addition, filePath);
		next = ensureAfter(next, "        azureOpenAIResponsesProvider(),\n", "        basetenProvider(),\n", filePath);
		next = ensureAfter(
			next,
			"        openrouterProvider(),\n",
			"        qwenTokenPlanProvider(),\n        qwenTokenPlanCnProvider(),\n        qwenTokenPlanIndividualProvider(),\n",
			filePath,
		);
		return next;
	});

	patchFile("env-api-keys.js", (source, filePath) =>
		ensureAfter(
			source,
			'        "cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",\n',
			'        "qwen-token-plan": "QWEN_TOKEN_PLAN_API_KEY",\n        "qwen-token-plan-cn": "QWEN_TOKEN_PLAN_CN_API_KEY",\n        "qwen-token-plan-individual": "QWEN_TOKEN_PLAN_API_KEY",\n        baseten: "BASETEN_API_KEY",\n',
			filePath,
		),
	);

	const upstreamTypes = readFileSync(join(sourceDist, "types.d.ts"), "utf8");
	const knownProvider = upstreamTypes.match(/^export type KnownProvider = (.+);$/m)?.[1];
	if (!knownProvider) throw new Error("Upstream package does not declare KnownProvider");
	const providerIds = [...knownProvider.matchAll(/"([^"]+)"/g)]
		.map((match) => match[1])
		.filter((provider) => provider !== "radius");
	if (!providerIds.includes("cohere")) providerIds.unshift("cohere");
	patchFile("types.d.ts", (source) =>
		source.replace(/^export type KnownProvider = .+;$/m, `export type KnownProvider = ${providerIds.map((id) => `"${id}"`).join(" | ")};`),
	);

	writeFileSync(
		join(projectRoot, "vendor/metis-ai/model-catalog.json"),
		`${JSON.stringify({ source: "@earendil-works/pi-ai", version: upstreamVersion }, null, 2)}\n`,
	);

	console.log(`Synced Metis model catalog from ${upstreamSpec} (${basename(tarball)})`);
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

