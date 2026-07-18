import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("instructs models to resolve metis docs and examples under absolute base paths", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain(
				"- When reading metis docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory",
			);
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("requires deep web investigation for every task and cleans disposable research scratch", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: "/Users/test/project",
				sessionId: "research123",
			});

			expect(prompt).toContain("For EVERY task");
			expect(prompt).toContain("NO simple, trivial, familiar-task, or typo exception");
			expect(prompt).toContain("multiple complementary queries");
			expect(prompt).toContain("Prefer credible primary sources");
			expect(prompt).toContain("official documentation and specifications");
			expect(prompt).toContain("Use webfetch to inspect the authoritative or primary pages");
			expect(prompt).toContain("directly reuse a credible source's architecture or code");
			expect(prompt).toContain("license permits the intended use");
			expect(prompt).toContain("Do NOT cite, list, link, or otherwise mention investigation sources in user-facing output");
			expect(prompt).toContain("only then begin substantive work");
			expect(prompt).toContain("/Users/test/project/.temp/research123_research.md");
			expect(prompt).toContain("Delete /Users/test/project/.temp/research123_research.md immediately when no longer needed");
			expect(prompt).toContain("not the append-only working log at /Users/test/project/.temp/research123_log.md");
		});

		test("requires risk-based comprehensive testing and exact user prompt fidelity", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("CRITICAL - User Prompt Fidelity");
			expect(prompt).toContain("Do NOT omit, reinterpret, weaken, substitute, or expand any requirement");
			expect(prompt).toContain("risk-based test matrix");
			expect(prompt).toContain("boundary, empty, invalid, and error inputs");
			expect(prompt).toContain("integration, API/schema/dependency/configuration contracts");
			expect(prompt).toContain("concurrency, race conditions, and recovery");
			expect(prompt).toContain("authentication, authorization, input validation");
			expect(prompt).toContain("load, stress, and endurance");
			expect(prompt).toContain("accessibility, responsive behavior, localization, and platform/browser compatibility");
			expect(prompt).toContain("canary rollout, and rollback");
			expect(prompt).toContain("use web research when useful");
			expect(prompt).toContain("never use search as a substitute for testing");
		});

		test("does not inject default requirements into a custom prompt", () => {
			const prompt = buildSystemPrompt({
				customPrompt: "Custom instructions only.",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Custom instructions only.");
			expect(prompt).not.toContain("CRITICAL - User Prompt Fidelity");
			expect(prompt).not.toContain("risk-based test matrix");
		});

		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});
});
