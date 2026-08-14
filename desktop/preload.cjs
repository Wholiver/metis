const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("metisDesktop", {
	appInfo: () => ipcRenderer.invoke("app:info"),
	setUiLanguage: (language) => ipcRenderer.invoke("app:set-language", language),
	quit: () => ipcRenderer.invoke("app:quit"),
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
	},
	workspace: {
		get: () => ipcRenderer.invoke("workspace:get"),
		set: (workspacePath) => ipcRenderer.invoke("workspace:set", workspacePath),
		select: () => ipcRenderer.invoke("workspace:select"),
		selectMany: () => ipcRenderer.invoke("workspace:select-many"),
		tree: () => ipcRenderer.invoke("workspace:tree"),
		diff: (relativePath) => ipcRenderer.invoke("workspace:diff", relativePath),
		reveal: (relativePath) => ipcRenderer.invoke("workspace:reveal", relativePath),
	},
	providerConfig: {
		getCustom: () => ipcRenderer.invoke("provider-config:get-custom"),
		listCustom: () => ipcRenderer.invoke("provider-config:list-custom"),
		discoverModels: (config) => ipcRenderer.invoke("provider-config:discover-models", config),
		saveCustom: (config) => ipcRenderer.invoke("provider-config:save-custom", config),
		deleteCustom: (providerId) => ipcRenderer.invoke("provider-config:delete-custom", providerId),
	},
	metis: {
		connect: (options) => ipcRenderer.invoke("metis:connect", options),
		disconnect: () => ipcRenderer.invoke("metis:disconnect"),
		request: (request) => ipcRenderer.invoke("metis:request", request),
		onEvent: (listener) => {
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
});
