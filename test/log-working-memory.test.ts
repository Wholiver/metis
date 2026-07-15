import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	WORKING_MEMORY_MAX_BYTES,
	createLogToolDefinition,
	extractWorkingMemory,
} from "../src/core/tools/log.ts";

function textOutput(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part): part is { type: string; text: string } => typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

describe("log working memory", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "metis-log-working-memory-"));
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	function context(sessionId: string) {
		return {
			cwd,
			mode: "tui" as const,
			hasUI: true,
			sessionManager: { getSessionId: () => sessionId },
			modelRegistry: {} as any,
			model: undefined,
			ui: {} as any,
			isIdle: () => true,
			isProjectTrusted: () => true,
		} as any;
	}

	async function execute(
		sessionId: string,
		args: { action?: "read" | "checkpoint" | "error" | "completion"; content?: string },
		signal?: AbortSignal,
	) {
		return createLogToolDefinition(cwd).execute("log-call", args, signal, undefined, context(sessionId));
	}

	it("supports read, checkpoint, error, completion, and legacy completion", async () => {
		expect(textOutput(await execute("actions", { action: "read" }))).toContain("No working memory");

		const checkpoint = await execute("actions", {
			action: "checkpoint",
			content: "Goal: ship memory\nDone: schema\nNext: runtime",
		});
		expect(textOutput(checkpoint)).toContain("Current working memory");
		expect(textOutput(checkpoint)).toContain("Goal: ship memory");

		await execute("actions", {
			action: "error",
			content: "Phase: build\nDiagnosis: missing import\nFix: restored import\nVerification: passed",
		});
		await execute("actions", { action: "completion", content: "Completed: implementation" });
		await execute("actions", { content: "Legacy completion remains compatible" });

		const log = readFileSync(join(cwd, ".temp", "actions_log.md"), "utf-8");
		expect(log).toMatch(/## \[[^\]]+\] Checkpoint/);
		expect(log).toMatch(/## \[[^\]]+\] Error/);
		expect(log).toMatch(/## \[[^\]]+\] Completion/);
		expect(log).toMatch(/## \[[^\]]+\] Task summary/);

		const current = textOutput(await execute("actions", { action: "read" }));
		expect(current).toContain("Goal: ship memory");
		expect(current).toContain("Phase: build");
		expect(current).toContain("Completed: implementation");
		expect(current).toContain("Legacy completion remains compatible");
	});

	it("treats an existing empty log as no saved working memory", async () => {
		mkdirSync(join(cwd, ".temp"), { recursive: true });
		writeFileSync(join(cwd, ".temp", "empty_log.md"), "");

		expect(textOutput(await execute("empty", { action: "read" }))).toContain("No working memory");
	});

	it("uses latest checkpoint, or latest legacy summary when no checkpoint exists", async () => {
		const checkpointLog = [
			"## [2026-01-01 10:00] Checkpoint",
			"Goal: old",
			"## [2026-01-01 10:01] Error",
			"Error: old",
			"## [2026-01-01 10:02] Checkpoint",
			"Goal: current",
			"## [2026-01-01 10:03] Error",
			"Error: retained",
			"## [2026-01-01 10:04] Completion",
			"Done: retained",
		].join("\n");
		expect(extractWorkingMemory(checkpointLog)).not.toContain("Goal: old");
		expect(extractWorkingMemory(checkpointLog)).toContain("Goal: current");
		expect(extractWorkingMemory(checkpointLog)).toContain("Error: retained");
		expect(extractWorkingMemory(checkpointLog)).toContain("Done: retained");

		const legacyLog = [
			"## [2026-01-01 09:00] Task summary",
			"Old summary",
			"## [2026-01-01 09:01] Task summary",
			"Latest summary",
		].join("\n");
		expect(extractWorkingMemory(legacyLog)).toBe(
			"## [2026-01-01 09:01] Task summary\nLatest summary",
		);
	});

	it("suppresses consecutive identical checkpoints", async () => {
		await execute("duplicate", { action: "checkpoint", content: "Goal: same" });
		const result = await execute("duplicate", { action: "checkpoint", content: "Goal: same" });
		const log = readFileSync(join(cwd, ".temp", "duplicate_log.md"), "utf-8");

		expect(textOutput(result)).toContain("skipped duplicate");
		expect(log.match(/\] Checkpoint/g)).toHaveLength(1);
	});

	it("bounds reads to 12 KiB while preserving goal head and latest tail", () => {
		const middle = Array.from({ length: 500 }, (_, index) => `detail-${index}: ${"x".repeat(80)}`).join("\n");
		const log = [
			"## [2026-01-01 10:00] Checkpoint",
			"Goal: preserve this header",
			middle,
			"## [2026-01-01 11:00] Error",
			"Residual risk: preserve this latest tail",
		].join("\n");
		const current = extractWorkingMemory(log);

		expect(current).toBeDefined();
		expect(Buffer.byteLength(current!, "utf-8")).toBeLessThanOrEqual(WORKING_MEMORY_MAX_BYTES);
		expect(current).toContain("Goal: preserve this header");
		expect(current).toContain("Residual risk: preserve this latest tail");
		expect(current).toContain("older working-memory content omitted");
	});

	it("serializes concurrent appends and isolates sessions", async () => {
		await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				execute("concurrent", { action: "error", content: `Error ${index}` }),
			),
		);
		await execute("other", { action: "checkpoint", content: "Other session" });

		const concurrent = readFileSync(join(cwd, ".temp", "concurrent_log.md"), "utf-8");
		const other = readFileSync(join(cwd, ".temp", "other_log.md"), "utf-8");
		expect(concurrent.match(/\] Error/g)).toHaveLength(12);
		for (let index = 0; index < 12; index++) expect(concurrent).toContain(`Error ${index}`);
		expect(concurrent).not.toContain("Other session");
		expect(other).toContain("Other session");
	});

	it("honors cancellation before reading or writing", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			execute("cancelled", { action: "checkpoint", content: "must not write" }, controller.signal),
		).rejects.toThrow("Operation aborted");
		expect(() => readFileSync(join(cwd, ".temp", "cancelled_log.md"), "utf-8")).toThrow();
	});

	it("reads an existing old-format file through the tool", async () => {
		mkdirSync(join(cwd, ".temp"), { recursive: true });
		writeFileSync(
			join(cwd, ".temp", "legacy_log.md"),
			"## [2026-01-01 09:00] Task summary\nRecovered old task\n",
		);

		expect(textOutput(await execute("legacy", { action: "read" }))).toContain("Recovered old task");
	});
});
