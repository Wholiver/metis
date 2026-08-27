import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectContextFiles } from "../src/core/resource-loader.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AGENTS discovery", () => {
	it("uses project-root scope and gives AGENTS.override.md precedence", () => {
		const root = mkdtempSync(join(tmpdir(), "metis-agents-"));
		roots.push(root);
		const nested = join(root, "packages", "app");
		mkdirSync(join(root, ".git"));
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(root, "AGENTS.md"), "root instructions");
		writeFileSync(join(nested, "AGENTS.md"), "ignored nested instructions");
		writeFileSync(join(nested, "AGENTS.override.md"), "nested override");
		writeFileSync(join(root, "outside.md"), "not instructions");

		const files = loadProjectContextFiles({ cwd: nested, agentDir: join(root, ".agent") });
		expect(files.map((file) => file.content)).toEqual(["root instructions", "nested override"]);
	});
});

