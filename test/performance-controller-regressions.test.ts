import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	detectOutputPollution,
	findOverlappingOwnedPaths,
	normalizeFailureFingerprint,
	type ExecutionFailureCode,
} from "../src/core/execution-types.ts";
import {
	createTaskExecutionController,
	mapExecutionStatusToExitCode,
} from "../src/core/task-execution-controller.ts";
import { createSpawnAgentToolDefinition, type ChildAgentResultPayload } from "../src/core/tools/spawn_agent.ts";
import { setGlobalSpawnGuard, SpawnGuard } from "../src/core/spawn-guard.ts";
import { parseArgs } from "../src/cli/args.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import type { AssistantMessage } from "@earendil-works/metis-ai";
import { SharedMutatingOwnerRegistry, resolveChildWorktree } from "../src/core/workspace-probe.ts";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		spawn: (...args: any[]) => spawnMock(...args),
	};
});

const FIXTURE_DIR = join(import.meta.dirname, "fixtures/performance-controller");

function loadFixture<T>(name: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

describe("performance-controller regression fixtures (Issue 0)", () => {
	const tempDirs: string[] = [];

	beforeEach(() => {
		setGlobalSpawnGuard(new SpawnGuard());
	});

	afterEach(() => {
		spawnMock.mockReset();
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("manifest lists the seven stable failure codes", () => {
		const manifest = loadFixture<{ codes: ExecutionFailureCode[] }>("manifest.json");
		expect(manifest.codes).toEqual([
			"CHILD_RESULT_INVALID",
			"FALSE_COMPLETION_AFTER_VERIFIER_FAIL",
			"REQUIRED_ARTIFACT_MISSING",
			"OUTPUT_POLLUTION",
			"NUMERIC_TOLERANCE_FAILED",
			"CHILD_WORKSPACE_DRIFT",
			"NO_PROGRESS_FINGERPRINT",
		]);
		const files = readdirSync(FIXTURE_DIR).filter((f) => /^0[1-7]-/.test(f) && f.endsWith(".json"));
		expect(files.length).toBe(7);
	});

	it("01: exit-0 without ChildResult is CHILD_RESULT_INVALID under reliable-headless", async () => {
		const fixture = loadFixture<{
			failureCode: string;
			spawn: { agent: string; gate: string; laneId: string };
			expectedOutcome: string;
			expectedStatus: string;
			expectedErrorCode: string;
		}>("01-child-no-verdict.json");
		expect(fixture.failureCode).toBe("CHILD_RESULT_INVALID");

		const mockChild = createMockChildProcess();
		spawnMock.mockReturnValue(mockChild);
		const tempDir = mkdtempSync(join(tmpdir(), "metis-pc-no-verdict-"));
		tempDirs.push(tempDir);
		const definition = createSpawnAgentToolDefinition(tempDir);
		const execution = definition.execute(
			"pc-g6",
			{ agent: fixture.spawn.agent, task: "Verify", laneId: fixture.spawn.laneId, gate: fixture.spawn.gate as "G6" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);
		await vi.waitFor(() => expect(mockChild.stdout.listenerCount("data")).toBeGreaterThan(0));
		mockChild.emit("close", 0);
		const result = await execution;
		const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;
		expect(payload.status).toBe(fixture.expectedStatus);
		expect(payload.outcome).toBe(fixture.expectedOutcome);
		expect(payload.errorCode).toBe(fixture.expectedErrorCode);
	});

	it("02: reliable-headless ignores legacy active performance and host-verifies instead", async () => {
		const fixture = loadFixture<{
			failureCode: ExecutionFailureCode;
			performance: { status: "active"; frontier: string };
			assistant: { text: string };
			reliableHeadlessStatus: string;
		}>("02-false-completion.json");

		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: fixture.assistant.text, stopReason: "stop" }),
			getPerformanceSnapshot: () => fixture.performance,
		});
		const cwd = mkdtempSync(join(tmpdir(), "metis-pc-false-"));
		tempDirs.push(cwd);
		const result = await controller.execute({
			instruction: "finish",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 60_000,
		});
		// Host oracle owns completion: empty workspace without semantic evidence fails closed,
		// but NOT because legacy performance status is still active.
		expect(result.status).toBe("task_failed");
		expect(result.failure?.code).not.toBe("FALSE_COMPLETION_AFTER_VERIFIER_FAIL");
		expect(result.failure?.code).toBe("INSUFFICIENT_EVIDENCE");
		expect(mapExecutionStatusToExitCode(result.status)).toBe(1);
	});

	it("02b: print mode with executionResult overrides exit for reliable-headless", async () => {
		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			messages: ["hi"],
			executionProfile: "reliable-headless",
			executionResult: {
				status: "task_failed",
				contract: {
					kind: "mixed",
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
					passed: false,
					reasons: [{ code: "FALSE_COMPLETION_AFTER_VERIFIER_FAIL", message: "still active" }],
					requiredArtifactsPresent: true,
					forbiddenArtifactsAbsent: true,
					checksPassed: false,
					unresolvedFindings: 1,
				},
				finalText: "claimed success",
			},
		});
		expect(exitCode).toBe(1);
	});

	it("01b: reliable-headless converts exit-0 without ChildResult into CHILD_RESULT_INVALID", async () => {
		const previous = process.env.METIS_EXECUTION_PROFILE;
		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";
		try {
			const mockChild = createMockChildProcess();
			spawnMock.mockReturnValue(mockChild);
			const tempDir = mkdtempSync(join(tmpdir(), "metis-pc-invalid-"));
			tempDirs.push(tempDir);
			const definition = createSpawnAgentToolDefinition(tempDir);
			const execution = definition.execute(
				"pc-invalid",
				{ agent: "verifier", task: "Verify", laneId: "lane-a", gate: "G6" },
				new AbortController().signal,
				() => {},
				undefined as never,
			);
			await vi.waitFor(() => expect(mockChild.stdout.listenerCount("data")).toBeGreaterThan(0));
			mockChild.emit("close", 0);
			const result = await execution;
			const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;
			expect(payload.status).toBe("error");
			expect(payload.outcome).toBe("invalid");
			expect(payload.errorCode).toBe("CHILD_RESULT_INVALID");
			expect(payload.outcome).not.toBe("no_verdict");
		} finally {
			if (previous === undefined) delete process.env.METIS_EXECUTION_PROFILE;
			else process.env.METIS_EXECUTION_PROFILE = previous;
		}
	});

	it("fail-closed: empty workspace without oracle cannot PASS via controller.execute", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-pc-failclosed-"));
		tempDirs.push(cwd);
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "I am done", stopReason: "stop" }),
		});
		const result = await controller.execute({
			instruction: "finish the task",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 1000,
		});
		expect(result.status).toBe("task_failed");
		expect(result.completion.passed).toBe(false);
	});

	it("03: missing required artifact maps to REQUIRED_ARTIFACT_MISSING", () => {
		const fixture = loadFixture<{
			failureCode: ExecutionFailureCode;
			contract: { requiredArtifacts: Array<{ path: string }> };
			presentArtifacts: string[];
		}>("03-missing-artifact.json");
		const missing = fixture.contract.requiredArtifacts
			.map((a) => a.path)
			.filter((path) => !fixture.presentArtifacts.includes(path));
		expect(missing.length).toBeGreaterThan(0);
		expect(fixture.failureCode).toBe("REQUIRED_ARTIFACT_MISSING");
	});

	it("04: output pollution detector flags .venv and caches", () => {
		const fixture = loadFixture<{ failureCode: ExecutionFailureCode; outputEntries: string[]; polluters: string[] }>(
			"04-output-pollution.json",
		);
		expect(detectOutputPollution(fixture.outputEntries)).toEqual(fixture.polluters);
		expect(fixture.failureCode).toBe("OUTPUT_POLLUTION");
	});

	it("05: numeric tolerance failure has stable fingerprint code", () => {
		const fixture = loadFixture<{
			failureCode: ExecutionFailureCode;
			expected: { accuracy: number };
			actual: { accuracy: number };
			tolerance: number;
			checkId: string;
		}>("05-numeric-tolerance.json");
		const delta = Math.abs(fixture.actual.accuracy - fixture.expected.accuracy);
		expect(delta).toBeGreaterThan(fixture.tolerance);
		const fingerprint = normalizeFailureFingerprint({
			checkId: fixture.checkId,
			exitCode: 1,
			errorSummary: `delta=${delta}`,
		});
		expect(fingerprint.startsWith(`${fixture.checkId}|1|`)).toBe(true);
		expect(fixture.failureCode).toBe("NUMERIC_TOLERANCE_FAILED");
	});

	it("06: isolated snapshot omits gitignored venv (workspace drift)", () => {
		const fixture = loadFixture<{
			failureCode: ExecutionFailureCode;
			parentEntries: string[];
			isolatedVisibleEntries: string[];
			missingInChild: string[];
			reliableHeadlessWorkspacePolicy: string;
		}>("06-workspace-drift.json");
		const missing = fixture.parentEntries.filter((e) => !fixture.isolatedVisibleEntries.includes(e));
		expect(missing).toEqual(fixture.missingInChild);
		expect(fixture.reliableHeadlessWorkspacePolicy).toBe("shared");
		expect(fixture.failureCode).toBe("CHILD_WORKSPACE_DRIFT");
	});

	it("07: identical fingerprints force no-progress stop", () => {
		const fixture = loadFixture<{
			failureCode: ExecutionFailureCode;
			fingerprints: Array<{ checkId: string; exitCode: number; errorSummary: string; artifactHash: string }>;
			shouldStop: boolean;
		}>("07-no-progress.json");
		const normalized = fixture.fingerprints.map((f) => normalizeFailureFingerprint(f));
		expect(normalized[0]).toBe(normalized[1]);
		expect(fixture.shouldStop).toBe(true);
		expect(fixture.failureCode).toBe("NO_PROGRESS_FINGERPRINT");
	});

	it("rejects overlapping owned paths under shared cwd", () => {
		const overlap = findOverlappingOwnedPaths([
			{ ownerId: "impl-a", ownedPaths: ["output"] },
			{ ownerId: "impl-b", ownedPaths: ["output/result.csv"] },
		]);
		expect(overlap?.map((c) => c.ownerId)).toEqual(["impl-a", "impl-b"]);
	});

	it("parses --execution-profile", () => {
		const parsed = parseArgs(["--execution-profile", "reliable-headless", "-p", "task"]);
		expect(parsed.executionProfile).toBe("reliable-headless");
		expect(parsed.diagnostics).toEqual([]);
	});

	it("reliable-headless strips worktree for shared policy", () => {
		const previous = process.env.METIS_EXECUTION_PROFILE;
		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";
		delete process.env.METIS_WORKSPACE_POLICY;
		try {
			expect(resolveChildWorktree({ role: "implementer", requestedWorktree: "auto" })).toBeUndefined();
			expect(resolveChildWorktree({ role: "verifier", requestedWorktree: "temp" })).toBeUndefined();
		} finally {
			if (previous === undefined) delete process.env.METIS_EXECUTION_PROFILE;
			else process.env.METIS_EXECUTION_PROFILE = previous;
		}
	});

	it("shared mutating owner registry serializes broad claims", () => {
		const registry = new SharedMutatingOwnerRegistry();
		expect(registry.claim("a", ["."])).toBeUndefined();
		expect(registry.claim("b", ["."])).toMatch(/OVERLAPPING_OWNED_PATHS/);
		registry.release("a");
		expect(registry.claim("b", ["output"])).toBeUndefined();
	});
});

