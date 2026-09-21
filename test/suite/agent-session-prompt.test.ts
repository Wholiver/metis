import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/metis-agent-core";
import { fauxAssistantMessage, fauxToolCall, type Model } from "@earendil-works/metis-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { InputEvent } from "../../src/core/extensions/index.ts";
import type { PromptTemplate } from "../../src/core/prompt-templates.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getAssistantTexts, getMessageText, type Harness } from "./harness.ts";

function visibleSessionMessages(harness: Harness) {
	return harness.session.messages.filter((message) => !(message.role === "custom" && message.customType === "workflow_context"));
}

function admissionCall(overrides: Record<string, unknown> = {}) {
	return fauxToolCall("performance_admit", {
		tier: "T1",
		taskShape: "bounded",
		deliverables: ["Parser behavior repaired"],
		acceptanceCriteria: ["Regression passes"],
		verificationCommands: ["npm test -- parser"],
		sharedMutableState: false,
		lanes: [{
			id: "parser-fix", objective: "Repair parser", framework: "backend-fix",
			ownedPaths: ["src/parser.ts", "test/parser.test.ts"], deliverables: ["Fix and regression"],
			acceptanceCriteria: ["Regression passes"], verificationCommands: ["npm test -- parser"], dependsOn: [],
		}],
		...overrides,
	});
}

function admittedResponses(overrides: Record<string, unknown> = {}) {
	return [
		fauxAssistantMessage(admissionCall(overrides), { stopReason: "toolUse" }),
		fauxAssistantMessage("admitted"),
	];
}

