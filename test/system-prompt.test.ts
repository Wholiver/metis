import { describe, expect, test } from "vitest";
import { buildInstructionStack, buildSystemPrompt, compileInstructionStack, instructionStackHash } from "../src/core/system-prompt.ts";

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

	test("keeps Plan conversational and Build execution-oriented with unified role identity", () => {
		const planPrompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "plan" });
		const buildPrompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "build" });

		expect(planPrompt).toContain("Chief Planning Architect (Planner)");
		expect(planPrompt).toContain("<proposed_plan>");
		expect(planPrompt).toContain("Do not edit files, run mutating tools, or call update_plan");
		expect(planPrompt).toContain("strictly forbid repetitive patterns such as '正在...', '我将...'");
		expect(planPrompt).toContain("MUST call ask_user");
		expect(planPrompt).toContain("Never present clarification questions as ordinary assistant text");
		expect(buildPrompt).toContain("Primary Coordinator & Engineering Engine (Coordinator & Executor)");
		expect(buildPrompt).toContain("strictly forbid repetitive '正在...', '我将...'");
		expect(buildPrompt).toContain("initialize or refresh update_plan before mutating tools");
		expect(buildPrompt).toContain("Progress & Implementation: maintain visible progress pacing");
	});

	test("requires intermediate updates before tool execution in every mode", () => {
		for (const collaborationMode of ["plan", "build", undefined] as const) {
			const prompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode });
			expect(prompt).toContain("First think briefly and emit one concise intermediate text update");
			expect(prompt).toContain("before visible tool work begins");
		}
	});

	test("keeps memoryOverview out of the compiled prompt while preserving its provenance", () => {
		const overviewContent = "# Memory Overview\n\n- [tech_stack]: Node.js with TypeScript\n- [user_preferences]: Prefers concise explanations";
		const stack = buildInstructionStack({ cwd: "/workspace", memoryOverview: overviewContent });

		// The overview is the one privileged input that changes mid-session. Compiling it
		// into the system prompt made every new memory invalidate the cached request
		// prefix, so WorkflowRuntime appends it as a runtime-context block instead.
		expect(stack.memoryOverview?.content).toBe(overviewContent);
		expect(compileInstructionStack(stack)).not.toContain(overviewContent);
		expect(buildSystemPrompt({ cwd: "/workspace", memoryOverview: overviewContent })).toBe(
			buildSystemPrompt({ cwd: "/workspace" }),
		);
		expect(instructionStackHash(stack)).toBe(instructionStackHash(buildInstructionStack({ cwd: "/workspace" })));

		expect(buildInstructionStack({ cwd: "/workspace", memoryOverview: "   \n  " }).memoryOverview).toBeUndefined();
	});

	test("incorporates Phase 0 Intent Classification & Admission Check across base instructions and Build mode", () => {
		const prompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "build" });
		expect(prompt).toContain("Phase 0: Intent Classification & Admission Check (Triage Fast-Path)");
		expect(prompt).toContain("Conversational / General Query / Greeting");
		expect(prompt).toContain("First apply Phase 0 Admission Check");
		expect(prompt).toContain("respond directly in text without mutating tools, creating ROADMAP/GATELOG files, or spawning subagents");
	});
});

