import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

export type DeleteSessionFileResult = {
	ok: boolean;
	method: "trash" | "unlink";
	error?: string;
};

/**
 * Delete a session file, trying the `trash` CLI first, then falling back to unlink.
 */
export async function deleteSessionFile(sessionPath: string): Promise<DeleteSessionFileResult> {
	const resolved = resolvePath(sessionPath);
	const trashArgs = resolved.startsWith("-") ? ["--", resolved] : [resolved];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

	const getTrashErrorHint = (): string | null => {
		const parts: string[] = [];
		if (trashResult.error) {
			parts.push(trashResult.error.message);
		}
		const stderr = trashResult.stderr?.trim();
		if (stderr) {
			parts.push(stderr.split("\n")[0] ?? stderr);
		}
		if (parts.length === 0) return null;
		return `trash: ${parts.join(" · ").slice(0, 200)}`;
	};

	if (trashResult.status === 0 || !existsSync(resolved)) {
		return { ok: true, method: "trash" };
	}

	try {
		await unlink(resolved);
		return { ok: true, method: "unlink" };
	} catch (err) {
		const unlinkError = err instanceof Error ? err.message : String(err);
		const trashErrorHint = getTrashErrorHint();
		const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
		return { ok: false, method: "unlink", error };
	}
}
