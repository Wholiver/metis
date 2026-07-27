const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("metisDesktop", {
	appInfo: () => ipcRenderer.invoke("app:info"),
	quit: () => ipcRenderer.invoke("app:quit"),
	clipboard: {
		writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
	},
	sessionFile: {
		open: () => ipcRenderer.invoke("session-file:open"),
		save: (format) => ipcRenderer.invoke("session-file:save", format),
	},
	workspace: {
		get: () => ipcRenderer.invoke("workspace:get"),
		set: (workspacePath) => ipcRenderer.invoke("workspace:set", workspacePath),
		select: () => ipcRenderer.invoke("workspace:select"),
		tree: () => ipcRenderer.invoke("workspace:tree"),
		diff: (relativePath) => ipcRenderer.invoke("workspace:diff", relativePath),
		reveal: (relativePath) => ipcRenderer.invoke("workspace:reveal", relativePath),
	},
	providerConfig: {
		saveCustom: (config) => ipcRenderer.invoke("provider-config:save-custom", config),
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
	},
	openExternal: (url) => ipcRenderer.invoke("external:open", url),
});
