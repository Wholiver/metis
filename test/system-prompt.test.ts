import { describe, expect, test } from "vitest";
import { buildInstructionStack, buildSystemPrompt, compileInstructionStack } from "../src/core/system-prompt.ts";

describe("instruction stack", () => {
	test("renders trusted base and developer instructions in deterministic order", () => {
		const stack = buildInstructionStack({
			baseInstructions: "Base profile.",
			developerInstructions: ["Global rule."],
			contextFiles: [{ path: "/repo/AGENTS.md", content: "Project rule." }],
			selectedTools: ["read", "write"],
			toolSnippets: { read: "Read files", write: "Write files" },
			cwd: "/repo",
		});

		expect(stack.base.content).toBe("Base profile.");
		expect(stack.developer.map((entry) => entry.content)).toEqual(
			expect.arrayContaining(["Global rule.", "Project rule."]),
		);
		const rendered = compileInstructionStack(stack);
		expect(rendered.indexOf("Base profile.")).toBeLessThan(rendered.indexOf("Global rule."));
		expect(rendered).toContain('<developer_instructions source="/repo/AGENTS.md">');
	});

	test("keeps runtime context out of privileged instructions", () => {
		const stack = buildInstructionStack({ selectedTools: [], cwd: "/workspace", sessionId: "session" });
		expect(stack.context[0]?.content).toContain("Current working directory: /workspace");
		expect(compileInstructionStack(stack)).not.toContain("Current working directory");
	});

	test("renders no visible tools when no snippets are supplied", () => {
		const prompt = buildSystemPrompt({ selectedTools: [], cwd: process.cwd() });
		expect(prompt).toContain("Available tools for this step:\n(none)");
	});

	test("does not leak custom tool names without a prompt snippet", () => {
		const prompt = buildSystemPrompt({ selectedTools: ["read", "dynamic_tool"], cwd: process.cwd() });
		expect(prompt).not.toContain("dynamic_tool");
	});

	test("preserves configured base instructions and deduplicates tool guidance", () => {
		const prompt = buildSystemPrompt({
			baseInstructions: "Custom base.",
			promptGuidelines: ["Use scoped validation.", " Use scoped validation. "],
			cwd: process.cwd(),
		});
		expect(prompt).toContain("Custom base.");
		expect(prompt.match(/Use scoped validation\./g)).toHaveLength(1);
	});

	test("does not encode legacy memory and plan-file mandates", () => {
		const prompt = buildSystemPrompt({ cwd: "/workspace", sessionId: "session" });
		expect(prompt).not.toContain("LIVE WORKING MEMORY");
		expect(prompt).not.toContain("remember_user_intent exactly once");
		expect(prompt).not.toContain("after 8 non-log tool calls");
		expect(prompt).toContain("active workflow provides a checklist");
	});

	test("keeps Plan conversational and Build execution-oriented", () => {
		const planPrompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "plan" });
		const buildPrompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "build" });

		expect(planPrompt).toContain("Plan Mode is conversational and read-only");
		expect(planPrompt).toContain("<proposed_plan>");
		expect(planPrompt).toContain("Do not edit files, run mutating tools, or call update_plan");
		expect(planPrompt).toContain("before each meaningful batch of read-only tool calls");
		expect(planPrompt).toContain("Use the user's language");
		expect(planPrompt).toContain("Do not narrate every file read");
		expect(planPrompt).toContain("MUST call ask_user");
		expect(planPrompt).toContain("Never present clarification questions as ordinary assistant text");
		expect(buildPrompt).toContain("Plan Mode is ended");
		expect(buildPrompt).toContain("before each meaningful batch of tool calls");
		expect(buildPrompt).toContain("Use the user's language");
		expect(buildPrompt).toContain("call update_plan before the first mutating tool");
		expect(buildPrompt).toContain("call read_plan whenever its exact contents or current execution progress are not present");
	});
});
