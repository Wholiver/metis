import { VERSION } from "../../config.ts";

const json = { type: "object", additionalProperties: true } as const;
const error = {
	type: "object",
	required: ["error"],
	properties: {
		error: {
			type: "object",
			required: ["code", "message"],
			properties: { code: { type: "string" }, message: { type: "string" } },
		},
	},
} as const;
const askUserResponse = {
	type: "object",
	additionalProperties: false,
	required: ["cancelled", "answers"],
	properties: {
		cancelled: { type: "boolean" },
		answers: {
			type: "array",
			items: {
				type: "object", additionalProperties: false, required: ["id", "value"],
				properties: { id: { type: "string" }, value: { type: "string" }, selectedLabel: { type: "string" } },
			},
		},
	},
} as const;
const promptRequest = {
	type: "object",
	additionalProperties: false,
	required: ["message"],
	properties: {
		message: { type: "string", minLength: 1 },
		images: { type: "array", items: json },
		streamingBehavior: { type: "string", enum: ["steer", "followUp"] },
		workflowAction: { type: "string", enum: ["process_proposal"], description: "Enable runtime-enforced read_plan then update_plan sequencing for an approved proposal." },
	},
} as const;

export function createServerOpenApiDocument() {
	return {
		openapi: "3.1.0",
		info: {
			title: "Metis Desktop Server API",
			version: VERSION,
			description: "Local REST API and Server-Sent Events transport for Metis Desktop clients.",
		},
		servers: [{ url: "http://127.0.0.1:4096" }],
		paths: {
			"/global/health": { get: operation("Server health", 200, json) },
			"/desktop/work-stats": { get: operation("Desktop work and token activity", 200, json) },
			"/event": {
				get: {
					summary: "Live session event stream",
					responses: {
						"200": {
							description: "SSE stream; each data field is one ServerEvent JSON object",
							content: { "text/event-stream": { schema: { type: "string" } } },
						},
					},
				},
			},
			"/session": { get: operation("Current session state", 200, json) },
			"/sessions": { get: operation("List sessions for a workspace", 200, json) },
			"/session/messages": { get: operation("Current messages", 200, json) },
			"/session/entries": { get: operation("Persisted session entries", 200, json) },
			"/session/tree": { get: operation("Session branch tree", 200, json) },
			"/config/providers": { get: operation("Available models", 200, json) },
			"/session/prompt": { post: bodyOperation("Submit prompt", promptRequest, 202, json) },
			"/session/steer": { post: bodyOperation("Steer active turn", json, 200, json) },
			"/session/follow-up": { post: bodyOperation("Queue follow-up", json, 200, json) },
			"/session/queue": { delete: bodyOperation("Remove queued message", json, 200, json) },
			"/session/queue/promote": { post: bodyOperation("Promote follow-up to steering", json, 200, json) },
			"/session/abort": { post: operation("Abort active turn", 200, json) },
			"/session/user-input/{requestId}": {
				post: {
					...bodyOperation("Answer or cancel a pending ask_user request", askUserResponse, 200, json),
					parameters: [{ name: "requestId", in: "path", required: true, schema: { type: "string" } }],
				},
			},
			"/session/compact": { post: bodyOperation("Compact context", json, 200, json) },
			"/session/new": { post: bodyOperation("Create session, optionally in another workspace", json, 200, json) },
			"/session/switch": { post: bodyOperation("Switch session", json, 200, json) },
			"/session/fork": { post: bodyOperation("Fork session", json, 200, json) },
			"/session/model": { put: bodyOperation("Select model", json, 200, json) },
			"/session/thinking": { put: bodyOperation("Set thinking level", json, 200, json) },
			"/session/collaboration-mode": { put: bodyOperation("Set Build or Plan workflow mode", json, 200, json) },
			"/settings/defaults": { get: operation("Get persisted defaults for new sessions", 200, json), put: bodyOperation("Update persisted defaults for new sessions", json, 200, json) },
			"/memory": { get: operation("Get memory state", 200, json) },
			"/memory/search": { get: operation("Search advisory memory", 200, json) },
			"/memory/settings": { put: bodyOperation("Enable or disable memory", json, 200, json) },
			"/memory/run": { post: operation("Run idle memory consolidation", 200, json) },
			"/memory/reset": { post: bodyOperation("Reset memory with explicit confirmation", json, 200, json) },
		"/session/settings": { put: bodyOperation("Update Agent session settings", json, 200, json) },
		"/commands": { get: operation("List built-in and loaded slash commands", 200, json) },
		"/session/command": { post: bodyOperation("Execute a slash command", json, 200, json) },
			"/session/name": { put: bodyOperation("Set session name", json, 200, json) },
			"/extension/ui-response": { post: bodyOperation("Resolve extension UI request", json, 200, json) },
		},
		components: {
			securitySchemes: { basicAuth: { type: "http", scheme: "basic" } },
			schemas: { Error: error, AskUserResponse: askUserResponse },
		},
		security: [{ basicAuth: [] }],
	};
}

function operation(summary: string, status: number, responseSchema: object) {
	return {
		summary,
		responses: {
			[String(status)]: {
				description: "Success",
				content: { "application/json": { schema: responseSchema } },
			},
			default: {
				description: "Error",
				content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
			},
		},
	};
}

function bodyOperation(summary: string, requestSchema: object, status: number, responseSchema: object) {
	return {
		...operation(summary, status, responseSchema),
		requestBody: {
			required: true,
			content: { "application/json": { schema: requestSchema } },
		},
	};
}
