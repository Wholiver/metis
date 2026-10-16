const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("metisDesktop", {
	platform: process.platform,
	appInfo: () => ipcRenderer.invoke("app:info"),
	setUiLanguage: (language) => ipcRenderer.invoke("app:set-language", language),
	setUiTheme: (theme) => ipcRenderer.invoke("app:set-theme", theme),
	quit: () => ipcRenderer.invoke("app:quit"),
	reload: () => ipcRenderer.invoke("app:reload"),
	openDevTools: () => ipcRenderer.invoke("app:open-devtools"),
	clipboard: {
		writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
	},
	attachments: {
		pathForFile: (file) => webUtils.getPathForFile(file),
		save: (attachment) => ipcRenderer.invoke("attachment:save", attachment),
	},
	sessionFile: {
		open: () => ipcRenderer.invoke("session-file:open"),
		save: (format) => ipcRenderer.invoke("session-file:save", format),
	},
	sessionTokens: {
		totals: (sessionPaths) => ipcRenderer.invoke("session-tokens:totals", sessionPaths),
		activity: (sessionPaths) => ipcRenderer.invoke("session-tokens:activity", sessionPaths),
		costActivity: (sessionPaths) => ipcRenderer.invoke("session-tokens:cost-activity", sessionPaths),
	},
	workspace: {
		get: () => ipcRenderer.invoke("workspace:get"),
		set: (workspacePath) => ipcRenderer.invoke("workspace:set", workspacePath),
		select: () => ipcRenderer.invoke("workspace:select"),
		selectParent: () => ipcRenderer.invoke("workspace:select-parent"),
		create: (input) => ipcRenderer.invoke("workspace:create", input),
		selectMany: () => ipcRenderer.invoke("workspace:select-many"),
		tree: (targetDir) => ipcRenderer.invoke("workspace:tree", targetDir),
		diff: (relativePath) => ipcRenderer.invoke("workspace:diff", relativePath),
		gitInfo: (targetDir) => ipcRenderer.invoke("workspace:git-info", targetDir),
		gitStatus: (mode, targetDir) => ipcRenderer.invoke("workspace:git-status", mode, targetDir),
		gitDiff: (relativePath, mode, targetDir) => ipcRenderer.invoke("workspace:git-diff", relativePath, mode, targetDir),
		gitInit: (targetDir) => ipcRenderer.invoke("workspace:git-init", targetDir),
		gitStage: (files, targetDir) => ipcRenderer.invoke("workspace:git-stage", files, targetDir),
		gitUnstage: (files, targetDir) => ipcRenderer.invoke("workspace:git-unstage", files, targetDir),
		gitDiscard: (files, targetDir) => ipcRenderer.invoke("workspace:git-discard", files, targetDir),
		gitCommit: (message, targetDir) => ipcRenderer.invoke("workspace:git-commit", message, targetDir),
		gitHistory: (limit, targetDir) => ipcRenderer.invoke("workspace:git-history", limit, targetDir),
		gitCommitDetail: (hash, targetDir) => ipcRenderer.invoke("workspace:git-commit-detail", hash, targetDir),
		gitCommitFileDiff: (hash, relativePath, targetDir) => ipcRenderer.invoke("workspace:git-commit-file-diff", hash, relativePath, targetDir),
		gitBranches: (targetDir) => ipcRenderer.invoke("workspace:git-branches", targetDir),
		gitCheckout: (branch, targetDir) => ipcRenderer.invoke("workspace:git-checkout", branch, targetDir),
		reveal: (relativePath, targetDir) => ipcRenderer.invoke("workspace:reveal", relativePath, targetDir),
		openPath: (relativePath, targetDir) => ipcRenderer.invoke("workspace:open-path", relativePath, targetDir),
		readFile: (relativePath, targetDir) => ipcRenderer.invoke("workspace:read-file", relativePath, targetDir),
		isRemote: () => ipcRenderer.invoke("workspace:is-remote"),
		validate: (targetPath) => ipcRenderer.invoke("workspace:validate", targetPath),
	},
	providerConfig: {
		getCustom: () => ipcRenderer.invoke("provider-config:get-custom"),
		listCustom: () => ipcRenderer.invoke("provider-config:list-custom"),
		discoverModels: (config) => ipcRenderer.invoke("provider-config:discover-models", config),
		saveCustom: (config) => ipcRenderer.invoke("provider-config:save-custom", config),
		deleteCustom: (providerId) => ipcRenderer.invoke("provider-config:delete-custom", providerId),
		deleteModel: (providerId, modelId) => ipcRenderer.invoke("provider-config:delete-model", providerId, modelId),
	},
	metis: {
		getConnection: () => ipcRenderer.invoke("metis:get-connection"),
		connect: (options) => ipcRenderer.invoke("metis:connect", options),
		disconnect: () => ipcRenderer.invoke("metis:disconnect"),
		request: (request) => ipcRenderer.invoke("metis:request", request),
		onEvent: (listener) => {
			// Payloads may be JSON strings (cheaper IPC clone than nested objects).
			const handler = (_event, payload) => listener(payload);
			ipcRenderer.on("metis:event", handler);
			return () => ipcRenderer.removeListener("metis:event", handler);
		},
		onDisconnect: (listener) => {
			const handler = (_event, message) => listener(message);
			ipcRenderer.on("metis:disconnected", handler);
			return () => ipcRenderer.removeListener("metis:disconnected", handler);
		},
		onServerReady: (listener) => {
			const handler = () => listener();
			ipcRenderer.on("metis:server-ready", handler);
			return () => ipcRenderer.removeListener("metis:server-ready", handler);
		},
	},
	openExternal: (url) => ipcRenderer.invoke("external:open", url),
	update: {
		check: () => ipcRenderer.invoke("update:check"),
	},
	browser: {
		bindTab: (payload) => ipcRenderer.invoke("browser:bind-tab", payload),
		updateTabMeta: (payload) => ipcRenderer.invoke("browser:update-tab-meta", payload),
		onEnsureTab: (listener) => {
			const handler = (_event, payload) => listener(payload);
			ipcRenderer.on("browser:host-ensure-tab", handler);
			return () => ipcRenderer.removeListener("browser:host-ensure-tab", handler);
		},
		onSelectTab: (listener) => {
			const handler = (_event, payload) => listener(payload);
			ipcRenderer.on("browser:host-select-tab", handler);
			return () => ipcRenderer.removeListener("browser:host-select-tab", handler);
		},
		onBusy: (listener) => {
			const handler = (_event, payload) => listener(payload);
			ipcRenderer.on("browser:host-busy", handler);
			return () => ipcRenderer.removeListener("browser:host-busy", handler);
		},
	},
	routines: {
		list: () => ipcRenderer.invoke("routine:list"),
		create: (payload) => ipcRenderer.invoke("routine:create", payload),
		update: (id, patch) => ipcRenderer.invoke("routine:update", { id, patch }),
		delete: (id) => ipcRenderer.invoke("routine:delete", { id }),
		runNow: (id) => ipcRenderer.invoke("routine:run-now", { id }),
		onUpdated: (listener) => {
			const handler = (_event, payload) => listener(payload);
			ipcRenderer.on("routine:updated", handler);
			return () => ipcRenderer.removeListener("routine:updated", handler);
		},
	},
	harness: {
		load: (targetDir) => ipcRenderer.invoke("harness:load", targetDir),
		save: (harness, targetDir) => ipcRenderer.invoke("harness:save", harness, targetDir),
		delete: (targetDir) => ipcRenderer.invoke("harness:delete", targetDir),
		seed: () => ipcRenderer.invoke("harness:seed"),
	},
});

