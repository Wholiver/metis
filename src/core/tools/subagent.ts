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
	"Spawn a background subagent for parallel work.",
	"If 2+ launches are planned at one planning point, issue all of those subagent tool calls consecutively as one uninterrupted batch; do not place reasoning text, status text, or any other tool call between them.",
	"After calls, do not emit a user-facing launch count or waiting notice; UI shows running subagents.",
	"Once any starts, the current Agent run pauses after the launch batch; do not continue work, call another tool, checkpoint, log, or request another model turn while waiting for the next result.",
	"After final planned launch, end the turn without status text. Each completed subagent resumes the Agent separately, in completion order.",
	"For every completed result, first emit a brief user-visible update, then decide whether to continue work now or end the turn and wait for another running subagent.",
	"A completed result releases the current pause even when other subagents are still running; those remaining results will resume the Agent separately.",
	"Batching exception: another subagent need discovered only after substantial intervening work or a long interval.",
	"Finished subagents automatically send system result messages.",
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
				"Execute task. Your very last message MUST be a text final-summary report; never finish directly after a tool call.",
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
				content: [{ type: "text", text: `Subagent ${jobId} started. Finish every already-planned Subagent launch in this same uninterrupted batch, then end the turn without status text, more tools, checkpointing, or logging. The next completed result will resume the Agent automatically.` }],
				details: undefined,
				terminate: true,
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
