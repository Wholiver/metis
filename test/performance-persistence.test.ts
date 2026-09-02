import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ interruptNextStateWrite: false }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return {
		...fs,
		writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
			if (fault.interruptNextStateWrite && basename(String(args[0])).startsWith("run.json")) {
				fault.interruptNextStateWrite = false;
				fs.writeFileSync(args[0], '{"schemaVersion":');
				throw new Error("Injected interrupted state write");
			}
			return fs.writeFileSync(...args);
		},
	};
});

import { PerformanceRuntime } from "../src/core/performance-runtime.ts";

const roots: string[] = [];
afterEach(() => {
	fault.interruptNextStateWrite = false;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("keeps the last valid run readable when a state write is interrupted", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-write-"));
	roots.push(agentDir);
	const runtime = new PerformanceRuntime(agentDir);
	const state = runtime.start({ kind: "start", mission: "Inspect scope" });
	const before = readFileSync(join(state.governanceRoot, "run.json"), "utf8");
	fault.interruptNextStateWrite = true;
	expect(() => runtime.reserveSpawn("root", "scoper", "interrupted")).toThrow("Injected interrupted state write");
	expect(readFileSync(join(state.governanceRoot, "run.json"), "utf8")).toBe(before);
	expect(runtime.read(state.runId)).toMatchObject({ status: "active", leases: [] });
	expect(readdirSync(state.governanceRoot).filter((name) => name.startsWith("run.json"))).toEqual(["run.json"]);
	expect(runtime.reserveSpawn("root", "scoper", "retry")).toEqual({ valid: true });
});
