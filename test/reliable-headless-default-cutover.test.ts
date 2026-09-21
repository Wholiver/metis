import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/metis-ai";
import {
	DEFAULT_EXECUTION_PROFILE,
	ensureReliableExecutionEnv,
	isExecutionProfile,
} from "../src/core/execution-types.ts";
import { resolveExecutionProfile } from "../src/core/task-execution-controller.ts";
import { resolveReliableTurnPolicy, runReliableTurn } from "../src/core/reliable-headless-runners.ts";
import { parseArgs } from "../src/cli/args.ts";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("reliable-headless is the sole product profile", () => {
	it("forces env and remaps legacy argv to reliable-headless", () => {
		delete process.env.METIS_EXECUTION_PROFILE;
		expect(resolveExecutionProfile(undefined)).toBe("reliable-headless");
		expect(process.env.METIS_EXECUTION_PROFILE).toBe("reliable-headless");
		expect(isExecutionProfile("legacy")).toBe(false);
		expect(isExecutionProfile("reliable-headless")).toBe(true);
		expect(DEFAULT_EXECUTION_PROFILE).toBe("reliable-headless");

		const parsed = parseArgs(["--execution-profile", "legacy"]);
		expect(parsed.executionProfile).toBe("reliable-headless");
		expect(parsed.diagnostics.some((d) => d.type === "warning" && /legacy/.test(d.message))).toBe(true);
		ensureReliableExecutionEnv();
		expect(process.env.METIS_EXECUTION_PROFILE).toBe("reliable-headless");
	});

	it("chat-aware policy conversational-passes without oracle; original root loop for instruction-owned oracles", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-reliable-default-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");
		// Ambient public checks must not alone force chat into the Controller.
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({ name: "ambient", scripts: { test: "echo ambient-test" } }, null, 2),
		);

		const prompts: string[] = [];
		const session = {
			prompt: vi.fn(async (text: string) => {
				prompts.push(text);
			}),
			getActiveToolDefinition: () => undefined,
			performanceRun: undefined,
		};

		const chat = await runReliableTurn({
			session,
			instruction: "你好，随便聊聊天气",
			cwd,
			policy: "chat-aware",
			rootPromptText: "你好，随便聊聊天气",
			collectAssistantOutcome: () => ({
				finalText: "今天不错",
				stopReason: "stop",
			}),
		});
		expect(chat.status).toBe("completed");
		expect(prompts).toContain("你好，随便聊聊天气");
		expect(chat.attempts.every((a) => a.role === "root")).toBe(true);

		prompts.length = 0;
		const task = await runReliableTurn({
			session,
			instruction: "Create output/a.txt containing FINAL",
			cwd,
			taskPaths: { output: join(cwd, "output") },
			policy: "chat-aware",
			rootPromptText: "Create output/a.txt containing FINAL",
			collectAssistantOutcome: () => ({
				finalText: "done",
				stopReason: "stop",
			}),
		});
		expect(task.status).toBe("completed");
		expect(prompts).toEqual(["Create output/a.txt containing FINAL"]);
		expect(task.attempts.every((a) => a.role === "root")).toBe(true);
		expect(task.failure).toBeUndefined();
	});

	it("chat-aware fail-closes when instruction-owned oracle evidence is missing", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-reliable-oracle-miss-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		const session = {
			prompt: vi.fn(async () => {}),
			getActiveToolDefinition: () => undefined,
			performanceRun: undefined,
		};
		const result = await runReliableTurn({
			session,
			instruction: "Create output/a.txt containing FINAL",
			cwd,
			taskPaths: { output: join(cwd, "output") },
			policy: "chat-aware",
			rootPromptText: "Create output/a.txt containing FINAL",
			collectAssistantOutcome: () => ({
				finalText: "I'll write that next.",
				stopReason: "stop",
			}),
		});
		expect(result.status).toBe("task_failed");
		expect(result.failure).toBeDefined();
		expect(session.prompt).toHaveBeenCalledWith("Create output/a.txt containing FINAL");
		expect(result.attempts.some((a) => a.role === "root")).toBe(true);
	});

	it("chat-aware prompts follow-ups once without duplicating the joined instruction", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-reliable-followup-"));
		tempDirs.push(cwd);
		const session = {
			prompt: vi.fn(async () => {}),
			getActiveToolDefinition: () => undefined,
			performanceRun: undefined,
		};
		const result = await runReliableTurn({
			session,
			instruction: "hello",
			cwd,
			policy: "chat-aware",
			followUpMessages: ["hello"],
			collectAssistantOutcome: () => ({
				finalText: "hi",
				stopReason: "stop",
			}),
		});
		expect(result.status).toBe("completed");
		expect(session.prompt).toHaveBeenCalledTimes(1);
		expect(session.prompt).toHaveBeenCalledWith("hello");
	});

	it("Plan mode never enters Controller even when instruction looks like an artifact oracle", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-reliable-plan-"));
		tempDirs.push(cwd);
		const prompts: string[] = [];
		const session = {
			prompt: vi.fn(async (text: string) => {
				prompts.push(text);
			}),
			getActiveToolDefinition: () => undefined,
			performanceRun: undefined,
			collaborationMode: "plan",
		};
		const result = await runReliableTurn({
			session,
			instruction: "Plan how we should Create output/a.txt containing FINAL",
			cwd,
			policy: "strict",
			collaborationMode: "plan",
			rootPromptText: "Plan how we should Create output/a.txt containing FINAL",
			collectAssistantOutcome: () => ({
				finalText: "<proposed_plan>write the file later</proposed_plan>",
				stopReason: "stop",
			}),
		});
		expect(result.status).toBe("completed");
		expect(prompts).toEqual(["Plan how we should Create output/a.txt containing FINAL"]);
		expect(result.attempts.every((a) => a.role === "root")).toBe(true);
	});

	it("strict policy still uses named-child short-loop and fail-closes without spawn_agent", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-reliable-strict-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");
		const prompts: string[] = [];
		const session = {
			prompt: vi.fn(async (text: string) => {
				prompts.push(text);
			}),
			getActiveToolDefinition: () => undefined,
			performanceRun: undefined,
		};
		const task = await runReliableTurn({
			session,
			instruction: "Create output/a.txt containing FINAL",
			cwd,
			taskPaths: { output: join(cwd, "output") },
			policy: "strict",
			rootPromptText: "Create output/a.txt containing FINAL",
			collectAssistantOutcome: () => ({
				finalText: "done",
				stopReason: "stop",
			}),
		});
		expect(task.status).toBe("task_failed");
		expect(task.failure?.message).toMatch(/HOST_NAMED_CHILD_NO_SPAWN|spawn_agent/i);
		expect(prompts).toEqual([]);
	});

	it("resolveReliableTurnPolicy keeps original print/chat default and opts adapters into strict", () => {
		expect(resolveReliableTurnPolicy({ env: {} })).toBe("chat-aware");
		expect(resolveReliableTurnPolicy({ taskPaths: { output: "/tmp/out" }, env: {} })).toBe("strict");
		expect(resolveReliableTurnPolicy({ requested: "strict", env: {} })).toBe("strict");
	});
});

