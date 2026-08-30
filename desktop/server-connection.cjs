const DEFAULT_METIS_SERVER = Object.freeze({
	baseUrl: "http://127.0.0.1:4096",
	username: "metis",
	password: "",
});

function normalizedHttpUrl(value) {
	try {
		const url = new URL(String(value || ""));
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.href.replace(/\/$/, "");
	} catch {
		return undefined;
	}
}

function restoreMetisServer(saved) {
	return {
		baseUrl: normalizedHttpUrl(saved?.baseUrl) || DEFAULT_METIS_SERVER.baseUrl,
		username: typeof saved?.username === "string" && saved.username.trim()
			? saved.username.trim()
			: DEFAULT_METIS_SERVER.username,
		password: "",
	};
}

function persistMetisServer(server) {
	return {
		baseUrl: normalizedHttpUrl(server?.baseUrl) || DEFAULT_METIS_SERVER.baseUrl,
		username: typeof server?.username === "string" && server.username.trim()
			? server.username.trim()
			: DEFAULT_METIS_SERVER.username,
	};
}

function localServerTarget(baseUrl) {
	try {
		const url = new URL(String(baseUrl));
		const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
		if (url.protocol !== "http:" || url.pathname !== "/" || url.search || url.hash) return undefined;
		if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) return undefined;
		const port = url.port ? Number(url.port) : 80;
		if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
		return {
			baseUrl: url.origin,
			hostname: hostname === "localhost" ? "127.0.0.1" : hostname,
			port,
		};
	} catch {
		return undefined;
	}
}

module.exports = {
	DEFAULT_METIS_SERVER,
	localServerTarget,
	persistMetisServer,
	restoreMetisServer,
};
