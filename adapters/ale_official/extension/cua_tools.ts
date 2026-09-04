/**
 * ALE CUA tools extension — wraps the official ALE `cua_mcp_server` bridge.
 *
 * Registers TypeBox-schema Metis tools that forward to the stdio MCP server
 * ALE stages at `ALE_CUA_MCP_ENTRY` (with `CUA_SERVER_URL`). Shell / filesystem
 * work stays on Metis built-in tools against the sandbox environment.
 *
 * Env (set by MetisDeployer):
 *   ALE_CUA_MCP_NODE   — absolute path to node
 *   ALE_CUA_MCP_ENTRY  — absolute path to cua_mcp_server/src/index.js
 *   CUA_SERVER_URL     — computer-server HTTP endpoint
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtensionAPI } from "metis";
import { Type } from "typebox";

const Coord = Type.Array(Type.Number(), {
	minItems: 2,
	maxItems: 2,
	description: "(x, y) coordinates normalized to [0, 1000].",
});

const MouseButton = Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]);
const ClickCount = Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]);
const ScrollDirection = Type.Union([
	Type.Literal("up"),
	Type.Literal("down"),
	Type.Literal("left"),
	Type.Literal("right"),
]);

type JsonRpcId = number;
type Pending = {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
};

class CuaMcpClient {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private nextId = 1;
	private pending = new Map<JsonRpcId, Pending>();
	private initialized = false;
	private starting: Promise<void> | null = null;

	async ensureStarted(): Promise<void> {
		if (this.initialized) return;
		if (this.starting) return this.starting;
		this.starting = this.start();
		try {
			await this.starting;
		} finally {
			this.starting = null;
		}
	}

	private async start(): Promise<void> {
		const node = process.env.ALE_CUA_MCP_NODE || process.env.NODE || "node";
		const entry = process.env.ALE_CUA_MCP_ENTRY;
		if (!entry) {
			throw new Error("ALE_CUA_MCP_ENTRY is not set (deployer must stage cua MCP bridge)");
		}
		const env = { ...process.env };
		if (!env.CUA_SERVER_URL) {
			env.CUA_SERVER_URL = "http://localhost:5000";
		}

		this.proc = spawn(node, [entry], {
			stdio: ["pipe", "pipe", "pipe"],
			env,
		});

		this.proc.on("exit", (code, signal) => {
			const err = new Error(`cua_mcp_server exited code=${code} signal=${signal}`);
			for (const [, p] of this.pending) p.reject(err);
			this.pending.clear();
			this.initialized = false;
			this.proc = null;
		});

		const rl = createInterface({ input: this.proc.stdout });
		rl.on("line", (line) => this.onLine(line));

		// Drain stderr so the child never blocks on a full pipe.
		this.proc.stderr.on("data", () => {});

		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "metis-ale-cua", version: "1.0.0" },
		});
		this.notify("notifications/initialized", {});
		this.initialized = true;
	}

	private onLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let msg: { id?: JsonRpcId; result?: unknown; error?: { message?: string } };
		try {
			msg = JSON.parse(trimmed);
		} catch {
			return;
		}
		if (msg.id === undefined) return;
		const pending = this.pending.get(msg.id);
		if (!pending) return;
		this.pending.delete(msg.id);
		if (msg.error) {
			pending.reject(new Error(msg.error.message || "MCP error"));
		} else {
			pending.resolve(msg.result);
		}
	}

	private send(payload: Record<string, unknown>): void {
		if (!this.proc?.stdin.writable) {
			throw new Error("cua_mcp_server stdin is not writable");
		}
		this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
	}

	private notify(method: string, params: Record<string, unknown>): void {
		this.send({ jsonrpc: "2.0", method, params });
	}

	private request(method: string, params: Record<string, unknown>): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<{
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError?: boolean;
	}> {
		await this.ensureStarted();
		const result = (await this.request("tools/call", {
			name,
			arguments: args,
		})) as {
			content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			isError?: boolean;
		};
		return {
			content: result?.content ?? [{ type: "text", text: JSON.stringify(result ?? {}) }],
			isError: Boolean(result?.isError),
		};
	}

	async close(): Promise<void> {
		if (!this.proc) return;
		try {
			this.proc.stdin.end();
		} catch {
			/* ignore */
		}
		try {
			this.proc.kill("SIGTERM");
		} catch {
			/* ignore */
		}
		this.proc = null;
		this.initialized = false;
	}
}

function mapMcpContent(
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
	const out: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	for (const part of content) {
		if (part.type === "image" && part.data) {
			out.push({
				type: "image",
				data: part.data,
				mimeType: part.mimeType || "image/png",
			});
		} else if (part.type === "text") {
			out.push({ type: "text", text: part.text ?? "" });
		}
	}
	if (out.length === 0) {
		out.push({ type: "text", text: "(empty CUA tool result)" });
	}
	return out;
}

