import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalMetisExperimental = process.env.METIS_EXPERIMENTAL;

	afterEach(() => {
		if (originalMetisExperimental === undefined) {
			delete process.env.METIS_EXPERIMENTAL;
		} else {
			process.env.METIS_EXPERIMENTAL = originalMetisExperimental;
		}
	});

	it("returns false when METIS_EXPERIMENTAL is unset", () => {
		delete process.env.METIS_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when METIS_EXPERIMENTAL is empty", () => {
		process.env.METIS_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when METIS_EXPERIMENTAL is set to 1", () => {
		process.env.METIS_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when METIS_EXPERIMENTAL is set to 0", () => {
		process.env.METIS_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when METIS_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.METIS_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});

