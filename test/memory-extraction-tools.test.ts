import { describe, expect, it, vi } from "vitest";
import { extractMemoryCandidates } from "../src/core/sdk.ts";

function response(content: any[], stopReason: string) {
	return { role: "assistant", content, stopReason, timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as any;
}

const checkpoint = { sessionId: "session", reason: "completed" as const, timestamp: new Date(0).toISOString() };
const registry = { getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "test", headers: {}, env: {} })) } as any;

describe("background memory extraction", () => {
	it("allows more than three model-directed queries without a fixed output token cap", async () => {
		const queued = [0, 1, 2, 3].map((index) => response([{ type: "toolCall", id: `call-${index}`, name: "query_memory_db", arguments: { sql: `SELECT * FROM memory_records WHERE category = 'cat-${index}'` } }], "toolUse"));
		queued.push(response([{ type: "text", text: JSON.stringify([{ scope: "project", kind: "fact", content: "Verified durable project fact", confidence: 0.9 }]) }], "stop"));
		const options: any[] = [];
		const contexts: any[] = [];
		const stream = vi.fn((_model, context, requestOptions) => {
			contexts.push(context);
			options.push(requestOptions);
			return { result: async () => queued.shift() };
		});
		const queries: string[] = [];
		const result = await extractMemoryCandidates(
			{ reasoning: true } as any,
			registry,
			checkpoint,
			(sql) => { queries.push(sql); return []; },
			undefined,
			stream as any,
		);
		expect(queries).toHaveLength(4);
		expect(queries[0]).toContain("cat-0");
		expect(result.candidates).toHaveLength(1);
		expect(options).toHaveLength(5);
		for (const request of options) {
			expect(request).not.toHaveProperty("maxTokens");
			expect(request.reasoning).toBe("low");
		}
		expect(contexts.at(-1).messages.filter((message: any) => message.role === "toolResult")).toHaveLength(4);
	});

	it("omits reasoning entirely for models without thinking support", async () => {
		let requestOptions: any;
		const stream = vi.fn((_model, _context, options) => {
			requestOptions = options;
			return { result: async () => response([{ type: "text", text: "[]" }], "stop") };
		});
		await extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], undefined, stream as any);
		expect(requestOptions).not.toHaveProperty("reasoning");
		expect(requestOptions).not.toHaveProperty("maxTokens");
	});

	it("rejects unknown tools and invalid query arguments as recoverable extraction failures", async () => {
		for (const toolCall of [
			{ type: "toolCall", id: "unknown", name: "read", arguments: { path: "MEMORY.md" } },
			{ type: "toolCall", id: "invalid", name: "query_memory_db", arguments: { sql: "" } },
		]) {
			const stream = vi.fn(() => ({ result: async () => response([toolCall], "toolUse") }));
			const result = await extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], undefined, stream as any);
			expect(result).toMatchObject({ candidates: [] });
			expect(result.failureReason).toMatch(/unknown tool|invalid/i);
		}
	});

	it("caps valid model candidates at six and reports invalid JSON", async () => {
		const candidates = Array.from({ length: 8 }, (_, index) => ({ scope: "project", kind: "fact", content: `Verified fact ${index}`, confidence: 0.9 }));
		let stream = vi.fn(() => ({ result: async () => response([{ type: "text", text: JSON.stringify(candidates) }], "stop") }));
		expect((await extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], undefined, stream as any)).candidates).toHaveLength(6);
		stream = vi.fn(() => ({ result: async () => response([{ type: "text", text: "not-json" }], "stop") }));
		expect((await extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], undefined, stream as any)).failureReason).toMatch(/JSON/i);
	});

	it("validates candidate fields and drops low-confidence candidates", async () => {
		let stream = vi.fn(() => ({ result: async () => response([{ type: "text", text: JSON.stringify([
			{ scope: "project", kind: "fact", content: "Low confidence fact", confidence: 0.4 },
			{ scope: "project", kind: "fact", content: "High confidence fact", confidence: 0.9 },
		]) }], "stop") }));
		const filtered = await extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], undefined, stream as any);
		expect(filtered.candidates.map((candidate) => candidate.content)).toEqual(["High confidence fact"]);

		stream = vi.fn(() => ({ result: async () => response([{ type: "text", text: JSON.stringify([
			{ scope: "unknown", kind: "fact", content: "Invalid scoped fact", confidence: 0.9 },
		]) }], "stop") }));
		expect((await extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], undefined, stream as any)).failureReason).toMatch(/schema validation/i);
	});

	it("propagates AbortSignal instead of using fallback", async () => {
		const controller = new AbortController();
		const stream = vi.fn((_model, _context, options) => ({
			result: async () => await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
		}));
		const extraction = extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], controller.signal, stream as any);
		controller.abort();
		await expect(extraction).rejects.toThrow("aborted");
	});

	it("parses valid category and supersedes fields", async () => {
		const stream = vi.fn(() => ({
			result: async () =>
				response([
					{
						type: "text",
						text: JSON.stringify([
							{
								scope: "project",
								category: "tech_stack",
								kind: "fact",
								content: "TypeScript with Node.js runtime",
								confidence: 0.95,
								supersedes: ["old-id-1", "old-id-2"],
							},
						]),
					},
				], "stop"),
		}));
		const result = await extractMemoryCandidates({ reasoning: false } as any, registry, checkpoint, () => [], undefined, stream as any);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]).toMatchObject({
			scope: "project",
			category: "tech_stack",
			kind: "fact",
			content: "TypeScript with Node.js runtime",
			confidence: 0.95,
			supersedes: ["old-id-1", "old-id-2"],
		});
	});

	it("supports memoryMap in JSON object format and passes existingMemoryMap in user prompt", async () => {
		let capturedContext: any;
		const stream = vi.fn((_model, context) => {
			capturedContext = context;
			return {
				result: async () =>
					response([
						{
							type: "text",
							text: JSON.stringify({
								candidates: [
									{
										scope: "project",
										category: "tech_stack",
										kind: "fact",
										content: "Node.js v22 required",
										confidence: 0.9,
									},
								],
								memoryMap: "# Memory Map\n\n## Projects\n- **[tech_stack]**: Node.js v22",
							}),
						},
					], "stop"),
			};
		});

		const result = await extractMemoryCandidates(
			{ reasoning: false } as any,
			registry,
			checkpoint,
			() => [],
			undefined,
			stream as any,
			"# Existing Memory Map\n## Old section",
		);

		expect(capturedContext.messages[0].content[0].text).toContain("Existing Memory Map:\n# Existing Memory Map");
		expect(result.candidates).toHaveLength(1);
		expect(result.memoryMap).toBe("# Memory Map\n\n## Projects\n- **[tech_stack]**: Node.js v22");
	});
});

