import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const { createRoutineHostController } = require("../desktop/routine-host.cjs") as {
	createRoutineHostController: (options?: any) => {
		start: () => Promise<{ baseUrl: string; token: string }>;
		stop: () => void;
		list: () => any[];
		create: (payload: any) => { ok: boolean; routine?: any; error?: string };
		update: (id: string, patch: any) => { ok: boolean; routine?: any; error?: string };
		delete: (id: string) => { ok: boolean; routine?: any; error?: string };
		runNow: (id: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
		handleCommand: (command: any) => Promise<any>;
		tick: () => Promise<void>;
		baseUrl: string;
		token: string;
	};
};

describe("desktop routine host controller", () => {
	let tempDir: string;
	let storagePath: string;
	const controllers: Array<{ stop: () => void }> = [];

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "metis-routine-test-"));
		storagePath = join(tempDir, "routines.json");
	});

	afterEach(() => {
		for (const ctrl of controllers) ctrl.stop();
		controllers.length = 0;
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("creates, updates, lists, and deletes routines in storage", () => {
		const controller = createRoutineHostController({ storagePath });
		controllers.push(controller);

		// Initially empty
		expect(controller.list()).toEqual([]);

		// Create
		const createRes = controller.create({
			title: "Daily Standup",
			cron: "0 9 * * 1-5",
			prompt: "Summarize yesterday's commits",
			projectPath: "/test/project",
		});
		expect(createRes.ok).toBe(true);
		expect(createRes.routine?.id).toBeDefined();
		expect(createRes.routine?.title).toBe("Daily Standup");
		expect(createRes.routine?.status).toBe("active");
		expect(createRes.routine?.nextRunAt).toBeDefined();

		const list = controller.list();
		expect(list.length).toBe(1);
		expect(list[0].id).toBe(createRes.routine.id);

		// Update
		const updateRes = controller.update(createRes.routine.id, {
			status: "paused",
			title: "Paused Standup",
		});
		expect(updateRes.ok).toBe(true);
		expect(updateRes.routine?.status).toBe("paused");
		expect(updateRes.routine?.title).toBe("Paused Standup");

		// Delete
		const deleteRes = controller.delete(createRes.routine.id);
		expect(deleteRes.ok).toBe(true);
		expect(controller.list().length).toBe(0);
	});

	it("persists routines across controller instantiations", () => {
		const ctrl1 = createRoutineHostController({ storagePath });
		controllers.push(ctrl1);
		ctrl1.create({
			title: "Persisted Routine",
			cron: "0 18 * * *",
			prompt: "Wrap up work",
		});

		// Create another controller pointing to the same storage
		const ctrl2 = createRoutineHostController({ storagePath });
		controllers.push(ctrl2);
		const list = ctrl2.list();
		expect(list.length).toBe(1);
		expect(list[0].title).toBe("Persisted Routine");
	});

	it("starts HTTP control plane and responds to authorized commands", async () => {
		const controller = createRoutineHostController({ storagePath });
		controllers.push(controller);

		const { baseUrl, token } = await controller.start();
		expect(baseUrl).toMatch(/^http:\/\/127\.0.0\.1:\d+/);

		// Health check
		const healthRes = await fetch(`${baseUrl}/health`);
		expect(healthRes.status).toBe(200);
		const healthData = await healthRes.json();
		expect(healthData.ok).toBe(true);

		// Unauthorized command without token
		const unauthRes = await fetch(`${baseUrl}/routine/command`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "list" }),
		});
		expect(unauthRes.status).toBe(401);

		// Authorized command with token
		const createRes = await fetch(`${baseUrl}/routine/command`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-metis-routine-token": token,
			},
			body: JSON.stringify({
				action: "create",
				payload: {
					title: "API Created Routine",
					cron: "0 12 * * *",
					prompt: "Lunch reminder",
				},
			}),
		});
		expect(createRes.status).toBe(200);
		const createData = await createRes.json();
		expect(createData.ok).toBe(true);
		expect(createData.routine.title).toBe("API Created Routine");

		// List via HTTP
		const listRes = await fetch(`${baseUrl}/routine/command`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-metis-routine-token": token,
			},
			body: JSON.stringify({ action: "list" }),
		});
		const listData = await listRes.json();
		expect(listData.ok).toBe(true);
		expect(listData.routines.length).toBe(1);
	});

	it("executes routine via runNow by calling mock Server API", async () => {
		let createdSessionPrompt = "";
		let receivedSessionCwd = "";

		// Mock Metis server
		const mockServer = http.createServer((req, res) => {
			if (req.method === "POST" && req.url === "/session/new") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					const parsed = JSON.parse(body || "{}");
					receivedSessionCwd = parsed.cwd;
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ sessionId: "mock-session-123" }));
				});
				return;
			}
			if (req.method === "POST" && req.url === "/session/prompt") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					const parsed = JSON.parse(body || "{}");
					createdSessionPrompt = parsed.message;
					res.writeHead(202, { "content-type": "application/json" });
					res.end(JSON.stringify({ accepted: true }));
				});
				return;
			}
			res.writeHead(404);
			res.end();
		});

		await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", () => resolve()));
		const address = mockServer.address() as any;
		const mockServerUrl = `http://127.0.0.1:${address.port}`;

		try {
			const controller = createRoutineHostController({
				storagePath,
				getServerBaseUrl: () => mockServerUrl,
			});
			controllers.push(controller);

			const { routine } = controller.create({
				title: "Automated Task",
				cron: "0 9 * * *",
				prompt: "Do the task now",
				projectPath: "/workspace/my-app",
			});

			const runRes = await controller.runNow(routine.id);
			expect(runRes.ok).toBe(true);
			expect(runRes.sessionId).toBe("mock-session-123");
			expect(receivedSessionCwd).toBe("/workspace/my-app");
			expect(createdSessionPrompt).toBe("Do the task now");

			const updated = controller.list().find((r) => r.id === routine.id);
			expect(updated.lastStatus).toBe("success");
			expect(updated.lastSessionId).toBe("mock-session-123");
			expect(updated.lastRunAt).toBeDefined();
		} finally {
			mockServer.close();
		}
	});
});
