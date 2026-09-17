import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildContractSolverPrompt,
	compileTaskContract,
	classifyTaskKind,
	isHiddenGraderPath,
	parseAndValidateSolverProposal,
	resolveSolverSafePath,
} from "../src/core/task-contract.ts";
import { verifyTaskContract } from "../src/core/task-verifier.ts";

describe("task-contract compiler", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("classifies kinds and rejects hidden grader paths", () => {
		expect(classifyTaskKind("run pytest and fix the bug", undefined)).toBe("code");
		expect(classifyTaskKind("write scores within tolerance using numeric table", undefined)).toBe("numeric-data");
		expect(isHiddenGraderPath("hidden_tests/test_private.py")).toBe(true);
		expect(isHiddenGraderPath("output/result.json")).toBe(false);
	});

	it("compiles required artifacts from instruction and discovers public checks", () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-contract-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "check.sh"), "#!/bin/sh\nexit 0\n");
		const contract = compileTaskContract({
			instruction: "Create output/result.json with accuracy metric",
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(contract.compiled).toBe(true);
		expect(contract.requiredArtifacts.some((a) => a.path.includes("output/result.json"))).toBe(true);
		expect(contract.checks.some((c) => c.id === "public:check.sh")).toBe(true);
		expect(contract.contractHash.length).toBeGreaterThan(0);
	});
});

