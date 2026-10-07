/**
 * Desktop Routine host: localhost HTTP control plane and Cron scheduler
 * for Metis Desktop and Server routine_* tools.
 */

const http = require("node:http");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { isValidCron, matchesCron, getNextRunTime } = require("./cron-utils.cjs");

function defaultStoragePath() {
	return path.join(os.homedir(), ".metis", "routines.json");
}

function ensureDirSync(dirPath) {
	try {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}
	} catch {}
}

function loadRoutinesFromDisk(storagePath) {
	try {
		if (!fs.existsSync(storagePath)) return [];
		const raw = fs.readFileSync(storagePath, "utf8");
		const data = JSON.parse(raw);
		return Array.isArray(data) ? data : [];
	} catch {
		return [];
	}
}

function saveRoutinesToDisk(storagePath, routines) {
	try {
		ensureDirSync(path.dirname(storagePath));
		const tempPath = `${storagePath}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
		fs.writeFileSync(tempPath, JSON.stringify(routines, null, 2), "utf8");
		fs.renameSync(tempPath, storagePath);
	} catch (error) {
		console.error("[desktop-routine-host] Failed to save routines:", error);
	}
}

function createRoutineHostController(options = {}) {
	const storagePath = options.storagePath || defaultStoragePath();
	const token = options.token || randomBytes(16).toString("hex");
	const checkIntervalMs = options.checkIntervalMs || 15000;
	const getServerBaseUrl = typeof options.getServerBaseUrl === "function"
		? options.getServerBaseUrl
		: () => (typeof options.serverBaseUrl === "string" ? options.serverBaseUrl : "");
	const onRoutineUpdated = typeof options.onRoutineUpdated === "function" ? options.onRoutineUpdated : null;

	let server = null;
	let baseUrl = "";
	let tickerTimer = null;
	let routines = loadRoutinesFromDisk(storagePath);
	// Track the minute when a routine was last triggered by cron to avoid duplicate firings in the same minute
	const lastTriggeredMinutes = new Map();

	function notifyUpdate(routine) {
		if (onRoutineUpdated) {
			try {
				onRoutineUpdated(routine, [...routines]);
			} catch (err) {
				console.error("[desktop-routine-host] notifyUpdate error:", err);
			}
		}
	}

	function refreshNextRunTimes() {
		const now = new Date();
		for (const r of routines) {
			if (r.status === "active" && isValidCron(r.cron)) {
				const next = getNextRunTime(r.cron, now);
				r.nextRunAt = next ? next.toISOString() : undefined;
			} else {
				r.nextRunAt = undefined;
			}
		}
	}

	function list() {
		refreshNextRunTimes();
		return [...routines];
	}

	function create(payload = {}) {
		const title = String(payload.title || "").trim();
		const cron = String(payload.cron || "").trim();
		const prompt = String(payload.prompt || "").trim();
		const projectPath = typeof payload.projectPath === "string" ? payload.projectPath.trim() : "";

		if (!title) return { ok: false, error: "Title is required" };
		if (!cron || !isValidCron(cron)) return { ok: false, error: `Invalid cron expression: "${cron}"` };
		if (!prompt) return { ok: false, error: "Prompt is required" };

		const id = `routine-${Date.now()}-${randomBytes(3).toString("hex")}`;
		const next = getNextRunTime(cron, new Date());

		const routine = {
			id,
			title,
			cron,
			prompt,
			projectPath,
			status: payload.status === "paused" ? "paused" : "active",
			source: payload.source === "self_learning" ? "self_learning" : (payload.source || "manual"),
			createdAt: new Date().toISOString(),
			nextRunAt: next ? next.toISOString() : undefined,
		};

		routines.push(routine);
		saveRoutinesToDisk(storagePath, routines);
		notifyUpdate(routine);
		return { ok: true, routine };
	}

	function update(id, patch = {}) {
		const routine = routines.find((r) => r.id === id);
		if (!routine) return { ok: false, error: `Routine not found: ${id}` };

		if (patch.title !== undefined) {
			const t = String(patch.title).trim();
			if (!t) return { ok: false, error: "Title cannot be empty" };
			routine.title = t;
		}

		if (patch.cron !== undefined) {
			const c = String(patch.cron).trim();
			if (!isValidCron(c)) return { ok: false, error: `Invalid cron expression: "${c}"` };
			routine.cron = c;
		}

		if (patch.prompt !== undefined) {
			const p = String(patch.prompt).trim();
			if (!p) return { ok: false, error: "Prompt cannot be empty" };
			routine.prompt = p;
		}

		if (patch.projectPath !== undefined) {
			routine.projectPath = String(patch.projectPath).trim();
		}

		if (patch.status !== undefined) {
			if (patch.status === "active" || patch.status === "paused") {
				routine.status = patch.status;
			}
		}

		if (patch.source !== undefined) {
			routine.source = patch.source;
		}

		refreshNextRunTimes();
		saveRoutinesToDisk(storagePath, routines);
		notifyUpdate(routine);
		return { ok: true, routine };
	}

	function remove(id) {
		const index = routines.findIndex((r) => r.id === id);
		if (index === -1) return { ok: false, error: `Routine not found: ${id}` };
		const [deleted] = routines.splice(index, 1);
		lastTriggeredMinutes.delete(id);
		saveRoutinesToDisk(storagePath, routines);
		notifyUpdate(deleted);
		return { ok: true, routine: deleted };
	}

	async function executeRoutine(routine) {
		const serverUrl = getServerBaseUrl();
		if (!serverUrl) {
			routine.lastStatus = "failed";
			routine.lastError = "Metis Server is not running";
			saveRoutinesToDisk(storagePath, routines);
			notifyUpdate(routine);
			return { ok: false, error: routine.lastError };
		}

		routine.lastStatus = "running";
		routine.lastError = undefined;
		saveRoutinesToDisk(storagePath, routines);
		notifyUpdate(routine);

		try {
			// 1. Create a new session on Metis server
			const newSessionRes = await fetch(`${serverUrl}/session/new`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-metis-desktop": "true",
				},
				body: JSON.stringify({
					cwd: routine.projectPath || undefined,
					collaborationMode: "build",
				}),
			});

			if (!newSessionRes.ok) {
				const errBody = await newSessionRes.text();
				throw new Error(`Failed to create session: ${newSessionRes.status} ${errBody}`);
			}

			const sessionState = await newSessionRes.json();
			const sessionId = sessionState.sessionId || sessionState.id;

			// 2. Submit prompt to the session
			const promptRes = await fetch(`${serverUrl}/session/prompt`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-metis-desktop": "true",
				},
				body: JSON.stringify({
					message: routine.prompt,
				}),
			});

			if (!promptRes.ok) {
				const promptErr = await promptRes.text();
				throw new Error(`Failed to submit prompt: ${promptRes.status} ${promptErr}`);
			}

			routine.lastRunAt = new Date().toISOString();
			routine.lastSessionId = sessionId;
			routine.lastStatus = "success";
			routine.lastError = undefined;
			refreshNextRunTimes();
			saveRoutinesToDisk(storagePath, routines);
			notifyUpdate(routine);
			return { ok: true, sessionId };
		} catch (error) {
			routine.lastRunAt = new Date().toISOString();
			routine.lastStatus = "failed";
			routine.lastError = error instanceof Error ? error.message : String(error);
			refreshNextRunTimes();
			saveRoutinesToDisk(storagePath, routines);
			notifyUpdate(routine);
			return { ok: false, error: routine.lastError };
		}
	}

	async function runNow(id) {
		const routine = routines.find((r) => r.id === id);
		if (!routine) return { ok: false, error: `Routine not found: ${id}` };
		return executeRoutine(routine);
	}

	async function tick() {
		const now = new Date();
		const currentMinute = Math.floor(now.getTime() / 60000);

		for (const r of routines) {
			if (r.status !== "active") continue;
			if (!isValidCron(r.cron)) continue;

			if (matchesCron(r.cron, now)) {
				const lastMinute = lastTriggeredMinutes.get(r.id);
				if (lastMinute === currentMinute) continue;
				lastTriggeredMinutes.set(r.id, currentMinute);
				void executeRoutine(r);
			}
		}
	}

	async function handleCommand(command = {}) {
		if (!command || typeof command.action !== "string") {
			return { ok: false, error: "Action is required" };
		}

		switch (command.action) {
			case "list":
				return { ok: true, routines: list() };
			case "create":
				return create(command.payload || command);
			case "update":
				return update(command.id, command.patch || command);
			case "delete":
				return remove(command.id);
			case "run_now":
				return runNow(command.id);
			default:
				return { ok: false, error: `Unknown action: ${command.action}` };
		}
	}

	function start() {
		if (server) return Promise.resolve({ baseUrl, token });
		return new Promise((resolve, reject) => {
			server = http.createServer(async (req, res) => {
				const respond = (status, body) => {
					const payload = JSON.stringify(body);
					res.writeHead(status, {
						"content-type": "application/json; charset=utf-8",
						"content-length": Buffer.byteLength(payload),
					});
					res.end(payload);
				};

				try {
					if (req.socket.remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
						respond(403, { ok: false, error: "Forbidden" });
						return;
					}
					if (req.method === "GET" && req.url === "/health") {
						respond(200, { ok: true });
						return;
					}
					if (req.method !== "POST" || req.url !== "/routine/command") {
						respond(404, { ok: false, error: "Not found" });
						return;
					}
					const provided = req.headers["x-metis-routine-token"];
					if (provided !== token) {
						respond(401, { ok: false, error: "Unauthorized" });
						return;
					}
					const chunks = [];
					for await (const chunk of req) chunks.push(chunk);
					const raw = Buffer.concat(chunks).toString("utf8");
					let command;
					try {
						command = raw ? JSON.parse(raw) : null;
					} catch {
						respond(400, { ok: false, error: "Invalid JSON" });
						return;
					}
					const result = await handleCommand(command);
					respond(result.ok ? 200 : 400, result);
				} catch (error) {
					respond(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
				}
			});

			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				baseUrl = `http://127.0.0.1:${address.port}`;
				tickerTimer = setInterval(() => {
					void tick();
				}, checkIntervalMs);
				resolve({ baseUrl, token });
			});
			server.on("error", reject);
		});
	}

	function stop() {
		if (tickerTimer) {
			clearInterval(tickerTimer);
			tickerTimer = null;
		}
		if (server) {
			try {
				server.close();
			} catch {}
			server = null;
			baseUrl = "";
		}
	}

	return {
		start,
		stop,
		get token() {
			return token;
		},
		get baseUrl() {
			return baseUrl;
		},
		list,
		create,
		update,
		delete: remove,
		runNow,
		handleCommand,
		tick,
	};
}

module.exports = {
	createRoutineHostController,
	defaultStoragePath,
};
