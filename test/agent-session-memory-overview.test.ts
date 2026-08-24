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

describe("AgentSession Memory Overview Injection", () => {
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

	it("injects <memory_overview> into system prompt when memory-overview.md exists", async () => {
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

		expect(session.systemPrompt).toContain("<memory_overview>\n# Memory Overview\n\n- [tech_stack]: TypeScript & Vitest\n- [user_preferences]: Prefers concise answers\n</memory_overview>");

		session.dispose();
	});

	it("omits <memory_overview> when memory-overview.md does not exist or is empty", async () => {
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

		session.dispose();
	});

	it("dynamically picks up updated memory-overview.md across prompts", async () => {
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

		expect(session.systemPrompt).toContain("<memory_overview>\n# Memory Overview v2\n- [known_failures_and_fixes]: Check null before access\n</memory_overview>");

		session.dispose();
	});
});
