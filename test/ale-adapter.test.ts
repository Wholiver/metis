import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

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

		it("runner.py should parse multiline verifier JSON without losing zero scores", () => {
			const script = `
import json
from adapters.ale.runner import classify_verifier_output, parse_verifier_score

cases = {
    "multiline_zero": '''{
  "score": 0.0,
  "pass_fail": false
}''',
    "embedded_partial": '''scorer starting
{
  "score": 0.6418181818
}
scorer finished''',
    "zero_precedence": '{"total_score": 0.0, "score": 1.0}',
    "no_score": '{"passed": true}',
    "out_of_range": '{"score": 100}',
}
print(json.dumps({
    "scores": {name: parse_verifier_score(output) for name, output in cases.items()},
    "zero_with_success_exit": classify_verifier_output(cases["multiline_zero"], 0),
    "no_score_with_success_exit": classify_verifier_output(cases["no_score"], 0),
}))
`;
			const output = execFileSync("python3", ["-c", script], {
				cwd: rootDir,
				encoding: "utf8",
			});
			expect(JSON.parse(output)).toEqual({
				scores: {
					multiline_zero: 0,
					embedded_partial: 0.6418181818,
					zero_precedence: 0,
					no_score: null,
					out_of_range: null,
				},
				zero_with_success_exit: [0, "failed"],
				no_score_with_success_exit: [0, "unverified"],
			});
		});

		it("strict submission scripts should require official evidence and ALE-v1.0 validation", async () => {
			const rescore = await fs.readFile(path.join(rootDir, "scripts", "rescore-ale.py"), "utf-8");
			const evaluator = await fs.readFile(path.join(rootDir, "scripts", "run-official-ale-evaluate.py"), "utf-8");
			const packager = await fs.readFile(path.join(rootDir, "scripts", "build_leaderboard_submission.py"), "utf-8");
			const schema = await fs.readFile(path.join(rootDir, "scripts", "ale_trajectory_schema.py"), "utf-8");
			expect(rescore).toContain("OFFICIAL_ALE_COMMIT");
			expect(evaluator).toContain("module.evaluate");
			expect(rescore).toContain('"outcome": "blocked"');
			expect(packager).toContain("require_trusted_scores");
			expect(packager).toContain("len(task_ids) != 99");
			expect(packager).toContain("Trajectory.model_validate");
			expect(schema).toContain('Literal["ALE-v1.0"]');
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
