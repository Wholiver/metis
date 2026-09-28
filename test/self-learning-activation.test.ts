import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isSelfLearningActive } from "../src/core/adaptations/activation.ts";
import { getEffectiveWorkflow } from "../src/core/adaptations/effective.ts";

describe("isSelfLearningActive priority resolution", () => {
	it("defaults to false when no settings or flags are provided", () => {
		expect(isSelfLearningActive()).toBe(false);
		expect(isSelfLearningActive({})).toBe(false);
		expect(isSelfLearningActive({ settings: {} })).toBe(false);
		expect(isSelfLearningActive({ settings: { selfLearning: {} } })).toBe(false);
		expect(isSelfLearningActive({ settings: { selfLearning: { enabled: false } } })).toBe(false);
	});

	it("uses configuration setting when no flags or env overrides are set", () => {
		expect(isSelfLearningActive({ settings: { selfLearning: { enabled: true } } })).toBe(true);
		expect(isSelfLearningActive({ settings: { selfLearning: { enabled: false } } })).toBe(false);
	});

	it("prioritizes explicit off over configuration", () => {
		expect(isSelfLearningActive({
			adaptationsFlag: "off",
			settings: { selfLearning: { enabled: true } },
		})).toBe(false);

		expect(isSelfLearningActive({
			env: { METIS_ADAPTATIONS: "off" },
			settings: { selfLearning: { enabled: true } },
		})).toBe(false);

		expect(isSelfLearningActive({
			env: { METIS_ADAPTATIONS: "0" },
			settings: { selfLearning: { enabled: true } },
		})).toBe(false);

		expect(isSelfLearningActive({
			env: { METIS_ADAPTATIONS: "false" },
			settings: { selfLearning: { enabled: true } },
		})).toBe(false);
	});

	it("prioritizes explicit on over configuration", () => {
		expect(isSelfLearningActive({
			adaptationsFlag: "on",
			settings: { selfLearning: { enabled: false } },
		})).toBe(true);

		expect(isSelfLearningActive({
			env: { METIS_ADAPTATIONS: "on" },
			settings: { selfLearning: { enabled: false } },
		})).toBe(true);

		expect(isSelfLearningActive({
			env: { METIS_ADAPTATIONS: "1" },
			settings: { selfLearning: { enabled: false } },
		})).toBe(true);

		expect(isSelfLearningActive({
			env: { METIS_ADAPTATIONS: "true" },
			settings: { selfLearning: { enabled: false } },
		})).toBe(true);
	});

	it("prioritizes explicit off over explicit on", () => {
		expect(isSelfLearningActive({
			adaptationsFlag: "off",
			env: { METIS_ADAPTATIONS: "on" },
			settings: { selfLearning: { enabled: true } },
		})).toBe(false);

		expect(isSelfLearningActive({
			adaptationsFlag: "on",
			env: { METIS_ADAPTATIONS: "off" },
			settings: { selfLearning: { enabled: true } },
		})).toBe(false);
	});

	it("forces reliable-headless to false unless explicitly enabled", () => {
		// Even if config is enabled, reliable-headless defaults to false
		expect(isSelfLearningActive({
			executionProfile: "reliable-headless",
			settings: { selfLearning: { enabled: true } },
		})).toBe(false);

		// But explicit CLI flag --adaptations on enables it
		expect(isSelfLearningActive({
			executionProfile: "reliable-headless",
			adaptationsFlag: "on",
			settings: { selfLearning: { enabled: false } },
		})).toBe(true);

		// And explicit env METIS_ADAPTATIONS=on enables it
		expect(isSelfLearningActive({
			executionProfile: "reliable-headless",
			env: { METIS_ADAPTATIONS: "on" },
			settings: { selfLearning: { enabled: false } },
		})).toBe(true);

		// Explicit off disables it even with flag on
		expect(isSelfLearningActive({
			executionProfile: "reliable-headless",
			adaptationsFlag: "on",
			env: { METIS_ADAPTATIONS: "off" },
		})).toBe(false);
	});
});

describe("getEffectiveWorkflow activation guard", () => {
	it("returns undefined immediately when self-learning is off, even if workflow.json exists on disk", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-workflow-test-"));
		const tempAgentDir = path.join(tempDir, "agent");
		const userAdaptationsDir = path.join(tempAgentDir, "adaptations");
		fs.mkdirSync(userAdaptationsDir, { recursive: true });

		const dummyWorkflow = {
			extraChecks: [
				{
					id: "test-check",
					name: "Test Check",
					gate: "G2",
					command: "npm test",
					description: "Run test check",
				},
			],
		};
		fs.writeFileSync(
			path.join(userAdaptationsDir, "workflow.json"),
			JSON.stringify(dummyWorkflow),
			"utf8",
		);

		try {
			// 1. Defaults to false: returns undefined
			expect(getEffectiveWorkflow({
				cwd: tempDir,
				agentDir: tempAgentDir,
			})).toBeUndefined();

			// 2. Explicit off via settings: returns undefined
			expect(getEffectiveWorkflow({
				cwd: tempDir,
				agentDir: tempAgentDir,
				settings: { selfLearning: { enabled: false } },
			})).toBeUndefined();

			// 3. Explicit off via flag: returns undefined even if settings enabled
			expect(getEffectiveWorkflow({
				cwd: tempDir,
				agentDir: tempAgentDir,
				adaptationsFlag: "off",
				settings: { selfLearning: { enabled: true } },
			})).toBeUndefined();

			// 4. Explicit off via env: returns undefined even if settings enabled
			expect(getEffectiveWorkflow({
				cwd: tempDir,
				agentDir: tempAgentDir,
				env: { METIS_ADAPTATIONS: "off" },
				settings: { selfLearning: { enabled: true } },
			})).toBeUndefined();

			// 5. Active: returns workflow from disk
			const effective = getEffectiveWorkflow({
				cwd: tempDir,
				agentDir: tempAgentDir,
				settings: { selfLearning: { enabled: true } },
			});
			expect(effective).toBeDefined();
			expect(effective?.extraChecks?.[0]?.id).toBe("test-check");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
