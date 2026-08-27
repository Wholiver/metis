import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
	method: string;
	url: string;
	headers: http.IncomingHttpHeaders;
	body: any;
	timestamp: number;
}

export interface MockToolCall {
	id?: string;
	name: string;
	arguments: Record<string, unknown> | string;
}

export interface MockChatCompletionResponse {
	text?: string;
	toolCalls?: MockToolCall[];
	finishReason?: "stop" | "tool_calls" | "length" | "content_filter" | null;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	delayMs?: number;
	statusCode?: number;
	error?: {
		message: string;
		type?: string;
		code?: string;
	};
}

export type ResponseHandler = (req: RecordedRequest) => MockChatCompletionResponse | Promise<MockChatCompletionResponse>;

export class MockOpenAIServer {
	private server: http.Server | null = null;
	private port = 0;
	private requests: RecordedRequest[] = [];
	private responseQueue: (MockChatCompletionResponse | ResponseHandler)[] = [];
	private defaultHandler: ResponseHandler | null = null;

	public async start(): Promise<string> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer(async (req, res) => {
				try {
					await this.handleRequest(req, res);
				} catch (err: any) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: { message: err.message } }));
				}
			});

			this.server.listen(0, "127.0.0.1", () => {
				const addr = this.server!.address() as AddressInfo;
				this.port = addr.port;
				resolve(this.getBaseUrl());
			});

			this.server.on("error", reject);
		});
	}

	public async stop(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.server) {
				resolve();
				return;
			}
			this.server.close(() => {
				this.server = null;
				resolve();
			});
		});
	}

	public getPort(): number {
		return this.port;
	}

	public getBaseUrl(): string {
		return `http://127.0.0.1:${this.port}/v1`;
	}

	public getRequests(): RecordedRequest[] {
		return [...this.requests];
	}

	public clearRequests(): void {
		this.requests = [];
	}

	public enqueueResponse(resp: MockChatCompletionResponse | ResponseHandler): void {
		this.responseQueue.push(resp);
	}

	public setHandler(handler: ResponseHandler | null): void {
		this.defaultHandler = handler;
	}

	public reset(): void {
		this.requests = [];
		this.responseQueue = [];
		this.defaultHandler = null;
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const method = req.method || "GET";
		const url = req.url || "/";

		let bodyBuffer = "";
		for await (const chunk of req) {
			bodyBuffer += chunk.toString("utf-8");
		}

		let parsedBody: any = null;
		if (bodyBuffer) {
			try {
				parsedBody = JSON.parse(bodyBuffer);
			} catch {
				parsedBody = bodyBuffer;
			}
		}

		const recorded: RecordedRequest = {
			method,
			url,
			headers: req.headers,
			body: parsedBody,
			timestamp: Date.now(),
		};
		this.requests.push(recorded);

		// Handle Models endpoint
		if (method === "GET" && (url === "/v1/models" || url === "/models")) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					object: "list",
					data: [
						{ id: "mock-model", object: "model", owned_by: "metis-test" },
						{ id: "anthropic/claude-3.5-sonnet", object: "model", owned_by: "openrouter" },
						{ id: "gpt-4o", object: "model", owned_by: "openai" },
					],
				}),
			);
			return;
		}

		// Handle Chat Completions endpoint
		if (method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
			let responseData: MockChatCompletionResponse;
			if (this.responseQueue.length > 0) {
				const next = this.responseQueue.shift()!;
				responseData = typeof next === "function" ? await next(recorded) : next;
			} else if (this.defaultHandler) {
				responseData = await this.defaultHandler(recorded);
			} else {
				responseData = {
					text: "Mock completion response",
					finishReason: "stop",
				};
			}

			if (responseData.delayMs && responseData.delayMs > 0) {
				await new Promise((r) => setTimeout(r, responseData.delayMs));
			}

			if (responseData.error) {
				res.writeHead(responseData.statusCode || 400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: responseData.error }));
				return;
			}

			const requestedModel = parsedBody?.model || "mock-model";
			const isStream = Boolean(parsedBody?.stream);

			if (isStream) {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});

				const chunkId = `chatcmpl-${Date.now()}`;

				if (responseData.toolCalls && responseData.toolCalls.length > 0) {
					for (let i = 0; i < responseData.toolCalls.length; i++) {
						const tc = responseData.toolCalls[i];
						const argsStr = typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments);
						const callId = tc.id || `call_${i}_${Date.now()}`;

						const toolChunk = {
							id: chunkId,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: requestedModel,
							choices: [
								{
									index: 0,
									delta: {
										role: "assistant",
										tool_calls: [
											{
												index: i,
												id: callId,
												type: "function",
												function: {
													name: tc.name,
													arguments: argsStr,
												},
											},
										],
									},
									finish_reason: null,
								},
							],
						};
						res.write(`data: ${JSON.stringify(toolChunk)}\n\n`);
					}

					// Finish chunk
					const finishChunk = {
						id: chunkId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: requestedModel,
						choices: [
							{
								index: 0,
								delta: {},
								finish_reason: responseData.finishReason || "tool_calls",
							},
						],
						usage: responseData.usage || {
							prompt_tokens: 120,
							completion_tokens: 45,
							total_tokens: 165,
						},
					};
					res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
				} else {
					// Text streaming
					const text = responseData.text ?? "Mock answer";
					const textChunk = {
						id: chunkId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: requestedModel,
						choices: [
							{
								index: 0,
								delta: {
									role: "assistant",
									content: text,
								},
								finish_reason: null,
							},
						],
					};
					res.write(`data: ${JSON.stringify(textChunk)}\n\n`);

					const finishChunk = {
						id: chunkId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: requestedModel,
						choices: [
							{
								index: 0,
								delta: {},
								finish_reason: responseData.finishReason || "stop",
							},
						],
						usage: responseData.usage || {
							prompt_tokens: 80,
							completion_tokens: 30,
							total_tokens: 110,
						},
					};
					res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
				}

				res.write("data: [DONE]\n\n");
				res.end();
			} else {
				// Non-streaming JSON response
				const message: any = {
					role: "assistant",
					content: responseData.text || null,
				};
				if (responseData.toolCalls && responseData.toolCalls.length > 0) {
					message.tool_calls = responseData.toolCalls.map((tc, idx) => ({
						id: tc.id || `call_${idx}_${Date.now()}`,
						type: "function",
						function: {
							name: tc.name,
							arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
						},
					}));
				}

				const fullResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: requestedModel,
					choices: [
						{
							index: 0,
							message,
							finish_reason: responseData.finishReason || (responseData.toolCalls?.length ? "tool_calls" : "stop"),
						},
					],
					usage: responseData.usage || {
						prompt_tokens: 100,
						completion_tokens: 40,
						total_tokens: 140,
					},
				};

				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(fullResponse));
			}
			return;
		}

		// 404 for other endpoints
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: { message: `Route not found: ${method} ${url}` } }));
	}
}

