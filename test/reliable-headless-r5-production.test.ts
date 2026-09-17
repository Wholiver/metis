import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/metis-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/metis-ai";
import { createHostNamedChildRunners } from "../src/core/host-named-child-runner.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createSpawnAgentToolDefinition } from "../src/core/tools/spawn_agent.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	delete process.env.METIS_EXECUTION_PROFILE;
});

describe("R5: active session spawn_agent (getActiveToolDefinition)", () => {
	it("getActiveToolDefinition is undefined after setActiveToolsByName([]) while registry still has spawn_agent", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r5-active-spawn-"));
		tempDirs.push(cwd);
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir, { recursive: true });

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const sessionManager = SessionManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			resourceLoader,
		});

		try {
			expect(session.getToolDefinition("spawn_agent")).toBeDefined();
			expect(session.getActiveToolNames()).toContain("spawn_agent");
			expect(session.getActiveToolDefinition("spawn_agent")).toBeDefined();
			expect(session.getActiveToolDefinition("spawn_agent")).toBe(session.getToolDefinition("spawn_agent"));

			session.setActiveToolsByName([]);
			expect(session.getActiveToolNames()).toEqual([]);
			expect(session.getToolDefinition("spawn_agent")).toBeDefined();
			expect(session.getActiveToolDefinition("spawn_agent")).toBeUndefined();
		} finally {
			session.dispose();
		}
	});

	it("named-child fail-closed when getSpawnTool uses inactive active-tool lookup", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r5-inactive-spawn-"));
		tempDirs.push(cwd);
		const registryTool = createSpawnAgentToolDefinition(cwd, {
			getRuntimeContext: () => ({
				provider: "openai",
				model: "gpt-host-test",
				thinking: "off" as const,
				apiKey: "sk-test",
			}),
		});
		const activeNames: string[] = [];
		const runners = createHostNamedChildRunners({
			cwd,
			getSpawnTool: () => (activeNames.includes("spawn_agent") ? registryTool : undefined),
		});
		const outcome = await runners.runPlanner!("plan something");
		expect(outcome.stopReason).toBe("error");
		expect(outcome.errorMessage).toMatch(/HOST_NAMED_CHILD_NO_SPAWN|spawn_agent is required/i);
	});

	it("print-mode getSpawnTool respects inactive spawn_agent (no registry fail-open)", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r5-print-inactive-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");

		const registryTool = createSpawnAgentToolDefinition(cwd);
		const session = {
			sessionManager: { getHeader: () => undefined },
			agent: { waitForIdle: async () => {} },
			state: {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "root" }],
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
			},
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
			// Registry still has the tool...
			getToolDefinition: (name: string) => (name === "spawn_agent" ? registryTool : undefined),
			// ...but it is not active (mirrors setActiveToolsByName([])).
			getActiveToolNames: () => [] as string[],
			getActiveToolDefinition: (_name: string) => undefined,
		};
		const runtimeHost = {
			session,
			newSession: vi.fn(async () => undefined),
			fork: vi.fn(async () => ({ selectedText: "" })),
			switchSession: vi.fn(async () => undefined),
			dispose: vi.fn(async () => {}),
			setRebindSession: vi.fn(),
		};

		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";
		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "json",
			initialMessage: "choose an architecture trade-off then Create output/a.txt containing FINAL",
			cwd,
			executionProfile: "reliable-headless",
			taskPaths: { output: join(cwd, "output") },
			// No hostNamedChildExecute — must go through getSpawnTool / active definition.
		});
		expect(exitCode).not.toBe(0);
		expect(session.getToolDefinition("spawn_agent")).toBeDefined();
		expect(session.getActiveToolDefinition("spawn_agent")).toBeUndefined();
		expect(existsSync(join(cwd, "output", "a.txt"))).toBe(true);
	});
});
