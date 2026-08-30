import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/metis-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";

const require = createRequire(import.meta.url);
const providerConfig = require("../desktop/provider-config.cjs") as {
	deleteCustomProviderConfig(agentDir: string, providerId: string): Promise<boolean>;
	discoverCustomProviderModels(baseUrl: string, apiKey: string, options?: { fetchImpl?: typeof fetch }): Promise<Array<{ id: string; thinkingOptions: Array<{ id: string; label: string; value: string }> }>>;
	listCustomProviderConfigs(agentDir: string): Promise<Array<Record<string, unknown>>>;
	saveCustomProviderConfig(
		agentDir: string,
		config: Record<string, unknown>,
		options?: { fetchImpl?: typeof fetch },
	): Promise<Record<string, unknown>>;
};

describe("Desktop custom Provider configuration", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-desktop-provider-"));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(agentDir, { recursive: true, force: true });
	});

	it("creates multiple providers and discovers models automatically", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ id: "model-a", supported_reasoning_efforts: ["none", "low", { value: "max", label: "Maximum" }] }, { id: "model-b" }, { id: "model-a" }] }),
		});

		const first = await providerConfig.saveCustomProviderConfig(
			agentDir,
			{ name: "Local Proxy", baseUrl: "http://127.0.0.1:8045/v1", apiKey: "secret", reasoning: true },
			{ fetchImpl },
		);
		const second = await providerConfig.saveCustomProviderConfig(
			agentDir,
			{ name: "Local Proxy", baseUrl: "http://127.0.0.1:9045/v1", apiKey: "secret", modelIds: ["manual-model"] },
			{ fetchImpl },
		);

		expect(first.provider).toBe("custom-local-proxy");
		expect(first.modelIds).toEqual(["model-a", "model-b"]);
		expect(second.provider).toBe("custom-local-proxy-2");
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const saved = await providerConfig.listCustomProviderConfigs(agentDir);
		expect(saved.map((item) => item.provider)).toEqual(["custom-local-proxy", "custom-local-proxy-2"]);
		expect(saved[0]?.reasoning).toBe(true);
	});

	it("edits selected models without requiring or persisting an API key", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
		const created = await providerConfig.saveCustomProviderConfig(agentDir, {
			name: "Proxy",
			baseUrl: "https://proxy.example/v1",
			apiKey: "secret",
			modelIds: ["old-model"],
		}, { fetchImpl });

		await providerConfig.saveCustomProviderConfig(agentDir, {
			providerId: created.provider,
			name: "Proxy Renamed",
			baseUrl: "https://proxy.example/v1",
			modelIds: ["new-model", "custom-model"],
			reasoning: true,
		}, { fetchImpl });
		expect(fetchImpl).toHaveBeenCalledTimes(3);

		const models = JSON.parse(fs.readFileSync(path.join(agentDir, "models.json"), "utf8"));
		expect(models.providers[created.provider as string].apiKey).toBeUndefined();
		expect(models.providers[created.provider as string].models).toEqual([
			{ id: "new-model", input: ["text", "image"], contextWindow: 256000 },
			{ id: "custom-model", input: ["text", "image"], contextWindow: 256000 },
		]);
	});

	it("lists legacy other config and deletes only requested custom provider", async () => {
		fs.writeFileSync(
			path.join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					anthropic: { baseUrl: "https://override.example" },
					other: { name: "Legacy", baseUrl: "https://legacy.example/v1", models: [{ id: "legacy" }] },
					"custom-next": { name: "Next", baseUrl: "https://next.example/v1", models: [{ id: "next" }] },
				},
			}),
		);

		expect((await providerConfig.listCustomProviderConfigs(agentDir)).map((item) => item.provider)).toEqual(["other", "custom-next"]);
		expect(await providerConfig.deleteCustomProviderConfig(agentDir, "other")).toBe(true);
		expect(await providerConfig.deleteCustomProviderConfig(agentDir, "anthropic")).toBe(false);
		const remaining = JSON.parse(fs.readFileSync(path.join(agentDir, "models.json"), "utf8"));
		expect(remaining.providers.other).toBeUndefined();
		expect(remaining.providers.anthropic).toBeDefined();
		expect(remaining.providers["custom-next"]).toBeDefined();
	});

	it("tries /v1/models then /models and sends bearer authorization", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: false })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ models: ["alpha"] }) });

		await expect(
			providerConfig.discoverCustomProviderModels("https://proxy.example", "secret", { fetchImpl }),
		).resolves.toEqual([{ id: "alpha", thinkingOptions: [] }]);
		expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
			"https://proxy.example/v1/models",
			"https://proxy.example/models",
		]);
		expect(fetchImpl.mock.calls[0]?.[1]?.headers.Authorization).toBe("Bearer secret");
	});

	it("persists provider-native reasoning options and contextWindow from discovery", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [
				{ id: "native", context_length: 65536, capabilities: { reasoning: { efforts: ["disabled", { id: "balanced", label: "Balanced" }] } } },
				{ id: "glm-5.3", max_model_len: 128000 },
				{ id: "qwen3-disabled", context_window: 32768, supported_reasoning_efforts: ["disabled"] },
			] }),
		});

		await providerConfig.saveCustomProviderConfig(agentDir, {
			name: "Native",
			baseUrl: "https://native.example/v1",
			apiKey: "secret",
		}, { fetchImpl });

		const config = JSON.parse(fs.readFileSync(path.join(agentDir, "models.json"), "utf8"));
		expect(config.providers["custom-native"].models).toMatchObject([
			{ id: "native", reasoning: true, contextWindow: 65536, thinkingOptions: [{ id: "off", label: "disabled", value: "disabled" }, { id: "balanced", label: "Balanced", value: "balanced" }] },
			{ id: "glm-5.3", contextWindow: 128000 },
			{ id: "qwen3-disabled", contextWindow: 32768 },
		]);
		expect(config.providers["custom-native"].models[1]).not.toHaveProperty("thinkingOptions");

		const registry = ModelRegistry.create(
			AuthStorage.create(path.join(agentDir, "auth.json")),
			path.join(agentDir, "models.json"),
		);
		const glm = registry.find("custom-native", "glm-5.3");
		expect(glm?.reasoning).toBe(false);
		expect(glm?.contextWindow).toBe(128000);
		expect(getSupportedThinkingLevels(glm!)).toEqual(["off"]);
		const disabled = registry.find("custom-native", "qwen3-disabled");
		expect(disabled?.reasoning).toBe(false);
		expect(disabled?.contextWindow).toBe(32768);
		expect(getSupportedThinkingLevels(disabled!)).toEqual(["off"]);
	});
});
