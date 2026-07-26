import type { ExtensionAPI, ExtensionContext } from "metis";
import { resolve } from "path";
import { homedir } from "os";
import { readFileSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { spawn } from "child_process";

interface DreamState {
	enabled: boolean;
	lastDreamDate?: string;
}

const DREAM_CHILD_ENV = "METIS_DREAM_PHASE_CHILD";
const DREAM_CLEANUP_HELPER_ENV = "METIS_DREAM_PHASE_CLEANUP_HELPER";

function getDreamRootDir(): string {
	const agentDir = process.env.METIS_CODING_AGENT_DIR;
	return agentDir ? resolve(agentDir, "..") : resolve(homedir(), ".metis");
}

const METIS_DIR = getDreamRootDir();
const BRAIN_MAP_PATH = resolve(METIS_DIR, "brain-map.md");
const MEMORY_DIR = resolve(METIS_DIR, "memory");
const LESSONS_DIR = resolve(METIS_DIR, "lessons");
const DREAM_STATE_PATH = resolve(METIS_DIR, "dream_state.json");

function readState(): DreamState {
	try {
		if (existsSync(DREAM_STATE_PATH)) {
			return JSON.parse(readFileSync(DREAM_STATE_PATH, "utf-8"));
		}
	} catch {}
	return { enabled: false };
}

function writeState(state: DreamState) {
	try {
		writeFileSync(DREAM_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
	} catch {}
}

function getTodayString(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getDateStringFromMtime(mtimeMs: number): string {
	const date = new Date(mtimeMs);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toPosixPath(path: string): string {
	return path.replace(/\\/g, "/");
}

function getWorkingLogPath(ctx: ExtensionContext): string {
	return toPosixPath(resolve(ctx.cwd, ".temp", `${ctx.sessionManager.getSessionId()}_log.md`));
}

function resolveCurrentModel(ctx: ExtensionContext): { provider: string; id: string } | undefined {
	if (ctx.model) {
		return { provider: ctx.model.provider, id: ctx.model.id };
	}

	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		if (entry.type === "model_change") {
			return { provider: entry.provider, id: entry.modelId };
		}
		if (entry.type === "message" && entry.message.role === "assistant") {
			return { provider: entry.message.provider, id: entry.message.model };
		}
	}

	return undefined;
}

function pruneTempLogs(ctx: ExtensionContext): void {
	const tempDir = resolve(ctx.cwd, ".temp");
	if (!existsSync(tempDir)) return;

	const today = getTodayString();
	for (const entry of readdirSync(tempDir)) {
		if (!entry.endsWith("_log.md")) continue;

		const filePath = resolve(tempDir, entry);
		try {
			const stats = statSync(filePath);
			if (getDateStringFromMtime(stats.mtimeMs) !== today) {
				rmSync(filePath, { force: true });
			}
		} catch {}
	}
}

function buildDreamPrompt(ctx: ExtensionContext): string {
	const workingLogPath = getWorkingLogPath(ctx);
	return `
[BACKGROUND DREAM PHASE]
Do NOT answer any user questions. You are a background task responsible for memory consolidation.
Instructions:
1. Read ${workingLogPath}.
2. Read ${toPosixPath(BRAIN_MAP_PATH)}.
3. Read the detailed files linked from brain-map.md under ${toPosixPath(MEMORY_DIR)}/ and ${toPosixPath(LESSONS_DIR)}/ when relevant.
4. Extract Episodic Memory: You MUST write ONE brief summary node of today's session into the Episodic section of brain-map.md, even if the session was simple. Start it with [Weight: 3]. If the session had no meaningful event, write a minimal summary such as "Reviewed session log; no semantic lesson-worthy issue found.".
5. Extract Semantic Memory (Hippocampus Filter): ONLY extract specific nodes for high cognitive effort events (unexpected quirks, hard bugs). Ignore routine CRUD or UI tasks. If none exist, do not force a lesson file.
6. Create Synapses: When adding new nodes, search brain-map.md for related existing nodes and add bidirectional "[Related: #ID]" links.
7. Apply Forgetting Curve: Check all [Last-Accessed] dates in brain-map.md. Reduce the [Weight] of nodes not accessed in over 3 days by 1.
	8. Garbage Collection: If any node's [Weight] drops to 0, REMOVE it from brain-map.md AND you MUST physically delete/archive its corresponding full-text file in ${toPosixPath(MEMORY_DIR)}/ or ${toPosixPath(LESSONS_DIR)}/.
	9. Leave temp logs untouched. A background cleanup helper will prune stale logs after success. Never delete today's temp log at ${workingLogPath}.
	10. Update ${toPosixPath(DREAM_STATE_PATH)} so lastDreamDate is today and enabled stays true.
	11. Finish tool execution and exit only after at least one write operation has completed.
`;
}

let isDreaming = false;
let dreamCleanupWatcher: NodeJS.Timeout | undefined;

function stopDreamCleanupWatcher(): void {
	if (dreamCleanupWatcher) {
		clearInterval(dreamCleanupWatcher);
		dreamCleanupWatcher = undefined;
	}
}

function startDreamCleanupWatcher(ctx: ExtensionContext, expectedDate: string): void {
	stopDreamCleanupWatcher();
	const startedAt = Date.now();

	dreamCleanupWatcher = setInterval(() => {
		const state = readState();
		if (!state.enabled) {
			stopDreamCleanupWatcher();
			return;
		}

		if (state.lastDreamDate === expectedDate) {
			pruneTempLogs(ctx);
			stopDreamCleanupWatcher();
			updateStatusUI(ctx);
			return;
		}

		if (Date.now() - startedAt > 10 * 60 * 1000) {
			stopDreamCleanupWatcher();
		}
	}, 5 * 1000);
}

function spawnDreamCleanupHelper(ctx: ExtensionContext, expectedDate: string): void {
	const cleanupScript = `
const { existsSync, readdirSync, rmSync, readFileSync, statSync } = require("fs");
const { resolve } = require("path");

const tempDir = process.env.METIS_DREAM_CLEANUP_TEMP_DIR;
const statePath = process.env.METIS_DREAM_CLEANUP_STATE_PATH;
const expectedDate = process.env.METIS_DREAM_CLEANUP_EXPECTED_DATE;
const workingLogPath = process.env.METIS_DREAM_CLEANUP_WORKING_LOG_PATH;

function todayStringFromMs(ms) {
  const date = new Date(ms);
  return \`\${date.getFullYear()}-\${String(date.getMonth() + 1).padStart(2, "0")}-\${String(date.getDate()).padStart(2, "0")}\`;
}

function pruneTempLogs() {
  if (!existsSync(tempDir)) return;
  for (const entry of readdirSync(tempDir)) {
    if (!entry.endsWith("_log.md")) continue;
    const filePath = resolve(tempDir, entry);
    if (filePath === workingLogPath) continue;
    try {
      const stats = statSync(filePath);
      if (todayStringFromMs(stats.mtimeMs) !== expectedDate) {
        rmSync(filePath, { force: true });
      }
    } catch {}
  }
}

let attempts = 0;
const maxAttempts = 120;
const timer = setInterval(() => {
  attempts += 1;
  try {
    if (!existsSync(statePath)) {
      if (attempts >= maxAttempts) {
        clearInterval(timer);
        process.exit(0);
      }
      return;
    }
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    if (state?.lastDreamDate === expectedDate) {
      pruneTempLogs();
      clearInterval(timer);
      process.exit(0);
    }
    if (attempts >= maxAttempts) {
      clearInterval(timer);
      process.exit(0);
    }
  } catch {
    if (attempts >= maxAttempts) {
      clearInterval(timer);
      process.exit(0);
    }
  }
}, 5000);
`;

	const helper = spawn(process.argv[0], ["-e", cleanupScript], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			[DREAM_CLEANUP_HELPER_ENV]: "1",
			METIS_DREAM_CLEANUP_TEMP_DIR: resolve(ctx.cwd, ".temp"),
			METIS_DREAM_CLEANUP_STATE_PATH: DREAM_STATE_PATH,
			METIS_DREAM_CLEANUP_EXPECTED_DATE: expectedDate,
			METIS_DREAM_CLEANUP_WORKING_LOG_PATH: getWorkingLogPath(ctx),
		},
		stdio: "ignore",
		detached: true,
	});
	helper.unref();
}

function updateStatusUI(ctx: ExtensionContext) {
	const state = readState();
	if (!state.enabled) {
		ctx.ui.setStatus("dream", "");
		return;
	}

	if (isDreaming) {
		ctx.ui.setStatus("dream", "💤 Dreaming...");
		return;
	}

	const today = getTodayString();
	if (state.lastDreamDate === today) {
		ctx.ui.setStatus("dream", "🌙 Dream: Done");
	} else {
		ctx.ui.setStatus("dream", "🌙 Dream: Pending");
	}
}

async function triggerDreamPhase(ctx: ExtensionContext, manual = false) {
	if (isDreaming) return;

	const state = readState();
	if (!state.enabled) return;

	const today = getTodayString();
	if (state.lastDreamDate === today && !manual) return;

	isDreaming = true;
	updateStatusUI(ctx);
	startDreamCleanupWatcher(ctx, today);
	spawnDreamCleanupHelper(ctx, today);

	try {
		const childArgs = [process.argv[1], "-p", buildDreamPrompt(ctx)];
		const model = resolveCurrentModel(ctx);
		if (model) {
			childArgs.splice(1, 0, "--provider", model.provider, "--model", model.id);
		}

		const child = spawn(process.argv[0], childArgs, {
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", [DREAM_CHILD_ENV]: "1" },
			stdio: "ignore",
			detached: true,
		});

		child.on("exit", (code) => {
			isDreaming = false;
			if (code === 0) {
				pruneTempLogs(ctx);
				stopDreamCleanupWatcher();

				const currentState = readState();
				currentState.lastDreamDate = getTodayString();
				writeState(currentState);
				ctx.ui.notify("Background Dream Phase completed successfully.");
			} else if (manual) {
				stopDreamCleanupWatcher();
				ctx.ui.notify(`Background Dream Phase failed (exit code ${code}, likely LLM rate limit or API error).`);
			}
			updateStatusUI(ctx);
		});

		child.on("error", (err) => {
			isDreaming = false;
			stopDreamCleanupWatcher();
			if (manual) ctx.ui.notify(`Failed to spawn Dream Phase: ${err.message}`);
			updateStatusUI(ctx);
		});

		child.unref();
	} catch (e: any) {
		isDreaming = false;
		stopDreamCleanupWatcher();
		if (manual) ctx.ui.notify(`Failed to spawn Dream Phase: ${e.message}`);
		updateStatusUI(ctx);
	}
}

export default function dreamMode(metis: ExtensionAPI): void {
	if (process.env[DREAM_CHILD_ENV] === "1") {
		return;
	}

	metis.registerCommand("dream", {
		description: "Toggle automatic brain-like memory consolidation (sleep mode).",
		handler: async (_args, ctx) => {
			const state = readState();
			state.enabled = !state.enabled;
			writeState(state);
			ctx.ui.notify(
				`Dream Mode ${state.enabled ? "enabled" : "disabled"}. ${state.enabled ? "Memory consolidation will happen automatically in the background." : ""}`,
			);

			if (state.enabled) {
				triggerDreamPhase(ctx, true);
			} else {
				updateStatusUI(ctx);
			}
		},
	});

	let cronInterval: NodeJS.Timeout | undefined;

	metis.on("session_start", (_event, ctx) => {
		updateStatusUI(ctx);

		if (cronInterval) {
			clearInterval(cronInterval);
		}

		triggerDreamPhase(ctx);

		cronInterval = setInterval(() => {
			const state = readState();
			if (!state.enabled) return;

			const now = new Date();
			const today = getTodayString();

			if (now.getHours() === 1 && state.lastDreamDate !== today && !ctx.hasPendingMessages() && ctx.isIdle()) {
				triggerDreamPhase(ctx);
			}
		}, 60 * 1000);
	});

	metis.on("session_shutdown", () => {
		if (cronInterval) {
			clearInterval(cronInterval);
		}
		stopDreamCleanupWatcher();
	});
}
