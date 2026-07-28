import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ImageContent } from "@earendil-works/metis-ai";
import { getProviders } from "@earendil-works/metis-ai/compat";
import { APP_NAME, getShareViewerUrl, VERSION } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import { resolveModelScope } from "../../core/model-resolver.ts";
import { SessionManager } from "../../core/session-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.ts";
import { ProjectTrustStore } from "../../core/trust-manager.ts";
import { isUiLanguage, SUPPORTED_UI_LANGUAGES } from "../../core/ui-language.ts";
import { getChangelogPath } from "../../utils/changelog.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "../rpc/rpc-types.ts";
import { createServerOpenApiDocument } from "./openapi.ts";
import type {
	ServerAddress,
	ServerErrorBody,
	ServerEvent,
	ServerHandle,
	ServerModeOptions,
	ServerPromptRequest,
	ServerSessionState,
} from "./server-types.ts";

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 4096;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const HEARTBEAT_MS = 25_000;

type JsonObject = Record<string, unknown>;

export async function runServerMode(
	runtimeHost: AgentSessionRuntime,
	options: ServerModeOptions = {},
): Promise<void> {
	const handle = await startServerMode(runtimeHost, options);
	console.error(`${APP_NAME} server listening on ${handle.address.url}`);
	console.error(`OpenAPI: ${handle.address.url}/openapi.json`);

	const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
	if (process.platform !== "win32") signals.push("SIGHUP");
	const onSignal = () => {
		killTrackedDetachedChildren();
		void handle.close();
	};
	for (const signal of signals) process.on(signal, onSignal);

	try {
		await handle.closed;
	} finally {
		for (const signal of signals) process.off(signal, onSignal);
	}
}

