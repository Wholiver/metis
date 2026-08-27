import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tokenTotals = require("../desktop/session-token-totals.cjs") as {
	readSessionTokenActivity: (filePaths: string[]) => Promise<{
		totals: Record<string, number>;
		tokenTotal: number;
		dailyTokens: Record<string, number>;
	}>;
	readSessionTokenTotal: (filePath: string) => Promise<number>;
	readSessionTokenTotals: (filePaths: string[]) => Promise<Record<string, number>>;
};

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "metis-desktop-session-tokens-"));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("desktop-local session token totals", () => {
	it("streams assistant usage from JSONL without counting user usage twice", async () => {
		const sessionPath = join(directory, "session.jsonl");
		const firstDay = new Date(2026, 7, 1, 12).toISOString();
		const secondDay = new Date(2026, 7, 2, 12).toISOString();
		await writeFile(sessionPath, [
			JSON.stringify({ type: "session", id: "session" }),
			JSON.stringify({ type: "message", message: { role: "user", usage: { totalTokens: 999 } } }),
			JSON.stringify({ type: "message", timestamp: firstDay, message: { role: "assistant", usage: { totalTokens: 120, input: 80, output: 40 } } }),
			"not-json",
			JSON.stringify({ type: "message", timestamp: secondDay, message: { role: "assistant", usage: { input: 40, output: 10, cacheRead: 5, cacheWrite: 2 } } }),
		].join("\n"), "utf8");

		expect(await tokenTotals.readSessionTokenTotal(sessionPath)).toBe(177);
		expect(await tokenTotals.readSessionTokenTotals([sessionPath, sessionPath])).toEqual({ [sessionPath]: 177 });
		expect(await tokenTotals.readSessionTokenActivity([sessionPath, sessionPath])).toEqual({
			totals: { [sessionPath]: 177 },
			tokenTotal: 177,
			dailyTokens: { "2026-08-01": 120, "2026-08-02": 57 },
		});
	});

	it("rejects non-absolute and non-JSONL paths", async () => {
		expect(await tokenTotals.readSessionTokenTotal("relative.jsonl")).toBe(0);
		expect(await tokenTotals.readSessionTokenTotal(resolve(directory, "session.txt"))).toBe(0);
	});

	it("keeps token collection in Desktop IPC instead of Server or Agent code", () => {
		const main = require("node:fs").readFileSync(resolve(process.cwd(), "desktop/main.cjs"), "utf8");
		const preload = require("node:fs").readFileSync(resolve(process.cwd(), "desktop/preload.cjs"), "utf8");
		const build = require("node:fs").readFileSync(resolve(process.cwd(), "desktop/scripts/build.mjs"), "utf8");
		expect(main).toContain('ipcMain.handle("session-tokens:totals"');
		expect(main).toContain('ipcMain.handle("session-tokens:activity"');
		expect(preload).toContain('ipcRenderer.invoke("session-tokens:totals", sessionPaths)');
		expect(preload).toContain('ipcRenderer.invoke("session-tokens:activity", sessionPaths)');
		expect(build).toContain('"session-token-totals.cjs"');
	});
});