describe("AgentSession prompt characterization", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (tempDirs.length > 0) {
			const tempDir = tempDirs.pop();
			if (tempDir) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		}
	});

	it("prompts while idle and records a single text response", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("hello")]);

		await harness.session.prompt("hi");

		expect(visibleSessionMessages(harness).map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(getMessageText(visibleSessionMessages(harness)[0]!)).toBe("hi");
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.session.performanceRun).toBeUndefined();
	});

	it("blocks mutating tools until performance_admit succeeds", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const target = join(harness.tempDir, "blocked-before-admission.txt");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: target, content: "must not exist" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("blocked"),
		]);
		await harness.session.prompt("Create a file");
		expect(existsSync(target)).toBe(false);
		expect(harness.session.performanceRun).toBeUndefined();
		expect(harness.session.messages.some((message) => getMessageText(message).includes("requires a successful performance_admit"))).toBe(true);
	});

	it("blocks mutating browser tools until performance_admit succeeds", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		(harness.session as unknown as { _performanceAdmissionRequired: boolean })._performanceAdmissionRequired = true;
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "nav-1", name: "browser_navigate", arguments: { url: "file:///tmp/x.svg" } },
			args: { url: "file:///tmp/x.svg" },
		} as never)).toMatchObject({
			block: true,
			reason: expect.stringContaining("performance_admit"),
		});
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "tabs-new-1", name: "browser_tabs", arguments: { action: "new", url: "file:///tmp/x.svg" } },
			args: { action: "new", url: "file:///tmp/x.svg" },
		} as never)).toMatchObject({
			block: true,
			reason: expect.stringContaining("performance_admit"),
		});
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "tabs-select-1", name: "browser_tabs", arguments: { action: "select", tabId: "t1" } },
			args: { action: "select", tabId: "t1" },
		} as never)).toMatchObject({
			block: true,
			reason: expect.stringContaining("performance_admit"),
		});
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "tabs-list-1", name: "browser_tabs", arguments: { action: "list" } },
			args: { action: "list" },
		} as never)).toBeUndefined();
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "snap-1", name: "browser_snapshot", arguments: {} },
			args: {},
		} as never)).toBeUndefined();
		expect(await harness.session.agent.beforeToolCall?.({
			toolCall: { id: "shot-1", name: "browser_take_screenshot", arguments: {} },
			args: {},
		} as never)).toBeUndefined();
	});

	it("warns when update_plan completes the checklist while a Performance run is active", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(admissionCall(), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("update_plan", {
				plan: [{ step: "Repair parser", status: "completed" }],
			}), { stopReason: "toolUse" }),
			fauxAssistantMessage("checklist marked complete"),
		]);
		await harness.session.prompt("Repair the parser");
		expect(harness.session.performanceRun?.status).toBe("active");
		expect(JSON.stringify(harness.session.messages)).toContain("FALSE_COMPLETION_BLOCKED");
	});

	it("starts native Performance orchestration only after structured admission", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses(admittedResponses());

		await harness.session.prompt("Repair the parser");

		expect(harness.session.performanceRun).toMatchObject({ mission: "Repair the parser", frontier: "G0", status: "active", schemaVersion: 2 });
		expect(getMessageText(visibleSessionMessages(harness)[0]!)).toBe("Repair the parser");
		expect(harness.session.performanceRun?.governanceRoot).toContain("performance-runs");
		const roadmap = join(harness.session.performanceRun!.governanceRoot, "ROADMAP.md");
		expect(existsSync(roadmap)).toBe(true);
		expect(readFileSync(roadmap, "utf8")).toContain("Mission pointer:");
		expect(harness.session.workflowPlan).toBeUndefined();
	});

	it("keeps an active T0 apply run instead of accepting a false completion", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(admissionCall({
				tier: "T0",
				taskShape: "bounded",
				deliverables: ["pelican.svg"],
				acceptanceCriteria: ["内置浏览器截图 shows a pelican on a bicycle"],
				verificationCommands: ["browser_take_screenshot"],
				lanes: [{
					id: "pelican-svg",
					objective: "Generate pelican.svg",
					framework: "apply",
					ownedPaths: ["pelican.svg"],
					deliverables: ["pelican.svg"],
					acceptanceCriteria: ["内置浏览器截图 shows a pelican on a bicycle"],
					verificationCommands: ["browser_take_screenshot"],
					dependsOn: [],
				}],
			}), { stopReason: "toolUse" }),
			fauxAssistantMessage("All steps done, the SVG is delivered."),
		]);

		await harness.session.prompt("画一只鹈鹕骑自行车");

		// First-draft text does not close the run. Host auto-continue is not implemented.
		expect(harness.session.performanceRun).toMatchObject({ status: "active", frontier: "G4" });
		expect(getAssistantTexts(harness)).toEqual(expect.arrayContaining([
			"All steps done, the SVG is delivered.",
		]));
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("honors and strips native direct invocation controls", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses(admittedResponses());

		await harness.session.prompt("mode=custom max_subs=3 agents=auto Repair the parser");

		expect(harness.session.performanceRun).toMatchObject({
			mission: "Repair the parser", concurrency: "custom", maxConcurrent: 3, agentSelection: "auto",
		});
	});

	it("hard-stops direct Build before model work when a required capability is disabled", async () => {
		const harness = await createHarness({ initialActiveToolNames: ["read", "write"] });
		harnesses.push(harness);

		await expect(harness.session.prompt("Repair the parser")).rejects.toThrow("control capability is disabled");

		expect(harness.session.performanceRun).toBeUndefined();
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("re-admits a later direct task at a legal G1 fallback", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			...admittedResponses({ tier: "T2", taskShape: "sequential-complex", lanes: [{
				id: "parser-plan", objective: "Design parser", framework: "plan-design", ownedPaths: ["src/parser.ts"],
				deliverables: ["Design"], acceptanceCriteria: ["Design accepted"], verificationCommands: ["npm test -- parser"], dependsOn: [],
			}] }),
			...admittedResponses({ tier: "T2", taskShape: "sequential-complex", lanes: [{
				id: "parser-plan", objective: "Design parser tests", framework: "plan-design", ownedPaths: ["src/parser.ts"],
				deliverables: ["Updated design"], acceptanceCriteria: ["Tests covered"], verificationCommands: ["npm test -- parser"], dependsOn: [],
			}] }),
		]);

		await harness.session.prompt("Repair the parser");
		const firstRun = harness.session.performanceRun;
		await harness.session.prompt("Add parser tests");

		expect(harness.session.performanceRun).toMatchObject({ runId: firstRun?.runId, frontier: "G1" });
		expect(readFileSync(join(firstRun!.governanceRoot, "PROMPTS.txt"), "utf8")).toContain("Add parser tests");
	});

	it("uses attended chooser selections for direct Build runs and records them", async () => {
		const requests: string[][] = [];
		const harness = await createHarness({
			performanceAttendance: "attended",
			askUserHandler: async (request) => {
				requests.push(request.questions.map((question) => question.id));
				return {
					cancelled: false,
					answers: [
						{ id: "performance_concurrency", value: "wide", selectedLabel: "wide" },
						{ id: "performance_agent_selection", value: "auto-tier", selectedLabel: "auto-tier" },
						{ id: "performance_custom_cap", value: "12", selectedLabel: "12" },
					],
				};
			},
		});
		harnesses.push(harness);
		harness.setResponses(admittedResponses());

		await harness.session.prompt("Repair the parser");

		expect(requests).toEqual([["performance_concurrency", "performance_agent_selection", "performance_custom_cap"]]);
		expect(harness.session.performanceRun).toMatchObject({ attendance: "attended", concurrency: "wide", maxConcurrent: 4, agentSelection: "auto" });
		expect(readFileSync(join(harness.session.performanceRun!.governanceRoot, "GATELOG.md"), "utf8")).toContain("OPERATOR attendance=attended concurrency=wide");
	});

	it("applies an attended custom concurrency ceiling", async () => {
		const harness = await createHarness({
			performanceAttendance: "attended",
			askUserHandler: async () => ({
				cancelled: false,
				answers: [
					{ id: "performance_concurrency", value: "custom", selectedLabel: "custom" },
					{ id: "performance_agent_selection", value: "inherit", selectedLabel: "inherit" },
					{ id: "performance_custom_cap", value: "24", selectedLabel: "24" },
				],
			}),
		});
		harnesses.push(harness);
		harness.setResponses(admittedResponses());

		await harness.session.prompt("Repair the parser");

		expect(harness.session.performanceRun).toMatchObject({ attendance: "attended", concurrency: "custom", maxConcurrent: 4, agentSelection: "off" });
	});

	it("keeps Plan mode read-only and defers Performance orchestration to Build", async () => {
		let chooserCalls = 0;
		const harness = await createHarness({
			collaborationMode: "plan",
			performanceAttendance: "attended",
			askUserHandler: async () => {
				chooserCalls += 1;
				return { cancelled: true, answers: [] };
			},
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("<proposed_plan>\n# Proposed plan\n\n1. Repair parser\n</proposed_plan>")]);

		await harness.session.prompt("Repair the parser");

		expect(harness.session.performanceRun).toBeUndefined();
		expect(harness.session.workflowProposal?.markdown).toContain("Repair parser");
		expect(harness.session.getActiveToolNames()).not.toEqual(expect.arrayContaining(["spawn_agent", "performance_gate", "write", "edit"]));
		expect(chooserCalls).toBe(0);
	});

	it("starts Build Performance from the approved Plan proposal during Process", async () => {
		const harness = await createHarness({ collaborationMode: "plan" });
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("<proposed_plan>\n# Approved proposal\n\nRepair parser with regression tests.\n</proposed_plan>")]);
		await harness.session.prompt("Repair the parser");
		const proposal = harness.session.workflowProposal;
		expect(proposal).toBeDefined();

		harness.session.setCollaborationMode("build");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read_plan", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage(admissionCall(), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("update_plan", {
				plan: [{ step: "Repair parser", status: "in_progress" }],
			}), { stopReason: "toolUse" }),
			fauxAssistantMessage("Build checklist initialized."),
		]);

		await harness.session.prompt("Process approved proposal", { workflowAction: "process_proposal" });

		expect(harness.session.performanceRun?.mission).toBe(proposal?.markdown);
		expect(harness.session.workflowPlan).toMatchObject({ phase: "active", proposalRevision: proposal?.revision });
	});

	it("cancels Process before any Build run and clears its temporary execution setup", async () => {
		const harness = await createHarness({
			collaborationMode: "plan",
			performanceAttendance: "attended",
			askUserHandler: async () => ({ cancelled: true, answers: [] }),
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("<proposed_plan>\n# Approved proposal\n\nRepair parser.\n</proposed_plan>")]);
		await harness.session.prompt("Repair the parser");
		harness.session.setCollaborationMode("build");
		harness.setResponses([fauxAssistantMessage(admissionCall(), { stopReason: "toolUse" }), fauxAssistantMessage("cancelled")]);

		await expect(harness.session.prompt("Process approved proposal", { workflowAction: "process_proposal" })).rejects.toThrow("Process stopped");

		expect(harness.session.performanceRun).toBeUndefined();
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.session.workflowPlan?.phase).not.toBe("active");
	});

	it("does not treat removed /performance syntax as an orchestration entry", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("unknown command")]);

		await harness.session.prompt("/performance Repair the parser");

		expect(harness.session.performanceRun).toBeUndefined();
	});

	it("keeps Build tools configured while Plan exposes only read tools", async () => {
		const harness = await createHarness({ initialActiveToolNames: ["read", "write"], collaborationMode: "build" });
		harnesses.push(harness);

		expect(harness.session.getActiveToolNames()).toEqual(["read", "write"]);
		harness.session.setCollaborationMode("plan");
		expect(harness.session.getActiveToolNames()).toEqual(["read"]);
		expect(harness.session.getAllTools().map((tool) => tool.name)).not.toContain("write");

		harness.session.setCollaborationMode("build");
		expect(harness.session.getActiveToolNames()).toEqual(["read", "write"]);
	});

	it("includes update_plan in the default Build tool set but never in Plan", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		expect(harness.session.getActiveToolNames()).toContain("update_plan");
		harness.session.setCollaborationMode("plan");
		expect(harness.session.getActiveToolNames()).not.toContain("update_plan");
		harness.session.setCollaborationMode("build");
		expect(harness.session.getActiveToolNames()).toContain("update_plan");
	});

	it("exposes ask_user in Plan and persists its structured answer as a tool result", async () => {
		const harness = await createHarness({ collaborationMode: "plan" });
		harnesses.push(harness);
		expect(harness.session.getActiveToolNames()).toContain("ask_user");
		expect(harness.session.getAllTools().map((tool) => tool.name)).toContain("ask_user");
		harness.session.setAskUserHandler(async (request) => ({
			cancelled: false,
			answers: [{ id: request.questions[0]!.id, value: "Developers", selectedLabel: "Developers" }],
		}));
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("ask_user", { questions: [{ id: "audience", header: "Audience", question: "Who is this for?", options: [{ label: "Users", description: "End users" }, { label: "Developers", description: "Contributors", recommended: true }] }] }), { stopReason: "toolUse" }),
			fauxAssistantMessage("<proposed_plan>\n# Summary\nOptimize for developers.\n</proposed_plan>"),
		]);
		await harness.session.prompt("Optimize README");
		const result = harness.session.messages.find((message) => message.role === "toolResult" && message.toolName === "ask_user");
		expect(result?.role).toBe("toolResult");
		expect(getMessageText(result)).toContain('"selectedLabel":"Developers"');
	});

	it("handles a tool call turn and waits for the follow-up LLM response", async () => {
		const toolRuns: string[] = [];
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async (_toolCallId, params) => {
				const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
				toolRuns.push(text);
				return {
					content: [{ type: "text", text: `echo:${text}` }],
					details: { text },
				};
			},
		};
		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "hello" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("start");

		expect(toolRuns).toEqual(["hello"]);
		expect(visibleSessionMessages(harness).map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(visibleSessionMessages(harness)[2]?.role).toBe("toolResult");
		expect(visibleSessionMessages(harness)[3]?.role).toBe("assistant");
	});

	it("executes multiple tool calls from one response and continues with a single follow-up response", async () => {
		const toolRuns: string[] = [];
		const makeTool = (name: string, delayMs: number): AgentTool => ({
			name,
			label: name,
			description: `${name} tool`,
			parameters: Type.Object({ value: Type.String() }),
			execute: async (_toolCallId, params) => {
				const value =
					typeof params === "object" && params !== null && "value" in params ? String(params.value) : "";
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				toolRuns.push(`${name}:${value}`);
				return {
					content: [{ type: "text", text: `${name}:${value}` }],
					details: { value },
				};
			},
		});
		const harness = await createHarness({ tools: [makeTool("slow", 25), makeTool("fast", 0)] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("slow", { value: "a" }), fauxToolCall("fast", { value: "b" })], {
				stopReason: "toolUse",
			}),
			(context) => {
				const toolResults = context.messages.filter((message) => message.role === "toolResult");
				return fauxAssistantMessage(`tool results: ${toolResults.length}`);
			},
		]);

		await harness.session.prompt("run tools");

		expect(toolRuns.sort()).toEqual(["fast:b", "slow:a"]);
		expect(harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
		expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("assistant");
	});

	it("preserves image attachments in the provider context", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		let sawImage = false;

		harness.setResponses([
			(context) => {
				const user = [...context.messages].reverse().find((message) => message.role === "user");
				sawImage =
					user?.role === "user" &&
					typeof user.content !== "string" &&
					user.content.some((part) => part.type === "image");
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("describe", {
			images: [
				{
					type: "image",
					mimeType: "image/png",
					data: "ZmFrZQ==",
				},
			],
		});

		expect(sawImage).toBe(true);
	});

	it("expands skill commands before sending the prompt", async () => {
		const tempDir = join(tmpdir(), `metis-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);
		const skillPath = join(tempDir, "test-skill.md");
		writeFileSync(skillPath, "# Test Skill\n\nUse the skill body.");

		const resourceLoader = {
			...createTestResourceLoader(),
			getSkills: () => ({
				skills: [
					{
						name: "test",
						description: "Test skill",
						filePath: skillPath,
						disableModelInvocation: false,
						baseDir: tempDir,
						sourceInfo: createSyntheticSourceInfo(skillPath, {
							source: "local",
							scope: "project",
							origin: "top-level",
							baseDir: tempDir,
						}),
					},
				],
				diagnostics: [],
			}),
		};
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);
		let expandedPrompt = "";

		harness.setResponses([
			(context) => {
				const user = [...context.messages].reverse().find((message) => message.role === "user");
				expandedPrompt = user ? getMessageText(user) : "";
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("/skill:test explain this");

		expect(expandedPrompt).toContain('<skill name="test" location="');
		expect(expandedPrompt).toContain("Use the skill body.");
		expect(expandedPrompt).toContain("explain this");
	});

	it("requires admit for skill-expanded mutating prompts instead of skipping on the /skill prefix", async () => {
		const tempDir = join(tmpdir(), `metis-skill-admit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);
		const skillPath = join(tempDir, "write-file.md");
		writeFileSync(skillPath, "# Write File\n\nCreate the requested file in the workspace.");
		const resourceLoader = {
			...createTestResourceLoader(),
			getSkills: () => ({
				skills: [
					{
						name: "write-file",
						description: "Write a file",
						filePath: skillPath,
						disableModelInvocation: false,
						baseDir: tempDir,
						sourceInfo: createSyntheticSourceInfo(skillPath, {
							source: "local",
							scope: "project",
							origin: "top-level",
							baseDir: tempDir,
						}),
					},
				],
				diagnostics: [],
			}),
		};
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);
		const target = join(harness.tempDir, "skill-mutated.txt");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: target, content: "must not exist" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("blocked"),
		]);
		await harness.session.prompt("/skill:write-file Create a file named skill-mutated.txt");
		expect(existsSync(target)).toBe(false);
		expect(harness.session.performanceRun).toBeUndefined();
		expect(harness.session.messages.some((message) => getMessageText(message).includes("requires a successful performance_admit"))).toBe(true);
	});

	it("expands prompt templates before sending the prompt", async () => {
		const template: PromptTemplate = {
			name: "review",
			description: "Review template",
			content: "Review this code: $1",
			filePath: "/virtual/review.md",
			sourceInfo: createSyntheticSourceInfo("/virtual/review.md", {
				source: "local",
				scope: "temporary",
				origin: "top-level",
			}),
		};
		const resourceLoader = {
			...createTestResourceLoader(),
			getPrompts: () => ({ prompts: [template], diagnostics: [] }),
		};
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);
		let expandedPrompt = "";

		harness.setResponses([
			(context) => {
				const user = [...context.messages].reverse().find((message) => message.role === "user");
				expandedPrompt = user ? getMessageText(user) : "";
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("/review src/index.ts");

		expect(expandedPrompt).toBe("Review this code: src/index.ts");
	});

	it("dispatches extension commands without consuming a provider response", async () => {
		const commandRuns: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(metis) => {
					metis.registerCommand("testcmd", {
						description: "Test command",
						handler: async (args) => {
							commandRuns.push(args);
						},
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("should stay queued")]);

		await harness.session.prompt("/testcmd hello world");

		expect(commandRuns).toEqual(["hello world"]);
		expect(harness.session.messages).toEqual([]);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("sendUserMessage while idle triggers a turn", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("response")]);

		await harness.session.sendUserMessage("from extension");

		expect(visibleSessionMessages(harness).map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(getMessageText(visibleSessionMessages(harness)[0]!)).toBe("from extension");
	});

	it("does not report streamingBehavior to input handlers while idle", async () => {
		const inputEvents: InputEvent[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(metis) => {
					metis.on("input", (event) => {
						inputEvents.push(event);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("idle", { streamingBehavior: "followUp" });

		expect(inputEvents).toHaveLength(1);
		expect(inputEvents[0]?.streamingBehavior).toBeUndefined();
	});

	it("reports streamingBehavior to input handlers while streaming", async () => {
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const inputEvents: InputEvent[] = [];
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return {
					content: [{ type: "text", text: "released" }],
					details: {},
				};
			},
		};
		const harness = await createHarness({
			tools: [waitTool],
			extensionFactories: [
				(metis) => {
					metis.on("input", (event) => {
						inputEvents.push(event);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		const sawToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("start");
		await sawToolStart;
		await harness.session.prompt("queued", { streamingBehavior: "followUp" });

		expect(inputEvents.map((event) => event.streamingBehavior)).toEqual([undefined, "followUp"]);

		releaseToolExecution?.();
		await promptPromise;
	});

	it("throws when prompted during streaming without a streamingBehavior", async () => {
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return {
					content: [{ type: "text", text: "released" }],
					details: {},
				};
			},
		};
		const harness = await createHarness({ tools: [waitTool] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		const sawToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("start");
		await sawToolStart;

		await expect(harness.session.prompt("second")).rejects.toThrow(
			"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
		);

		releaseToolExecution?.();
		await promptPromise;
	});

	it("throws when prompting without a model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.agent.state.model = undefined as unknown as Model<any>;

		await expect(harness.session.prompt("hi")).rejects.toThrow("No model selected.");
	});

	it("throws when prompting without configured auth", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);

		await expect(harness.session.prompt("hi")).rejects.toThrow(
			`No API key found for ${harness.getModel().provider}.`,
		);
	});

	it("does not inject a progress nudge after explore-only tools", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "先看目录。" },
				fauxToolCall("ls", { path: "." }),
			], { stopReason: "toolUse" }),
			fauxAssistantMessage("看完了。"),
		]);
		await harness.session.prompt("看看当前工作区");
		const nudges = harness.session.agent.state.messages.filter(
			(message) => message.role === "custom" && message.customType === "workflow_context",
		);
		expect(nudges.some((message) => typeof message.content === "string" && message.content.includes("Visible progress update"))).toBe(false);
		expect(visibleSessionMessages(harness).some((message) => message.role === "custom")).toBe(false);
	});

	it("injects a required progress nudge after performance_admit", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(admissionCall(), { stopReason: "toolUse" }),
			fauxAssistantMessage("开始实现。"),
		]);
		await harness.session.prompt("Create a README");
		const nudges = harness.session.agent.state.messages.filter(
			(message) => message.role === "custom" && message.customType === "workflow_context",
		);
		expect(nudges.some((message) => typeof message.content === "string" && message.content.includes("required: admission"))).toBe(true);
	});

	it("includes the admission nudge in the next provider convertToLlm payload", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const payloads: string[] = [];
		const original = harness.session.agent.convertToLlm.bind(harness.session.agent);
		harness.session.agent.convertToLlm = (messages) => {
			const converted = original(messages);
			payloads.push(JSON.stringify(converted));
			return converted;
		};
		harness.setResponses([
			fauxAssistantMessage(admissionCall(), { stopReason: "toolUse" }),
			fauxAssistantMessage("开始实现。"),
		]);
		await harness.session.prompt("Create a README");
		expect(payloads.length).toBeGreaterThanOrEqual(2);
		expect(payloads[0]).not.toContain("Visible progress update");
		expect(payloads[1]).toContain("Visible progress update");
		expect(payloads[1]).toContain("required: admission");
		expect(payloads[1]).toContain("one-off milestone");
	});
});
