import type { ImageContent } from "@earendil-works/metis-ai";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "../rpc/rpc-types.ts";

export interface ServerModeOptions {
	hostname?: string;
	port?: number;
	cors?: string[];
	username?: string;
	password?: string;
}

export interface ServerAddress {
	hostname: string;
	port: number;
	url: string;
}

export interface ServerHandle {
	address: ServerAddress;
	closed: Promise<void>;
	close(): Promise<void>;
}

export interface ServerSessionState {
	cwd: string;
	model: unknown;
	thinkingLevel: string;
	thinkingLevels: string[];
	supportsThinking: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: string;
	followUpMode: string;
	sessionFile: string | undefined;
	sessionId: string;
	sessionName: string | undefined;
	isGeneratingSessionName: boolean;
	sessionTitleError?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
	steeringMessages: readonly string[];
	followUpMessages: readonly string[];
	runningSubagentIds: readonly string[];
	extensionStatuses: Record<string, string>;
	contextUsage?: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	};
}

export interface ServerMessageTiming {
	messageTimestamp: number;
	completedAt: number;
}

export interface ServerPromptRequest {
	message: string;
	images?: ImageContent[];
	streamingBehavior?: "steer" | "followUp";
}

export type ServerEvent =
	| { type: "server.connected"; properties: { version: string } }
	| { type: "server.session_changed"; properties: { sessionId: string } }
	| { type: "server.heartbeat"; properties: { timestamp: number } }
	| AgentSessionEvent
	| RpcExtensionUIRequest
	| { type: "extension_error"; extensionPath: string; event: string; error: string };

export type ServerExtensionUIResponse = RpcExtensionUIResponse;

export interface ServerErrorBody {
	error: {
		code: string;
		message: string;
	};
}
