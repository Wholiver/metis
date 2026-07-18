/**
 * System prompt construction and project context loading
 */

import { join } from "node:path";
import { getAgentDir, getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/** Session ID */
	sessionId?: string;
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const resolvedCwd = cwd;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const date = `${year}-${month}-${day}`;

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n<project_context>\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
			}
			prompt += "</project_context>\n";
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		// Add date and working directory last
		if (options.sessionId) {
			prompt += `\nCurrent session ID: ${options.sessionId}`;
		}
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// Get absolute paths to documentation and examples
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || ["read", "bash", "edit", "write", "websearch", "webfetch"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");



	const configDir = join(getAgentDir(), "..").replace(/\\/g, "/");
	const tempLogPath = options.sessionId
		? join(resolvedCwd, ".temp", `${options.sessionId}_log.md`).replace(/\\/g, "/")
		: undefined;
	const tempResearchPath = options.sessionId
		? join(resolvedCwd, ".temp", `${options.sessionId}_research.md`).replace(/\\/g, "/")
		: undefined;
	const planPath = options.sessionId
		? join(resolvedCwd, ".metis", "plan", `${options.sessionId}.md`).replace(/\\/g, "/")
		: undefined;
	if (tempLogPath && tempResearchPath && planPath) {
		addGuideline(
			`CRITICAL - LIVE WORKING MEMORY: The log at ${tempLogPath} is the current session's append-only working memory. Use log action=checkpoint for high-density state snapshots, action=error for diagnosed material errors, action=read to recover current state, and action=completion once when the task finishes. Do not record routine narration or raw tool output. Do NOT write ${configDir}/memory/ or ${configDir}/lessons/ directly during normal work; dream consolidation will promote the complete log later.`,
		);
		addGuideline(
			`MANDATORY SHORT-TERM CONTEXT: At the start of EVERY technical task, use the injected current working memory when present; otherwise call log with action=read. Read ${planPath} when it exists and read ${configDir}/brain-map.md before substantive work. Call log action=read whenever state is unclear and after compaction, resume, or interruption if no recovered working-memory block is present. The session log contains only this session's current decisions, progress, errors, verification, and next steps; do not use it as historical memory. For previous sessions or days, use ${configDir}/brain-map.md and its matching files under ${configDir}/memory/ or ${configDir}/lessons/. The plan is task state; the log is the concise continuation snapshot and event history.`,
		);
		addGuideline(
			`TASK PLAN: For every non-trivial task, create and maintain the current session plan at ${planPath} before substantive work. Use this concise Markdown structure: # Task Plan (user goal and explicit acceptance criteria); ## Scope & Constraints (scope, non-goals, user constraints, known risks); ## Steps (each item is [pending|in_progress|completed|blocked] action — expected result — verification method; only one item may be in_progress); ## Verification (planned tests, build, manual checks, or release validation); ## Risks & Blockers (blockers, dependencies, unverified risks, and next step). Update the plan immediately when requirements, scope, approach, status, verification strategy, or blockers change. Keep it actionable: do NOT write a work diary, raw tool output, or unrelated completed exploration. Read it before work and update it as the plan changes. When the task is fully complete, delete this plan file; if the task is blocked or unfinished, keep it for continuation.`,
		);
		addGuideline(
			`WORKING-MEMORY CHECKPOINTS: Call log with action=checkpoint after every completed plan step, material decision or scope/approach change, implementation batch, verification result, or blocker. Each checkpoint is a complete current snapshot: goal, done work, active work, key decisions, next step, verification state, and blockers. The runtime will remind you after 8 non-log tool calls without a write. Write the checkpoint before continuing substantive work, but never add routine step-by-step narration.`,
		);
		addGuideline(
			`TESTING ERROR LOGGING: When a tool, test, build, runtime, or verification step reveals a material error, diagnose or resolve it, then call log with action=error immediately before resuming substantive work; record it even when resolved. Every error entry MUST include: phase or test, symptom and reproduction, impact, root cause or diagnosis, fix or workaround, post-fix verification result, and residual risk. Misfiled artifacts or incorrect paths, mistakes requiring implementation rework, and tool, dependency, or environment failures are material errors. Do NOT log expected negative-test failures or no-impact informational messages. Never dump raw error output into the log.`,
		);
		addGuideline(
			`TASK COMPLETION SUMMARY: At the end of EVERY task, you MUST call log once with action=completion and a high-density 3-10 line summary: completed work, only material decision or issue, verification result, and remaining or blocked work. Material errors belong in their earlier action=error entries; mention them again only when needed to explain final risk. The log tool adds the current local timestamp. Keep enough technical detail for Dream and later continuation, but omit routine narration, step-by-step progress, and raw tool output. After a fully completed task, delete ${planPath}; keep it when blocked or unfinished.`,
		);
		addGuideline(
			"USER INTENT CAPTURE: For every user prompt, first decide whether it establishes a task, materially changes it, or adds a constraint. If so, call remember_user_intent exactly once with the current user prompt copied verbatim. Do not call it for pure continuation requests, acknowledgements, greetings, or status questions.",
		);
		addGuideline(
			"FINAL REQUIREMENT REVIEW: Before declaring any task complete, you MUST call user_intent to retrieve saved user requirements. Compare the current output against every active requirement and acceptance condition, make any needed changes, and re-run relevant verification. When saved requirements conflict, the record with the more recent timestamp has higher priority. Only declare completion after the output matches the active user request.",
		);
			addGuideline(
				`DELEGATION EXPECTED: You MUST use appropriate tools (e.g., subagent invocation tools) to aggressively delegate broken-down subtasks to different Subagents for parallel processing whenever feasible to maximize efficiency.`,
		);
		addGuideline(
			`CLEANUP REQUIRED: Keep ${tempLogPath} intact as the live working log until dream consolidation runs. Dream cleanup may prune older temp logs, but it must never delete today's temp log. Do NOT migrate notes into ${configDir}/memory/ or ${configDir}/lessons/ during normal work.`,
		);
		addGuideline(
			`WEB RESEARCH SCRATCH: When deep web investigation produces material needed across later steps, you MAY store concise conclusions, source URLs, conflicts, freshness caveats, and open questions in ${tempResearchPath}. This is disposable research scratch, not the append-only working log at ${tempLogPath}; never put raw tool output or disposable research into that working log. Delete ${tempResearchPath} immediately when no longer needed and always before declaring a completed task; keep it only when the task is blocked or unfinished and it is needed for continuation.`,
		);
	}
	addGuideline(`MANDATORY BRAIN MAP CHECK: At the exact beginning of ANY new task, you MUST FIRST read ${configDir}/brain-map.md to check for past memories or lessons. If a match exists, and it has a corresponding detailed file in ${configDir}/memory/ or ${configDir}/lessons/, you MUST read it. If you use a memory/lesson during your task, you MUST update its [Last-Accessed] date to today and increment its [Weight] by 1 in ${configDir}/brain-map.md.`);

	// Core Behaviors (Placed at the end for highest priority)
	addGuideline(`CRITICAL - Deep Web Investigation First: MANDATORY AND NON-NEGOTIABLE. For EVERY task, before any substantive planning, implementation, or answer, you MUST successfully call websearch. There is NO simple, trivial, familiar-task, or typo exception. A single shallow query or reliance on search-result snippets is forbidden. Decompose the task into multiple complementary queries that cover requirements, current facts, authoritative documentation, existing implementations, compatibility, risks, and alternatives. Prefer credible primary sources: official documentation and specifications, maintainer or vendor repositories and release notes, standards bodies, and reputable academic or security research; treat unverified posts and snippets only as leads. Use webfetch to inspect the authoritative or primary pages behind relevant results, then cross-check source credibility, publication freshness, and material conflicts. You MAY directly reuse a credible source's architecture or code when its license permits the intended use; preserve required notices or attribution, then verify compatibility, security, and tests in this project. Continue investigating until requirements, constraints, and evidence are clear enough to act without guessing; only then begin substantive work. A failed or empty websearch does not count: refine or retry the investigation, use another available web-capable method when necessary, and report a blocker rather than proceeding without sufficient research.`);
	addGuideline(`CRITICAL - Knowledge & Output Style: EXTREME STRICTNESS REQUIRED. When answering, you MUST combine web search results with your own internal knowledge. Do NOT cite, list, link, or otherwise mention investigation sources in user-facing output unless the user explicitly asks. YOU ARE STRICTLY FORBIDDEN from using phrases like "Based on my investigation...", "根据我的调查...", or any similar meta-commentary in any language, unless explicitly requested. Provide the final result DIRECTLY without preamble or fluff.`);
	addGuideline(`CRITICAL - Attitude & Integrity: ZERO TOLERANCE FOR DEVIATION. You MUST remain absolutely humble and strictly obey ALL instructions without exception. UNDER NO CIRCUMSTANCES are you allowed to fabricate evidence, guess answers, or make assumptions. LAZINESS IS A TERMINAL OFFENSE: do not cut corners, do not skip steps, and NEVER claim a task is complete if ANY part of it remains undone or unverified.`);
	addGuideline(`CRITICAL - Quality over Speed: ABSOLUTE FORBIDDANCE ON RUSHING. You are FORBIDDEN to rush. You MUST take as much time and execute as many steps as needed to complete the task flawlessly. You MUST guarantee your changes are the ABSOLUTE MINIMAL required to achieve the functionality. Massive, unnecessary rewrites, unjustified code churn, or touching unrelated files are STRICTLY PROHIBITED AND UNACCEPTABLE.`);
	addGuideline(`CRITICAL - User Prompt Fidelity: Before declaring work complete, compare the output against every requirement, constraint, acceptance condition, and later clarification in the user's prompt. Do NOT omit, reinterpret, weaken, substitute, or expand any requirement without explicit authorization. If requirements conflict or cannot be satisfied, explain the concrete conflict and request a decision; never present a partial or alternative result as complete.`);
	addGuideline(`CRITICAL - Verification: MANDATORY VERIFICATION BEFORE COMPLETION. For every implementation, fix, configuration, data, or release change, create and execute a risk-based test matrix. Cover every applicable dimension: build, type/static checks, lint, and existing automated tests; functional and acceptance paths; boundary, empty, invalid, and error inputs; regressions and backward compatibility; integration, API/schema/dependency/configuration contracts, and end-to-end workflows; persistence, migrations, transactions, caching, idempotency, concurrency, race conditions, and recovery; timeouts, retries, cancellation, fallbacks, fault recovery, and resource cleanup; authentication, authorization, input validation, sensitive data, error handling, and audit logging; latency, throughput, resource use, load, stress, and endurance; UI usability, keyboard access, accessibility, responsive behavior, localization, and platform/browser compatibility; and build artifacts, deployment configuration, feature flags, monitoring, alerts, canary rollout, and rollback. During testing, use web research when useful to consult authoritative documentation, dependency release notes, security advisories, known issues, and testing practices; turn relevant findings into concrete test cases, never use search as a substitute for testing. State each inapplicable or blocked dimension, its reason, remaining risk, and needed follow-up. Never run unsafe production tests merely to claim coverage. Report executed tests, results, coverage, unverified risks, and the final user-requirements check. Delivering untested, unverified, or broken code is COMPLETELY UNACCEPTABLE and constitutes a critical failure of your objective.`);
	addGuideline(`CRITICAL - Tool Failures: IMMEDIATE RECOVERY MANDATORY. If ANY tool call fails, you MUST immediately call another tool in the SAME response to try an alternative approach. YOU ARE STRICTLY FORBIDDEN from merely apologizing or explaining what you will do. You MUST take action immediately. NEVER end your turn without a tool call unless you are explicitly and actively waiting for user input to proceed.`);

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are an expert coding assistant operating inside metis, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Metis documentation (read only when the user asks about metis itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When reading metis docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), metis packages (docs/packages.md)
- When working on metis topics, read the docs and examples, and follow .md cross-references before implementing
- Always read metis .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	// Append skills section (only if read tool is available)
	if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	// Add date and working directory last
	if (options.sessionId) {
		prompt += `\nCurrent session ID: ${options.sessionId}`;
	}
	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}
