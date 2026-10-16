import { describe, expect, it } from "vitest";
import {
	filterVisibleModels,
	hideModel,
	loadHiddenModelKeys,
	modelKey,
	resolveCustomProviderModel,
	restoreAllHiddenModels,
	unhideModel,
} from "../desktop/src/lib/model-selection.ts";

describe("desktop model selection", () => {
	it("selects the imported custom model when the current model is the unknown placeholder", () => {
		const models = [
			{ provider: "anthropic", id: "claude" },
			{ provider: "other", id: "gpt-custom" },
		];

		expect(resolveCustomProviderModel(
			{ provider: "unknown", id: "unknown", api: "unknown" },
			models,
		)).toEqual({ provider: "other", id: "gpt-custom" });
	});

	it("prefers the newly saved custom Provider when multiple custom Providers exist", () => {
		const models = [
			{ provider: "other", id: "legacy" },
			{ provider: "custom-local", id: "local-model" },
		];

		expect(resolveCustomProviderModel(
			{ provider: "unknown", id: "unknown", api: "unknown" },
			models,
			"custom-local",
		)).toEqual({ provider: "custom-local", id: "local-model" });
	});

	it("manages hidden model keys and filters visible models", () => {
		const store = new Map<string, string>();
		const mockStorage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, val: string) => store.set(key, val),
			removeItem: (key: string) => store.delete(key),
		} as Storage;

		expect(loadHiddenModelKeys(mockStorage).size).toBe(0);

		hideModel("openai", "gpt-4o-mini", mockStorage);
		expect(loadHiddenModelKeys(mockStorage).has("openai/gpt-4o-mini")).toBe(true);

		const allModels = [
			{ provider: "openai", id: "gpt-4o" },
			{ provider: "openai", id: "gpt-4o-mini" },
			{ provider: "anthropic", id: "claude-3-7-sonnet" },
		];

		const visible = filterVisibleModels(allModels, loadHiddenModelKeys(mockStorage));
		expect(visible).toEqual([
			{ provider: "openai", id: "gpt-4o" },
			{ provider: "anthropic", id: "claude-3-7-sonnet" },
		]);

		unhideModel("openai", "gpt-4o-mini", mockStorage);
		expect(loadHiddenModelKeys(mockStorage).has("openai/gpt-4o-mini")).toBe(false);

		hideModel("anthropic", "claude-3-7-sonnet", mockStorage);
		restoreAllHiddenModels(mockStorage);
		expect(loadHiddenModelKeys(mockStorage).size).toBe(0);
	});
});

