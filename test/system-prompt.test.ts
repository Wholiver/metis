import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildInstructionStack, buildSystemPrompt, compileInstructionStack, instructionStackHash } from "../src/core/system-prompt.ts";
import { BUILTIN_COORDINATOR } from "../src/core/agent-definition.ts";
import { SPAWN_AGENT_GUIDANCE, spawnAgentSchema } from "../src/core/tools/spawn_agent.ts";
import { PerformanceRuntime } from "../src/core/performance-runtime.ts";

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
		expect(prompt).toContain("Keep concise progress visible");
	});

	test("keeps Plan conversational and Build execution-oriented with unified role identity", () => {
		const planPrompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "plan" });
		const buildPrompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "build" });

		expect(planPrompt).toContain("Chief Planning Architect (Planner)");
		expect(planPrompt).toContain("<proposed_plan>");
		expect(planPrompt).toContain("Do not edit files, run mutating tools, or call update_plan");
		expect(planPrompt).toContain("No performance_admit, no performance_gate, no spawn fleet");
		expect(planPrompt).not.toContain("Authoritative Build admission policy");
		expect(planPrompt).not.toContain("call performance_admit before the first write");
		expect(planPrompt).toContain("four-step plan");
		expect(planPrompt).toContain("strictly forbid repetitive patterns such as '正在...', '我将...'");
		expect(planPrompt).toContain("MUST call ask_user");
		expect(planPrompt).toContain("Never present clarification questions as ordinary assistant text");
		expect(planPrompt).toContain("Match user's language");
		expect(buildPrompt).toContain("Primary Coordinator & Engineering Engine (Coordinator & Executor)");
		expect(buildPrompt).toContain("Match user's language");
		expect(buildPrompt).toContain("strictly forbid repetitive '正在...', '我将...'");
		expect(buildPrompt).toContain("Read-only investigation may precede admission; mutating work may not");
		expect(buildPrompt).toContain("Creating or generating files, SVG, images, pages, or other artifacts is mutating work");
		expect(buildPrompt).toContain("Do not finish after a first-draft write");
		expect(buildPrompt).toContain("keep integrated-workspace evidence current");
	});

	test("requires intermediate updates before tool execution in every mode", () => {
		for (const collaborationMode of ["plan", "build", undefined] as const) {
			const prompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode });
			expect(prompt).toContain("user's latest-message language");
			expect(prompt).toContain("Default is silence between tools");
			expect(prompt).toContain("never emit because a tool result arrived");
			expect(prompt).toContain("what you found or what is wrong, and what you will do next");
			expect(prompt).toContain("emit zero visible text while exploring");
			expect(prompt).toContain("update_plan checking off a step");
			expect(prompt).toContain("a stretch of quiet implementation");
			expect(prompt).toContain("Do not emit extra visible notes around performance_admit or a passing performance_gate");
			expect(prompt).toContain("a completed checklist is not task completion");
			expect(prompt).toContain("Never narrate tool-call schema, missing arguments, or how to invoke a tool");
			expect(prompt).toContain("Never narrate one update per tool");
			expect(prompt).toContain("Do not put a required update only in thinking");
			expect(prompt.indexOf("Default is silence between tools")).toBeLessThan(prompt.indexOf("what you found or what is wrong"));
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

	test("named children get a ChildResult worker contract instead of the root Build closed loop", () => {
		const childPrompt = buildSystemPrompt({
			cwd: "/workspace",
			collaborationMode: "build",
			namedAgentSession: true,
		});
		expect(childPrompt).toContain("ChildResult");
		expect(childPrompt).toContain("Do not call performance_admit or performance_gate");
		expect(childPrompt).not.toContain("Authoritative Build admission policy");
		expect(childPrompt).not.toContain("L0–L4");
		expect(childPrompt).not.toContain("L0→L4");
		expect(childPrompt).not.toContain("FEATURE-SUPERVISOR");
		expect(childPrompt).not.toContain("admit first, then implement");
		const gateDescription = JSON.stringify(spawnAgentSchema.properties.gate);
		expect(gateDescription).not.toMatch(/must submit/i);
		expect(gateDescription).toContain("ChildResult");
		expect(gateDescription).toContain("must not call performance_gate");
	});

	test("uses one authoritative structured Build admission policy", () => {
		const prompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "build" });
		expect(prompt).toContain("Authoritative Build admission policy");
		expect(prompt).toContain("Conversational or read-only requests");
		expect(prompt).toContain("call performance_admit before the first write, edit, bash, spawn_agent, update_plan, performance_gate, or mutating browser_* action");
		expect(prompt).toContain("Never skip admission to finish faster");
		expect(prompt).toContain("A first-draft write is not completion");
		expect(prompt).toContain("Apply/T0 skips G0; close G4 only after independent verification evidence");
		expect(prompt).toContain("Do not claim completion after a failed or mismatched performance_gate");
		expect(prompt).toContain("Do not stop after the first plausible artifact");
		expect(prompt.match(/authoritative Build admission policy/gi)).toHaveLength(2);
	});

	test("treats artifact generation as mutating closed-loop work, not chat", () => {
		const prompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "build" });
		expect(prompt).toContain("creates, edits, generates, or opens a file, image, SVG, page, script, or other workspace artifact is mutating Build work");
		expect(prompt).toContain("Artifact and generation work (SVG, image, page, report, data file)");
		expect(prompt).toContain("at least one repair pass if that check fails");
		expect(prompt).toContain("Do not claim completion after a failed or mismatched performance_gate");
		expect(prompt).toContain("write gate receipts under that run's governance artifacts/ directory");
		expect(prompt).toContain("T0: G4; T1: G4 then G5/G6");
		expect(prompt).not.toContain("Reliable-headless short loop");
	});

	test("routes T0/T1 without implementation subagents and keeps assurance semantic", () => {
		const prompt = buildSystemPrompt({ cwd: "/workspace", collaborationMode: "build" });
		expect(prompt).toContain("T0 bounded mechanical work: root still implements and verifies with a real closed loop");
		expect(prompt).toContain("T1 bounded fix or feature: root performs G4; then fresh reviewer G5 and fresh verifier G6");

		// BUILTIN_COORDINATOR role contract
		expect(BUILTIN_COORDINATOR.systemPrompt).toContain("T0 never reaches this role");
		expect(BUILTIN_COORDINATOR.systemPrompt).toContain("T1 uses root implementation followed by fresh G5 review and G6 verification");

		// spawn_agent tool guidance negative constraint
		expect(SPAWN_AGENT_GUIDANCE).toContain("T0 forbids spawn_agent");
		expect(SPAWN_AGENT_GUIDANCE).toContain("T1 keeps implementation on root and permits only fresh reviewer/verifier assurance");
		expect(JSON.stringify(spawnAgentSchema)).not.toMatch(/must submit/i);

		// performance runtime emits admitted route, not pre-admission triage prose
		const tempDir = mkdtempSync(join(tmpdir(), "metis-prompt-test-"));
		try {
			const runtime = new PerformanceRuntime(tempDir);
			runtime.admit({ kind: "admit", mission: "Simple task test", workspaceRoot: "/workspace", admission: {
				tier: "T0", taskShape: "bounded", deliverables: ["file updated"], acceptanceCriteria: ["exact change present"],
				verificationCommands: ["git diff --check"], sharedMutableState: false,
				lanes: [{ id: "apply", objective: "apply exact edit", framework: "apply", ownedPaths: ["README.md"], deliverables: ["file updated"], acceptanceCriteria: ["exact change present"], verificationCommands: ["git diff --check"], dependsOn: [] }],
			} });
			const protocolBlock = runtime.contextBlocks().find((b) => b.id === "performance-protocol");
			expect(protocolBlock?.content).toContain("root G4 executor for the admitted T0 bounded lane");
			expect(protocolBlock?.content).toContain("call performance_gate");
			expect(protocolBlock?.content).not.toContain("L1 FEATURE-SUPERVISOR");
			expect(runtime.contextBlocks().find((b) => b.id === "performance-state")?.content).toContain("reported by every performance_gate");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
