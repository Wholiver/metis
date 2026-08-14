import { describe, expect, it } from "vitest";
import { BRANCH_SUMMARY_PROMPT } from "../src/core/compaction/branch-summarization.ts";
import {
	SUMMARIZATION_PROMPT,
	TURN_PREFIX_SUMMARIZATION_PROMPT,
	UPDATE_SUMMARIZATION_PROMPT,
} from "../src/core/compaction/compaction.ts";
import { SUMMARIZATION_SYSTEM_PROMPT } from "../src/core/compaction/utils.ts";
import { SESSION_NAME_SYSTEM_PROMPT } from "../src/core/session-name-generator.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import { SUBAGENT_COORDINATION_GUIDANCE } from "../src/core/tools/subagent.ts";

const TOOL_NAMES = [
	"read",
	"bash",
	"edit",
	"write",
	"log",
	"remember_user_intent",
	"user_intent",
	"websearch",
	"webfetch",
	"video",
	"subagent",
];

describe("static prompt compression contracts", () => {
	it("keeps the default agent prompt below its compressed budget", () => {
		const prompt = buildSystemPrompt({
			cwd: "/workspace",
			sessionId: "session",
			selectedTools: TOOL_NAMES,
			toolSnippets: Object.fromEntries(TOOL_NAMES.map((name) => [name, name])),
		});

		expect(prompt.length).toBeLessThan(3_000);
		expect(prompt).toContain("active workflow provides a checklist");
		expect(prompt).not.toContain("after 8 non-log tool calls");
		expect(prompt).not.toContain("remember_user_intent exactly once");
	});

	it("keeps compaction prompts compact without dropping exact output schemas", () => {
		const prompts = [
			SUMMARIZATION_SYSTEM_PROMPT,
			SUMMARIZATION_PROMPT,
			UPDATE_SUMMARIZATION_PROMPT,
			TURN_PREFIX_SUMMARIZATION_PROMPT,
			BRANCH_SUMMARY_PROMPT,
		];

		expect(prompts.join("\n").length).toBeLessThan(2_500);
		for (const prompt of [SUMMARIZATION_PROMPT, UPDATE_SUMMARIZATION_PROMPT]) {
			for (const heading of [
				"## Goal",
				"## Constraints & Preferences",
				"## Progress",
				"### Done",
				"### In Progress",
				"### Blocked",
				"## Key Decisions",
				"## Next Steps",
				"## Critical Context",
			]) {
				expect(prompt).toContain(heading);
			}
		}
		expect(UPDATE_SUMMARIZATION_PROMPT).toContain("Preserve all existing relevant information");
		expect(SUMMARIZATION_SYSTEM_PROMPT).toContain("Never continue it or answer its questions");
	});

	it("keeps subagent and title safety constraints within budgets", () => {
		expect(SUBAGENT_COORDINATION_GUIDANCE.length).toBeLessThan(1_300);
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("current Agent run pauses");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("in completion order");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("brief user-visible update");

		expect(SESSION_NAME_SYSTEM_PROMPT.length).toBeLessThan(140);
		expect(SESSION_NAME_SYSTEM_PROMPT).toContain("first prompt");
		expect(SESSION_NAME_SYSTEM_PROMPT).toContain("2–6 words");
		expect(SESSION_NAME_SYSTEM_PROMPT).toContain("title only");
	});

	it("preserves dynamic user and project prompt content verbatim", () => {
		const custom = "CUSTOM  keep   spacing\nDO NOT alter $variables.";
		const append = "APPEND\n  exact indentation";
		const project = "PROJECT\n\tconstraint: unchanged";
		const prompt = buildSystemPrompt({
			customPrompt: custom,
			appendSystemPrompt: append,
			contextFiles: [{ path: "/workspace/AGENTS.md", content: project }],
			cwd: "/workspace",
		});

		expect(prompt).toContain(custom);
		expect(prompt).toContain(append);
		expect(prompt).toContain(project);
	});
});
