import { describe, expect, it } from "vitest";
import { resolveCustomProviderModel } from "../desktop/src/lib/model-selection.ts";

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
});
