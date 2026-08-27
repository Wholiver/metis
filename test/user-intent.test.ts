import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendUserIntent, getUserIntentPath } from "../src/core/user-intent.ts";

describe("session user intent storage", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	it("appends timestamped prompts and isolates sessions", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "metis-user-intent-"));

		await appendUserIntent(tempDir, "session-a", "first request");
		await appendUserIntent(tempDir, "session-a", "replacement request\nwith a second line");
		await appendUserIntent(tempDir, "session-b", "other request");

		const sessionA = readFileSync(getUserIntentPath(tempDir, "session-a"), "utf-8");
		expect(sessionA).toMatch(/^## \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] User intent/m);
		expect(sessionA).toContain("first request");
		expect(sessionA).toContain("replacement request\nwith a second line");
		expect(readFileSync(getUserIntentPath(tempDir, "session-b"), "utf-8")).toContain("other request");
	});

	it("migrates a legacy single-prompt file before appending", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "metis-user-intent-"));
		const path = getUserIntentPath(tempDir, "session-a");
		mkdirSync(join(tempDir, ".temp"), { recursive: true });
		writeFileSync(path, "legacy request");

		await appendUserIntent(tempDir, "session-a", "new request");

		const history = readFileSync(path, "utf-8");
		expect(history.match(/User intent/g)).toHaveLength(2);
		expect(history).toContain("legacy request");
		expect(history).toContain("new request");
	});

	it("serializes concurrent appends", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "metis-user-intent-"));

		await Promise.all([
			appendUserIntent(tempDir, "session-a", "并发需求 A"),
			appendUserIntent(tempDir, "session-a", "并发需求 B"),
		]);

		const history = readFileSync(getUserIntentPath(tempDir, "session-a"), "utf-8");
		expect(history).toContain("并发需求 A");
		expect(history).toContain("并发需求 B");
	});
});

