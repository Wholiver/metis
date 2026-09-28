/**
 * Coalesce high-frequency Server SSE frames before they cross Electron IPC.
 *
 * `webContents.send` structured-clones the payload (and contextBridge clones it
 * again). Streaming `message_update` events carry the full assistant message, so
 * forwarding every token stalls both the main process and the renderer.
 *
 * Payloads stay as JSON strings: cloning a string is cheaper than walking the
 * parsed object tree, and the renderer parses once per flushed frame.
 *
 * Inline screenshot base64 (browser tool results) is stripped before IPC. Session
 * files and `/session/messages` keep full images; the live chat tool row only
 * shows text, so omitting live image bytes avoids multi-MB frames that tear the
 * SSE reader mid-turn and briefly drop the "思考中" row.
 */

const COALESCE_TYPES = new Set(["message_update", "tool_execution_update"]);
const DROP_TYPES = new Set(["server.heartbeat"]);
const STRIP_IMAGE_TYPES = new Set([
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_update",
	"tool_execution_end",
]);
/** Skip JSON walk when payload has no large base64 `data` field. */
const LARGE_IMAGE_DATA_RE = /"data"\s*:\s*"[A-Za-z0-9+/=\s]{512,}/;
const IMAGE_TYPE_MARKER = '"type":"image"';
const IMAGE_TYPE_MARKER_SPACED = '"type": "image"';

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

function looksLikeInlineImageBlock(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if (value.type === "image") return true;
	return typeof value.mimeType === "string"
		&& value.mimeType.startsWith("image/")
		&& typeof value.data === "string";
}

/**
 * Replace inline image base64 with a short placeholder; keep mimeType.
 * Returns the same reference when nothing changed.
 */
function stripInlineImageData(value) {
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((item) => {
			const stripped = stripInlineImageData(item);
			if (stripped !== item) changed = true;
			return stripped;
		});
		return changed ? next : value;
	}
	if (!value || typeof value !== "object") return value;

	if (looksLikeInlineImageBlock(value) && typeof value.data === "string" && value.data.length > 0) {
		return {
			...value,
			data: "",
			_omitted: "image_data",
		};
	}

	let changed = false;
	const next = {};
	for (const [key, child] of Object.entries(value)) {
		const stripped = stripInlineImageData(child);
		next[key] = stripped;
		if (stripped !== child) changed = true;
	}
	return changed ? next : value;
}

function prepareSsePayload(data) {
	const text = String(data);
	const type = peekSseEventType(text);
	if (!STRIP_IMAGE_TYPES.has(type)) return text;
	if (
		!LARGE_IMAGE_DATA_RE.test(text)
		&& !text.includes(IMAGE_TYPE_MARKER)
		&& !text.includes(IMAGE_TYPE_MARKER_SPACED)
	) {
		return text;
	}
	try {
		const parsed = JSON.parse(text);
		const stripped = stripInlineImageData(parsed);
		return stripped === parsed ? text : JSON.stringify(stripped);
	} catch {
		return text;
	}
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
		const prepared = prepareSsePayload(data);
		const type = peekSseEventType(prepared);
		if (DROP_TYPES.has(type)) return;
		if (COALESCE_TYPES.has(type)) {
			enqueue(coalesceKey(type, prepared), prepared, peekSseServerSequence(prepared));
			return;
		}
		flush();
		send(prepared);
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
	STRIP_IMAGE_TYPES,
	peekSseEventType,
	peekSseToolCallId,
	peekSseServerSequence,
	stripInlineImageData,
	prepareSsePayload,
	createSseIpcBridge,
};
