/**
 * Client for Metis Desktop Inspector browser host (localhost HTTP control plane).
 * Tools call this; Electron main implements the server when Desktop launches Metis Server.
 */

export type BrowserHostCommand =
	| { op: "navigate"; url: string; newTab?: boolean; tabId?: string }
	| { op: "tabs"; action: "list" | "select" | "new"; tabId?: string; url?: string }
	| { op: "snapshot"; tabId?: string; interactive?: boolean }
	| { op: "click"; ref: string; tabId?: string }
	| { op: "fill"; ref: string; value: string; tabId?: string }
	| { op: "type"; text: string; ref?: string; tabId?: string; submit?: boolean }
	| { op: "press_key"; key: string; tabId?: string }
	| { op: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number; ref?: string; tabId?: string }
	| { op: "screenshot"; tabId?: string; fullPage?: boolean };

export interface BrowserHostResult {
	ok: boolean;
	error?: string;
	tabId?: string;
	url?: string;
	title?: string;
	tabs?: Array<{ id: string; url: string; title: string; active: boolean }>;
	snapshot?: string;
	screenshotBase64?: string;
	mimeType?: string;
}

export interface BrowserHostClient {
	execute(command: BrowserHostCommand, signal?: AbortSignal): Promise<BrowserHostResult>;
}

export interface HttpBrowserHostOptions {
	baseUrl: string;
	token?: string;
	timeoutMs?: number;
}

export function createHttpBrowserHostClient(options: HttpBrowserHostOptions): BrowserHostClient {
	const timeoutMs = options.timeoutMs ?? 60_000;
	return {
		async execute(command, signal) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			const onAbort = () => controller.abort();
			signal?.addEventListener("abort", onAbort, { once: true });
			try {
				const headers: Record<string, string> = {
					"content-type": "application/json",
					accept: "application/json",
				};
				if (options.token) {
					headers["x-metis-browser-token"] = options.token;
				}
				const response = await fetch(new URL("/browser/command", options.baseUrl).toString(), {
					method: "POST",
					headers,
					body: JSON.stringify(command),
					signal: controller.signal,
				});
				const text = await response.text();
				let parsed: BrowserHostResult | undefined;
				try {
					parsed = text ? (JSON.parse(text) as BrowserHostResult) : undefined;
				} catch {
					parsed = undefined;
				}
				if (!response.ok) {
					return {
						ok: false,
						error: parsed?.error || `Browser host HTTP ${response.status}: ${text.slice(0, 200)}`,
					};
				}
				if (!parsed) {
					return { ok: false, error: "Browser host returned invalid JSON" };
				}
				return parsed;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: `Browser host request failed: ${message}` };
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}

/** Resolve Desktop-injected browser host from environment. */
export function createBrowserHostFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): BrowserHostClient | undefined {
	const baseUrl = env.METIS_BROWSER_HOST?.trim();
	if (!baseUrl) {
		return undefined;
	}
	try {
		const url = new URL(baseUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return undefined;
		}
		if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
			return undefined;
		}
	} catch {
		return undefined;
	}
	return createHttpBrowserHostClient({
		baseUrl: baseUrl.replace(/\/$/, ""),
		token: env.METIS_BROWSER_HOST_TOKEN?.trim() || undefined,
	});
}