export default function aleCuaToolsExtension(metis: ExtensionAPI) {
	const client = new CuaMcpClient();

	const forward = (mcpName: string) => {
		return async (_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => {
			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Cancelled" }], isError: true, details: {} };
			}
			try {
				const result = await client.callTool(mcpName, params);
				return {
					content: mapMcpContent(result.content),
					isError: result.isError,
					details: { mcpTool: mcpName },
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `CUA tool ${mcpName} failed: ${message}` }],
					isError: true,
					details: { mcpTool: mcpName, error: message },
				};
			}
		};
	};

	metis.registerTool({
		name: "cua_screenshot",
		label: "CUA Screenshot",
		description: "Take a desktop screenshot via ALE cua_mcp_server. Coordinates for other CUA tools use normalized [0,1000].",
		parameters: Type.Object({
			save_path: Type.Optional(
				Type.String({
					description: "Optional absolute VM path to also save the PNG.",
				}),
			),
		}),
		async execute(toolCallId, params, signal) {
			return forward("screenshot")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_click",
		label: "CUA Click",
		description: "Click at normalized desktop coordinates via ALE cua_mcp_server.",
		parameters: Type.Object({
			coordinate: Type.Optional(Coord),
			button: Type.Optional(MouseButton),
			clicks: Type.Optional(ClickCount),
		}),
		async execute(toolCallId, params, signal) {
			return forward("click")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_type",
		label: "CUA Type",
		description: "Type text into the focused desktop field via ALE cua_mcp_server.",
		parameters: Type.Object({
			text: Type.String({ description: "Text to type." }),
		}),
		async execute(toolCallId, params, signal) {
			return forward("type")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_scroll",
		label: "CUA Scroll",
		description: "Scroll the desktop via ALE cua_mcp_server.",
		parameters: Type.Object({
			direction: ScrollDirection,
			amount: Type.Number({ description: "Scroll units." }),
			coordinate: Type.Optional(Coord),
		}),
		async execute(toolCallId, params, signal) {
			return forward("scroll")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_drag",
		label: "CUA Drag",
		description: "Drag the mouse on the desktop via ALE cua_mcp_server.",
		parameters: Type.Object({
			coordinate: Coord,
			start_coordinate: Type.Optional(Coord),
			button: Type.Optional(MouseButton),
		}),
		async execute(toolCallId, params, signal) {
			return forward("drag")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_key",
		label: "CUA Key",
		description: "Press key(s) / hotkeys via ALE cua_mcp_server.",
		parameters: Type.Object({
			keys: Type.Array(Type.String(), {
				description: 'Keys to press, e.g. ["ctrl","c"] or ["enter"].',
			}),
		}),
		async execute(toolCallId, params, signal) {
			return forward("key")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_key_down",
		label: "CUA Key Down",
		description: "Hold keys down without releasing via ALE cua_mcp_server.",
		parameters: Type.Object({
			keys: Type.Array(Type.String()),
		}),
		async execute(toolCallId, params, signal) {
			return forward("key_down")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_key_up",
		label: "CUA Key Up",
		description: "Release previously held keys via ALE cua_mcp_server.",
		parameters: Type.Object({
			keys: Type.Array(Type.String()),
		}),
		async execute(toolCallId, params, signal) {
			return forward("key_up")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_hold_key",
		label: "CUA Hold Key",
		description: "Hold keys for a duration then release via ALE cua_mcp_server.",
		parameters: Type.Object({
			keys: Type.Array(Type.String()),
			duration: Type.Number({ description: "Seconds to hold." }),
		}),
		async execute(toolCallId, params, signal) {
			return forward("hold_key")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_mouse_move",
		label: "CUA Mouse Move",
		description: "Move the cursor to normalized coordinates via ALE cua_mcp_server.",
		parameters: Type.Object({
			coordinate: Coord,
		}),
		async execute(toolCallId, params, signal) {
			return forward("mouse_move")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_mouse_down",
		label: "CUA Mouse Down",
		description: "Press a mouse button without releasing via ALE cua_mcp_server.",
		parameters: Type.Object({
			button: Type.Optional(MouseButton),
		}),
		async execute(toolCallId, params, signal) {
			return forward("mouse_down")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_mouse_up",
		label: "CUA Mouse Up",
		description: "Release a mouse button via ALE cua_mcp_server.",
		parameters: Type.Object({
			button: Type.Optional(MouseButton),
		}),
		async execute(toolCallId, params, signal) {
			return forward("mouse_up")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_wait",
		label: "CUA Wait",
		description: "Pause for a duration via ALE cua_mcp_server.",
		parameters: Type.Object({
			duration: Type.Number({ description: "Seconds to wait." }),
		}),
		async execute(toolCallId, params, signal) {
			return forward("wait")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_cursor_position",
		label: "CUA Cursor Position",
		description: "Read the current cursor position (normalized) via ALE cua_mcp_server.",
		parameters: Type.Object({}),
		async execute(toolCallId, params, signal) {
			return forward("cursor_position")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.registerTool({
		name: "cua_get_screen_size",
		label: "CUA Screen Size",
		description: "Get absolute pixel screen size via ALE cua_mcp_server.",
		parameters: Type.Object({}),
		async execute(toolCallId, params, signal) {
			return forward("get_screen_size")(toolCallId, params as Record<string, unknown>, signal);
		},
	});

	metis.on("session_shutdown", async () => {
		await client.close();
	});
}
