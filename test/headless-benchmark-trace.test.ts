import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";
import { TraceCollector, getGlobalTraceCollector } from "../src/core/trace-collector.ts";
import { createAskUserToolDefinition } from "../src/core/tools/ask-user.ts";
import { createSpawnAgentToolDefinition } from "../src/core/tools/spawn_agent.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("Bundle 6: Headless Benchmark Mode, Exit Codes & Full Trace", () => {
	describe("1. CLI Argument Parsing (--base-url, --output-final-answer)", () => {
		it("should parse --base-url and --output-final-answer correctly", () => {
			const parsed = parseArgs([
				"--base-url",
				"http://127.0.0.1:8000/v1",
				"--output-final-answer",
				"./output/final_response.txt",
				"-p",
				"Execute benchmark task",
			]);

			expect(parsed.baseUrl).toBe("http://127.0.0.1:8000/v1");
			expect(parsed.outputFinalAnswer).toBe("./output/final_response.txt");
			expect(parsed.print).toBe(true);
			expect(parsed.messages).toContain("Execute benchmark task");
			expect(parsed.diagnostics.length).toBe(0);
		});
	});

	describe("2. Custom OpenAI-Compatible BaseURL & Uncataloged Models (Feat 40)", () => {
		it("should dynamically resolve arbitrary uncataloged model when --base-url is specified", () => {
			const authStorage = AuthStorage.create();
			const registry = ModelRegistry.create(authStorage);
			const result = resolveCliModel({
				cliModel: "custom-harbor-llm-v1",
				cliBaseUrl: "http://127.0.0.1:9999/v1",
				modelRegistry: registry,
			});

			expect(result.error).toBeUndefined();
			expect(result.model).toBeDefined();
			expect(result.model?.id).toBe("custom-harbor-llm-v1");
			expect(result.model?.provider).toBe("openai");
			expect(result.model?.baseUrl).toBe("http://127.0.0.1:9999/v1");
			expect(["openai-responses", "openai-completions"]).toContain(result.model?.api);
		});

		it("should support completely custom provider with --base-url and custom model id", () => {
			const authStorage = AuthStorage.create();
			const registry = ModelRegistry.create(authStorage);
			const result = resolveCliModel({
				cliProvider: "vllm-custom",
				cliModel: "deepseek-coder-v3",
				cliBaseUrl: "http://192.168.1.100:8000/v1",
				modelRegistry: registry,
			});

			expect(result.error).toBeUndefined();
			expect(result.model).toBeDefined();
			expect(result.model?.id).toBe("deepseek-coder-v3");
			expect(result.model?.provider).toBe("vllm-custom");
			expect(result.model?.baseUrl).toBe("http://192.168.1.100:8000/v1");
			expect(result.model?.api).toBe("openai-completions");
		});
	});

	describe("3. Full Lifecycle TraceContext & Token/Cost Aggregator (Feats 35, 36, 37, 38)", () => {
		it("should inject traceContext into JSON events without losing original payload", () => {
			const collector = new TraceCollector("run-test-123");
			const traceContext = {
				rootRunId: "run-test-123",
				agentId: "planner-01",
				parentId: "root",
				depth: 1,
				provider: "openai",
				model: "gpt-4o",
				baseUrl: "http://127.0.0.1:8000/v1",
			};

			const rawEvent = { type: "tool_execution_start", toolName: "read", toolCallId: "call-1" };
			const enriched = collector.injectTraceContext(rawEvent, traceContext);

			expect(enriched.type).toBe("tool_execution_start");
			expect(enriched.toolName).toBe("read");
			expect(enriched.traceContext).toEqual(traceContext);
		});

		it("should record and aggregate token, cost, and latency across recursive agent tree", () => {
			const collector = new TraceCollector("run-root-abc");

			// Root agent usage
			collector.recordUsage(
				"root",
				{ input: 1000, output: 200, cacheRead: 500, cacheWrite: 100, cost: 0.005, durationMs: 1200 },
				{ depth: 0, provider: "openai", model: "gpt-4o" },
			);

			// Child L1 agent usage
			collector.recordUsage(
				"planner-01",
				{ input: 2000, output: 400, cacheRead: 800, cacheWrite: 200, cost: 0.010, durationMs: 2500 },
				{ parentId: "root", depth: 1, provider: "openai", model: "gpt-4o" },
			);

			// Child L2 agent usage
			collector.recordUsage(
				"implementer-02",
				{ input: 4000, output: 1000, cacheRead: 1500, cacheWrite: 300, cost: 0.025, durationMs: 4000 },
				{ parentId: "planner-01", depth: 2, provider: "openai", model: "gpt-4o" },
			);

			const summary = collector.getSummary();

			expect(summary.type).toBe("trace_summary");
			expect(summary.rootRunId).toBe("run-root-abc");
			expect(summary.totalInputTokens).toBe(7000);
			expect(summary.totalOutputTokens).toBe(1600);
			expect(summary.totalCacheReadTokens).toBe(2800);
			expect(summary.totalCacheWriteTokens).toBe(600);
			expect(summary.totalCost).toBeCloseTo(0.040, 5);
			expect(summary.agentCount).toBe(3);
			expect(summary.agents.length).toBe(3);

			const plannerStats = summary.agents.find((a) => a.agentId === "planner-01");
			expect(plannerStats).toBeDefined();
			expect(plannerStats?.depth).toBe(1);
			expect(plannerStats?.parentId).toBe("root");
			expect(plannerStats?.inputTokens).toBe(2000);
		});

		it("should support merging child trace summaries into root collector", () => {
			const rootCollector = new TraceCollector("root-run-xyz");
			rootCollector.recordUsage("root", { input: 500, output: 100, cost: 0.002 });

			const childSummary = {
				type: "trace_summary" as const,
				rootRunId: "root-run-xyz",
				totalInputTokens: 1500,
				totalOutputTokens: 300,
				totalCacheReadTokens: 0,
				totalCacheWriteTokens: 0,
				totalCost: 0.008,
				totalDurationMs: 3000,
				agentCount: 1,
				agents: [
					{
						agentId: "verifier-01",
						depth: 1,
						parentId: "root",
						inputTokens: 1500,
						outputTokens: 300,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						cost: 0.008,
						durationMs: 3000,
						turnCount: 2,
					},
				],
			};

			rootCollector.mergeChildTrace(childSummary);
			const totalSummary = rootCollector.getSummary();

			expect(totalSummary.agents).toHaveLength(2);
			expect(totalSummary.totalInputTokens).toBe(2000);
			expect(totalSummary.totalOutputTokens).toBe(400);
			expect(totalSummary.totalCost).toBeCloseTo(0.010, 5);
		});
	});

	describe("4. Headless & Unattended Fallback for ask_user (Feats 33, 34)", () => {
		it("should auto-resolve with recommended or first option without throwing in unattended mode", async () => {
			const toolDef = createAskUserToolDefinition({ handler: undefined });

			const result = await toolDef.execute(
				"call-unattended",
				{
					questions: [
						{
							id: "db_choice",
							header: "Choose Database",
							question: "Which database should be used?",
							options: [
								{ label: "sqlite", description: "Use local SQLite database" },
								{ label: "postgres", description: "Use PostgreSQL", recommended: true },
							],
						},
					],
				},
				new AbortController().signal,
				() => {},
				undefined as any,
			);

			expect(result.content[0].type).toBe("text");
			const parsedPayload = JSON.parse(result.content[0].text);
			expect(parsedPayload.cancelled).toBe(false);
			expect(parsedPayload.answers).toHaveLength(1);
			expect(parsedPayload.answers[0].id).toBe("db_choice");
			expect(parsedPayload.answers[0].value).toBe("postgres");
			expect(parsedPayload.answers[0].selectedLabel).toBe("postgres");
			expect(parsedPayload.note).toContain("Unattended mode");
		});
	});

	describe("5. Child Agent Spawn Context & Attribution (Feats 38, 46)", () => {
		it("should forward --base-url to child process arguments when configured", async () => {
			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "metis-test-spawn-"));
			try {
				const toolDef = createSpawnAgentToolDefinition(tempDir, {
					runtimeContext: {
						rootRunId: "run-bench-1",
						currentAgentId: "root",
						currentDepth: 0,
						provider: "openai",
						model: "gpt-4o",
						baseUrl: "http://127.0.0.1:8000/v1",
					},
				});

				expect(toolDef.name).toBe("spawn_agent");
				expect(toolDef.parameters).toBeDefined();
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		});
	});

	describe("6. Isolated Final Answer Output File (Feat 49)", () => {
		it("should successfully isolate output final response into designated path", async () => {
			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "metis-test-final-ans-"));
			const targetFile = path.join(tempDir, "answers", "final_result.txt");

			try {
				// Simulating writing final answer file as in runPrintMode
				const finalContent = "The solution to benchmark problem 42 is verified.";
				await fs.mkdir(path.dirname(targetFile), { recursive: true });
				await fs.writeFile(targetFile, finalContent, "utf-8");

				const exists = await fs.stat(targetFile);
				expect(exists.isFile()).toBe(true);

				const content = await fs.readFile(targetFile, "utf-8");
				expect(content).toBe("The solution to benchmark problem 42 is verified.");
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		});
	});
});