export async function startServerMode(
	runtimeHost: AgentSessionRuntime,
	options: ServerModeOptions = {},
): Promise<ServerHandle> {
	const hostname = options.hostname ?? DEFAULT_HOSTNAME;
	const port = options.port ?? DEFAULT_PORT;
	const username = options.username ?? process.env.METIS_SERVER_USERNAME ?? "metis";
	const password = options.password ?? process.env.METIS_SERVER_PASSWORD;
	const allowedOrigins = new Set(options.cors ?? []);
	let advertisedPort = port;

	if (!isLoopbackHostname(hostname) && !password) {
		throw new Error("Refusing non-loopback server without METIS_SERVER_PASSWORD");
	}

	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let closing = false;
	let resolveClosed!: () => void;
	const closed = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const eventClients = new Set<ServerResponse>();
	const extensionStatuses = new Map<string, string>();
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (response: RpcExtensionUIResponse) => void; cancel: () => void }
	>();

	const broadcast = (event: ServerEvent | object): void => {
		const data = `data: ${JSON.stringify(event)}\n\n`;
		for (const client of eventClients) client.write(data);
	};

	const createDialogPromise = <T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> => {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
		const id = crypto.randomUUID();
		return new Promise<T>((resolve) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};
			const finishDefault = () => {
				cleanup();
				resolve(defaultValue);
			};
			const onAbort = () => finishDefault();
			opts?.signal?.addEventListener("abort", onAbort, { once: true });
			if (opts?.timeout) timeoutId = setTimeout(finishDefault, opts.timeout);
			pendingExtensionRequests.set(id, {
				cancel: finishDefault,
				resolve: (response) => {
					cleanup();
					resolve(parseResponse(response));
				},
			});
			broadcast({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	};

	const createExtensionUIContext = (): ExtensionUIContext => ({
		select: (title, values, opts) =>
			createDialogPromise(opts, undefined, { method: "select", title, options: values }, (response) =>
				"cancelled" in response && response.cancelled
					? undefined
					: "value" in response
						? response.value
						: undefined,
			),
		confirm: (title, message, opts) =>
			createDialogPromise(opts, false, { method: "confirm", title, message }, (response) =>
				"confirmed" in response ? response.confirmed : false,
			),
		input: (title, placeholder, opts) =>
			createDialogPromise(opts, undefined, { method: "input", title, placeholder }, (response) =>
				"cancelled" in response && response.cancelled
					? undefined
					: "value" in response
						? response.value
						: undefined,
			),
		notify(message: string, notifyType?: "info" | "warning" | "error") {
			broadcast({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message, notifyType });
		},
		onTerminalInput: () => () => {},
		setStatus(statusKey: string, statusText: string | undefined) {
			if (statusText === undefined) extensionStatuses.delete(statusKey);
			else extensionStatuses.set(statusKey, statusText);
			broadcast({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey, statusText });
		},
		setWorkingMessage(_message?: string) {},
		setWorkingVisible(_visible: boolean) {},
		setWorkingIndicator(_options?: WorkingIndicatorOptions) {},
		setHiddenThinkingLabel(_label?: string) {},
		setWidget(widgetKey: string, content: unknown, widgetOptions?: ExtensionWidgetOptions) {
			if (content === undefined || Array.isArray(content)) {
				broadcast({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey,
					widgetLines: content,
					widgetPlacement: widgetOptions?.placement,
				});
			}
		},
		setFooter(_factory: unknown) {},
		setHeader(_factory: unknown) {},
		setTitle(title: string) {
			broadcast({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setTitle", title });
		},
		async custom() {
			return undefined as never;
		},
		pasteToEditor(text: string) {
			this.setEditorText(text);
		},
		setEditorText(text: string) {
			broadcast({ type: "extension_ui_request", id: crypto.randomUUID(), method: "set_editor_text", text });
		},
		getEditorText: () => "",
		editor: (title: string, prefill?: string) =>
			createDialogPromise(undefined, undefined, { method: "editor", title, prefill }, (response) =>
				"cancelled" in response && response.cancelled
					? undefined
					: "value" in response
						? response.value
						: undefined,
			),
		addAutocompleteProvider() {},
		setEditorComponent() {},
		getEditorComponent: () => undefined,
		get theme() {
			return theme;
		},
		getAllThemes: () => [],
		getTheme: (_name: string) => undefined,
		setTheme(_theme: string | Theme) {
			return { success: false, error: "Theme switching not supported in server mode" };
		},
		getToolsExpanded: () => false,
		setToolsExpanded(_expanded: boolean) {},
	});

	const bindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		extensionStatuses.clear();
		await session.bindExtensions({
			uiContext: createExtensionUIContext(),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (newOptions) => runtimeHost.newSession(newOptions),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navigationOptions) => {
					const result = await session.navigateTree(targetId, navigationOptions);
					return { cancelled: result.cancelled };
				},
				switchSession: (sessionPath, switchOptions) => runtimeHost.switchSession(sessionPath, switchOptions),
				reload: () => session.reload(),
			},
			shutdownHandler: () => void close(),
			onError: (extensionError) => {
				broadcast({
					type: "extension_error",
					extensionPath: extensionError.extensionPath,
					event: extensionError.event,
					error: extensionError.error,
				});
			},
		});
		unsubscribe?.();
		unsubscribe = session.subscribe((event) => {
			broadcast(event);
		});
		broadcast({ type: "server.session_changed", properties: { sessionId: session.sessionId } });
	};

	runtimeHost.setRebindSession(bindSession);

	const server = createServer((request, response) => {
		void route(request, response).catch((cause: unknown) => {
			const message = cause instanceof Error ? cause.message : String(cause);
			if (!response.headersSent) {
				if (cause instanceof HttpError) sendError(response, cause.status, cause.code, message);
				else {
					console.error("Server request failed:", cause);
					sendError(response, 500, "internal_error", "Internal server error");
				}
			}
			else response.end();
		});
	});

	async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
		setCorsHeaders(request, response, allowedOrigins);
		if (request.method === "OPTIONS") {
			if (!isOriginAllowed(request, allowedOrigins)) return sendError(response, 403, "cors_denied", "Origin not allowed");
			response.writeHead(204).end();
			return;
		}
		if (!isOriginAllowed(request, allowedOrigins)) return sendError(response, 403, "cors_denied", "Origin not allowed");
		if (password && !isAuthorized(request, username, password)) {
			response.setHeader("WWW-Authenticate", 'Basic realm="metis"');
			return sendError(response, 401, "unauthorized", "Valid Basic authentication required");
		}

		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? hostname}`);
		const method = request.method ?? "GET";
		if (method === "GET" && url.pathname === "/global/health") {
			return sendJson(response, 200, { healthy: true, version: VERSION });
		}
		if (method === "GET" && (url.pathname === "/doc" || url.pathname === "/openapi.json")) {
			const document = createServerOpenApiDocument();
			document.servers = [{ url: `http://${formatHostname(hostname)}:${advertisedPort}` }];
			return sendJson(response, 200, document);
		}
		if (method === "GET" && url.pathname === "/event") {
			response.writeHead(200, {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			response.flushHeaders();
			eventClients.add(response);
			response.write(`data: ${JSON.stringify({ type: "server.connected", properties: { version: VERSION } })}\n\n`);
			request.on("close", () => eventClients.delete(response));
			return;
		}
		if (method === "GET" && url.pathname === "/session") return sendJson(response, 200, getSessionState());
		if (method === "GET" && url.pathname === "/sessions") {
			const requestedCwd = url.searchParams.get("cwd") || runtimeHost.cwd;
			const cwd = path.resolve(requestedCwd);
			if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
				return sendError(response, 400, "invalid_workspace", `Workspace directory does not exist: ${cwd}`);
			}
			const sessionManager = session.sessionManager;
			const sessionDir = sessionManager.usesDefaultSessionDir() ? undefined : sessionManager.getSessionDir();
			return sendJson(response, 200, { cwd, sessions: await SessionManager.list(cwd, sessionDir) });
		}
		if (method === "GET" && url.pathname === "/session/messages") {
			return sendJson(response, 200, { messages: session.messages, messageTimings: getMessageTimings() });
		}
		if (method === "GET" && url.pathname === "/session/entries") {
			let entries = session.sessionManager.getEntries();
			const since = url.searchParams.get("since");
			if (since) {
				const index = entries.findIndex((entry) => entry.id === since);
				if (index === -1) return sendError(response, 404, "entry_not_found", `Entry not found: ${since}`);
				entries = entries.slice(index + 1);
			}
			return sendJson(response, 200, { entries, leafId: session.sessionManager.getLeafId() });
		}
		if (method === "GET" && url.pathname === "/session/tree") {
			return sendJson(response, 200, { tree: session.sessionManager.getTree(), leafId: session.sessionManager.getLeafId() });
		}
		if (method === "GET" && url.pathname === "/config/providers") {
			return sendJson(response, 200, { models: await session.modelRegistry.getAvailable() });
		}
		if (method === "GET" && url.pathname === "/commands") {
			return sendJson(response, 200, { commands: getCommandCatalog() });
		}
		if (method === "POST" && url.pathname === "/session/command") {
			const body = await readJsonBody<{ command?: string }>(request);
			if (!body?.command?.trim()) return sendError(response, 400, "invalid_request", "command is required");
			return sendJson(response, 200, await executeSlashCommand(body.command));
		}

		if (method === "POST" && url.pathname === "/session/prompt") {
			const body = await readJsonBody<ServerPromptRequest>(request);
			if (!body || typeof body.message !== "string" || !body.message.trim()) {
				return sendError(response, 400, "invalid_request", "message must be a non-empty string");
			}
			await submitPrompt(body);
			return sendJson(response, 202, { accepted: true });
		}
		if (method === "POST" && url.pathname === "/session/steer") {
			const body = await readMessageBody(request);
			await session.steer(body.message, body.images);
			return sendJson(response, 200, { success: true });
		}
		if (method === "POST" && url.pathname === "/session/follow-up") {
			const body = await readMessageBody(request);
			await session.followUp(body.message, body.images);
			return sendJson(response, 200, { success: true });
		}
		if (method === "DELETE" && url.pathname === "/session/queue") {
			const body = await readJsonBody<{ queue?: string; index?: number }>(request);
			if (body?.queue !== "steering" && body?.queue !== "followUp") {
				return sendError(response, 400, "invalid_request", "queue must be steering or followUp");
			}
			if (!Number.isInteger(body.index) || Number(body.index) < 0) {
				return sendError(response, 400, "invalid_request", "index must be a non-negative integer");
			}
			try {
				const s = session as any;
				const message = typeof s.removeQueuedMessage === "function" ? s.removeQueuedMessage(body.queue, Number(body.index)) : undefined;
				return sendJson(response, 200, { success: true, message });
			} catch (error) {
				return sendError(response, 404, "queue_item_not_found", error instanceof Error ? error.message : String(error));
			}
		}
		if (method === "POST" && url.pathname === "/session/queue/promote") {
			const body = await readJsonBody<{ index?: number }>(request);
			if (!Number.isInteger(body?.index) || Number(body?.index) < 0) {
				return sendError(response, 400, "invalid_request", "index must be a non-negative integer");
			}
			try {
				const s = session as any;
				if (typeof s.promoteFollowUpMessage === "function") {
					s.promoteFollowUpMessage(Number(body?.index));
				}
				return sendJson(response, 200, { success: true });
			} catch (error) {
				return sendError(response, 404, "queue_item_not_found", error instanceof Error ? error.message : String(error));
			}
		}
		if (method === "POST" && url.pathname === "/session/abort") {
			await session.abort();
			return sendJson(response, 200, { success: true });
		}
		if (method === "POST" && url.pathname === "/session/compact") {
			const body = await readJsonBody<{ customInstructions?: string }>(request, true);
			return sendJson(response, 200, await session.compact(body?.customInstructions));
		}
		if (method === "POST" && url.pathname === "/session/new") {
			const body = await readJsonBody<{ cwd?: string; parentSession?: string }>(request, true);
			const cwd = body?.cwd ? path.resolve(body.cwd) : undefined;
			if (cwd && (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory())) {
				return sendError(response, 400, "invalid_workspace", `Workspace directory does not exist: ${cwd}`);
			}
			const result = await runtimeHost.newSession({ cwd, parentSession: body?.parentSession });
			if (!result.cancelled) await bindSession();
			return sendJson(response, 200, result);
		}
		if (method === "POST" && url.pathname === "/session/switch") {
			const body = await readJsonBody<{ sessionPath?: string }>(request);
			if (!body?.sessionPath) return sendError(response, 400, "invalid_request", "sessionPath is required");
			const result = await runtimeHost.switchSession(body.sessionPath);
			if (!result.cancelled) await bindSession();
			return sendJson(response, 200, result);
		}
		if (method === "POST" && url.pathname === "/session/fork") {
			const body = await readJsonBody<{ entryId?: string }>(request, true);
			if (!body?.entryId) return sendError(response, 400, "invalid_request", "entryId is required");
			const result = await runtimeHost.fork(body.entryId);
			if (!result.cancelled) await bindSession();
			return sendJson(response, 200, result);
		}
		if (method === "PUT" && url.pathname === "/session/model") {
			const body = await readJsonBody<{ provider?: string; modelId?: string }>(request);
			const models = await session.modelRegistry.getAvailable();
			const model = models.find((candidate) => candidate.provider === body?.provider && candidate.id === body?.modelId);
			if (!model) return sendError(response, 404, "model_not_found", `Model not found: ${body?.provider}/${body?.modelId}`);
			await session.setModel(model);
			return sendJson(response, 200, model);
		}
		if (method === "PUT" && url.pathname === "/session/thinking") {
			const body = await readJsonBody<{ level?: string }>(request);
			const availableLevels = session.getAvailableThinkingLevels();
			if (!body?.level || !availableLevels.includes(body.level as never)) {
				return sendError(response, 400, "invalid_request", `level must be one of: ${availableLevels.join(", ")}`);
			}
			session.setThinkingLevel(body.level as never);
			return sendJson(response, 200, { success: true, level: session.thinkingLevel });
		}
		if (method === "PUT" && url.pathname === "/session/settings") {
			const body = await readJsonBody<{
				autoCompactionEnabled?: unknown;
				steeringMode?: unknown;
				followUpMode?: unknown;
			}>(request);
			const hasAutoCompaction = body?.autoCompactionEnabled !== undefined;
			const hasSteeringMode = body?.steeringMode !== undefined;
			const hasFollowUpMode = body?.followUpMode !== undefined;
			if (!hasAutoCompaction && !hasSteeringMode && !hasFollowUpMode) {
				return sendError(response, 400, "invalid_request", "At least one Agent setting is required");
			}
			if (hasAutoCompaction && typeof body?.autoCompactionEnabled !== "boolean") {
				return sendError(response, 400, "invalid_request", "autoCompactionEnabled must be a boolean");
			}
			const queueModes = ["all", "one-at-a-time"];
			if (hasSteeringMode && !queueModes.includes(body?.steeringMode as string)) {
				return sendError(response, 400, "invalid_request", "steeringMode must be one of: all, one-at-a-time");
			}
			if (hasFollowUpMode && !queueModes.includes(body?.followUpMode as string)) {
				return sendError(response, 400, "invalid_request", "followUpMode must be one of: all, one-at-a-time");
			}

			if (hasAutoCompaction) session.setAutoCompactionEnabled(body?.autoCompactionEnabled as boolean);
			if (hasSteeringMode) session.setSteeringMode(body?.steeringMode as "all" | "one-at-a-time");
			if (hasFollowUpMode) session.setFollowUpMode(body?.followUpMode as "all" | "one-at-a-time");
			return sendJson(response, 200, getSessionState());
		}
		if (method === "PUT" && url.pathname === "/session/name") {
			const body = await readJsonBody<{ name?: string }>(request);
			const name = body?.name?.trim();
			if (!name) return sendError(response, 400, "invalid_request", "name must be a non-empty string");
			session.setSessionName(name);
			return sendJson(response, 200, { success: true });
		}
		if (method === "POST" && url.pathname === "/extension/ui-response") {
			const body = await readJsonBody<RpcExtensionUIResponse>(request);
			if (!body?.id) return sendError(response, 400, "invalid_request", "id is required");
			const pending = pendingExtensionRequests.get(body.id);
			if (!pending) return sendError(response, 404, "request_not_found", `UI request not found: ${body.id}`);
			pending.resolve(body);
			return sendJson(response, 200, { success: true });
		}

		return sendError(response, 404, "not_found", `${method} ${url.pathname} not found`);
	}

	function getCommandCatalog(): Array<Record<string, unknown>> {
		const builtins = BUILTIN_SLASH_COMMANDS.map((command) => ({ ...command, source: "builtin" }));
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		const prompts = (session.promptTemplates ?? []).map((command: any) => ({
			name: command.name,
			description: command.description,
			argumentHint: command.argumentHint,
			source: "prompt",
		}));
		const extensions = (session.extensionRunner?.getRegisteredCommands?.() ?? [])
			.filter((command: any) => !builtinNames.has(command.name))
			.map((command: any) => ({
				name: command.invocationName ?? command.name,
				description: command.description,
				source: "extension",
			}));
		const skills = session.settingsManager?.getEnableSkillCommands?.()
			? (session.resourceLoader?.getSkills?.().skills ?? []).map((skill: any) => ({
					name: `skill:${skill.name}`,
					description: skill.description,
					source: "skill",
				}))
			: [];
		return [...builtins, ...prompts, ...extensions, ...skills];
	}

	async function executeSlashCommand(input: string): Promise<Record<string, unknown>> {
		const commandText = input.trim();
		if (!commandText.startsWith("/")) throw new HttpError(400, "invalid_command", "command must start with /");
		const firstSpace = commandText.indexOf(" ");
		const name = commandText.slice(1, firstSpace === -1 ? undefined : firstSpace);
		const argument = firstSpace === -1 ? "" : commandText.slice(firstSpace + 1).trim();
		const builtin = BUILTIN_SLASH_COMMANDS.some((command) => command.name === name);

		if (!builtin) {
			const dynamic = getCommandCatalog().some((command) => command.name === name && command.source !== "builtin");
			if (!dynamic) throw new HttpError(404, "command_not_found", `Unknown command: /${name}`);
			await submitPrompt({ message: commandText });
			return { command: name, accepted: true, message: `/${name} 已提交` };
		}

		switch (name) {
			case "settings":
				return { command: name, action: "open-panel", panel: "agent", message: "已打开 Agent 设置" };
			case "language": {
				if (!argument) {
					return {
						command: name,
						current: session.settingsManager.getUiLanguage(),
						options: SUPPORTED_UI_LANGUAGES,
						usage: "/language <code>",
					};
				}
				if (!isUiLanguage(argument)) throw new HttpError(400, "invalid_language", `Unsupported language: ${argument}`);
				session.settingsManager.setUiLanguage(argument);
				return { command: name, value: argument, message: `语言已设为 ${argument}；Desktop 可立即应用，Agent / TUI 将在下次重载或重启后应用` };
			}
			case "model": {
				if (!argument) return { command: name, action: "open-panel", panel: "agent", message: "请在 Agent 页选择模型" };
				const models = await session.modelRegistry.getAvailable();
				const query = argument.toLowerCase();
				const matches = models.filter((model: any) =>
					[`${model.provider}/${model.id}`, model.id, model.name].filter(Boolean).some((value) => String(value).toLowerCase() === query),
				);
				if (matches.length !== 1) throw new HttpError(400, "model_not_found", `Model reference must match exactly: ${argument}`);
				await session.setModel(matches[0]);
				return { command: name, model: matches[0], message: `模型已切换为 ${matches[0].provider}/${matches[0].id}` };
			}
			case "scoped-models": {
				const models = await session.modelRegistry.getAvailable();
				if (!argument) {
					return {
						command: name,
						enabled: session.scopedModels.map((item: any) => `${item.model.provider}/${item.model.id}`),
						available: models.map((model: any) => `${model.provider}/${model.id}`),
						usage: "/scoped-models <provider/model,provider/model|all>",
					};
				}
				const patterns = argument === "all" ? undefined : argument.split(",").map((value) => value.trim()).filter(Boolean);
				const scoped = patterns ? await resolveModelScope(patterns, session.modelRegistry) : [];
				session.setScopedModels(scoped);
				session.settingsManager.setEnabledModels(patterns);
				return { command: name, enabled: patterns ?? "all", message: "模型循环范围已保存" };
			}
			case "export": {
				const filePath = argument.endsWith(".jsonl")
					? await session.exportToJsonl(argument || undefined)
					: await session.exportToHtml(argument || undefined);
				return { command: name, filePath, message: `会话已导出到 ${filePath}` };
			}
			case "import": {
				if (!argument) throw new HttpError(400, "missing_argument", "Usage: /import <path.jsonl>");
				const result = await runtimeHost.importFromJsonl(argument);
				if (!result.cancelled) await bindSession();
				return { command: name, ...result, message: result.cancelled ? "导入已取消" : `已导入 ${argument}` };
			}
			case "share": {
				const auth = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
				if (auth.error || auth.status !== 0) throw new HttpError(400, "github_auth_required", "GitHub CLI 未安装或未登录");
				const temporaryPath = path.join(os.tmpdir(), `metis-session-${crypto.randomUUID()}.html`);
				try {
					await session.exportToHtml(temporaryPath);
					const gist = spawnSync("gh", ["gist", "create", "--public=false", temporaryPath], { encoding: "utf8" });
					if (gist.error || gist.status !== 0) throw new HttpError(500, "share_failed", gist.stderr?.trim() || "Failed to create gist");
					const gistUrl = gist.stdout.trim();
					const gistId = gistUrl.split("/").pop();
					if (!gistId) throw new HttpError(500, "share_failed", "Failed to parse gist URL");
					return { command: name, url: getShareViewerUrl(gistId), gistUrl, action: "open-url", message: "分享链接已创建" };
				} finally {
					try { fs.unlinkSync(temporaryPath); } catch {}
				}
			}
			case "copy": {
				const text = session.getLastAssistantText();
				if (!text) throw new HttpError(404, "message_not_found", "还没有 Agent 消息可复制");
				return { command: name, action: "copy", text, message: "最后一条 Agent 消息已复制" };
			}
			case "name": {
				if (!argument) return { command: name, value: session.sessionName ?? null, usage: "/name <name>" };
				session.setSessionName(argument);
				return { command: name, value: argument, message: `会话名称已设为 ${argument}` };
			}
			case "session":
				return { command: name, state: getSessionState(), stats: session.getSessionStats() };
			case "changelog":
				return { command: name, changelog: fs.readFileSync(getChangelogPath(), "utf8") };
			case "hotkeys":
				return {
					command: name,
					hotkeys: ["⌘N：新建任务", "Enter：发送", "Shift+Enter：换行", "Esc：关闭设置或对话框", "⌘/Ctrl + 点击：打开外部链接"],
				};
			case "fork": {
				if (!argument) return { command: name, entries: session.getUserMessagesForForking(), usage: "/fork <entryId>" };
				const result = await runtimeHost.fork(argument);
				if (!result.cancelled) await bindSession();
				return { command: name, ...result, message: result.cancelled ? "分叉已取消" : "已创建分叉会话" };
			}
			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) throw new HttpError(400, "empty_session", "当前会话还没有可克隆内容");
				const result = await runtimeHost.fork(leafId, { position: "at" });
				if (!result.cancelled) await bindSession();
				return { command: name, ...result, message: result.cancelled ? "克隆已取消" : "已克隆当前会话" };
			}
			case "tree": {
				if (!argument) return { command: name, tree: session.sessionManager.getTree(), leafId: session.sessionManager.getLeafId(), usage: "/tree <entryId>" };
				const result = await session.navigateTree(argument);
				return { command: name, ...result, message: result.cancelled ? "导航已取消" : "已切换会话分支" };
			}
			case "trust": {
				const cwd = session.sessionManager.getCwd();
				const store = new ProjectTrustStore(runtimeHost.services.agentDir);
				if (!argument) return { command: name, cwd, decision: store.get(cwd), usage: "/trust <trusted|untrusted|clear>" };
				const decision = argument === "trusted" ? true : argument === "untrusted" ? false : argument === "clear" ? null : undefined;
				if (decision === undefined) throw new HttpError(400, "invalid_trust", "Use trusted, untrusted, or clear");
				store.set(cwd, decision);
				return { command: name, decision, message: "项目信任设置已保存，重启 Agent 后生效" };
			}
			case "login": {
				const authStorage: any = session.modelRegistry.authStorage;
				const oauthProviders = authStorage.getOAuthProviders?.() ?? [];
				const [providerId, ...keyParts] = argument.split(/\s+/).filter(Boolean);
				const listProviders = () =>
					[...new Set([...oauthProviders.map((provider: any) => provider.id), ...session.modelRegistry.getAll().map((model: any) => model.provider)])];
				let providerIds = listProviders();
				if (!providerId) return { command: name, providers: providerIds, usage: "/login <provider> [api-key]" };
				if (!providerIds.includes(providerId)) {
					// Desktop writes custom providers to models.json then /reload + /login.
					// Refresh once so newly saved providers (e.g. "other") are visible.
					session.modelRegistry.refresh();
					providerIds = listProviders();
				}
				if (!providerIds.includes(providerId)) throw new HttpError(404, "provider_not_found", `Unknown provider: ${providerId}`);
				const apiKey = keyParts.join(" ");
				if (apiKey) {
					authStorage.set(providerId, { type: "api_key", key: apiKey });
				} else {
					const oauthProvider = oauthProviders.find((provider: any) => provider.id === providerId);
					if (!oauthProvider) throw new HttpError(400, "api_key_required", `Usage: /login ${providerId} <api-key>`);
					const ui = createExtensionUIContext();
					await authStorage.login(providerId, {
						onAuth: (info: any) => broadcast({ type: "extension_ui_request", id: crypto.randomUUID(), method: "open_url", ...info } as any),
						onDeviceCode: (info: any) => broadcast({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message: `${info.verificationUri ?? info.url ?? ""}\n${info.userCode ?? info.code ?? ""}` } as any),
						onPrompt: (prompt: any) => ui.input(prompt.message, prompt.placeholder),
						onProgress: (message: string) => ui.notify(message),
						onSelect: async (prompt: any) => {
							const label = await ui.select(prompt.message, prompt.options.map((option: any) => option.label));
							return prompt.options.find((option: any) => option.label === label)?.id;
						},
						onManualCodeInput: () => ui.input("粘贴重定向 URL 或验证码"),
					});
				}
				session.modelRegistry.refresh();
				session.syncModelFromRegistry();
				return { command: name, provider: providerId, message: `${providerId} 登录信息已保存` };
			}
			case "logout": {
				const authStorage: any = session.modelRegistry.authStorage;
				if (!argument) return { command: name, providers: authStorage.list(), usage: "/logout <provider>" };
				authStorage.logout(argument);
				session.modelRegistry.refresh();
				session.syncModelFromRegistry();
				return { command: name, provider: argument, message: `${argument} 的已保存凭据已移除` };
			}
			case "new": {
				const result = await runtimeHost.newSession();
				if (!result.cancelled) await bindSession();
				return { command: name, ...result, message: result.cancelled ? "新建会话已取消" : "新会话已创建" };
			}
			case "compact":
				return { command: name, result: await session.compact(argument || undefined), message: "上下文压缩完成" };
			case "resume": {
				if (!argument) {
					const sessions = await SessionManager.listAll(session.sessionManager.getSessionDir());
					return { command: name, sessions, usage: "/resume <sessionPath>" };
				}
				const result = await runtimeHost.switchSession(argument);
				if (!result.cancelled) await bindSession();
				return { command: name, ...result, message: result.cancelled ? "恢复会话已取消" : "已切换会话" };
			}
			case "reload":
				await session.reload();
				return { command: name, message: "Agent 扩展、Skills、Prompts、主题和模型注册表已重载；Desktop 快捷键未改变" };
			case "quit":
				return { command: name, action: "quit", message: "正在退出 Metis Desktop" };
			default:
				throw new HttpError(404, "command_not_found", `Unknown command: /${name}`);
		}
	}

	function getSessionState(): ServerSessionState {
		const s = session as any;
		if (!session.sessionName && !session.isStreaming && session.messages.some((message: any) => message.role === "assistant")) {
			if (typeof s.ensureSessionName === "function") {
				void s.ensureSessionName();
			}
		}
		return {
			cwd: session.sessionManager.getCwd(),
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			thinkingLevels: session.getAvailableThinkingLevels(),
			supportsThinking: session.supportsThinking(),
			isStreaming: session.isStreaming,
			isCompacting: session.isCompacting,
			steeringMode: session.steeringMode,
			followUpMode: session.followUpMode,
			sessionFile: session.sessionFile,
			sessionId: session.sessionId,
			sessionName: session.sessionName,
			isGeneratingSessionName: s.isGeneratingSessionName ?? false,
			sessionTitleError: s.sessionNameError ?? undefined,
			autoCompactionEnabled: session.autoCompactionEnabled,
			messageCount: session.messages.length,
			pendingMessageCount: session.pendingMessageCount,
			steeringMessages: session.getSteeringMessages(),
			followUpMessages: session.getFollowUpMessages(),
			runningSubagentIds: session.getRunningSubagentIds?.() ?? [],
			extensionStatuses: Object.fromEntries(extensionStatuses),
			contextUsage: typeof session.getContextUsage === "function" ? session.getContextUsage() : undefined,
		};
	}

	function getMessageTimings(): Array<{ messageTimestamp: number; completedAt: number }> {
		return session.sessionManager.getBranch().flatMap((entry) => {
			if (entry.type !== "message" || entry.message.role !== "assistant") return [];
			const messageTimestamp = Number(entry.message.timestamp);
			const completedAt = Date.parse(entry.timestamp);
			if (!Number.isFinite(messageTimestamp) || !Number.isFinite(completedAt)) return [];
			return [{ messageTimestamp, completedAt }];
		});
	}

	async function submitPrompt(body: ServerPromptRequest): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const promptTask = session.prompt(body.message, {
				images: normalizeImageContents(body.images),
				streamingBehavior: body.streamingBehavior,
				source: "rpc",
				preflightResult: (succeeded) => {
					if (succeeded && !settled) {
						settled = true;
						resolve();
					}
				},
			});
			void promptTask.catch((cause: unknown) => {
				if (!settled) {
					settled = true;
					reject(cause);
				}
			});
		});
	}

	async function readMessageBody(request: IncomingMessage): Promise<{ message: string; images?: ImageContent[] }> {
		const body = await readJsonBody<{ message?: string; images?: unknown }>(request);
		if (!body?.message?.trim()) throw new HttpError(400, "invalid_request", "message must be a non-empty string");
		return { message: body.message, images: normalizeImageContents(body.images) };
	}

	const heartbeat = setInterval(() => {
		broadcast({ type: "server.heartbeat", properties: { timestamp: Date.now() } });
	}, HEARTBEAT_MS);
	heartbeat.unref();

	async function close(): Promise<void> {
		if (closing) return closed;
		closing = true;
		clearInterval(heartbeat);
		unsubscribe?.();
		for (const client of eventClients) client.end();
		eventClients.clear();
		for (const pending of [...pendingExtensionRequests.values()]) pending.cancel();
		pendingExtensionRequests.clear();
		await new Promise<void>((resolve, reject) => {
			server.close((cause) => (cause ? reject(cause) : resolve()));
		});
		await runtimeHost.dispose();
		resolveClosed();
	}

	server.on("clientError", (_cause, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
	await bindSession();
	await listen(server, port, hostname);
	const info = server.address() as AddressInfo;
	advertisedPort = info.port;
	const address: ServerAddress = {
		hostname,
		port: info.port,
		url: `http://${formatHostname(hostname)}:${info.port}`,
	};
	return { address, closed, close };
}

function normalizeImageContents(value: unknown): ImageContent[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new HttpError(400, "invalid_request", "images must be an array");

	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== "object") {
			throw new HttpError(400, "invalid_request", `images[${index}] must be an image object`);
		}
		const record = candidate as Record<string, unknown>;
		const nested = record.image && typeof record.image === "object" ? record.image as Record<string, unknown> : undefined;
		const source = nested ?? record;
		let data = typeof source.data === "string" ? source.data.trim() : "";
		let mimeType = [source.mimeType, source.mediaType, source.contentType]
			.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			?.trim()
			.toLowerCase();

		const dataUrl = data.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
		if (dataUrl) {
			mimeType ??= dataUrl[1].toLowerCase();
			data = dataUrl[2].replace(/\s+/g, "");
		} else {
			data = data.replace(/\s+/g, "");
		}

		if (!mimeType) {
			if (data.startsWith("iVBORw0KGgo")) mimeType = "image/png";
			else if (data.startsWith("/9j/")) mimeType = "image/jpeg";
			else if (data.startsWith("R0lGOD")) mimeType = "image/gif";
			else if (data.startsWith("UklGR") && data.slice(12, 16) === "V0VC") mimeType = "image/webp";
		}
		if (mimeType === "image/jpg") mimeType = "image/jpeg";

		if (!data) throw new HttpError(400, "invalid_request", `images[${index}].data is required`);
		if (!mimeType || !/^image\/[a-z0-9.+-]+$/.test(mimeType)) {
			throw new HttpError(400, "invalid_request", `images[${index}].mimeType must be an image MIME type`);
		}
		return { type: "image", data, mimeType } satisfies ImageContent;
	});
}