describe("task-verifier", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("fails closed on missing artifact, pollution, and content errors", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-verify-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		mkdirSync(join(cwd, "output", ".venv"), { recursive: true });
		writeFileSync(join(cwd, "output", "result.json"), '{"accuracy":0.5}');

		const contract = compileTaskContract({
			instruction: "Write output/result.json with accuracy",
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});

		const missing = await verifyTaskContract({
			contract: {
				...contract,
				requiredArtifacts: [{ path: "output/missing.json", nonEmpty: true }],
				checks: [],
			},
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(missing.completion.passed).toBe(false);
		expect(missing.failures.some((f) => f.code === "REQUIRED_ARTIFACT_MISSING")).toBe(true);

		const polluted = await verifyTaskContract({
			contract: { ...contract, checks: [], requiredArtifacts: [{ path: "output/result.json", nonEmpty: true }] },
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(polluted.failures.some((f) => f.code === "OUTPUT_POLLUTION")).toBe(true);

		const numeric = await verifyTaskContract({
			contract: { ...contract, checks: [], requiredArtifacts: [{ path: "output/result.json", nonEmpty: true, type: "json" }], forbiddenArtifacts: [] },
			cwd,
			taskPaths: { output: join(cwd, "output") },
			numericExpectations: { accuracy: { expected: 0.95, tolerance: 0.02, actualPath: "output/result.json" } },
		});
		// Rebuild without pollution for numeric-only assertion
		rmSync(join(cwd, "output", ".venv"), { recursive: true, force: true });
		const numericClean = await verifyTaskContract({
			contract: {
				...contract,
				checks: [],
				requiredArtifacts: [{ path: "output/result.json", nonEmpty: true, type: "json" }],
				forbiddenArtifacts: [],
			},
			cwd,
			taskPaths: { output: join(cwd, "output") },
			numericExpectations: { accuracy: { expected: 0.95, tolerance: 0.02, actualPath: "output/result.json" } },
		});
		expect(numericClean.failures.some((f) => f.code === "NUMERIC_TOLERANCE_FAILED")).toBe(true);
		expect(numeric.failures.length).toBeGreaterThan(0);
	});

	it("refuses auto PASS when no public/structural oracle exists", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-insuff-"));
		tempDirs.push(cwd);
		const contract = compileTaskContract({
			instruction: "think about architecture options",
			cwd,
		});
		const result = await verifyTaskContract({
			contract: { ...contract, requiredArtifacts: [], checks: [], unresolved: [] },
			cwd,
		});
		expect(result.completion.passed).toBe(false);
		expect(result.failures.some((f) => f.code === "INSUFFICIENT_EVIDENCE")).toBe(true);
	});

	it("marks evidence stale when contract hash changes", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-stale-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "result.json"), '{"ok":true}');
		const contract = compileTaskContract({
			instruction: "Create output/result.json",
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		const result = await verifyTaskContract({
			contract: { ...contract, checks: [], requiredArtifacts: [{ path: "output/result.json", nonEmpty: true }] },
			cwd,
			taskPaths: { output: join(cwd, "output") },
			priorEvidenceHash: "not-the-current-hash",
		});
		expect(result.failures.some((f) => f.code === "EVIDENCE_STALE")).toBe(true);
	});

	it("executes declarative valid-json and line-count oracles", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-decl-oracle-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "result.json"), '{"ok":true}');
		writeFileSync(join(cwd, "output", "lines.txt"), "a\nb\nc\n");
		const base = compileTaskContract({
			instruction: "Create output/result.json with three-line companion",
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		const ok = await verifyTaskContract({
			contract: {
				...base,
				checks: [],
				requiredArtifacts: [],
				constraints: [
					{
						id: "json-ok",
						description: "valid json",
						authority: "task",
						oracle: { type: "valid-json", path: "output/result.json" },
					},
					{
						id: "three-lines",
						description: "three lines",
						authority: "task",
						oracle: { type: "line-count", path: "output/lines.txt", lines: 3 },
					},
				],
			},
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(ok.completion.passed).toBe(true);

		writeFileSync(join(cwd, "output", "result.json"), "{not-json");
		const bad = await verifyTaskContract({
			contract: {
				...base,
				checks: [],
				requiredArtifacts: [],
				constraints: [
					{
						id: "json-ok",
						description: "valid json",
						authority: "task",
						oracle: { type: "valid-json", path: "output/result.json" },
					},
				],
			},
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(bad.completion.passed).toBe(false);
		expect(bad.failures.some((f) => f.code === "FORMAT_INVALID")).toBe(true);
	});
});

describe("contract-solver proposal parse (fail-closed)", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("prompt and parse require exactly one JSON object (no markdown fences)", () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-solver-json-"));
		tempDirs.push(cwd);
		const prompt = buildContractSolverPrompt("write output/a.txt", {
			kind: "artifact",
			requiredArtifacts: [],
			forbiddenArtifacts: [],
			constraints: [],
			checks: [],
			environment: { requiredPaths: [], requiredCommands: [] },
			unresolved: [],
			compiled: true,
			contractHash: "abc",
			evidenceLevel: "structural",
		});
		expect(prompt).toContain("exactly one JSON object");
		expect(prompt).toContain("no markdown fences");
		expect(prompt).not.toMatch(/Allowed oracle types:.*command/);

		const fenced = parseAndValidateSolverProposal(
			'```json\n{"constraints":[{"id":"c","description":"d","oracle":{"type":"file-exists","path":"output/a.txt"}}]}\n```',
			cwd,
		);
		expect(fenced.ok).toBe(false);
		if (!fenced.ok) expect(fenced.reason).toMatch(/markdown fence|exactly one JSON/i);

		const prose = parseAndValidateSolverProposal("Here is the proposal:\n{\"constraints\":[]}", cwd);
		expect(prose.ok).toBe(false);

		const trailing = parseAndValidateSolverProposal(
			'{"constraints":[{"id":"c","description":"d","oracle":{"type":"file-contains","path":"output/a.txt","substring":"x"}}]}\nthanks',
			cwd,
		);
		expect(trailing.ok).toBe(false);

		mkdirSync(join(cwd, "output"), { recursive: true });
		const ok = parseAndValidateSolverProposal(
			JSON.stringify({
				constraints: [
					{
						id: "must-x",
						description: "contains x",
						oracle: { type: "file-contains", path: "output/a.txt", substring: "x" },
					},
				],
			}),
			cwd,
			{ output: join(cwd, "output") },
		);
		expect(ok.ok).toBe(true);
	});

	it("rejects path escape, grader paths, checks, and command oracles", () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-solver-path-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });

		expect(resolveSolverSafePath(cwd, "../etc/passwd").ok).toBe(false);
		expect(resolveSolverSafePath(cwd, "/etc/passwd").ok).toBe(false);
		expect(resolveSolverSafePath(cwd, "hidden_tests/x.py").ok).toBe(false);

		const outside = mkdtempSync(join(tmpdir(), "metis-outside-"));
		tempDirs.push(outside);
		writeFileSync(join(outside, "secret.txt"), "nope");
		try {
			symlinkSync(outside, join(cwd, "link-out"));
			expect(resolveSolverSafePath(cwd, "link-out/secret.txt").ok).toBe(false);
		} catch {
			// platforms without symlink permission still cover absolute/.. cases above
		}

		const withChecks = parseAndValidateSolverProposal(
			JSON.stringify({
				constraints: [
					{
						id: "c",
						description: "d",
						oracle: { type: "file-contains", path: "output/a.txt", substring: "x" },
					},
				],
				checks: [{ id: "evil", command: ["rm", "-rf", "/"], cwd: "." }],
			}),
			cwd,
		);
		expect(withChecks.ok).toBe(false);
		if (!withChecks.ok) expect(withChecks.reason).toMatch(/must not propose checks/i);

		const commandOracle = parseAndValidateSolverProposal(
			JSON.stringify({
				constraints: [
					{
						id: "evil",
						description: "shell",
						oracle: { type: "command", command: ["python", "-c", "import os; os.system('rm -rf /')"] },
					},
				],
			}),
			cwd,
		);
		expect(commandOracle.ok).toBe(false);
		if (!commandOracle.ok) expect(commandOracle.reason).toMatch(/command oracles are forbidden/i);

		const escapePath = parseAndValidateSolverProposal(
			JSON.stringify({
				constraints: [
					{
						id: "c",
						description: "d",
						oracle: { type: "file-contains", path: "../../etc/passwd", substring: "root" },
					},
				],
			}),
			cwd,
		);
		expect(escapePath.ok).toBe(false);
	});
});
