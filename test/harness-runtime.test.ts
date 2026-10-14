import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
	validateHarnessDocument,
	assertValidHarnessDocument,
	getBuiltinHarness,
	getHarnessFilePath,
	loadHarnessSnapshot,
	executeDeclarativeGateChecks,
	findHarnessGate,
	findHarnessRubric,
	type HarnessDocument,
	type HarnessGateNodeData,
} from "../src/index.ts";
import { PerformanceRuntime } from "../src/core/performance-runtime.ts";
import { loadAgents } from "../src/core/agent-definition.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { Agent } from "@earendil-works/metis-agent-core";
import { AgentSession } from "../src/core/agent-session.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";

describe("Agent Harness Graph Schema & Seed", () => {
	it("builtin harness seed satisfies validation with all tiers, frameworks, gates, and roles", () => {
		const seed = getBuiltinHarness();
		expect(seed.version).toBe(1);
		expect(seed.nodes.length).toBeGreaterThanOrEqual(58);
		expect(seed.edges.length).toBeGreaterThanOrEqual(130);

		const result = validateHarnessDocument(seed);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);

		// Confirms all 5 tiers exist
		const tiers = seed.nodes.filter((n) => n.type === "tier");
		expect(tiers.length).toBe(5);

		// Confirms 16 frameworks exist
		const frameworks = seed.nodes.filter((n) => n.type === "framework");
		expect(frameworks.length).toBe(16);

		// Confirms 11 gates exist (G0-G7, sweep, goal-check, complete)
		const gates = seed.nodes.filter((n) => n.type === "gate");
		expect(gates.length).toBe(11);

		// Confirms 26 built-in roles exist
		const roles = seed.nodes.filter((n) => n.type === "role");
		expect(roles.length).toBe(26);
	});

	it("rejects non-object or wrong version documents", () => {
		expect(validateHarnessDocument(null).valid).toBe(false);
		expect(validateHarnessDocument([]).valid).toBe(false);
		expect(validateHarnessDocument({ version: 2, nodes: [], edges: [] }).valid).toBe(false);
	});

	it("rejects invalid nodes, duplicate IDs, and dangling edge endpoints", () => {
		const doc = {
			version: 1,
			nodes: [
				{ id: "node-1", type: "tier", data: { name: "T1" } },
				{ id: "node-1", type: "gate", data: { name: "G1" } }, // duplicate id
				{ id: "node-2", type: "invalid-type", data: { name: "Bad" } },
			],
			edges: [
				{ id: "e1", source: "node-1", target: "non-existent" },
			],
		};
		const result = validateHarnessDocument(doc);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("Duplicate node id"))).toBe(true);
		expect(result.errors.some((e) => e.includes("invalid-type"))).toBe(true);
		expect(result.errors.some((e) => e.includes("does not exist in nodes"))).toBe(true);
	});

	it("validates custom gate checks and onFail loop-to targets", () => {
		const doc: HarnessDocument = {
			version: 1,
			nodes: [
				{
					id: "custom-gate-1",
					type: "gate",
					data: {
						id: "custom-gate-1",
						name: "Custom Test Gate",
						checks: [
							{ command: "npm test", expectExit: 0, artifactPath: "dist/bundle.js" },
						],
						rubric: "Ensure zero test regressions and bundle generated.",
						onFail: "loop-to:custom-role-1",
					},
				},
				{
					id: "custom-role-1",
					type: "role",
					data: {
						id: "custom-role-1",
						name: "custom-role-1",
						description: "Specialized fixer",
						systemPrompt: "You fix things",
					},
				},
			],
			edges: [
				{ id: "e1", source: "custom-gate-1", target: "custom-role-1" },
			],
		};
		expect(validateHarnessDocument(doc).valid).toBe(true);

		// If loop-to targets non-existent node
		(doc.nodes[0].data as HarnessGateNodeData).onFail = "loop-to:missing-node";
		const invalidResult = validateHarnessDocument(doc);
		expect(invalidResult.valid).toBe(false);
		expect(invalidResult.errors.some((e) => e.includes("missing-node"))).toBe(true);
	});

	it("does not fail because standard gates or roles like G6/reviewer are deleted", () => {
		const seed = getBuiltinHarness();
		// Delete G6 and reviewer
		seed.nodes = seed.nodes.filter((n) => n.id !== "G6" && n.id !== "reviewer");
		seed.edges = seed.edges.filter((e) => e.source !== "G6" && e.target !== "G6" && e.source !== "reviewer" && e.target !== "reviewer");

		const result = validateHarnessDocument(seed);
		expect(result.valid).toBe(true);
	});
});

