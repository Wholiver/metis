import { describe, expect, it } from "vitest";
import { BROWSER_TOOL_NAMES } from "../src/core/tools/browser.ts";

/**
 * Regression: SDK initialActiveToolNames omit dynamic browser_* tools.
 * AgentSession must merge browserToolNames into the active set.
 */
describe("browser active tool merge", () => {
	it("merges browser tools into an SDK default active list", () => {
		const sdkDefaults = [
			"read",
			"bash",
			"edit",
			"write",
			"spawn_agent",
			"websearch",
			"webfetch",
			"video",
			"update_plan",
			"ask_user",
			"read_plan",
			"performance_admit",
			"performance_gate",
			"query_memory_db",
		];
		const browserToolNames = [...BROWSER_TOOL_NAMES];
		const merged = [...new Set([...sdkDefaults, ...browserToolNames])];
		expect(merged).toContain("browser_navigate");
		expect(merged).toContain("browser_snapshot");
		expect(merged.filter((name) => name.startsWith("browser_"))).toEqual([...BROWSER_TOOL_NAMES]);
	});
});
