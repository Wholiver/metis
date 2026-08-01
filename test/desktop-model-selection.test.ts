import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveCustomProviderModel } = require("../desktop/renderer/model-selection.js") as {
	resolveCustomProviderModel: (
		previousModel: { provider?: string; id?: string; api?: string } | undefined,
		models: Array<{ provider: string; id: string }>,
		preferredProviderId?: string,
	) => { provider: string; id: string } | undefined;
};

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