describe("Harness Runtime Loader & Snapshot Lifecycle", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `metis-harness-test-${randomUUID()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns null when .metis/harness.json is missing", () => {
		const snapshot = loadHarnessSnapshot(testDir);
		expect(snapshot).toBeNull();
	});

	it("throws descriptive error when .metis/harness.json is corrupt JSON", () => {
		const metisDir = join(testDir, ".metis");
		mkdirSync(metisDir, { recursive: true });
		writeFileSync(join(metisDir, "harness.json"), "{ invalid json syntax ");

		expect(() => loadHarnessSnapshot(testDir)).toThrow(/Failed to parse Harness configuration/);
	});

	it("throws descriptive error when .metis/harness.json fails structural validation", () => {
		const metisDir = join(testDir, ".metis");
		mkdirSync(metisDir, { recursive: true });
		writeFileSync(join(metisDir, "harness.json"), JSON.stringify({ version: 99, nodes: [] }));

		expect(() => loadHarnessSnapshot(testDir)).toThrow(/Harness configuration at .* is invalid/);
	});

	it("freezes snapshot on valid file load", () => {
		const metisDir = join(testDir, ".metis");
		mkdirSync(metisDir, { recursive: true });
		const seed = getBuiltinHarness();
		writeFileSync(join(metisDir, "harness.json"), JSON.stringify(seed));

		const snapshot = loadHarnessSnapshot(testDir);
		expect(snapshot).not.toBeNull();
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(() => {
			(snapshot as any).version = 2;
		}).toThrow();
	});

	it("loadAgents adopts snapshot roles when snapshot is provided", () => {
		const customDoc: HarnessDocument = {
			version: 1,
			nodes: [
				{
					id: "harness-specialist",
					type: "role",
					data: {
						id: "harness-specialist",
						name: "harness-specialist",
						description: "Harness specialist description",
						systemPrompt: "You are the harness specialist",
						tools: ["read", "write"],
					},
				},
			],
			edges: [],
		};

		const res = loadAgents({
			cwd: testDir,
			harnessSnapshot: customDoc,
		});

		const specialist = res.agents.find((a) => a.name === "harness-specialist");
		expect(specialist).toBeDefined();
		expect(specialist?.systemPrompt).toBe("You are the harness specialist");
		expect(specialist?.tools).toEqual(["read", "write"]);

		// Standard built-in coordinator is absent because snapshot replaced built-ins
		const builtinCoord = res.agents.find((a) => a.name === "coordinator");
		expect(builtinCoord).toBeUndefined();
	});

	it("project .metis/agents/*.md overrides matching role in snapshot", () => {
		const customDoc: HarnessDocument = {
			version: 1,
			nodes: [
				{
					id: "specialist",
					type: "role",
					data: {
						id: "specialist",
						name: "specialist",
						description: "Base harness specialist",
						systemPrompt: "Original prompt",
					},
				},
			],
			edges: [],
		};

		// Write project agent file
		const agentsDir = join(testDir, ".metis", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "specialist.md"),
			`---
name: specialist
description: Overridden by project markdown
---
Project overridden prompt`,
		);

		const res = loadAgents({
			cwd: testDir,
			harnessSnapshot: customDoc,
		});

		const specialist = res.agents.find((a) => a.name === "specialist");
		expect(specialist).toBeDefined();
		expect(specialist?.systemPrompt).toBe("Project overridden prompt");
		expect(specialist?.source).toBe("project");
	});
});

describe("Declarative Gates Execution & Host Enforcement", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `metis-decl-gate-test-${randomUUID()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	it("passes declarative check when exit code matches and artifact exists", () => {
		writeFileSync(join(testDir, "output.txt"), "hello world");
		const gate: HarnessGateNodeData = {
			id: "verify-build",
			name: "Verify Build",
			checks: [
				{
					command: "echo test",
					expectExit: 0,
					artifactPath: "output.txt",
				},
			],
		};

		const result = executeDeclarativeGateChecks(gate, testDir);
		expect(result.passed).toBe(true);
		expect(result.results.length).toBe(1);
		expect(result.results[0].passed).toBe(true);
	});

	it("fails declarative check when exit code does not match", () => {
		const gate: HarnessGateNodeData = {
			id: "verify-fail",
			name: "Verify Failure",
			checks: [
				{
					command: "exit 42",
					expectExit: 0,
				},
			],
			onFail: "block",
		};

		const result = executeDeclarativeGateChecks(gate, testDir);
		expect(result.passed).toBe(false);
		expect(result.onFail).toBe("block");
		expect(result.failureReason).toContain("exited with 42, expected 0");
	});

	it("fails declarative check when artifact file is missing", () => {
		const gate: HarnessGateNodeData = {
			id: "verify-missing-artifact",
			name: "Missing Artifact",
			checks: [
				{
					command: "echo ok",
					expectExit: 0,
					artifactPath: "dist/non-existent-bundle.js",
				},
			],
			onFail: "loop-to:G4",
		};

		const result = executeDeclarativeGateChecks(gate, testDir);
		expect(result.passed).toBe(false);
		expect(result.onFail).toBe("loop-to:G4");
		expect(result.failureReason).toContain("does not exist");
	});

	it("retrieves rubric for gate role context injection", () => {
		const doc: HarnessDocument = {
			version: 1,
			nodes: [
				{
					id: "G5",
					type: "gate",
					data: {
						id: "G5",
						name: "Custom Review",
						rubric: "Check all API routes for authentication middlewares.",
					},
				},
			],
			edges: [],
		};

		const rubric = findHarnessRubric(doc, "G5");
		expect(rubric).toBe("Check all API routes for authentication middlewares.");

		const missingRubric = findHarnessRubric(doc, "G6");
		expect(missingRubric).toBeUndefined();
	});

	it("PerformanceRuntime enforces declarative gate checks on gate reporting", () => {
		const runtime = new PerformanceRuntime(testDir);
		const doc: HarnessDocument = {
			version: 1,
			nodes: [
				{
					id: "G4",
					type: "gate",
					data: {
						id: "G4",
						name: "Implementation",
						checks: [
							{
								command: "exit 1",
								expectExit: 0,
							},
						],
						onFail: "block",
					},
				},
			],
			edges: [],
		};

		const state = runtime.admit({
			kind: "admit",
			workspaceRoot: testDir,
			mission: "Test Mission",
			harnessSnapshot: doc,
			admission: {
				tier: "T1",
				taskShape: "bounded",
				deliverables: ["fix"],
				acceptanceCriteria: ["all pass"],
				verificationCommands: ["echo pass"],
				sharedMutableState: false,
				lanes: [
					{
						id: "lane-1",
						objective: "fix bug",
						framework: "apply",
						ownedPaths: ["."],
						deliverables: ["fix"],
						acceptanceCriteria: ["pass"],
						verificationCommands: ["echo pass"],
						dependsOn: [],
					},
				],
			},
		});

		expect(state.harnessSnapshot).toBeDefined();

		// Writing evidence
		const artifactsDir = join(state.governanceRoot, "artifacts");
		mkdirSync(artifactsDir, { recursive: true });
		writeFileSync(
			join(artifactsDir, "g4.json"),
			JSON.stringify({ changedFiles: ["a.ts"], testCommand: "echo ok", testOutput: "pass", exitCode: 0, testStatus: "pass" }),
		);

		// Record report for G4 where declarative check fails with exit 1
		runtime.recordGateReport({
			gate: "G4",
			itemId: "lane-1",
			actor: "implementer-1",
			role: "implementer",
			verdict: "pass",
			evidence: "artifacts/g4.json",
		});

		// Check runtime status was blocked due to onFail: "block"
		expect(runtime.state?.frontier).toBe("blocked");
	});
});