describe("print-mode always uses reliable path (no legacy branch)", () => {
	it("runPrintMode resolves profile to reliable-headless without env preset", async () => {
		delete process.env.METIS_EXECUTION_PROFILE;
		const { runPrintMode } = await import("../src/modes/print-mode.ts");
		const cwd = mkdtempSync(join(tmpdir(), "metis-print-default-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");

		const state = {
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
					api: "openai-responses",
					provider: "openai",
					model: "gpt-4o-mini",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				} satisfies AssistantMessage,
			],
		};
		const session = {
			sessionManager: { getHeader: () => undefined },
			agent: { waitForIdle: async () => {} },
			state,
			model: { provider: "openai", id: "gpt-4o-mini", baseUrl: undefined },
			thinkingLevel: "off",
			collaborationMode: "build",
			contextWindowId: undefined,
			workflowPlan: undefined,
			instructionSources: undefined,
			instructionDiagnostics: undefined,
			memoryState: undefined,
			performanceRun: undefined,
			extensionRunner: { hasHandlers: () => false, emit: vi.fn(async () => {}) },
			bindExtensions: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
			prompt: vi.fn(async () => {}),
			reload: vi.fn(async () => {}),
			getActiveToolDefinition: () => undefined,
			getToolDefinition: () => undefined,
		};
		const runtimeHost = {
			session,
			newSession: vi.fn(async () => undefined),
			fork: vi.fn(async () => ({ selectedText: "" })),
			switchSession: vi.fn(async () => undefined),
			dispose: vi.fn(async () => {}),
			setRebindSession: vi.fn(),
		};

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "json",
			initialMessage: "Create output/a.txt containing FINAL",
			cwd,
			taskPaths: { output: join(cwd, "output") },
			executionResult: {
				status: "completed",
				contract: {
					kind: "artifact",
					requiredArtifacts: [],
					forbiddenArtifacts: [],
					constraints: [],
					checks: [],
					environment: { requiredPaths: [], requiredCommands: [] },
					unresolved: [],
					compiled: true,
					contractHash: "x",
					evidenceLevel: "structural",
				},
				attempts: [],
				completion: {
					passed: true,
					reasons: [],
					requiredArtifactsPresent: true,
					forbiddenArtifactsAbsent: true,
					checksPassed: true,
					unresolvedFindings: 0,
				},
				finalText: "ok",
			},
		});
		expect(exitCode).toBe(0);
		expect(process.env.METIS_EXECUTION_PROFILE).toBe("reliable-headless");
	});
});
