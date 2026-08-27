import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withFileMutationQueue } from "./tools/file-mutation-queue.ts";
import { resolveToCwd } from "./tools/path-utils.ts";

export function getUserIntentPath(cwd: string, sessionId: string): string {
	return resolveToCwd(join(".temp", `${sessionId}_user_intent.md`), cwd);
}

function formatUserIntentEntry(timestamp: string, content: string): string {
	return `## [${timestamp}] User intent\n\n${content}${content.endsWith("\n") ? "" : "\n"}`;
}

function isUserIntentHistory(content: string): boolean {
	return /^## \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] User intent\n/.test(content);
}

export async function appendUserIntent(cwd: string, sessionId: string, content: string): Promise<void> {
	const absolutePath = getUserIntentPath(cwd, sessionId);
	await withFileMutationQueue(absolutePath, async () => {
		await mkdir(dirname(absolutePath), { recursive: true });
		let existing = "";
		try {
			existing = await readFile(absolutePath, "utf-8");
		} catch (error) {
			if (!(error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
				throw error;
			}
		}

		if (existing.trim().length > 0 && !isUserIntentHistory(existing)) {
			const { mtimeMs } = await stat(absolutePath);
			existing = formatUserIntentEntry(new Date(mtimeMs).toISOString(), existing);
		}

		const entry = formatUserIntentEntry(new Date().toISOString(), content);
		const separator = existing.trim().length > 0 ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
		await writeFile(absolutePath, `${existing}${separator}${entry}`, "utf-8");
	});
}

export async function readUserIntent(cwd: string, sessionId: string): Promise<string | undefined> {
	try {
		return await readFile(getUserIntentPath(cwd, sessionId), "utf-8");
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
			return undefined;
		}
		throw error;
	}
}

