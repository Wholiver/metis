import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import {
	createCustomProviderId,
	deleteCustomProviderConfig,
	fetchOtherProviderModels,
	listCustomProviderConfigs,
	ModelRegistry,
	saveOtherProviderConfig,
} from "../src/core/model-registry.ts";

describe("Other provider setup and login flow", () => {
	let tempDir: string;
	let authPath: string;
	let modelsPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-other-provider-test-"));
		authPath = path.join(tempDir, "auth.json");
		modelsPath = path.join(tempDir, "models.json");
		authStorage = AuthStorage.create(authPath);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("saves 'other' provider config to models.json and updates display name in ModelRegistry", () => {
		saveOtherProviderConfig(modelsPath, "other", "My Custom LLM", "https://api.myllm.com/v1");

		expect(fs.existsSync(modelsPath)).toBe(true);
		const content = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
		expect(content.providers.other).toBeDefined();
		expect(content.providers.other.name).toBe("My Custom LLM");
		expect(content.providers.other.baseUrl).toBe("https://api.myllm.com/v1");
		expect(content.providers.other.api).toBe("openai-completions");
		expect(content.providers.other.models).toEqual([{ id: "default", input: ["text", "image"] }]);

		const registry = ModelRegistry.create(authStorage, modelsPath);
		expect(registry.getProviderDisplayName("other")).toBe("My Custom LLM");

		const models = registry.getAll();
		const otherModel = models.find((m) => m.provider === "other" && m.id === "default");
		expect(otherModel).toBeDefined();
		expect(otherModel?.baseUrl).toBe("https://api.myllm.com/v1");
		expect(otherModel?.api).toBe("openai-completions");
		expect(otherModel?.input).toEqual(["text", "image"]);
	});

	it("saves fetched model list into models.json when modelIds are provided", () => {
		const fetchedModels = ["gpt-4o", "gpt-4o-mini", "qwen-2.5-coder"];
		saveOtherProviderConfig(modelsPath, "other", "My Custom LLM", "https://api.myllm.com/v1", fetchedModels);

		const content = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
		expect(content.providers.other.models).toEqual([
			{ id: "gpt-4o", input: ["text", "image"] },
			{ id: "gpt-4o-mini", input: ["text", "image"] },
			{ id: "qwen-2.5-coder", input: ["text", "image"] },
		]);

		authStorage.set("other", { type: "api_key", key: "sk-test" });
		const registry = ModelRegistry.create(authStorage, modelsPath);
		const availableModels = registry.getAvailable().filter((m) => m.provider === "other");
		expect(availableModels.map((m) => m.id)).toEqual(["gpt-4o", "gpt-4o-mini", "qwen-2.5-coder"]);
	});

	it("fetches available models from OpenAI-compatible /models endpoint", async () => {
		const mockResponse = {
			object: "list",
			data: [{ id: "llama-3.3-70b" }, { id: "qwen-2.5-72b" }],
		};

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => mockResponse,
			}),
		);

		const models = await fetchOtherProviderModels("https://api.example.com/v1", "sk-secret");
		expect(models).toEqual(["llama-3.3-70b", "qwen-2.5-72b"]);
	});

	it("preserves existing providers when updating 'other' provider in models.json", () => {
		const initial = {
			metadata: { owner: "user" },
			providers: {
				existing: {
					name: "Existing Provider",
					baseUrl: "https://existing.com/v1",
					api: "openai-completions",
				},
			},
		};
		fs.writeFileSync(modelsPath, JSON.stringify(initial, null, 2), "utf-8");

		saveOtherProviderConfig(modelsPath, "other", "Another LLM", "https://another.com/v1");

		const content = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
		expect(content.metadata).toEqual({ owner: "user" });
		expect(content.providers.existing).toBeDefined();
		expect(content.providers.other).toBeDefined();
		expect(content.providers.other.name).toBe("Another LLM");
	});

	it("creates independent IDs and persists multiple custom providers", () => {
		const firstId = createCustomProviderId(modelsPath, "Local Proxy");
		saveOtherProviderConfig(modelsPath, firstId, "Local Proxy", "http://127.0.0.1:8045/v1", ["model-a"]);
		const secondId = createCustomProviderId(modelsPath, "Local Proxy");
		saveOtherProviderConfig(modelsPath, secondId, "Local Proxy 2", "http://127.0.0.1:9045/v1", ["model-b"]);

		expect(firstId).toBe("custom-local-proxy");
		expect(secondId).toBe("custom-local-proxy-2");
		expect(listCustomProviderConfigs(modelsPath)).toEqual([
			{
				providerId: firstId,
				name: "Local Proxy",
				baseUrl: "http://127.0.0.1:8045/v1",
				modelIds: ["model-a"],
				reasoning: false,
			},
			{
				providerId: secondId,
				name: "Local Proxy 2",
				baseUrl: "http://127.0.0.1:9045/v1",
				modelIds: ["model-b"],
				reasoning: false,
			},
		]);
	});

	it("stores chosen model IDs and reasoning, then deletes only requested provider", () => {
		saveOtherProviderConfig(modelsPath, "custom-one", "One", "https://one.example/v1", ["a", "a", "b"], true);
		saveOtherProviderConfig(modelsPath, "custom-two", "Two", "https://two.example/v1", ["c"]);

		const before = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
		expect(before.providers["custom-one"].models).toEqual([
			{ id: "a", input: ["text", "image"], reasoning: true },
			{ id: "b", input: ["text", "image"], reasoning: true },
		]);

		expect(deleteCustomProviderConfig(modelsPath, "custom-one")).toBe(true);
		expect(deleteCustomProviderConfig(modelsPath, "anthropic")).toBe(false);
		const after = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
		expect(after.providers["custom-one"]).toBeUndefined();
		expect(after.providers["custom-two"]).toBeDefined();
	});
});
