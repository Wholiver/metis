import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SharedMutatingOwnerRegistry } from "../src/core/workspace-probe.ts";

/**
 * Real child-process integration for Issue 2.
 * Does not mock spawn; uses fixture executables in a shared cwd.
 */
describe("reliable-headless real child workspace integration", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("real child sees untracked input, task paths, venv marker, and writes visible to root", async () => {
		const root = mkdtempSync(join(tmpdir(), "metis-real-child-"));
		tempDirs.push(root);
		mkdirSync(join(root, "input"), { recursive: true });
		mkdirSync(join(root, "output"), { recursive: true });
		mkdirSync(join(root, "software"), { recursive: true });
		mkdirSync(join(root, ".venv", "bin"), { recursive: true });
		writeFileSync(join(root, "input", "problem_spec.md"), "# Spec\n");
		writeFileSync(join(root, "software", "run.sh"), "#!/bin/sh\necho ok\n");
		writeFileSync(join(root, ".venv", "bin", "python"), "#!/bin/sh\necho fake-python\n");
		chmodSync(join(root, ".venv", "bin", "python"), 0o755);
		writeFileSync(join(root, "untracked_seed.txt"), "seed-from-root\n");

		const childScript = join(root, "software", "child_probe.mjs");
		writeFileSync(
			childScript,
			`
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const cwd = process.cwd();
const checks = {
  cwd,
  seesInput: existsSync(join(cwd, "input", "problem_spec.md")),
  seesSoftware: existsSync(join(cwd, "software", "run.sh")),
  seesVenv: existsSync(join(cwd, ".venv", "bin", "python")),
  seesUntracked: existsSync(join(cwd, "untracked_seed.txt")),
  untracked: existsSync(join(cwd, "untracked_seed.txt")) ? readFileSync(join(cwd, "untracked_seed.txt"), "utf8") : null,
};
writeFileSync(join(cwd, "output", "child_result.json"), JSON.stringify(checks, null, 2));
writeFileSync(join(cwd, "output", "from_child.txt"), "written-by-child\\n");
console.log(JSON.stringify(checks));
`,
		);

		const result = await runNode(childScript, root, {
			METIS_TASK_INPUT: join(root, "input"),
			METIS_TASK_OUTPUT: join(root, "output"),
			METIS_TASK_SOFTWARE: join(root, "software"),
			METIS_EXECUTION_PROFILE: "reliable-headless",
			METIS_WORKSPACE_POLICY: "shared",
		});
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.cwd.replace(/^\/private/, "")).toBe(root.replace(/^\/private/, ""));
		expect(payload.seesInput).toBe(true);
		expect(payload.seesSoftware).toBe(true);
		expect(payload.seesVenv).toBe(true);
		expect(payload.seesUntracked).toBe(true);
		expect(existsSync(join(root, "output", "from_child.txt"))).toBe(true);
		expect(readFileSync(join(root, "output", "from_child.txt"), "utf8")).toContain("written-by-child");
		expect(JSON.parse(readFileSync(join(root, "output", "child_result.json"), "utf8")).seesVenv).toBe(true);
	});

	it("mutating owner mutex serializes real children; verifier reads frozen version after release", async () => {
		const root = mkdtempSync(join(tmpdir(), "metis-frozen-"));
		tempDirs.push(root);
		mkdirSync(join(root, "output"), { recursive: true });
		const registry = new SharedMutatingOwnerRegistry();

		const implementer = join(root, "implementer.mjs");
		const verifier = join(root, "verifier.mjs");
		writeFileSync(
			implementer,
			`
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.cwd(), "output", "artifact.txt"), "v1-partial\\n");
await new Promise((r) => setTimeout(r, 80));
writeFileSync(join(process.cwd(), "output", "artifact.txt"), "v2-final\\n");
`,
		);
		writeFileSync(
			verifier,
			`
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const text = readFileSync(join(process.cwd(), "output", "artifact.txt"), "utf8");
writeFileSync(join(process.cwd(), "output", "verifier_seen.txt"), text);
console.log(text.trim());
`,
		);

		expect(registry.claim("impl-1", ["output"])).toBeUndefined();
		expect(registry.claim("impl-2", ["output"])).toMatch(/OVERLAPPING_OWNED_PATHS/);

		const implPromise = runNode(implementer, root);
		// Concurrent claim while implementer owns output must fail.
		expect(registry.claim("verifier-early", ["output"])).toMatch(/OVERLAPPING_OWNED_PATHS/);

		const impl = await implPromise;
		expect(impl.exitCode).toBe(0);
		registry.release("impl-1");

		// After release, verifier may claim and must see frozen final version.
		expect(registry.claim("verifier-1", ["output"])).toBeUndefined();
		const verified = await runNode(verifier, root);
		expect(verified.exitCode).toBe(0);
		expect(verified.stdout.trim()).toBe("v2-final");
		expect(readFileSync(join(root, "output", "verifier_seen.txt"), "utf8").trim()).toBe("v2-final");
		registry.release("verifier-1");
	});
});

function runNode(script: string, cwd: string, env: Record<string, string> = {}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
	return new Promise((resolvePromise) => {
		const child = spawn(process.execPath, [script], {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
	});
}
