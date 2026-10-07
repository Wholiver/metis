/**
 * Client for Metis Desktop Routine host (localhost HTTP control plane).
 * Tools call this; Electron main implements the server when Desktop launches Metis Server.
 */

export interface RoutineItemData {
	id: string;
	title: string;
	cron: string;
	prompt: string;
	projectPath?: string;
	status: "active" | "paused";
	createdAt: string;
	lastRunAt?: string;
	lastSessionId?: string;
	lastStatus?: "success" | "failed" | "running";
	lastError?: string;
	nextRunAt?: string;
	source?: "manual" | "self_learning";
}

export type RoutineHostCommand =
	| { action: "list" }
	| { action: "create"; payload: { title: string; cron: string; prompt: string; projectPath?: string; status?: "active" | "paused"; source?: "manual" | "self_learning" } }
	| { action: "update"; id: string; patch: { title?: string; cron?: string; prompt?: string; projectPath?: string; status?: "active" | "paused"; source?: "manual" | "self_learning" } }
	| { action: "delete"; id: string }
	| { action: "run_now"; id: string };

export interface RoutineHostResult {
	ok: boolean;
	error?: string;
	routine?: RoutineItemData;
	routines?: RoutineItemData[];
	sessionId?: string;
}

export interface RoutineHostClient {
	execute(command: RoutineHostCommand, signal?: AbortSignal): Promise<RoutineHostResult>;
}

export interface HttpRoutineHostOptions {
	baseUrl: string;
	token?: string;
	timeoutMs?: number;
}

export function createHttpRoutineHostClient(options: HttpRoutineHostOptions): RoutineHostClient {
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
					headers["x-metis-routine-token"] = options.token;
				}
				const response = await fetch(new URL("/routine/command", options.baseUrl).toString(), {
					method: "POST",
					headers,
					body: JSON.stringify(command),
					signal: controller.signal,
				});
				const text = await response.text();
				let parsed: RoutineHostResult | undefined;
				try {
					parsed = text ? (JSON.parse(text) as RoutineHostResult) : undefined;
				} catch {
					parsed = undefined;
				}
				if (!response.ok) {
					return {
						ok: false,
						error: parsed?.error || text || `Routine host HTTP ${response.status}`,
					};
				}
				return parsed ?? { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message };
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}

export function createRoutineHostFromEnv(env: NodeJS.ProcessEnv = process.env): RoutineHostClient | null {
	const baseUrl = env.METIS_ROUTINE_HOST?.trim();
	if (!baseUrl) return null;
	return createHttpRoutineHostClient({
		baseUrl,
		token: env.METIS_ROUTINE_HOST_TOKEN?.trim() || undefined,
	});
}
