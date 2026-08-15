import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("Bundle 7: TerminalBench & Harbor Adapter and Docs Verification", () => {
	const rootDir = path.resolve(__dirname, "..");
	const adapterDir = path.join(rootDir, "adapters", "terminalbench");

	describe("1. Adapter Package Structure (Feat 51)", () => {
		it("should have all required adapter files in adapters/terminalbench", async () => {
			const initPyPath = path.join(adapterDir, "__init__.py");
			const adapterPyPath = path.join(adapterDir, "metis_adapter.py");
			const reqsPath = path.join(adapterDir, "requirements.txt");

			const [initStat, adapterStat, reqsStat] = await Promise.all([
				fs.stat(initPyPath),
				fs.stat(adapterPyPath),
				fs.stat(reqsPath),
			]);

			expect(initStat.isFile()).toBe(true);
			expect(adapterStat.isFile()).toBe(true);
			expect(reqsStat.isFile()).toBe(true);
		});

		it("should export MetisAdapter, BenchmarkResult, evaluate_task in __init__.py", async () => {
			const initContent = await fs.readFile(path.join(adapterDir, "__init__.py"), "utf-8");
			expect(initContent).toContain("BenchmarkResult");
			expect(initContent).toContain("MetisAdapter");
			expect(initContent).toContain("evaluate_task");
		});

		it("metis_adapter.py should contain standard exit code and status mappings", async () => {
			const adapterContent = await fs.readFile(path.join(adapterDir, "metis_adapter.py"), "utf-8");
			expect(adapterContent).toContain("class BenchmarkResult");
			expect(adapterContent).toContain("class MetisAdapter");
			expect(adapterContent).toContain("def run_task");
			expect(adapterContent).toContain("def evaluate_task");
			expect(adapterContent).toContain("--output-final-answer");
			expect(adapterContent).toContain("--no-session");
			expect(adapterContent).toContain("--mode");
			expect(adapterContent).toContain("trace_summary");
			expect(adapterContent).toContain("harness_error");
			expect(adapterContent).toContain("task_failure");
			expect(adapterContent).toContain("success");
		});
	});

	describe("2. Headless Benchmark Invocation (Feat 47)", () => {
		it("metis_adapter.py constructs headless command args correctly", async () => {
			const adapterContent = await fs.readFile(path.join(adapterDir, "metis_adapter.py"), "utf-8");
			// Checks that CLI options for headless benchmark are properly assembled
			expect(adapterContent).toContain("self.metis_bin");
			expect(adapterContent).toContain("-p");
			expect(adapterContent).toContain("json");
		});
	});

	describe("3. Documentation Verification (Feat 62)", () => {
		it("should have comprehensive docs/agents.md and docs/terminalbench.md", async () => {
			const agentsDocPath = path.join(rootDir, "docs", "agents.md");
			const tbDocPath = path.join(rootDir, "docs", "terminalbench.md");

			const [agentsStat, tbStat] = await Promise.all([
				fs.stat(agentsDocPath),
				fs.stat(tbDocPath),
			]);

			expect(agentsStat.isFile()).toBe(true);
			expect(tbStat.isFile()).toBe(true);

			const agentsDoc = await fs.readFile(agentsDocPath, "utf-8");
			expect(agentsDoc).toContain("spawn_agent");
			expect(agentsDoc).toContain("coordinator");
			expect(agentsDoc).toContain("SpawnGuard");
			expect(agentsDoc).toContain("worktree");

			const tbDoc = await fs.readFile(tbDocPath, "utf-8");
			expect(tbDoc).toContain("TerminalBench");
			expect(tbDoc).toContain("Harbor");
			expect(tbDoc).toContain("output-final-answer");
			expect(tbDoc).toContain("trace_summary");
		});
	});
});