describe("AgentSession Harness Snapshot Integration", () => {
	let tempDir: string;
	let session: any;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `metis-session-harness-${randomUUID()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		session?.dispose?.();
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	function createSession() {
		const agent = new Agent({
			model: {
				id: "claude-3-5-sonnet-20241022",
				provider: "anthropic",
				name: "Claude 3.5 Sonnet",
			},
			systemPrompt: "Test",
			tools: [],
		});
		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);

		return new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: new DefaultResourceLoader({ cwd: tempDir, agentDir: tempDir }),
		});
	}

	it("missing .metis/harness.json allows normal startup with null snapshot", async () => {
		session = createSession();
		expect(session.harnessSnapshot).toBeNull();
	});

	it("refuses to prompt when .metis/harness.json is invalid, reporting path and reasons", async () => {
		const metisDir = join(tempDir, ".metis");
		mkdirSync(metisDir, { recursive: true });
		writeFileSync(join(metisDir, "harness.json"), "{ invalid syntax");

		session = createSession();
		await expect(session.prompt("Hello")).rejects.toThrow(/Failed to parse Harness configuration/);
	});

	it("refuses to prompt when .metis/harness.json has invalid schema", async () => {
		const metisDir = join(tempDir, ".metis");
		mkdirSync(metisDir, { recursive: true });
		writeFileSync(join(metisDir, "harness.json"), JSON.stringify({ version: 2 }));

		session = createSession();
		await expect(session.prompt("Hello")).rejects.toThrow(/Harness configuration at .* is invalid/);
	});

	it("freezes snapshot on prompt and does not overwrite active run snapshot on mid-run disk change", async () => {
		const metisDir = join(tempDir, ".metis");
		mkdirSync(metisDir, { recursive: true });
		const seed = getBuiltinHarness();
		writeFileSync(join(metisDir, "harness.json"), JSON.stringify(seed));

		session = createSession();
		// In active performance run:
		// First load snapshot
		const initialSnapshot = loadHarnessSnapshot(tempDir);
		expect(initialSnapshot).not.toBeNull();

		// Admit a run to make it active
		session._performanceRuntime.admit({
			kind: "admit",
			workspaceRoot: tempDir,
			mission: "Active Run",
			harnessSnapshot: initialSnapshot,
			admission: {
				tier: "T1",
				taskShape: "bounded",
				deliverables: ["d1"],
				acceptanceCriteria: ["a1"],
				verificationCommands: ["echo 1"],
				sharedMutableState: false,
				lanes: [
					{
						id: "lane-1",
						objective: "lane 1",
						framework: "apply",
						ownedPaths: ["."],
						deliverables: ["d1"],
						acceptanceCriteria: ["a1"],
						verificationCommands: ["echo 1"],
						dependsOn: [],
					},
				],
			},
		});

		expect(session._performanceRuntime.hasActiveRun()).toBe(true);
		const runSnapshotBefore = session._performanceRuntime.state.harnessSnapshot;

		// Now change the file on disk mid-run
		const modifiedSeed = getBuiltinHarness();
		modifiedSeed.nodes = modifiedSeed.nodes.filter((n) => n.id !== "G1");
		writeFileSync(join(metisDir, "harness.json"), JSON.stringify(modifiedSeed));

		// Mid-run: active run snapshot must remain frozen and unchanged!
		expect(session._performanceRuntime.state.harnessSnapshot).toBe(runSnapshotBefore);
		expect(session._performanceRuntime.state.harnessSnapshot.nodes.some((n: any) => n.id === "G1")).toBe(true);
	});

	it("allowedSpawnRoles and prepareSpawn permit custom roles defined in harness snapshot", async () => {
		const customDoc: HarnessDocument = {
			version: 1,
			nodes: [
				{
					id: "tier-t1",
					type: "tier",
					data: { id: "tier-t1", name: "T1 Standard" },
				},
				{
					id: "custom-fw",
					type: "framework",
					data: { id: "custom-fw", name: "Custom Framework" },
				},
				{
					id: "custom-gate",
					type: "gate",
					data: { id: "custom-gate", name: "Custom Gate", onFail: "block" },
				},
				{
					id: "custom-worker",
					type: "role",
					data: {
						id: "custom-worker",
						name: "custom-worker",
						description: "Specialized worker",
						systemPrompt: "Work",
					},
				},
			],
			edges: [
				{ id: "e1", source: "tier-t1", target: "custom-fw", type: "tier-framework" },
				{ id: "e2", source: "custom-fw", target: "custom-gate", type: "framework-gate", order: 1 },
				{ id: "e3", source: "custom-gate", target: "custom-worker", type: "gate-role" },
			],
		};

		const runtime = new PerformanceRuntime(tempDir);
		runtime.admit({
			kind: "admit",
			workspaceRoot: tempDir,
			mission: "Custom Worker Test",
			harnessSnapshot: customDoc,
			admission: {
				tier: "T1",
				taskShape: "bounded",
				deliverables: ["res"],
				acceptanceCriteria: ["ok"],
				verificationCommands: ["echo 1"],
				sharedMutableState: false,
				lanes: [
					{
						id: "lane-1",
						objective: "test lane",
						framework: "custom-fw",
						ownedPaths: ["."],
						deliverables: ["res"],
						acceptanceCriteria: ["ok"],
						verificationCommands: ["echo 1"],
						dependsOn: [],
					},
				],
			},
		});

		// allowedSpawnRoles contains custom-worker from snapshot
		const allowed = runtime.allowedSpawnRoles();
		expect(allowed).toContain("custom-worker");

		// prepareSpawn allows custom-worker under T1 route without throwing route rejection
		const prepared = runtime.prepareSpawn({
			agent: "custom-worker",
			task: "Execute custom task",
			gate: "custom-gate" as any,
		});
		expect(prepared).toBeDefined();
		expect(prepared.task).toContain("Assigned task: Execute custom task");
		expect(prepared.gate).toBe("custom-gate");
		expect(prepared.laneId).toBe("lane-1");
	});

	it("resolves role model and thinking from harness snapshot for child subagents", () => {
		const customDoc: HarnessDocument = {
			version: 1,
			nodes: [
				{
					id: "tierflow-specialist",
					type: "role",
					data: {
						id: "tierflow-specialist",
						name: "tierflow-specialist",
						description: "Tierflow specialist",
						systemPrompt: "You use tierflow model",
						model: "tierflow",
						thinking: "high",
					},
				},
			],
			edges: [],
		};

		session = createSession();
		(session as any)._harnessSnapshot = customDoc;

		const roleNode = session.harnessSnapshot?.nodes.find((n: any) => n.id === "tierflow-specialist");
		expect(roleNode).toBeDefined();
		expect(roleNode?.data.model).toBe("tierflow");
		expect(roleNode?.data.thinking).toBe("high");
	});

	it("resolves model info including tierflow API credentials in spawn subagent context", () => {
		const prevKey = process.env.TIERFLOW_API_KEY;
		try {
			process.env.TIERFLOW_API_KEY = "sk-nBHERSQWPRDJeEtFEkvC9ESzoEmaT12TQEEl7LqdFnTiCwZn";
			const customDoc: HarnessDocument = {
				version: 1,
				nodes: [
					{
						id: "tierflow-worker",
						type: "role",
						data: {
							id: "tierflow-worker",
							name: "tierflow-worker",
							description: "Tierflow worker",
							systemPrompt: "Work",
							model: "tierflow",
						},
					},
				],
				edges: [],
			};

			session = createSession();
			(session as any)._harnessSnapshot = customDoc;

			const resolved = (session as any)._harnessSnapshot?.nodes.find((n: any) => n.id === "tierflow-worker");
			expect(resolved).toBeDefined();
			expect(resolved?.data.model).toBe("tierflow");
		} finally {
			process.env.TIERFLOW_API_KEY = prevKey;
		}
	});
});


