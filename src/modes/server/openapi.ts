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
			"/session/prompt": { post: bodyOperation("Submit prompt", json, 202, json) },
			"/session/steer": { post: bodyOperation("Steer active turn", json, 200, json) },
			"/session/follow-up": { post: bodyOperation("Queue follow-up", json, 200, json) },
			"/session/queue": { delete: bodyOperation("Remove queued message", json, 200, json) },
			"/session/queue/promote": { post: bodyOperation("Promote follow-up to steering", json, 200, json) },
			"/session/abort": { post: operation("Abort active turn", 200, json) },
			"/session/compact": { post: bodyOperation("Compact context", json, 200, json) },
			"/session/new": { post: bodyOperation("Create session, optionally in another workspace", json, 200, json) },
			"/session/switch": { post: bodyOperation("Switch session", json, 200, json) },
			"/session/fork": { post: bodyOperation("Fork session", json, 200, json) },
			"/session/model": { put: bodyOperation("Select model", json, 200, json) },
			"/session/thinking": { put: bodyOperation("Set thinking level", json, 200, json) },
		"/session/settings": { put: bodyOperation("Update Agent session settings", json, 200, json) },
		"/commands": { get: operation("List built-in and loaded slash commands", 200, json) },
		"/session/command": { post: bodyOperation("Execute a slash command", json, 200, json) },
			"/session/name": { put: bodyOperation("Set session name", json, 200, json) },
			"/extension/ui-response": { post: bodyOperation("Resolve extension UI request", json, 200, json) },
		},
		components: {
			securitySchemes: { basicAuth: { type: "http", scheme: "basic" } },
			schemas: { Error: error },
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
