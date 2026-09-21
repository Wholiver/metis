import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { defaultModelPerProvider } from "../src/core/model-resolver.ts";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "../src/core/provider-display-names.ts";
import {
	DEFAULT_SILICONFLOW_MODEL_ID,
	SILICONFLOW_API_KEY_ENV,
	SILICONFLOW_BASE_URL,
	SILICONFLOW_CN_API_KEY_ENV,
	SILICONFLOW_CN_BASE_URL,
	SILICONFLOW_CN_PROVIDER_ID,
	SILICONFLOW_PROVIDER_ID,
} from "../src/core/providers/siliconflow.ts";
import { isApiKeyLoginProvider } from "../src/modes/interactive/interactive-mode.ts";

describe("bundled SiliconFlow providers", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;
	const originalIntlKey = process.env[SILICONFLOW_API_KEY_ENV];
	const originalCnKey = process.env[SILICONFLOW_CN_API_KEY_ENV];

	beforeEach(() => {
		tempDir = join(tmpdir(), `metis-siliconflow-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = join(tempDir, "models.json");
		authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		delete process.env[SILICONFLOW_API_KEY_ENV];
		delete process.env[SILICONFLOW_CN_API_KEY_ENV];
	});

	afterEach(() => {
		if (originalIntlKey === undefined) delete process.env[SILICONFLOW_API_KEY_ENV];
		else process.env[SILICONFLOW_API_KEY_ENV] = originalIntlKey;
		if (originalCnKey === undefined) delete process.env[SILICONFLOW_CN_API_KEY_ENV];
		else process.env[SILICONFLOW_CN_API_KEY_ENV] = originalCnKey;
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("registers independent China and international OpenAI-compatible endpoints", () => {
		const registry = ModelRegistry.create(authStorage, modelsJsonPath);
		const intl = registry.find(SILICONFLOW_PROVIDER_ID, DEFAULT_SILICONFLOW_MODEL_ID);
		const china = registry.find(SILICONFLOW_CN_PROVIDER_ID, DEFAULT_SILICONFLOW_MODEL_ID);

		expect(intl?.baseUrl).toBe(SILICONFLOW_BASE_URL);
		expect(intl?.api).toBe("openai-completions");
		expect(china?.baseUrl).toBe(SILICONFLOW_CN_BASE_URL);
		expect(china?.api).toBe("openai-completions");
		expect(intl?.reasoning).toBe(true);
		expect(china?.reasoning).toBe(true);
		expect(intl?.baseUrl).not.toBe(china?.baseUrl);
		expect(defaultModelPerProvider[SILICONFLOW_PROVIDER_ID]).toBe(DEFAULT_SILICONFLOW_MODEL_ID);
		expect(defaultModelPerProvider[SILICONFLOW_CN_PROVIDER_ID]).toBe(DEFAULT_SILICONFLOW_MODEL_ID);
	});

	test("keeps API keys isolated between the two platforms", async () => {
		process.env[SILICONFLOW_CN_API_KEY_ENV] = "sk-cn-test";
		const registry = ModelRegistry.create(authStorage, modelsJsonPath);

		expect(authStorage.hasAuth(SILICONFLOW_CN_PROVIDER_ID)).toBe(true);
		expect(authStorage.hasAuth(SILICONFLOW_PROVIDER_ID)).toBe(false);
		expect(await registry.getApiKeyForProvider(SILICONFLOW_CN_PROVIDER_ID)).toBe("sk-cn-test");
		expect(await registry.getApiKeyForProvider(SILICONFLOW_PROVIDER_ID)).toBeUndefined();
		expect(registry.getProviderAuthStatus(SILICONFLOW_CN_PROVIDER_ID)).toEqual({
			configured: false,
			source: "environment",
			label: SILICONFLOW_CN_API_KEY_ENV,
		});
	});

	test("exposes both providers to API-key login", () => {
		expect(BUILT_IN_PROVIDER_DISPLAY_NAMES[SILICONFLOW_PROVIDER_ID]).toBe("SiliconFlow");
		expect(BUILT_IN_PROVIDER_DISPLAY_NAMES[SILICONFLOW_CN_PROVIDER_ID]).toBe("SiliconFlow (China)");
		expect(isApiKeyLoginProvider(SILICONFLOW_PROVIDER_ID, new Set())).toBe(true);
		expect(isApiKeyLoginProvider(SILICONFLOW_CN_PROVIDER_ID, new Set())).toBe(true);
	});
});
