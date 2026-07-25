export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createLogTool,
	createLogToolDefinition,
	type LogToolInput,
	type LogToolOptions,
} from "./log.ts";
export {
	createRememberUserIntentTool,
	createRememberUserIntentToolDefinition,
	type RememberUserIntentToolInput,
} from "./remember-user-intent.ts";
export {
	createUserIntentTool,
	createUserIntentToolDefinition,
	type UserIntentToolInput,
} from "./user-intent.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export {
	createVideoTool,
	createVideoToolDefinition,
	type VideoAction,
	type VideoMetadata,
	type VideoOperations,
	type VideoToolDetails,
	type VideoToolInput,
	type VideoToolOptions,
} from "./video.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";
export {
	createSubagentTool,
	createSubagentToolDefinition,
	type SubagentToolInput,
	type SubagentToolOptions,
} from "./subagent.ts";
export {
	createWebSearchTool,
	createWebSearchToolDefinition,
	type WebSearchToolInput,
	type WebSearchToolOptions,
} from "./websearch.ts";
export {
	createWebFetchTool,
	createWebFetchToolDefinition,
	type WebFetchToolInput,
	type WebFetchToolOptions,
} from "./webfetch.ts";

import type { AgentTool } from "@earendil-works/metis-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createLogTool, createLogToolDefinition, type LogToolOptions } from "./log.ts";
import { createRememberUserIntentTool, createRememberUserIntentToolDefinition } from "./remember-user-intent.ts";
import { createUserIntentTool, createUserIntentToolDefinition } from "./user-intent.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import { createVideoTool, createVideoToolDefinition, type VideoToolOptions } from "./video.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";
import { createSubagentTool, createSubagentToolDefinition, type SubagentToolOptions } from "./subagent.ts";
import { createWebSearchTool, createWebSearchToolDefinition, type WebSearchToolOptions } from "./websearch.ts";
import { createWebFetchTool, createWebFetchToolDefinition, type WebFetchToolOptions } from "./webfetch.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName =
	| "read"
	| "bash"
	| "edit"
	| "write"
	| "log"
	| "remember_user_intent"
	| "user_intent"
	| "grep"
	| "find"
	| "ls"
	| "subagent"
	| "websearch"
	| "webfetch"
	| "video";
export const allToolNames: Set<ToolName> = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"log",
	"remember_user_intent",
	"user_intent",
	"grep",
	"find",
	"ls",
	"subagent",
	"websearch",
	"webfetch",
	"video",
]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	log?: LogToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	subagent?: SubagentToolOptions;
	websearch?: WebSearchToolOptions;
	webfetch?: WebFetchToolOptions;
	video?: VideoToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	switch (toolName) {
		case "read":
			return createReadToolDefinition(cwd, options?.read);
		case "bash":
			return createBashToolDefinition(cwd, options?.bash);
		case "edit":
			return createEditToolDefinition(cwd, options?.edit);
		case "write":
			return createWriteToolDefinition(cwd, options?.write);
		case "log":
			return createLogToolDefinition(cwd, options?.log);
		case "remember_user_intent":
			return createRememberUserIntentToolDefinition(cwd);
		case "user_intent":
			return createUserIntentToolDefinition(cwd);
		case "grep":
			return createGrepToolDefinition(cwd, options?.grep);
		case "find":
			return createFindToolDefinition(cwd, options?.find);
		case "ls":
			return createLsToolDefinition(cwd, options?.ls);
		case "subagent":
			return createSubagentToolDefinition(cwd, options?.subagent);
		case "websearch":
			return createWebSearchToolDefinition(options?.websearch);
		case "webfetch":
			return createWebFetchToolDefinition(options?.webfetch);
		case "video":
			return createVideoToolDefinition(cwd, options?.video);
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	switch (toolName) {
		case "read":
			return createReadTool(cwd, options?.read);
		case "bash":
			return createBashTool(cwd, options?.bash);
		case "edit":
			return createEditTool(cwd, options?.edit);
		case "write":
			return createWriteTool(cwd, options?.write);
		case "log":
			return createLogTool(cwd, options?.log);
		case "remember_user_intent":
			return createRememberUserIntentTool(cwd);
		case "user_intent":
			return createUserIntentTool(cwd);
		case "grep":
			return createGrepTool(cwd, options?.grep);
		case "find":
			return createFindTool(cwd, options?.find);
		case "ls":
			return createLsTool(cwd, options?.ls);
		case "subagent":
			return createSubagentTool(cwd, options?.subagent);
		case "websearch":
			return createWebSearchTool(options?.websearch);
		case "webfetch":
			return createWebFetchTool(options?.webfetch);
		case "video":
			return createVideoTool(cwd, options?.video);
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd, options?.edit),
		createWriteToolDefinition(cwd, options?.write),
		createLogToolDefinition(cwd, options?.log),
		createRememberUserIntentToolDefinition(cwd),
		createUserIntentToolDefinition(cwd),
		createSubagentToolDefinition(cwd, options?.subagent),
		createWebSearchToolDefinition(options?.websearch),
		createWebFetchToolDefinition(options?.webfetch),
		createVideoToolDefinition(cwd, options?.video),
	];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
		createVideoToolDefinition(cwd, options?.video),
	];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		read: createReadToolDefinition(cwd, options?.read),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd, options?.edit),
		write: createWriteToolDefinition(cwd, options?.write),
		log: createLogToolDefinition(cwd, options?.log),
		remember_user_intent: createRememberUserIntentToolDefinition(cwd),
		user_intent: createUserIntentToolDefinition(cwd),
		grep: createGrepToolDefinition(cwd, options?.grep),
		find: createFindToolDefinition(cwd, options?.find),
		ls: createLsToolDefinition(cwd, options?.ls),
		subagent: createSubagentToolDefinition(cwd, options?.subagent),
		websearch: createWebSearchToolDefinition(options?.websearch),
		webfetch: createWebFetchToolDefinition(options?.webfetch),
		video: createVideoToolDefinition(cwd, options?.video),
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
		createLogTool(cwd, options?.log),
		createRememberUserIntentTool(cwd),
		createUserIntentTool(cwd),
		createSubagentTool(cwd, options?.subagent),
		createWebSearchTool(options?.websearch),
		createWebFetchTool(options?.webfetch),
		createVideoTool(cwd, options?.video),
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
		createVideoTool(cwd, options?.video),
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd, options?.edit),
		write: createWriteTool(cwd, options?.write),
		log: createLogTool(cwd, options?.log),
		remember_user_intent: createRememberUserIntentTool(cwd),
		user_intent: createUserIntentTool(cwd),
		grep: createGrepTool(cwd, options?.grep),
		find: createFindTool(cwd, options?.find),
		ls: createLsTool(cwd, options?.ls),
		subagent: createSubagentTool(cwd, options?.subagent),
		websearch: createWebSearchTool(options?.websearch),
		webfetch: createWebFetchTool(options?.webfetch),
		video: createVideoTool(cwd, options?.video),
	};
}
