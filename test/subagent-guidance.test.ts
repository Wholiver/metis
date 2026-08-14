import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { SUBAGENT_COORDINATION_GUIDANCE, createSubagentToolDefinition } from "../src/core/tools/subagent.ts";

describe("subagent coordination guidance", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		spawnMock.mockReset();
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("batches launches, pauses the current run, and resumes once per result", () => {
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("issue all of those subagent tool calls consecutively");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("do not place reasoning text, status text, or any other tool call between");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("current Agent run pauses");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("in completion order");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("brief user-visible update");
		expect(SUBAGENT_COORDINATION_GUIDANCE).toContain("releases the current pause even when other subagents are still running");
	});

	it("marks a started Subagent result as terminating", async () => {
		const child = {
			on: vi.fn(),
			unref: vi.fn(),
		};
		child.on.mockReturnValue(child);
		spawnMock.mockReturnValue(child);
		const tempDir = mkdtempSync(join(tmpdir(), "metis-subagent-guidance-"));
		tempDirs.push(tempDir);
		const definition = createSubagentToolDefinition(tempDir);

		const result = await definition.execute(
			"tool-call-abc123",
			{ title: "Test", task: "Do work" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);

		expect(definition.executionMode).toBe("sequential");
		expect(result.terminate).toBe(true);
		expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("end the turn") });
	});

	it("reports a start failure once and releases running status", async () => {
		const callbacks = new Map<string, (...args: any[]) => unknown>();
		const child = {
			on: vi.fn((event: string, callback: (...args: any[]) => unknown) => {
				callbacks.set(event, callback);
				return child;
			}),
			unref: vi.fn(),
		};
		spawnMock.mockReturnValue(child);
		const tempDir = mkdtempSync(join(tmpdir(), "metis-subagent-guidance-"));
		tempDirs.push(tempDir);
		const statuses: Array<[string, boolean]> = [];
		const messages: Array<[string, string]> = [];
		const definition = createSubagentToolDefinition(tempDir, {
			onStatusChange: (jobId, running) => statuses.push([jobId, running]),
			sendMessage: (jobId, message) => messages.push([jobId, message]),
		});

		await definition.execute(
			"tool-call-abc123",
			{ title: "Test", task: "Do work" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);
		callbacks.get("error")?.(new Error("boom"));
		await callbacks.get("close")?.();

		expect(statuses).toEqual([["abc123", true], ["abc123", false]]);
		expect(messages).toEqual([["abc123", "(Subagent failed to start: boom)"]]);
	});

	it.each([
		{ name: "empty output", removeOutput: false, expected: "(No output returned)" },
		{ name: "unreadable output", removeOutput: true, expected: "(Error reading output file)" },
	])("reports $name after a fast completion", async ({ removeOutput, expected }) => {
		const callbacks = new Map<string, (...args: any[]) => unknown>();
		const child = {
			on: vi.fn((event: string, callback: (...args: any[]) => unknown) => {
				callbacks.set(event, callback);
				return child;
			}),
			unref: vi.fn(),
		};
		spawnMock.mockReturnValue(child);
		const tempDir = mkdtempSync(join(tmpdir(), "metis-subagent-guidance-"));
		tempDirs.push(tempDir);
		const messages: Array<[string, string]> = [];
		const definition = createSubagentToolDefinition(tempDir, {
			sendMessage: (jobId, message) => messages.push([jobId, message]),
		});

		await definition.execute(
			"tool-call-abc123",
			{ title: "Test", task: "Do work" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);
		if (removeOutput) unlinkSync(join(tempDir, ".metis-subagent-abc123.log"));
		await callbacks.get("close")?.();

		expect(messages).toEqual([["abc123", expected]]);
	});
});
