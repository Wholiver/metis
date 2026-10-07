import { describe, expect, it, vi } from "vitest";
import { createRoutineToolDefinitions, ROUTINE_TOOL_NAMES } from "../src/core/tools/routine.ts";
import type { RoutineHostClient, RoutineHostCommand, RoutineHostResult } from "../src/core/routine-host.ts";

describe("core routine tools", () => {
	it("registers all expected routine tools", () => {
		const mockHost: RoutineHostClient = {
			execute: vi.fn().mockResolvedValue({ ok: true }),
		};

		const tools = createRoutineToolDefinitions({ host: mockHost });
		const toolNames = tools.map((t) => t.name);

		expect(toolNames).toEqual(ROUTINE_TOOL_NAMES);
		expect(toolNames).toContain("routine_list");
		expect(toolNames).toContain("routine_create");
		expect(toolNames).toContain("routine_update");
		expect(toolNames).toContain("routine_delete");
		expect(toolNames).toContain("routine_run_now");
	});

	it("executes routine_list and formats results", async () => {
		const mockHost: RoutineHostClient = {
			execute: vi.fn().mockResolvedValue({
				ok: true,
				routines: [
					{
						id: "r-1",
						title: "Morning Briefing",
						cron: "0 9 * * 1-5",
						prompt: "Review PRs and tasks",
						status: "active",
						createdAt: "2026-10-04T00:00:00.000Z",
						nextRunAt: "2026-10-05T09:00:00.000Z",
					},
				],
			} satisfies RoutineHostResult),
		};

		const tools = createRoutineToolDefinitions({ host: mockHost });
		const listTool = tools.find((t) => t.name === "routine_list")!;

		const result = await listTool.execute("call-1", {});
		expect(mockHost.execute).toHaveBeenCalledWith({ action: "list" }, undefined);
		expect(result.content[0].type).toBe("text");
		expect((result.content[0] as any).text).toContain("Morning Briefing");
		expect((result.content[0] as any).text).toContain("0 9 * * 1-5");
	});

	it("executes routine_create and passes arguments to host", async () => {
		const mockHost: RoutineHostClient = {
			execute: vi.fn().mockResolvedValue({
				ok: true,
				routine: {
					id: "r-new",
					title: "Daily Standup",
					cron: "0 10 * * *",
					prompt: "Check standup notes",
					status: "active",
					createdAt: "2026-10-04T00:00:00.000Z",
				},
			} satisfies RoutineHostResult),
		};

		const tools = createRoutineToolDefinitions({ host: mockHost, defaultProjectPath: "/workspace/fallback" });
		const createTool = tools.find((t) => t.name === "routine_create")!;

		const result = await createTool.execute("call-2", {
			title: "Daily Standup",
			cron: "0 10 * * *",
			prompt: "Check standup notes",
		});

		expect(mockHost.execute).toHaveBeenCalledWith(
			{
				action: "create",
				payload: {
					title: "Daily Standup",
					cron: "0 10 * * *",
					prompt: "Check standup notes",
					projectPath: "/workspace/fallback",
					status: undefined,
				},
			},
			undefined,
		);
		expect((result.content[0] as any).text).toContain("Daily Standup");
	});

	it("executes routine_update and routine_delete", async () => {
		const mockHost: RoutineHostClient = {
			execute: vi.fn().mockImplementation(async (cmd: RoutineHostCommand) => {
				if (cmd.action === "update") {
					return {
						ok: true,
						routine: {
							id: cmd.id,
							title: cmd.patch.title || "Updated",
							cron: "0 9 * * *",
							prompt: "Updated prompt",
							status: cmd.patch.status || "paused",
							createdAt: "2026-10-04T00:00:00.000Z",
						},
					};
				}
				if (cmd.action === "delete") {
					return { ok: true };
				}
				return { ok: false };
			}),
		};

		const tools = createRoutineToolDefinitions({ host: mockHost });
		const updateTool = tools.find((t) => t.name === "routine_update")!;
		const deleteTool = tools.find((t) => t.name === "routine_delete")!;

		const updateRes = await updateTool.execute("call-3", {
			id: "r-1",
			status: "paused",
		});
		expect((updateRes.content[0] as any).text).toContain("PAUSED");

		const deleteRes = await deleteTool.execute("call-4", { id: "r-1" });
		expect((deleteRes.content[0] as any).text).toBe("ok");
	});

	it("executes routine_run_now and handles errors", async () => {
		const mockHost: RoutineHostClient = {
			execute: vi.fn().mockImplementation(async (cmd: RoutineHostCommand) => {
				if (cmd.action === "run_now" && cmd.id === "r-ok") {
					return { ok: true, sessionId: "session-triggered-123" };
				}
				return { ok: false, error: "Routine not found" };
			}),
		};

		const tools = createRoutineToolDefinitions({ host: mockHost });
		const runNowTool = tools.find((t) => t.name === "routine_run_now")!;

		const successRes = await runNowTool.execute("call-5", { id: "r-ok" });
		expect((successRes.content[0] as any).text).toContain("session-triggered-123");

		const errorRes = await runNowTool.execute("call-6", { id: "r-fail" });
		expect((errorRes.content[0] as any).text).toContain("Routine not found");
	});
});