function createMockChildProcess() {
	const emitter = new EventEmitter() as any;
	emitter.stdout = new EventEmitter();
	emitter.stderr = new EventEmitter();
	emitter.unref = vi.fn();
	emitter.kill = vi.fn(() => {
		queueMicrotask(() => emitter.emit("exit", null, "SIGKILL"));
		return true;
	});
	return emitter;
}

function createAssistantMessage(options?: {
	text?: string;
	stopReason?: AssistantMessage["stopReason"];
	errorMessage?: string;
}): AssistantMessage {
	return {
		role: "assistant",
		content: options?.text ? [{ type: "text", text: options.text }] : [],
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
		stopReason: options?.stopReason ?? "stop",
		errorMessage: options?.errorMessage,
		timestamp: Date.now(),
	};
}

function createRuntimeHost(assistantMessage: AssistantMessage) {
	const extensionRunner = {
		hasHandlers: (eventType: string) => eventType === "session_shutdown",
		emit: vi.fn(async () => {}),
	};
	const state = { messages: [assistantMessage] };
	const session = {
		sessionManager: { getHeader: () => undefined },
		agent: { waitForIdle: async () => {} },
		state,
		extensionRunner,
		bindExtensions: vi.fn(async () => {}),
		subscribe: vi.fn(() => () => {}),
		prompt: vi.fn(async () => {}),
		reload: vi.fn(async () => {}),
		model: undefined,
		thinkingLevel: "off",
		collaborationMode: "build",
		contextWindowId: undefined,
		workflowPlan: undefined,
		instructionSources: undefined,
		instructionDiagnostics: undefined,
		memoryState: undefined,
		performanceRun: undefined,
		navigateTree: vi.fn(async () => ({ cancelled: false })),
	};
	return {
		session,
		newSession: vi.fn(async () => undefined),
		fork: vi.fn(async () => ({ selectedText: "" })),
		switchSession: vi.fn(async () => undefined),
		dispose: vi.fn(async () => {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		}),
		setRebindSession: vi.fn(),
	};
}
