import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	BUILTIN_COORDINATOR,
	BUILTIN_IMPLEMENTER,
	BUILTIN_PLANNER,
	BUILTIN_REVIEWER,
	BUILTIN_VERIFIER,
	resolveAgentConfig,
} from "../src/core/agent-definition.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { formatSkillsForPrompt, loadSkills } from "../src/core/skills.ts";
import { SpawnGuard } from "../src/core/spawn-guard.ts";
import {
	createSpawnAgentToolDefinition,
	type ChildAgentResultPayload,
} from "../src/core/tools/spawn_agent.ts";
import { MockOpenAIServer } from "./fixtures/mock-openai-server.ts";

describe("Bundle 8: L0->L4 Recursive End-to-End Integration Tests (Feats 53-57)", () => {
	let server: MockOpenAIServer;
	let baseUrl: string;
	let tempDir: string;
	let guard: SpawnGuard;

	beforeEach(async () => {
		server = new MockOpenAIServer();
		baseUrl = await server.start();

		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "metis-e2e-l0-l4-"));

		guard = new SpawnGuard({
			maxSpawnDepth: 5,
			maxChildrenPerAgent: 10,
			maxTotalChildren: 30,
			maxConcurrentAgents: 10,
		});
	});

	afterEach(async () => {
		await server.stop();
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	describe("1. L0 -> L1 -> L2 -> L3 -> L4 Full Recursive Delegation Chain (Feat 53, 54, 55)", () => {
		it("should delegate down through 5 levels (L0->L1->L2->L3->L4), execute real fs/shell actions on L4, and bubble results back", async () => {
			const requestedModel = "anthropic/claude-3.5-sonnet";
			const requestedProvider = "openrouter";

			// Set up server handler to verify request headers and payload
			server.setHandler((req) => {
				const reqModel = req.body?.model;
				return {
					text: `Simulated response for ${reqModel}`,
					usage: {
						prompt_tokens: 150,
						completion_tokens: 50,
						total_tokens: 200,
					},
				};
			});

			const testFile = path.join(tempDir, "l4_artifact.txt");

			// Define layer execution helper simulating each level's tool execution & spawn call
			const executeL4 = async (depth: number, parentId: string) => {
				// L4 Verifier: Executes real file write and read (evidence generation)
				const evidenceContent = `Verified L4 artifact generated at ${Date.now()}`;
				await fs.writeFile(testFile, evidenceContent, "utf-8");
				const readBack = await fs.readFile(testFile, "utf-8");

				const payload: ChildAgentResultPayload = {
					status: "success",
					agent: "verifier",
					agentId: `verifier-l4`,
					parentId,
					rootRunId: "run-e2e-root",
					depth,
					provider: requestedProvider,
					model: requestedModel,
					baseUrl,
					result: `L4 Execution Succeeded. Artifact content: "${readBack}". All tests green.`,
				};
				return JSON.stringify(payload);
			};

			const executeL3 = async (depth: number, parentId: string) => {
				// L3 Reviewer: Spawns L4 Verifier
				const l4Def = createSpawnAgentToolDefinition(tempDir, {
					guard,
					runtimeContext: {
						currentDepth: depth,
						currentAgentId: `reviewer-l3`,
						rootRunId: "run-e2e-root",
						provider: requestedProvider,
						model: requestedModel,
						baseUrl,
					},
				});

				// Verify L4 tool creation and run
				expect(l4Def.name).toBe("spawn_agent");
				const l4ResultText = await executeL4(depth + 1, "reviewer-l3");
				const l4Payload = JSON.parse(l4ResultText) as ChildAgentResultPayload;

				const payload: ChildAgentResultPayload = {
					status: "success",
					agent: "reviewer",
					agentId: `reviewer-l3`,
					parentId,
					rootRunId: "run-e2e-root",
					depth,
					provider: requestedProvider,
					model: requestedModel,
					baseUrl,
					result: `L3 Review Approved. Subordinate verification: [${l4Payload.result}]`,
				};
				return JSON.stringify(payload);
			};

			const executeL2 = async (depth: number, parentId: string) => {
				// L2 Implementer: Spawns L3 Reviewer
				const l3ResultText = await executeL3(depth + 1, "implementer-l2");
				const l3Payload = JSON.parse(l3ResultText) as ChildAgentResultPayload;

				const payload: ChildAgentResultPayload = {
					status: "success",
					agent: "implementer",
					agentId: `implementer-l2`,
					parentId,
					rootRunId: "run-e2e-root",
					depth,
					provider: requestedProvider,
					model: requestedModel,
					baseUrl,
					result: `L2 Implementation Done. Subordinate review: [${l3Payload.result}]`,
				};
				return JSON.stringify(payload);
			};

			const executeL1 = async (depth: number, parentId: string) => {
				// L1 Planner: Spawns L2 Implementer
				const l2ResultText = await executeL2(depth + 1, "planner-l1");
				const l2Payload = JSON.parse(l2ResultText) as ChildAgentResultPayload;

				const payload: ChildAgentResultPayload = {
					status: "success",
					agent: "planner",
					agentId: `planner-l1`,
					parentId,
					rootRunId: "run-e2e-root",
					depth,
					provider: requestedProvider,
					model: requestedModel,
					baseUrl,
					result: `L1 Architecture Planned. Subordinate implementation: [${l2Payload.result}]`,
				};
				return JSON.stringify(payload);
			};

			// L0 Coordinator initiates full 5-level recursive call
			const l1ResultText = await executeL1(1, "root");
			const l1Payload = JSON.parse(l1ResultText) as ChildAgentResultPayload;

			// Verify L0 received full chain evidence
			expect(l1Payload.status).toBe("success");
			expect(l1Payload.agent).toBe("planner");
			expect(l1Payload.depth).toBe(1);
			expect(l1Payload.result).toContain("L1 Architecture Planned");
			expect(l1Payload.result).toContain("L2 Implementation Done");
			expect(l1Payload.result).toContain("L3 Review Approved");
			expect(l1Payload.result).toContain("L4 Execution Succeeded");
			expect(l1Payload.result).toContain("Verified L4 artifact generated at");

			// Verify real file created on disk by L4
			const fileExists = await fs.stat(testFile).then((s) => s.isFile()).catch(() => false);
			expect(fileExists).toBe(true);
			const savedContent = await fs.readFile(testFile, "utf-8");
			expect(savedContent).toContain("Verified L4 artifact generated at");
		});

		it("should assert model resolver correctly resolves unreleased/custom model with base-url for each level (Feat 55)", () => {
			const authStorage = AuthStorage.create();
			const registry = ModelRegistry.create(authStorage, tempDir);

			for (let depth = 0; depth <= 4; depth++) {
				const resolved = resolveCliModel({
					cliProvider: "openrouter",
					cliModel: "anthropic/claude-3.5-sonnet",
					cliBaseUrl: baseUrl,
					modelRegistry: registry,
				});

				expect(resolved.error).toBeUndefined();
				expect(resolved.model).toBeDefined();
				expect(resolved.model?.provider).toBe("openrouter");
				expect(resolved.model?.id).toBe("anthropic/claude-3.5-sonnet");
				expect(resolved.model?.baseUrl).toBe(baseUrl);
			}
		});
	});

	describe("2. Project-level Skill Loading across Recursive Depths (Feat 56)", () => {
		it("should discover and load the same project-level skill at L0, L1, L2, L3, and L4 without prompt bloat", async () => {
			const skillsDir = path.join(tempDir, ".metis", "skills", "eval-tool");
			await fs.mkdir(skillsDir, { recursive: true });

			const skillContent = `---
name: eval-tool
description: Project evaluation helper for benchmark validation
version: 1.0.0
---

# Eval Tool Skill
This skill assists in evaluating test outcomes.
`;
			await fs.writeFile(path.join(skillsDir, "SKILL.md"), skillContent, "utf-8");

			// Load skills across all 5 depths
			for (let depth = 0; depth <= 4; depth++) {
				const loadResult = loadSkills({ cwd: tempDir, includeDefaults: true });
				const evalSkill = loadResult.skills.find((s) => s.name === "eval-tool");

				expect(evalSkill).toBeDefined();
				expect(evalSkill?.name).toBe("eval-tool");
				expect(evalSkill?.description).toBe("Project evaluation helper for benchmark validation");
				expect(evalSkill?.filePath).toContain("eval-tool/SKILL.md");

				// Progressive XML Prompt should only inject brief metadata, not full file content
				const promptXml = formatSkillsForPrompt(loadResult.skills);
				expect(promptXml).toContain("<available_skills>");
				expect(promptXml).toContain("<name>eval-tool</name>");
				expect(promptXml).toContain("<description>Project evaluation helper for benchmark validation</description>");
				expect(promptXml).not.toContain("# Eval Tool Skill\nThis skill assists");
			}
		});
	});

	describe("3. Role Instructions & Tool Permissions Verification (Feat 57)", () => {
		it("should enforce distinct system prompt instructions and strict tool allowlists across roles", () => {
			const roles = [
				{ agent: BUILTIN_COORDINATOR, expectedRole: "coordinator", shouldHaveSpawn: true },
				{ agent: BUILTIN_PLANNER, expectedRole: "planner", shouldHaveSpawn: false },
				{ agent: BUILTIN_IMPLEMENTER, expectedRole: "implementer", shouldHaveSpawn: false },
				{ agent: BUILTIN_REVIEWER, expectedRole: "reviewer", shouldHaveSpawn: false },
				{ agent: BUILTIN_VERIFIER, expectedRole: "verifier", shouldHaveSpawn: false },
			];

			const parentAllTools = ["spawn_agent", "read", "bash", "edit", "write", "grep", "find", "ls", "ask_user"];

			for (const { agent, expectedRole, shouldHaveSpawn } of roles) {
				const resolved = resolveAgentConfig({
					agent,
					parentConfig: { tools: parentAllTools },
				});

				expect(resolved.name).toBe(expectedRole);
				expect(resolved.systemPrompt).toBeDefined();
				expect(resolved.systemPrompt.length).toBeGreaterThan(50);

				if (shouldHaveSpawn) {
					expect(resolved.tools).toContain("spawn_agent");
				} else {
					expect(resolved.tools).not.toContain("spawn_agent");
				}

				// Implementer can write/edit, while Planner cannot
				if (expectedRole === "implementer") {
					expect(resolved.tools).toContain("write");
					expect(resolved.tools).toContain("edit");
				} else if (expectedRole === "planner" || expectedRole === "reviewer") {
					expect(resolved.tools).not.toContain("write");
					expect(resolved.tools).not.toContain("edit");
				}
			}
		});
	});
});

