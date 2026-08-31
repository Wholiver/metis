import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, getSupportedThinkingLevels, getThinkingOptions, type Model } from "@earendil-works/metis-ai/compat";
import { streamSimple } from "@earendil-works/metis-ai/api/openai-completions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { extractProviderThinkingOptions, ModelRegistry, saveOtherProviderConfig } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("custom provider thinking fallback", () => {
	let dir: string;
	beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "metis-custom-thinking-")); });
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	function load(id: string, overrides: Record<string, unknown> = {}, provider: Record<string, unknown> = {}) {
		const path = join(dir, "models.json");
		writeFileSync(path, JSON.stringify({ providers: { "custom-proxy": {
			api: "openai-completions", baseUrl: "https://proxy.example/v1", apiKey: "test-key",
			models: [{ id, ...overrides }], ...provider,
		} } }));
		const registry = ModelRegistry.create(AuthStorage.create(join(dir, "auth.json")), path);
		expect(registry.getError()).toBeUndefined();
		return { registry, model: registry.find("custom-proxy", id)! };
	}

	it.each([
		["deepseek-v4-pro", "openai-completions"],
		["qwen3.8-max", "openai-completions"],
		["gpt-5", "openai-responses"],
		["claude-opus-4-6", "anthropic-messages"],
		["gemini-2.5-flash", "google-generative-ai"],
		["kimi-k2.5", "openai-completions"],
		["MiniMax-M2.7", "anthropic-messages"],
	])("restores %s capabilities for file and dynamically registered providers", (id, api) => {
		const { registry, model } = load(id!, { reasoning: false, thinkingOptions: [] }, { api });
		expect(model.reasoning).toBe(true);
		expect(getThinkingOptions(model).some((option) => option.id !== "off")).toBe(true);
		registry.registerProvider("custom-dynamic", { api: api as Api, baseUrl: "https://proxy.example/v1", apiKey: "test-key", models: [{
			id: id!, name: id!, input: ["text"], contextWindow: 128000, maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}] });
		expect(getThinkingOptions(registry.find("custom-dynamic", id!)!)).toEqual(getThinkingOptions(model));
	});

	it("keeps exact effort maps including max and collapses switch-only controls", () => {
		expect(getSupportedThinkingLevels(load("deepseek-v4-pro").model)).toEqual(["off", "high", "max"]);
		expect(getThinkingOptions(load("kimi-k2.5").model).map((option) => option.label)).toEqual(["Off", "On"]);
		expect(getSupportedThinkingLevels(load("gpt-5").model)).toEqual(["minimal", "low", "medium", "high"]);
	});

	it("respects explicit declarations and does not guess unknown aliases", () => {
		expect(load("deepseek-v4-pro", { reasoning: false }).model.reasoning).toBe(false);
		expect(load("deepseek-v4-pro", {}, { reasoning: false }).model.reasoning).toBe(false);
		expect(load("my-private-model", { reasoning: true }).model.reasoning).toBe(true);
		expect(load("my-private-model", {}, { reasoning: true }).model.reasoning).toBe(true);
		expect(load("deepseek-v99-experimental").model.reasoning).toBe(false);
		const options = [{ id: "balanced", label: "Balanced", value: "balanced" }];
		expect(getThinkingOptions(load("my-private-model", { thinkingOptions: options }).model)).toEqual(options);
		expect(getThinkingOptions(load("deepseek-v4-pro", { reasoning: false, thinkingOptions: options }).model)).toEqual([]);
	});

	it.each([
		["https://proxy.example/v1", "deepseek"],
		["https://openrouter.ai/api/v1", "openrouter"],
		["https://api.together.xyz/v1", "together"],
	])("selects the request dialect from endpoint %s", (baseUrl, thinkingFormat) => {
		expect(load("deepseek-v4-pro", {}, { baseUrl }).model.compat).toMatchObject({ thinkingFormat });
	});

	it.each([
		["deepseek-v4-pro", "https://proxy.example/v1", "max", { thinking: { type: "enabled" }, reasoning_effort: "max" }],
		["deepseek-v4-pro", "https://proxy.example/v1", "off", { thinking: { type: "disabled" } }],
		["qwen3.8-max", "https://proxy.example/v1", "high", { enable_thinking: true }],
		["qwen3.8-max", "https://proxy.example/v1", "off", { enable_thinking: false }],
		["kimi-k2.5", "https://proxy.example/v1", "high", { thinking: { type: "enabled" } }],
		["kimi-k2.5", "https://proxy.example/v1", "off", { thinking: { type: "disabled" } }],
		["gpt-5", "https://proxy.example/v1", "high", { reasoning_effort: "high" }],
		["deepseek-v4-pro", "https://openrouter.ai/api/v1", "high", { reasoning: { effort: "high" } }],
		["deepseek-v4-pro", "https://api.together.xyz/v1", "high", { reasoning: { enabled: true } }],
	])("serializes %s/%s/%s with the matching request dialect", async (id, baseUrl, reasoning, expected) => {
		const model = load(id as string, {}, { baseUrl }).model as Model<"openai-completions">;
		let payload: unknown;
		const result = await streamSimple(model, { messages: [{ role: "user", content: "test", timestamp: 0 }] }, {
			apiKey: "test-key", reasoning: reasoning as string, onPayload(value) {
				payload = value;
				throw new Error("payload captured; no network request");
			},
		}).result();
		expect(result.errorMessage).toContain("payload captured");
		expect(payload).toMatchObject(expected);
		if (!("reasoning_effort" in (expected as object))) expect(payload).not.toHaveProperty("reasoning_effort");
	});

	it.each([
		{ reasoning: false },
		{ reasoning: false, thinkingOptions: [{ id: "high", label: "High", value: "high" }] },
		{ reasoning: true, thinkingLevelMap: { off: null, low: "low", high: "high" } },
		{ thinkingOptions: [{ id: "balanced", label: "Balanced", value: "balanced" }] },
	])("preserves existing TUI model settings when discovery has no capabilities: %j", (settings) => {
		load("my-private-model", settings);
		const path = join(dir, "models.json");
		saveOtherProviderConfig(path, "custom-proxy", "Proxy", "https://proxy.example/v1", ["my-private-model"], false, [{ id: "my-private-model", thinkingOptions: [] }]);
		expect(JSON.parse(readFileSync(path, "utf8")).providers["custom-proxy"].models[0]).toMatchObject(settings);
	});

	it("refreshes a stale session model and exposes recovered capabilities to snapshot consumers", async () => {
		const { registry, model } = load("deepseek-v4-pro", { reasoning: false, thinkingOptions: [] });
		const { session } = await createAgentSession({
			cwd: dir, agentDir: dir, authStorage: registry.authStorage, modelRegistry: registry,
			model: { ...model, reasoning: false, thinkingOptions: undefined, thinkingLevelMap: undefined },
			sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory(),
		});
		try {
			session.syncModelFromRegistry();
			expect(session.supportsThinking()).toBe(true);
			expect(session.getAvailableThinkingOptions().map((option) => option.id)).toEqual(["off", "high", "max"]);
			session.setThinkingLevel("max");
			expect(session.thinkingLevel).toBe("max");
		} finally { session.dispose(); }
	});

	it.each([
		{ supported_reasoning_efforts: [], capabilities: { reasoning: { efforts: ["high"] } } },
		{ thinking_options: [{ id: "high", value: "enabled", label: "On" }] },
		{ thinkingOptions: [{ id: "high", value: "enabled", label: "On" }] },
	])("extracts usable metadata without losing native IDs: %j", (metadata) => {
		expect(extractProviderThinkingOptions(metadata)[0]?.id).toBe("high");
	});

	it.each([
		{ reasoning: false }, { supports_reasoning: false },
		{ capabilities: { reasoning: false } }, { capabilities: { thinking: { supported: false } } },
	])("does not replace an explicit upstream opt-out with catalog fallback: %j", (metadata) => {
		const options = extractProviderThinkingOptions(metadata);
		expect(options.map((option) => option.id)).toEqual(["off"]);
		expect(load("deepseek-v4-pro", { thinkingOptions: options }).model.reasoning).toBe(false);
	});
});
