/**
 * Coalesce high-frequency Server SSE frames before they cross Electron IPC.
 *
 * `webContents.send` structured-clones the payload (and contextBridge clones it
 * again). Streaming `message_update` events carry the full assistant message, so
 * forwarding every token stalls both the main process and the renderer.
 *
 * Payloads stay as JSON strings: cloning a string is cheaper than walking the
 * parsed object tree, and the renderer parses once per flushed frame.
 */

const COALESCE_TYPES = new Set(["message_update", "tool_execution_update"]);
const DROP_TYPES = new Set(["server.heartbeat"]);

function peekSseEventType(data) {
	const text = String(data);
	const slice = text.slice(0, 192);
	const match = slice.match(/"type"\s*:\s*"((?:\\.|[^"\\])*)"/);
	return match ? match[1] : "";
}

function peekSseToolCallId(data) {
	const text = String(data);
	const slice = text.slice(0, 512);
	const match = slice.match(/"toolCallId"\s*:\s*"((?:\\.|[^"\\])*)"/);
	return match ? match[1] : "";
}

function peekSseServerSequence(data) {
	const text = String(data);
	const slice = text.slice(-192);
	const match = slice.match(/"serverSequence"\s*:\s*(\d+)/);
	return match ? Number(match[1]) : 0;
}

function coalesceKey(type, data) {
	if (type === "tool_execution_update") {
		return `tool_execution_update:${peekSseToolCallId(data) || "_"}`;
	}
	return type;
}

function createSseIpcBridge(options = {}) {
	const send = options.send;
	if (typeof send !== "function") {
		throw new Error("createSseIpcBridge requires options.send");
	}
	const schedule = typeof options.schedule === "function"
		? options.schedule
		: (fn) => setImmediate(fn);
	const cancel = typeof options.cancel === "function"
		? options.cancel
		: (id) => clearImmediate(id);

	let pending = new Map();
	let scheduledId;
	let disposed = false;

	function flush() {
		if (scheduledId !== undefined) {
			cancel(scheduledId);
			scheduledId = undefined;
		}
		if (pending.size === 0) return;
		const frames = [...pending.values()].sort((left, right) => left.sequence - right.sequence);
		pending = new Map();
		for (const frame of frames) send(frame.data);
	}

	function enqueue(key, data, sequence) {
		pending.set(key, { data, sequence });
		if (scheduledId !== undefined) return;
		scheduledId = schedule(flush);
	}

	function push(data) {
		if (disposed || data == null || data === "") return;
		const type = peekSseEventType(data);
		if (DROP_TYPES.has(type)) return;
		if (COALESCE_TYPES.has(type)) {
			enqueue(coalesceKey(type, data), data, peekSseServerSequence(data));
			return;
		}
		flush();
		send(data);
	}

	function dispose() {
		disposed = true;
		if (scheduledId !== undefined) {
			cancel(scheduledId);
			scheduledId = undefined;
		}
		pending = new Map();
	}

	return { push, flush, dispose };
}

module.exports = {
	COALESCE_TYPES,
	DROP_TYPES,
	peekSseEventType,
	peekSseToolCallId,
	peekSseServerSequence,
	createSseIpcBridge,
};
