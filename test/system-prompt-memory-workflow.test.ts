import { describe, expect, it } from "vitest";
import { resolve } from "path";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import { getAgentDir } from "../src/config.ts";

describe("buildSystemPrompt memory workflow", () => {
	it("routes normal work through temp log and leaves memory files for dream consolidation", () => {
		const prompt = buildSystemPrompt({
			cwd: "/Users/test/project",
			sessionId: "abc123",
			selectedTools: ["read", "bash", "log"],
			toolSnippets: {
				read: "read files",
				bash: "run shell",
				log: "append working log",
			},
		});

		const metisDir = resolve(getAgentDir(), "..").replace(/\\/g, "/");

		expect(prompt).toContain("/Users/test/project/.temp/abc123_log.md");
		expect(prompt).toContain("/Users/test/project/.metis/plan/abc123.md");
		expect(prompt).toContain("brain-map.md");
		expect(prompt).toContain("CRITICAL - LIVE WORKING MEMORY");
		expect(prompt).toContain("append-only working memory");
		expect(prompt).toContain("action=read");
		expect(prompt).toContain("action=checkpoint");
		expect(prompt).toContain("action=error");
		expect(prompt).toContain("action=completion");
		expect(prompt).toContain("TASK PLAN");
		expect(prompt).toContain("create and maintain the current session plan");
		expect(prompt).toContain("# Task Plan");
		expect(prompt).toContain("## Scope & Constraints");
		expect(prompt).toContain("## Steps");
		expect(prompt).toContain("## Verification");
		expect(prompt).toContain("## Risks & Blockers");
		expect(prompt).toContain("[pending|in_progress|completed|blocked]");
		expect(prompt).toContain("only one item may be in_progress");
		expect(prompt).toContain("Update the plan immediately when requirements, scope, approach, status, verification strategy, or blockers change");
		expect(prompt).toContain("do NOT write a work diary, raw tool output, or unrelated completed exploration");
		expect(prompt).toContain("delete this plan file");
		expect(prompt).toContain("WORKING-MEMORY CHECKPOINTS");
		expect(prompt).toContain("after every completed plan step");
		expect(prompt).toContain("material decision or scope/approach change");
		expect(prompt).toContain("implementation batch");
		expect(prompt).toContain("verification result, or blocker");
		expect(prompt).toContain("goal, done work, active work, key decisions, next step, verification state, and blockers");
		expect(prompt).toContain("after 8 non-log tool calls");
		expect(prompt).toContain("TASK COMPLETION SUMMARY");
		expect(prompt).toContain("TESTING ERROR LOGGING");
		expect(prompt).toContain("call log with action=error immediately before resuming substantive work");
		expect(prompt).toContain("record it even when resolved");
		expect(prompt).toContain("phase or test, symptom and reproduction, impact, root cause or diagnosis, fix or workaround, post-fix verification result, and residual risk");
		expect(prompt).toContain("Misfiled artifacts or incorrect paths");
		expect(prompt).toContain("Do NOT log expected negative-test failures or no-impact informational messages");
		expect(prompt).toContain("Never dump raw error output into the log");
		expect(prompt).toContain("FINAL REQUIREMENT REVIEW");
		expect(prompt).toContain("USER INTENT CAPTURE");
		expect(prompt).toContain("remember_user_intent exactly once");
		expect(prompt).toContain("copied verbatim");
		expect(prompt).toContain("MUST call user_intent");
		expect(prompt).toContain("more recent timestamp has higher priority");
		expect(prompt).toContain("high-density 3-10 line summary");
		expect(prompt).toContain("Keep enough technical detail for Dream and later continuation");
		expect(prompt).toContain("dream consolidation will promote the complete log later");
		expect(prompt).toContain("The session log contains only this session's current decisions");
		expect(prompt).toContain("do not use it as historical memory");
		expect(prompt).toContain("For previous sessions or days");
		expect(prompt).toContain("The plan is task state; the log is the concise continuation snapshot and event history");
		expect(prompt).toContain("Dream cleanup may prune older temp logs, but it must never delete today's temp log");
		expect(prompt).toContain(`Do NOT write ${metisDir}/memory/ or ${metisDir}/lessons/ directly during normal work`);
		expect(prompt).not.toContain("create a detailed log in");
		expect(prompt).not.toContain("IMMEDIATELY after writing a detailed memory/lesson");
	});

	it("uses parent of custom agent dir for brain-map and memory roots", () => {
		const previousAgentDir = process.env.METIS_CODING_AGENT_DIR;
		process.env.METIS_CODING_AGENT_DIR = "/tmp/custom-metis-agent";

		try {
			const prompt = buildSystemPrompt({
				cwd: "/Users/test/project",
				sessionId: "abc123",
				selectedTools: ["read"],
				toolSnippets: { read: "read files" },
			});

			expect(prompt).toContain("/tmp/brain-map.md");
			expect(prompt).toContain("Do NOT write /tmp/memory/ or /tmp/lessons/ directly during normal work");
		} finally {
			if (previousAgentDir === undefined) {
				delete process.env.METIS_CODING_AGENT_DIR;
			} else {
				process.env.METIS_CODING_AGENT_DIR = previousAgentDir;
			}
		}
	});
});
