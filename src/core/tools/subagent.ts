import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { openSync, closeSync, existsSync } from "node:fs";
import type { AgentTool } from "@earendil-works/metis-agent-core";
import { Type, type Static } from "typebox";
import { Text } from "@earendil-works/metis-tui";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const subagentSchema = Type.Object({
	title: Type.String({ description: "A brief, capitalized title for the subagent's task (e.g. 'Investigate Project Structure')" }),
	task: Type.String({ description: "The task to be executed by the subagent" }),
});

export const SUBAGENT_COORDINATION_GUIDANCE = [
	"Spawn a background subagent to execute a task in parallel.",
	"When you already intend to launch two or more subagents at the same planning point, issue all of those subagent tool calls consecutively as one uninterrupted batch.",
	"Do not place reasoning text, status text, or any other tool call between consecutive planned subagent calls.",
	"Do not emit a user-facing launch count or waiting notice after the calls; the application UI already shows every running subagent.",
	"As soon as any subagent has started, every currently running subagent forms one strict synchronization barrier.",
	"After the final planned launch, end the turn without status text. Do not take any next step, call any tool, continue independent work, acknowledge or summarize a result, or produce an answer until every running subagent has returned.",
	"Receiving one result never releases this barrier while another subagent is still running; keep waiting silently until the last result arrives, then process all received results together.",
	"This barrier applies to a single subagent and to multiple subagents, whether their tasks are related or independent. There are no exceptions for separate work.",
	"This batching rule does not apply when the need for another subagent is discovered only after substantial intervening work or a long interval.",
	"Never repeat, duplicate, independently investigate, browse, search, verify, checkpoint, log, or use another tool while this barrier is active.",
	"Do not acknowledge or summarize partial subagent results, and do not produce an interim answer; synthesize once after all results arrive.",
	"Do not emit waiting, acknowledgement, progress, or status-only messages while results are pending.",
	"Each finished subagent automatically sends a system message containing its result.",
].join(" ");

export type SubagentToolInput = Static<typeof subagentSchema>;

export interface SubagentToolOptions {
	sendMessage?: (jobId: string, result: string) => void;
	onStatusChange?: (jobId: string, running: boolean) => void;
}

function getMetisInvocation(): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	const isElectron = Boolean(process.versions.electron || process.env.ELECTRON_RUN_AS_NODE);

	if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
		const nodeCmd = isElectron ? "node" : process.execPath;
		return { command: nodeCmd, args: [currentScript] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime && !isElectron) {
		return { command: process.execPath, args: [] };
	}

	return { command: "metis", args: [] };
}

export function createSubagentToolDefinition(
	cwd: string,
	options?: SubagentToolOptions,
): ToolDefinition<typeof subagentSchema, undefined> {
	return {
		name: "subagent",
		label: "subagent",
		description: SUBAGENT_COORDINATION_GUIDANCE,
		promptSnippet: "Delegate tasks to subagents",
		parameters: subagentSchema,
		executionMode: "sequential",
		async execute(toolCallId, { title, task }, _signal, _onUpdate, _ctx) {
			const jobId = toolCallId.slice(-6);
			
			const tempFile = path.join(cwd, `.metis-subagent-${jobId}.txt`);
			await fs.writeFile(tempFile, `[SUBAGENT TASK]\n${task}`, "utf-8");

			const invocation = getMetisInvocation();
			const args = [
				...invocation.args,
				"--print", 
				"Please execute the following task. CRITICAL: You MUST provide a final summary report as text output in your very last message before finishing. Do not end your turn immediately after a tool call without speaking.", 
				`@${path.basename(tempFile)}`
			];

			const outputFile = path.join(cwd, `.metis-subagent-${jobId}.log`);
			
			// Open synchronously so the file descriptor is immediately available for spawn.
			const outFd = openSync(outputFile, "a");

			const child = spawn(invocation.command, args, {
				cwd,
				detached: true,
				stdio: ["ignore", outFd, outFd],
				env: { ...process.env, METIS_OFFLINE: "1", ELECTRON_RUN_AS_NODE: "1" }
			});

			try {
				closeSync(outFd);
			} catch (e) {
				// Ignore
			}

			let settled = false;
			const settle = (): boolean => {
				if (settled) return false;
				settled = true;
				options?.onStatusChange?.(jobId, false);
				return true;
			};

			child.on("close", async () => {
				if (!settle()) return;
				try {
					await fs.unlink(tempFile);
				} catch (e) {
					// Ignore
				}

				if (options?.sendMessage) {
					try {
						const content = await fs.readFile(outputFile, "utf-8");
						const resultText = content.length > 4000 ? "...(truncated)...\n" + content.slice(-4000) : content;
						options.sendMessage(jobId, resultText.trim() || "(No output returned)");
					} catch (e) {
						options.sendMessage(jobId, "(Error reading output file)");
					}
				}
			});
			child.on("error", (error) => {
				if (!settle()) return;
				options?.sendMessage?.(jobId, `(Subagent failed to start: ${error.message})`);
			});

			options?.onStatusChange?.(jobId, true);
			child.unref();

			return {
				content: [{ type: "text", text: `Subagent Job ${jobId} started in the background. Finish any already-planned consecutive subagent calls first, without intervening text. Do not emit a user-facing launch count or waiting notice; the application UI already shows every running subagent. After the final planned launch, end the turn without status text. From the moment any subagent starts, every running subagent forms one strict synchronization barrier. Do not call tools, continue independent work, checkpoint, log, acknowledge partial results, summarize, or answer. Wait silently until every running subagent has returned, even when tasks are independent, then process all results together. Results arrive automatically.` }],
				details: undefined
			};
		},
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const titleDisplay = args.title ? ` - ${args.title}` : "";
			text.setText(theme.fg("toolTitle", theme.bold(`Subagent${titleDisplay}`)));
			return text;
		},
		renderResult(_result, _options, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			// Hide the internal "started" message from the UI to keep it clean.
			text.setText("");
			return text;
		},
	};
}

export function createSubagentTool(cwd: string, options?: SubagentToolOptions): AgentTool<typeof subagentSchema> {
	return wrapToolDefinition(createSubagentToolDefinition(cwd, options));
}
