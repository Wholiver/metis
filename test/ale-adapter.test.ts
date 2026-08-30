import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("ALE-CLI Benchmark Adapter and Runner Suite", () => {
	const rootDir = path.resolve(__dirname, "..");
	const aleDir = path.join(rootDir, "adapters", "ale");

	describe("1. Adapter Package Structure", () => {
		it("should have all required files in adapters/ale", async () => {
			const initPyPath = path.join(aleDir, "__init__.py");
			const adapterPyPath = path.join(aleDir, "metis_adapter.py");
			const runnerPyPath = path.join(aleDir, "runner.py");
			const reqsPath = path.join(aleDir, "requirements.txt");

			const [initStat, adapterStat, runnerStat, reqsStat] = await Promise.all([
				fs.stat(initPyPath),
				fs.stat(adapterPyPath),
				fs.stat(runnerPyPath),
				fs.stat(reqsPath),
			]);

			expect(initStat.isFile()).toBe(true);
			expect(adapterStat.isFile()).toBe(true);
			expect(runnerStat.isFile()).toBe(true);
			expect(reqsStat.isFile()).toBe(true);
		});

		it("should export ALEMetisAdapter, ALEResult, ALERunner, ALETask in __init__.py", async () => {
			const initContent = await fs.readFile(path.join(aleDir, "__init__.py"), "utf-8");
			expect(initContent).toContain("ALEMetisAdapter");
			expect(initContent).toContain("ALEResult");
			expect(initContent).toContain("ALERunner");
			expect(initContent).toContain("ALETask");
			expect(initContent).toContain("evaluate_task");
		});
	});

	describe("2. OpenAI Codex and GPT-5.6-Luna Configuration", () => {
		it("metis_adapter.py should default to openai-codex, gpt-5.6-luna and low thinking", async () => {
			const adapterContent = await fs.readFile(path.join(aleDir, "metis_adapter.py"), "utf-8");
			expect(adapterContent).toContain('default_provider: Optional[str] = "openai-codex"');
			expect(adapterContent).toContain('default_model: Optional[str] = "gpt-5.6-luna"');
			expect(adapterContent).toContain('default_thinking: Optional[str] = "low"');
			expect(adapterContent).toContain("class ALEResult");
			expect(adapterContent).toContain("class ALEMetisAdapter");
			expect(adapterContent).toContain("--output-final-answer");
			expect(adapterContent).toContain("--no-session");
			expect(adapterContent).toContain("--mode");
			expect(adapterContent).toContain("trace_summary");
		});

		it("runner.py should configure concurrency 1, checkpointing, and ETA tracking", async () => {
			const runnerContent = await fs.readFile(path.join(aleDir, "runner.py"), "utf-8");
			expect(runnerContent).toContain("class ALERunner");
			expect(runnerContent).toContain("load_checkpoint");
			expect(runnerContent).toContain("save_checkpoint");
			expect(runnerContent).toContain("compute_eta");
			expect(runnerContent).toContain("format_duration");
			expect(runnerContent).toContain("checkpoint.json");
			expect(runnerContent).toContain("results.jsonl");
			expect(runnerContent).toContain("SIGINT");
		});
	});

	describe("3. Documentation Verification", () => {
		it("should have comprehensive docs/ale.md", async () => {
			const aleDocPath = path.join(rootDir, "docs", "ale.md");
			const docStat = await fs.stat(aleDocPath);
			expect(docStat.isFile()).toBe(true);

			const docContent = await fs.readFile(aleDocPath, "utf-8");
			expect(docContent).toContain("ALE-CLI");
			expect(docContent).toContain("openai-codex");
			expect(docContent).toContain("gpt-5.6-luna");
			expect(docContent).toContain("checkpoint.json");
			expect(docContent).toContain("ETA");
		});
	});
});