class HttpError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

async function readJsonBody<T>(request: IncomingMessage, optional = false): Promise<T | undefined> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "Request body exceeds 10 MiB");
		chunks.push(buffer);
	}
	if (size === 0) {
		if (optional) return undefined;
		throw new HttpError(400, "invalid_json", "JSON request body is required");
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
	} catch {
		throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
	}
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
	const body: ServerErrorBody = { error: { code, message } };
	sendJson(response, status, body);
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse, allowedOrigins: Set<string>): void {
	const origin = request.headers.origin;
	if (origin && (allowedOrigins.has(origin) || allowedOrigins.has("*"))) {
		response.setHeader("Access-Control-Allow-Origin", allowedOrigins.has("*") ? "*" : origin);
		response.setHeader("Vary", "Origin");
	}
	response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
	response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
}

function isOriginAllowed(request: IncomingMessage, allowedOrigins: Set<string>): boolean {
	const origin = request.headers.origin;
	return !origin || allowedOrigins.has(origin) || allowedOrigins.has("*");
}

function isAuthorized(request: IncomingMessage, username: string, password: string): boolean {
	const authorization = request.headers.authorization;
	if (!authorization?.startsWith("Basic ")) return false;
	let decoded: string;
	try {
		decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
	} catch {
		return false;
	}
	const separator = decoded.indexOf(":");
	if (separator === -1) return false;
	return safeEqual(decoded.slice(0, separator), username) && safeEqual(decoded.slice(separator + 1), password);
}

function safeEqual(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function formatHostname(hostname: string): string {
	return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

function listen(server: Server, port: number, hostname: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (cause: Error) => {
			server.off("listening", onListening);
			reject(cause);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, hostname);
	});
}
