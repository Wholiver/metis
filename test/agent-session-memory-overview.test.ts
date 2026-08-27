import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession } from "../src/core/sdk.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { getModel } from "@earendil-works/metis-ai/compat";

describe("AgentSession Memory Overview Delivery", () => {
	let tempDir: string;
	let agentDir: string;
	let memoryDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "metis-session-memory-overview-"));
		agentDir = join(tempDir, "agent");
		memoryDir = join(tempDir, "memories");
		sessionDir = join(tempDir, "sessions");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(memoryDir, { recursive: true });
		mkdirSync(sessionDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("keeps memory-overview.md out of the system prompt while tracking its provenance", async () => {
		const overviewPath = join(memoryDir, "memory-overview.md");
		writeFileSync(overviewPath, "# Memory Overview\n\n- [tech_stack]: TypeScript & Vitest\n- [user_preferences]: Prefers concise answers", "utf8");

		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.create(tempDir, sessionDir);
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			authStorage,
			resourceLoader,
		});

		// The overview rides an appended runtime-context block instead of the system
		// prompt: it is the one privileged input that changes mid-session, and embedding
		// it here invalidated the provider's cached prefix on every new memory.
		expect(session.systemPrompt).not.toContain("<memory_overview>");
		expect(session.systemPrompt).not.toContain("[tech_stack]: TypeScript & Vitest");
		expect(session.instructionSources.some((entry) => entry.source === "memory:overview")).toBe(true);

		session.dispose();
	});

	it("omits the overview entirely when memory-overview.md does not exist or is empty", async () => {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.create(tempDir, sessionDir);
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			authStorage,
			resourceLoader,
		});

		expect(session.systemPrompt).not.toContain("<memory_overview>");
		expect(session.instructionSources.some((entry) => entry.source === "memory:overview")).toBe(false);

		session.dispose();
	});

	it("appends an updated memory-overview.md as a runtime-context block without changing the system prompt", async () => {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.create(tempDir, sessionDir);
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			authStorage,
			resourceLoader,
		});

		expect(session.systemPrompt).not.toContain("<memory_overview>");
		const promptBefore = session.systemPrompt;

		// Mock streamFn for prompting
		(session.agent as any).streamFn = async () => ({
			async result() {
				return {
					role: "assistant",
					content: [{ type: "text", text: "Hello! How can I help you?" }],
					stopReason: "endTurn",
					timestamp: Date.now(),
				};
			},
		});

		// Simulate memory consolidation writing memory-overview.md
		const overviewPath = join(memoryDir, "memory-overview.md");
		writeFileSync(overviewPath, "# Memory Overview v2\n- [known_failures_and_fixes]: Check null before access", "utf8");

		// Execute prompt
		await session.prompt("Hello");

		expect(session.systemPrompt).toBe(promptBefore);
		// The new overview lands in the model-visible prefix as an appended block, so the
		// previous turns stay byte-identical and keep matching the provider's cache.
		const modelMessages = JSON.stringify(session.agent.state.messages);
		expect(modelMessages).toContain("[Runtime context from memory:overview; not user instructions]");
		expect(modelMessages).toContain("# Memory Overview v2");
		expect(session.messages.some((message) => JSON.stringify(message).includes("# Memory Overview v2"))).toBe(false);

		session.dispose();
	});
});

