import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSupportedThinkingLevels, getThinkingOptions, type Model, type OpenAICompletionsCompat } from "@earendil-works/metis-ai/compat";
import { streamSimple } from "@earendil-works/metis-ai/api/openai-completions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("documented GLM thinking for custom providers", () => {
	let dir: string;
	let auth: AuthStorage;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "metis-glm-thinking-"));
		auth = AuthStorage.create(join(dir, "auth.json"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function load(id: string, modelOverrides: Record<string, unknown> = {}, providerOverrides: Record<string, unknown> = {}) {
		const path = join(dir, "models.json");
		writeFileSync(path, JSON.stringify({ providers: { "custom-glm": {
			api: "openai-completions", baseUrl: "https://api.z.ai/api/paas/v4", apiKey: "test-key",
			models: [{ id, ...modelOverrides }], ...providerOverrides,
		} } }));
		const registry = ModelRegistry.create(auth, path);
		const model = registry.find("custom-glm", id)! as Model<"openai-completions">;
		return { registry, model };
	}

	it.each([
		["glm-5.3", ["low", "high", "max"]],
		["z-ai/GLM-5.3-FLASH", ["low", "high", "max"]],
		["glm-5.3:latest", ["low", "high", "max"]],
		["glm-5.2", ["off", "high", "max"]],
		["glm-5.2-highspeed", ["off", "high", "max"]],
		["glm-5.1", ["off", "high"]],
		["glm-5", ["off", "high"]],
		["glm-4.7-flash", ["off", "high"]],
		["glm-4.6", ["off", "high"]],
		["glm-4.5-air", ["off", "high"]],
	])("loads documented controls for %s without discovery metadata", (id, levels) => {
		const { model } = load(id as string);
		expect(model.reasoning).toBe(true);
		expect(getSupportedThinkingLevels(model)).toEqual(levels);
	});

	it("shows a switch, not invented effort grades, on older GLM models", () => {
		const { model } = load("glm-4.7");
		expect(getThinkingOptions(model).map((option) => option.label)).toEqual(["Off", "On"]);
		expect((model.compat as OpenAICompletionsCompat).supportsReasoningEffort).toBe(false);
	});

	it.each(["glm-4", "glm-5.9", "custom-glm-5.3-alias", "unknown-model"])("does not guess capabilities for %s", (id) => {
		expect(load(id).model.reasoning).toBe(false);
	});

	it("migrates legacy empty discovery while respecting explicit opt-outs and protocol overrides", () => {
		expect(load("glm-5.3", { reasoning: false, thinkingOptions: [] }).model.reasoning).toBe(true);
		expect(load("glm-5.3", { reasoning: false }).model.reasoning).toBe(false);
		expect(load("glm-5.3", {}, { reasoning: false }).model.reasoning).toBe(false);
		expect(load("glm-5.3", { thinkingOptions: [{ id: "off", label: "Disabled", value: "disabled" }] }).model.reasoning).toBe(false);
		expect(load("glm-5.3", {}, { api: "google-generative-ai" }).model.reasoning).toBe(false);
		const { model } = load("glm-5.3", {
			thinkingOptions: [{ id: "high", label: "Provider high", value: "high" }],
			compat: { thinkingFormat: "deepseek" },
		});
		expect(getSupportedThinkingLevels(model)).toEqual(["high"]);
		expect(model.compat).toMatchObject({ thinkingFormat: "deepseek" });
	});

	it.each([
		["https://proxy.example/v1", "zai"],
		["https://api.z.ai/api/coding/paas/v4", "zai"],
		["https://open.bigmodel.cn/api/paas/v4", "zai"],
		["https://openrouter.ai/api/v1", "openrouter"],
		["https://api.together.ai/v1", "together"],
	])("retains the request dialect for %s", (baseUrl, thinkingFormat) => {
		expect(load("glm-5.3", {}, { baseUrl }).model.compat).toMatchObject({ thinkingFormat });
	});

	it.each([
		["glm-5.3", "low", "enabled", "low"],
		["glm-5.3", "high", "enabled", "high"],
		["glm-5.3", "max", "enabled", "max"],
		["glm-5.3", "off", "enabled", "low"],
		["glm-5.3", "medium", "enabled", "high"],
		["glm-5.3-flash", "xhigh", "enabled", "max"],
		["glm-5.2", "max", "enabled", "max"],
		["glm-5.2", "off", "disabled", undefined],
		["glm-4.7", "high", "enabled", undefined],
		["glm-4.7", "off", "disabled", undefined],
	])("serializes %s/%s using Z.AI thinking parameters", async (id, reasoning, type, effort) => {
		const { model } = load(id!);
		let payload: unknown;
		const response = await streamSimple(model, { messages: [{ role: "user", content: "test", timestamp: 0 }] }, {
			apiKey: "test-key",
			reasoning: reasoning!,
			onPayload(value) {
				payload = value;
				throw new Error("payload captured; no network request");
			},
		}).result();
		expect(response.errorMessage).toContain("payload captured");
		expect(payload).toMatchObject({ model: id, thinking: { type } });
		if (effort) expect(payload).toHaveProperty("reasoning_effort", effort);
		else expect(payload).not.toHaveProperty("reasoning_effort");
	});

	it("exposes restored capabilities to session snapshots and clamps an old off selection", async () => {
		const { registry, model } = load("glm-5.3", { reasoning: false, thinkingOptions: [] });
		const { session } = await createAgentSession({
			cwd: dir, agentDir: dir, authStorage: auth, modelRegistry: registry,
			model: { ...model, reasoning: false, thinkingOptions: undefined, thinkingLevelMap: undefined },
			sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory(),
		});
		try {
			session.syncModelFromRegistry();
			expect(session.supportsThinking()).toBe(true);
			expect(session.getAvailableThinkingOptions().map((option) => option.id)).toEqual(["low", "high", "max"]);
			session.setThinkingLevel("off");
			expect(session.thinkingLevel).toBe("low");
		} finally { session.dispose(); }
	});
});
