import { describe, expect, it } from "vitest";
import { buildInstructionStack, buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("workflow prompt policy", () => {
	it("moves date, cwd, and session data to untrusted runtime context", () => {
		const stack = buildInstructionStack({ cwd: "/Users/test/project", sessionId: "abc123", selectedTools: ["read"] });
		expect(stack.context[0]?.content).toContain("Session ID: abc123");
		expect(stack.context[0]?.content).toContain("Current working directory: /Users/test/project");
	});

	it("keeps memory tools optional instead of making every prompt perform log work", () => {
		const prompt = buildSystemPrompt({ cwd: "/Users/test/project", selectedTools: ["read", "log"] });
		expect(prompt).not.toContain("action=checkpoint");
		expect(prompt).not.toContain("action=completion");
		expect(prompt).not.toContain("brain-map.md");
	});
});
