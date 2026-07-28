const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, session, shell, utilityProcess } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const MAX_TREE_ITEMS = 600;
const MAX_DIFF_BYTES = 300_000;
const IGNORED_DIRECTORIES = new Set([".git", ".codegraph", ".sessions", "node_modules", "dist", "coverage"]);

let mainWindow;
let isDefaultWorkspaceProjectRepo = false;
let workspaceRoot = findDefaultWorkspace();
let metisServer = { baseUrl: "http://127.0.0.1:4096", username: "metis", password: "" };
let metisEventController;
let autoServerProcess;
let appIsQuitting = false;

function createAppIcon() {
	const svgPath = path.join(__dirname, "renderer", "assets", "metis-pixel-mark.svg");
	const svg = fs.readFileSync(svgPath, "utf8");
	return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function findMetisCli() {
	const candidates = [
		path.join(process.resourcesPath, "metis-runtime", "dist", "cli.js"),
		path.resolve(__dirname, "../dist/cli.js"),
		path.resolve(__dirname, "../../dist/cli.js"),
	];
	return candidates.find((candidate) => fs.existsSync(candidate));
}

async function isLocalServerHealthy() {
	try {
		const response = await fetch("http://127.0.0.1:4096/global/health", { signal: AbortSignal.timeout(500) });
		if (!response.ok) return false;
		const data = await response.json();
		return data?.healthy === true;
	} catch {
		return false;
	}
}

async function ensureLocalMetisServer() {
	if (process.env.METIS_DESKTOP_NO_AUTO_SERVER || (await isLocalServerHealthy())) return;
	const cliPath = findMetisCli();
	if (!cliPath) {
		console.error("[desktop] Metis CLI not found in app resources or repository build output.");
		return;
	}
	let lastStderr = "";
	const defaultPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
	const envPath = process.env.PATH ? `${process.env.PATH}:${defaultPath}` : defaultPath;
	autoServerProcess = utilityProcess.fork(cliPath, ["server", "--hostname", "127.0.0.1", "--port", "4096"], {
		cwd: workspaceRoot,
		env: { ...process.env, PATH: envPath },
		stdio: ["ignore", "pipe", "pipe"],
		serviceName: "Metis Server",
	});
	autoServerProcess.stdout?.on("data", (chunk) => process.stdout.write("[server] " + chunk));
	autoServerProcess.stderr?.on("data", (chunk) => {
		const str = chunk.toString();
		if (str.trim()) lastStderr = str.trim();
		process.stderr.write("[server] " + str);
	});
	autoServerProcess.once("exit", (code) => {
		autoServerProcess = undefined;
		if (!appIsQuitting) {
			const detail = lastStderr ? `: ${lastStderr}` : "";
			console.error("[desktop] Auto-started Server exited (" + code + ")" + detail);
			mainWindow?.webContents.send("metis:disconnected", `本地 Server 已停止 (${code})${detail}`);
		}
	});
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (await isLocalServerHealthy()) return;
		if (!autoServerProcess) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	console.error("[desktop] Timed out waiting for local Metis Server.");
}

function stopAutoServer() {
	if (!autoServerProcess) return;
	const serverProcess = autoServerProcess;
	autoServerProcess = undefined;
	const serverPid = serverProcess.pid;
	serverProcess.kill();
	if (serverPid) {
		try {
			process.kill(serverPid, "SIGTERM");
		} catch (error) {
			if (error?.code !== "ESRCH") console.error("[desktop] Failed to stop local Server:", error);
		}
	}
}

function createWindow() {
	const icon = createAppIcon();
	const isMac = process.platform === "darwin";
	mainWindow = new BrowserWindow({
		width: 1540,
		height: 960,
		minWidth: 1040,
		minHeight: 700,
		show: false,
		backgroundColor: "#edf1f2",
		transparent: false,
		roundedCorners: true,
		vibrancy: isMac ? "sidebar" : undefined,
		visualEffectState: isMac ? "active" : undefined,
		title: "Metis",
		icon,
		titleBarStyle: isMac ? "hiddenInset" : "hidden",
		trafficLightPosition: { x: 18, y: 18 },
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: true,
			sandbox: false,
		},
	});

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
	mainWindow.once("ready-to-show", () => {
		mainWindow.show();
		if (process.env.METIS_DESKTOP_CAPTURE) {
			setTimeout(async () => {
				if (process.env.METIS_DESKTOP_CAPTURE_SETTINGS) {
					await mainWindow.webContents.executeJavaScript(
						"typeof openSettings === 'function' ? openSettings() : document.querySelector('#sidebarSettingsButton')?.click()",
					);
					await new Promise((resolve) => setTimeout(resolve, 300));
					if (process.env.METIS_DESKTOP_CAPTURE_SETTINGS_PANEL) {
						await mainWindow.webContents.executeJavaScript(
							`(() => {
								const name = ${JSON.stringify(process.env.METIS_DESKTOP_CAPTURE_SETTINGS_PANEL)};
								document.querySelector('[data-settings-panel="' + name + '"]')?.click();
							})()`,
						);
						await new Promise((resolve) => setTimeout(resolve, 220));
					}
				}
				if (process.env.METIS_DESKTOP_CAPTURE_SIDEBAR_COLLAPSED) {
					await mainWindow.webContents.executeJavaScript("document.querySelector('#sidebarToggle').click()");
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
				const captureServer = process.env.METIS_DESKTOP_CAPTURE_SERVER;
				if (captureServer) {
					await mainWindow.webContents.executeJavaScript(`
						document.querySelector('#serverUrlInput').value = ${JSON.stringify(captureServer)};
						document.querySelector('#connectServerButton').click();
					`);
					await new Promise((resolve) => setTimeout(resolve, 1_200));
				}
				const captureTab = process.env.METIS_DESKTOP_CAPTURE_TAB;
				if (captureTab) {
					await mainWindow.webContents.executeJavaScript(
						`document.querySelector('[data-open-inspector="${captureTab}"]')?.click()`,
					);
					await new Promise((resolve) => setTimeout(resolve, 900));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_MODEL_MENU) {
					await mainWindow.webContents.executeJavaScript("document.querySelector('#modelTrigger')?.click()");
					await new Promise((resolve) => setTimeout(resolve, 220));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_ADVANCED_MENU) {
					await mainWindow.webContents.executeJavaScript(`
						state.session = { ...state.session, supportsThinking: true, thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"], thinkingLevel: "high" };
						updateModelSelect();
						document.querySelector('#modelTrigger')?.click();
						document.querySelector('#advancedEntry')?.click();
					`);
					await new Promise((resolve) => setTimeout(resolve, 220));
				}
				const image = await mainWindow.webContents.capturePage();
				await fsp.writeFile(process.env.METIS_DESKTOP_CAPTURE, image.toPNG());
				app.quit();
			}, 1800);
		}
	});
	if (process.env.METIS_DESKTOP_CAPTURE) {
		mainWindow.webContents.on("console-message", (event) => {
			console.error(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
		});
	}
	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith("file:")) event.preventDefault();
	});
	mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
		delete webPreferences.preload;
		webPreferences.nodeIntegration = false;
		webPreferences.contextIsolation = true;
		webPreferences.sandbox = true;
		if (!isHttpUrl(params.src)) event.preventDefault();
	});
	mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
		guest.setWindowOpenHandler(({ url }) => {
			if (isHttpUrl(url)) void shell.openExternal(url);
			return { action: "deny" };
		});
	});
	mainWindow.on("closed", () => {
		metisEventController?.abort();
		mainWindow = undefined;
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (isHttpUrl(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
}

app.whenReady().then(() => {
	if (process.platform === "darwin") app.dock?.setIcon(createAppIcon());
	const browserSession = session.fromPartition("persist:metis-browser");
	browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
	registerIpc();
	createWindow();
	void ensureLocalMetisServer();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	appIsQuitting = true;
	metisEventController?.abort();
	stopAutoServer();
});

function registerIpc() {
	ipcMain.handle("app:info", () => ({
		name: app.getName(),
		version: app.getVersion(),
		platform: process.platform,
	}));
	ipcMain.handle("app:quit", () => app.quit());
	ipcMain.handle("clipboard:write-text", (_event, text) => clipboard.writeText(String(text ?? "")));
	ipcMain.handle("session-file:open", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			properties: ["openFile"],
			filters: [{ name: "Metis Session", extensions: ["jsonl"] }],
		});
		return result.canceled ? undefined : result.filePaths[0];
	});
	ipcMain.handle("session-file:save", async (_event, format) => {
		const extension = format === "jsonl" ? "jsonl" : "html";
		const result = await dialog.showSaveDialog(mainWindow, {
			defaultPath: `metis-session.${extension}`,
			filters: [{ name: format === "jsonl" ? "Metis Session" : "HTML", extensions: [extension] }],
		});
		return result.canceled ? undefined : result.filePath;
	});

	ipcMain.handle("workspace:get", () => workspaceSummary());
	ipcMain.handle("workspace:set", (_event, workspacePath) => setWorkspaceRoot(workspacePath));
	ipcMain.handle("workspace:select", async () => {
		const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
		if (result.canceled || result.filePaths.length === 0) return undefined;
		return setWorkspaceRoot(result.filePaths[0]);
	});
	ipcMain.handle("workspace:tree", () => readWorkspaceTree());
	ipcMain.handle("workspace:diff", (_event, relativePath) => readGitDiff(relativePath));
	ipcMain.handle("workspace:reveal", async (_event, relativePath) => {
		const absolutePath = resolveWorkspacePath(relativePath);
		shell.showItemInFolder(absolutePath);
	});
	ipcMain.handle("provider-config:save-custom", (_event, config) => saveCustomProviderConfig(config));

	ipcMain.handle("external:open", (_event, url) => {
		if (!isHttpUrl(url)) throw new Error("Only http and https URLs are allowed");
		return shell.openExternal(url);
	});

	ipcMain.handle("metis:connect", async (_event, options = {}) => {
		const baseUrl = normalizeServerUrl(options.baseUrl || metisServer.baseUrl);
		metisServer = {
			baseUrl,
			username: String(options.username || "metis"),
			password: String(options.password || ""),
		};
		const health = await metisRequest("/global/health");
		if (health.ok) void streamMetisEvents();
		return health;
	});
	ipcMain.handle("metis:disconnect", () => {
		metisEventController?.abort();
		return true;
	});
	ipcMain.handle("metis:request", (_event, request) =>
		metisRequest(request.path, { method: request.method, body: request.body }),
	);
}

