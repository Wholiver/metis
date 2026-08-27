import type { ImageContent } from "@earendil-works/metis-ai";
import type { ThinkingOption } from "@earendil-works/metis-ai";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import type { InstructionSourceSummary } from "../../core/system-prompt.ts";
import type { CollaborationMode, WorkflowPlanState } from "../../core/workflow-runtime.ts";
import type { WorkflowProposalState } from "../../core/workflow-runtime.ts";
import type { AskUserRequest } from "../../core/ask-user.ts";
import type { MemoryState } from "../../core/memory-coordinator.ts";
import type { PerformanceRunSummary } from "../../core/performance-runtime.ts";
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
	serverInstanceId: string;
	serverSequence: number;
	cwd: string;
	model: unknown;
	thinkingLevel: string;
	thinkingLevels: string[];
	thinkingOptions: ThinkingOption[];
	supportsThinking: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: string;
	followUpMode: string;
	concurrencyStrategy?: "tokensaver" | "wide" | "custom";
	maxConcurrent?: number;
	collaborationMode: CollaborationMode;
	contextWindowId: string;
	workflowPlan?: WorkflowPlanState;
	workflowProposal?: WorkflowProposalState;
	performanceRun?: PerformanceRunSummary;
	pendingUserInput?: AskUserRequest;
	instructionSources: InstructionSourceSummary[];
	instructionDiagnostics: string[];
	memoryState: MemoryState;
	sessionFile: string | undefined;
	sessionId: string;
	sessionName: string | undefined;
	isGeneratingSessionName: boolean;
	sessionTitleError?: string;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
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

export interface ServerDefaultsState {
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
}

export interface ServerMessageTiming {
	messageTimestamp: number;
	completedAt: number;
}

export interface ServerPromptRequest {
	message: string;
	images?: ImageContent[];
	streamingBehavior?: "steer" | "followUp";
	workflowAction?: "process_proposal";
}

export interface ServerEventMetadata {
	serverInstanceId: string;
	serverSequence: number;
	serverSessionId: string;
}

export type ServerEvent = (
	| { type: "server.connected"; properties: { version: string } }
	| { type: "server.session_changed"; properties: { sessionId: string } }
	| { type: "server.heartbeat"; properties: { timestamp: number } }
	| AgentSessionEvent
	| RpcExtensionUIRequest
	| { type: "extension_error"; extensionPath: string; event: string; error: string }
) & ServerEventMetadata;

export type ServerExtensionUIResponse = RpcExtensionUIResponse;

export interface ServerErrorBody {
	error: {
		code: string;
		message: string;
	};
}
