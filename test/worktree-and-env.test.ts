import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		spawn: (...args: any[]) => spawnMock(...args),
	};
});

import {
	DANGEROUS_ENV_VARS,
	filterChildEnvironment,
	maskSecretValue,
	sanitizeSensitiveString,
	sanitizeTraceData,
} from "../src/core/env-sanitizer.ts";
import {
	cleanupIsolatedWorkspace,
	createIsolatedWorkspace,
	isGitRepository,
} from "../src/core/worktree.ts";
import {
	createSpawnAgentToolDefinition,
	type ChildAgentResultPayload,
} from "../src/core/tools/spawn_agent.ts";
import { SpawnGuard, setGlobalSpawnGuard } from "../src/core/spawn-guard.ts";

describe("Worktree Isolation & Environment Security (Bundle 4)", () => {
	const tempDirs: string[] = [];

	beforeEach(() => {
		const guard = new SpawnGuard();
		setGlobalSpawnGuard(guard);
	});

	afterEach(async () => {
		spawnMock.mockReset();
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop()!;
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// Ignore
			}
		}
	});

	function createMockChildProcess() {
		const emitter = new EventEmitter() as any;
		emitter.stdout = new EventEmitter();
		emitter.stderr = new EventEmitter();
		emitter.unref = vi.fn();
		return emitter;
	}

	describe("Worktree & Workspace Isolation (Feat 25)", () => {
		it("detects git repositories accurately", async () => {
			const isGit = await isGitRepository(process.cwd());
			expect(typeof isGit).toBe("boolean");

			const nonGitDir = mkdtempSync(join(tmpdir(), "metis-non-git-"));
			tempDirs.push(nonGitDir);
			const isNonGit = await isGitRepository(nonGitDir);
			expect(isNonGit).toBe(false);
		});

		it("returns original cwd when no worktree is requested", async () => {
			const cwd = process.cwd();
			const ws = await createIsolatedWorkspace({ cwd });
			expect(ws.workspacePath).toBe(cwd);
			expect(ws.isGitWorktree).toBe(false);
			expect(ws.preserveOnExit).toBe(true);
			await cleanupIsolatedWorkspace(ws);
		});

		it("creates directory for explicit directory path worktree", async () => {
			const baseDir = mkdtempSync(join(tmpdir(), "metis-custom-ws-"));
			tempDirs.push(baseDir);
			const targetDir = join(baseDir, "sub-workspace");

			const ws = await createIsolatedWorkspace({
				cwd: baseDir,
				worktree: targetDir,
			});

			expect(ws.workspacePath).toBe(targetDir);
			expect(existsSync(targetDir)).toBe(true);
			expect(ws.isGitWorktree).toBe(false);
			await cleanupIsolatedWorkspace(ws);
		});

		it("creates and cleans up temporary directory workspace (mode: temp)", async () => {
			const baseDir = mkdtempSync(join(tmpdir(), "metis-temp-test-"));
			tempDirs.push(baseDir);

			const ws = await createIsolatedWorkspace({
				cwd: baseDir,
				worktree: "temp",
				agentId: "implementer-001",
			});

			expect(ws.workspacePath).toContain("metis-isolated-implementer-001");
			expect(existsSync(ws.workspacePath)).toBe(true);
			expect(ws.isGitWorktree).toBe(false);

			// Write a test file inside the isolated workspace
			const testFile = join(ws.workspacePath, "test.txt");
			await fs.writeFile(testFile, "Hello isolated workspace");
			expect(existsSync(testFile)).toBe(true);

			// Clean up
			await cleanupIsolatedWorkspace(ws);
			expect(existsSync(ws.workspacePath)).toBe(false);
		});

		it("falls back to temporary directory in non-git directories when auto is requested", async () => {
			const nonGitDir = mkdtempSync(join(tmpdir(), "metis-auto-fallback-"));
			tempDirs.push(nonGitDir);

			const ws = await createIsolatedWorkspace({
				cwd: nonGitDir,
				worktree: "auto",
				agentId: "test-agent",
			});

			expect(existsSync(ws.workspacePath)).toBe(true);
			expect(ws.isGitWorktree).toBe(false);
			await cleanupIsolatedWorkspace(ws);
			expect(existsSync(ws.workspacePath)).toBe(false);
		});

		it("seeds auto worktrees from tracked edits and untracked parent files", async () => {
			const repo = mkdtempSync(join(tmpdir(), "metis-dirty-worktree-"));
			tempDirs.push(repo);
			execFileSync("git", ["init"], { cwd: repo });
			execFileSync("git", ["config", "user.email", "metis@example.test"], { cwd: repo });
			execFileSync("git", ["config", "user.name", "Metis Test"], { cwd: repo });
			await fs.writeFile(join(repo, "README.md"), "committed\n");
			execFileSync("git", ["add", "README.md"], { cwd: repo });
			execFileSync("git", ["commit", "-m", "initial"], { cwd: repo });

			await fs.writeFile(join(repo, "README.md"), "dirty parent edit\n");
			await fs.mkdir(join(repo, "src"), { recursive: true });
			await fs.writeFile(join(repo, "src/index.ts"), "export const current = true;\n");

			const ws = await createIsolatedWorkspace({ cwd: repo, worktree: "auto", agentId: "snapshot" });
			tempDirs.push(ws.workspacePath);

			expect(await fs.readFile(join(ws.workspacePath, "README.md"), "utf8")).toBe("dirty parent edit\n");
			expect(await fs.readFile(join(ws.workspacePath, "src/index.ts"), "utf8")).toContain("current = true");
			await cleanupIsolatedWorkspace(ws);
			expect(existsSync(ws.workspacePath)).toBe(false);
		});
	});

	describe("Environment Variable Security & Blacklist (Feat 24)", () => {
		it("includes dangerous injection variables in DANGEROUS_ENV_VARS list", () => {
			expect(DANGEROUS_ENV_VARS).toContain("LD_PRELOAD");
			expect(DANGEROUS_ENV_VARS).toContain("LD_LIBRARY_PATH");
			expect(DANGEROUS_ENV_VARS).toContain("DYLD_INSERT_LIBRARIES");
			expect(DANGEROUS_ENV_VARS).toContain("DYLD_LIBRARY_PATH");
			expect(DANGEROUS_ENV_VARS).toContain("SUDO_COMMAND");
		});

		it("filters out dangerous environment variables from parent env", () => {
			const parentEnv: NodeJS.ProcessEnv = {
				PATH: "/usr/bin:/bin",
				HOME: "/home/user",
				NODE_ENV: "production",
				OPENAI_API_KEY: "sk-test-key-123456",
				LD_PRELOAD: "/malicious/lib.so",
				DYLD_INSERT_LIBRARIES: "/malicious/dylib.dylib",
				SUDO_COMMAND: "/bin/bash",
			};

			const filtered = filterChildEnvironment(parentEnv);

			expect(filtered.PATH).toBe("/usr/bin:/bin");
			expect(filtered.HOME).toBe("/home/user");
			expect(filtered.NODE_ENV).toBe("production");
			expect(filtered.OPENAI_API_KEY).toBe("sk-test-key-123456");

			// Dangerous variables must be filtered out
			expect(filtered.LD_PRELOAD).toBeUndefined();
			expect(filtered.DYLD_INSERT_LIBRARIES).toBeUndefined();
			expect(filtered.SUDO_COMMAND).toBeUndefined();
		});

		it("merges explicit overrides and Metis runtime variables", () => {
			const parentEnv = { PATH: "/bin" };
			const explicit = {
				METIS_AGENT_ID: "agent-123",
				METIS_AGENT_DEPTH: "2",
				CUSTOM_AGENT_VAR: "custom_val",
			};

			const filtered = filterChildEnvironment(parentEnv, explicit);
			expect(filtered.PATH).toBe("/bin");
			expect(filtered.METIS_AGENT_ID).toBe("agent-123");
			expect(filtered.METIS_AGENT_DEPTH).toBe("2");
			expect(filtered.CUSTOM_AGENT_VAR).toBe("custom_val");
		});
	});

	describe("Credential Redaction & Trace Desensitization (Feat 59)", () => {
		it("masks secret values correctly", () => {
			expect(maskSecretValue("sk-1234567890abcdef123456")).toBe("sk-****[REDACTED]");
			expect(maskSecretValue("secret_password_123")).toBe("se****[REDACTED]");
			expect(maskSecretValue("abc")).toBe("[REDACTED]");
		});

		it("sanitizes sensitive strings with API key and token signatures", () => {
			const text = "Connecting with sk-proj-1234567890abcdef and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
			const sanitized = sanitizeSensitiveString(text);

			expect(sanitized).not.toContain("sk-proj-1234567890abcdef");
			expect(sanitized).toContain("sk-****[REDACTED]");
			expect(sanitized).toContain("Bearer [REDACTED]");
		});

		it("deeply sanitizes JSON / Trace data structures", () => {
			const traceEvent = {
				event: "model_call",
				agentId: "implementer-1",
				depth: 1,
				apiKey: "sk-openai-top-secret-key-12345678",
				config: {
					auth: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
					token: "ghp_123456789012345678901234567890",
					model: "gpt-4o",
					temperature: 0.7,
				},
				headers: [
					{ name: "Authorization", value: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" },
				],
			};

			const sanitized = sanitizeTraceData(traceEvent);

			expect(sanitized.apiKey).toBe("sk-****[REDACTED]");
			expect(sanitized.config.auth).toBe("Bearer [REDACTED]");
			expect(sanitized.config.token).toBe("[REDACTED]");
			expect(sanitized.config.model).toBe("gpt-4o");
			expect(sanitized.config.temperature).toBe(0.7);
			expect(sanitized.headers[0].value).toBe("Bearer [REDACTED]");
		});
	});

	describe("Integration with spawn_agent tool", () => {
		it("spawns child in isolated workspace and retains successful output", async () => {
			const mockChild = createMockChildProcess();
			spawnMock.mockReturnValue(mockChild);

			const baseDir = mkdtempSync(join(tmpdir(), "metis-spawn-wt-"));
			tempDirs.push(baseDir);

			const definition = createSpawnAgentToolDefinition(baseDir, {
				runtimeContext: {
					currentDepth: 0,
					currentAgentId: "root",
					rootRunId: "run-wt-001",
					apiKey: "sk-my-secret-key-12345678",
				},
			});

			const executePromise = definition.execute(
				"call-wt-1",
				{
					agent: "implementer",
					task: "Refactor database queries",
					worktree: "temp",
				},
				new AbortController().signal,
				() => {},
				undefined as never,
			);

			await new Promise((r) => setTimeout(r, 30));

			expect(spawnMock).toHaveBeenCalledTimes(1);
			const spawnOptions = spawnMock.mock.calls[0][2];
			expect(spawnOptions.cwd).toContain("metis-isolated-implementer-");
			const isolatedPath = spawnOptions.cwd;

			// Verify environment filtering passed to child process
			const passedEnv = spawnOptions.env;
			expect(passedEnv.METIS_AGENT_ID).toBeDefined();
			expect(passedEnv.METIS_ROOT_RUN_ID).toBe("run-wt-001");
			expect(passedEnv.LD_PRELOAD).toBeUndefined();

			// Simulate a child edit and successful completion.
			await fs.writeFile(join(isolatedPath, "child-change.txt"), "retained output\n");
			mockChild.stdout.emit("data", Buffer.from("Refactored queries cleanly."));
			mockChild.emit("close", 0);

			const result = await executePromise;
			const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

			expect(payload.status).toBe("success");
			expect(payload.agent).toBe("implementer");
			expect(payload.worktree).toBe(isolatedPath);
			expect(payload.worktreeRetained).toBe(true);

			// Successful isolated output must remain available to the parent.
			await new Promise((r) => setTimeout(r, 30));
			expect(existsSync(isolatedPath)).toBe(true);
			expect(await fs.readFile(join(isolatedPath, "child-change.txt"), "utf8")).toBe("retained output\n");
			rmSync(isolatedPath, { recursive: true, force: true });
		});
	});
});