async function saveCustomProviderConfig(config = {}) {
	const name = String(config.name || "").trim();
	const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
	const apiKey = String(config.apiKey || "").trim();
	if (!name) throw new Error("Provider name is required");
	if (!apiKey) throw new Error("API Key is required");
	let parsedUrl;
	try {
		parsedUrl = new URL(baseUrl);
	} catch {
		throw new Error("Base URL must be a valid http or https URL");
	}
	if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Base URL must use http or https");

	const modelIds = await fetchCustomProviderModels(baseUrl, apiKey);
	const configuredAgentDir = process.env.METIS_CODING_AGENT_DIR;
	const agentDir = configuredAgentDir?.startsWith("~/")
		? path.join(app.getPath("home"), configuredAgentDir.slice(2))
		: configuredAgentDir || path.join(app.getPath("home"), ".metis", "agent");
	const modelsPath = path.join(agentDir, "models.json");
	let modelsConfig = { providers: {} };
	if (fs.existsSync(modelsPath)) {
		const source = await fsp.readFile(modelsPath, "utf8");
		try {
			modelsConfig = JSON.parse(stripJsonComments(source));
		} catch (error) {
			throw new Error(`Unable to parse existing models.json: ${error.message}`);
		}
	}
	if (!modelsConfig || typeof modelsConfig !== "object" || Array.isArray(modelsConfig)) modelsConfig = { providers: {} };
	if (!modelsConfig.providers || typeof modelsConfig.providers !== "object" || Array.isArray(modelsConfig.providers)) modelsConfig.providers = {};
	const existing = modelsConfig.providers.other && typeof modelsConfig.providers.other === "object"
		? modelsConfig.providers.other
		: {};
	modelsConfig.providers.other = {
		...existing,
		name,
		baseUrl,
		api: existing.api || "openai-completions",
		models: (modelIds.length ? modelIds : ["default"]).map((id) => ({ id })),
	};

	await fsp.mkdir(agentDir, { recursive: true });
	const temporaryPath = `${modelsPath}.${process.pid}.tmp`;
	await fsp.writeFile(temporaryPath, `${JSON.stringify(modelsConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await fsp.rename(temporaryPath, modelsPath);
	return { provider: "other", name, baseUrl, modelCount: modelIds.length, modelsPath };
}

async function fetchCustomProviderModels(baseUrl, apiKey) {
	const urls = baseUrl.endsWith("/v1") ? [`${baseUrl}/models`] : [`${baseUrl}/v1/models`, `${baseUrl}/models`];
	for (const url of urls) {
		try {
			const response = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "metis-desktop" },
			signal: AbortSignal.timeout(5_000),
			});
			if (!response.ok) continue;
			const data = await response.json();
			const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
			return [...new Set(items.map((item) => typeof item === "string" ? item : item?.id).filter((id) => typeof id === "string" && id.trim()))];
		} catch {}
	}
	return [];
}

function stripJsonComments(input) {
	return input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => match[0] === '"' ? match : "")
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail) => tail ?? (match[0] === '"' ? match : ""));
}

function workspaceSummary() {
	return {
		name: path.basename(workspaceRoot),
		path: workspaceRoot,
		isProjectRepo: isDefaultWorkspaceProjectRepo,
	};
}

function setWorkspaceRoot(workspacePath) {
	if (typeof workspacePath !== "string" || !workspacePath.trim()) throw new Error("Invalid workspace path");
	const resolved = path.resolve(workspacePath);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
		throw new Error(`Workspace directory does not exist: ${resolved}`);
	}
	workspaceRoot = resolved;
	isDefaultWorkspaceProjectRepo = true;
	return workspaceSummary();
}

function findDefaultWorkspace() {
	for (const candidate of [path.resolve(__dirname, ".."), path.resolve(__dirname, "../.."), process.cwd()]) {
		if (fs.existsSync(path.join(candidate, "src", "modes")) && fs.existsSync(path.join(candidate, "package.json"))) {
			isDefaultWorkspaceProjectRepo = true;
			return candidate;
		}
	}
	isDefaultWorkspaceProjectRepo = false;
	const cwd = process.cwd();
	if (cwd && cwd !== "/" && fs.existsSync(cwd)) {
		return cwd;
	}
	try {
		return app.getPath("documents");
	} catch {
		try {
			return app.getPath("home");
		} catch {
			return require("node:os").homedir();
		}
	}
}

async function readWorkspaceTree() {
	let count = 0;

	async function walk(directory, depth) {
		if (depth > 4 || count >= MAX_TREE_ITEMS) return [];
		const entries = await fsp.readdir(directory, { withFileTypes: true });
		entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
		const nodes = [];
		for (const entry of entries) {
			if (count >= MAX_TREE_ITEMS || entry.name === ".DS_Store") break;
			if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
			if (entry.isSymbolicLink()) continue;
			const absolutePath = path.join(directory, entry.name);
			const relativePath = path.relative(workspaceRoot, absolutePath);
			count += 1;
			if (entry.isDirectory()) {
				nodes.push({ name: entry.name, path: relativePath, type: "directory", children: await walk(absolutePath, depth + 1) });
			} else {
				nodes.push({ name: entry.name, path: relativePath, type: "file" });
			}
		}
		return nodes;
	}

	return { root: workspaceSummary(), nodes: await walk(workspaceRoot, 0), truncated: count >= MAX_TREE_ITEMS };
}

async function readGitDiff(relativePath) {
	const absolutePath = resolveWorkspacePath(relativePath);
	const stat = await fsp.stat(absolutePath);
	if (!stat.isFile()) throw new Error("Diff target must be a file");
	const normalized = path.relative(workspaceRoot, absolutePath);
	let diff = "";
	let isUntracked = false;
	try {
		const status = await execFileAsync("git", ["status", "--porcelain", "--", normalized], {
			cwd: workspaceRoot,
			maxBuffer: 16_384,
		});
		isUntracked = status.stdout.startsWith("??");
		const result = await execFileAsync("git", ["diff", "--no-ext-diff", "--unified=4", "--", normalized], {
			cwd: workspaceRoot,
			maxBuffer: MAX_DIFF_BYTES,
		});
		diff = result.stdout;
		if (!diff) {
			const staged = await execFileAsync("git", ["diff", "--cached", "--no-ext-diff", "--unified=4", "--", normalized], {
				cwd: workspaceRoot,
				maxBuffer: MAX_DIFF_BYTES,
			});
			diff = staged.stdout;
		}
	} catch (error) {
		if (error.code === "ENOENT") throw new Error("Git is not installed");
		diff = error.stdout || "";
	}
	if (!diff) {
		const source = await fsp.readFile(absolutePath, "utf8");
		const sourceLines = source.split(/\r?\n/).slice(0, 500);
		const body = sourceLines
			.map((line) => `${isUntracked ? "+" : " "}${line}`)
			.join("\n");
		diff = isUntracked
			? `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\n--- /dev/null\n+++ b/${normalized}\n@@ -0,0 +1,${sourceLines.length} @@\n${body}`
			: body;
	}
	return { path: normalized, diff: diff.slice(0, MAX_DIFF_BYTES), truncated: diff.length > MAX_DIFF_BYTES };
}

function resolveWorkspacePath(relativePath) {
	if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) throw new Error("Invalid workspace path");
	const absolutePath = path.resolve(workspaceRoot, relativePath);
	const relative = path.relative(workspaceRoot, absolutePath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes workspace");
	return absolutePath;
}

async function metisRequest(requestPath, init = {}) {
	if (typeof requestPath !== "string" || !requestPath.startsWith("/") || requestPath.startsWith("//")) {
		throw new Error("Invalid Metis API path");
	}
	const method = String(init.method || "GET").toUpperCase();
	if (!["GET", "POST", "PUT"].includes(method)) throw new Error("Unsupported Metis API method");
	const headers = { Accept: "application/json" };
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	if (metisServer.password) {
		headers.Authorization = `Basic ${Buffer.from(`${metisServer.username}:${metisServer.password}`).toString("base64")}`;
	}
	try {
		const response = await fetch(`${metisServer.baseUrl}${requestPath}`, {
			method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(15_000),
		});
		const text = await response.text();
		let data;
		try {
			data = text ? JSON.parse(text) : undefined;
		} catch {
			data = text;
		}
		return { ok: response.ok, status: response.status, data };
	} catch (error) {
		return { ok: false, status: 0, error: error.message };
	}
}

async function streamMetisEvents() {
	metisEventController?.abort();
	const controller = new AbortController();
	metisEventController = controller;
	const headers = { Accept: "text/event-stream" };
	if (metisServer.password) {
		headers.Authorization = `Basic ${Buffer.from(`${metisServer.username}:${metisServer.password}`).toString("base64")}`;
	}
	let retryDelay = 250;
	while (!controller.signal.aborted) {
		try {
			const response = await fetch(`${metisServer.baseUrl}/event`, { headers, signal: controller.signal });
			if (!response.ok || !response.body) throw new Error(`SSE failed: HTTP ${response.status}`);
			retryDelay = 250;
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			while (!controller.signal.aborted) {
				const { done, value } = await reader.read();
				if (done) throw new Error("SSE connection closed");
				buffer += decoder.decode(value, { stream: true });
				let boundary;
				while ((boundary = buffer.indexOf("\n\n")) !== -1) {
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = frame
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n");
					if (!data) continue;
					try {
						mainWindow?.webContents.send("metis:event", JSON.parse(data));
					} catch {}
				}
			}
		} catch (error) {
			if (controller.signal.aborted) break;
			mainWindow?.webContents.send("metis:disconnected", error.message);
		}
		await waitForAbortableDelay(retryDelay, controller.signal);
		retryDelay = Math.min(retryDelay * 2, 5_000);
	}
}

function waitForAbortableDelay(delay, signal) {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, delay);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

function normalizeServerUrl(value) {
	const url = new URL(String(value));
	if (!isHttpUrl(url.href)) throw new Error("Metis Server URL must use http or https");
	return url.href.replace(/\/$/, "");
}

function isHttpUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
