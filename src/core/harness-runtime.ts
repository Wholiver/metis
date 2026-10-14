import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_DIR_NAME } from "../config.ts";
import {
	assertValidHarnessDocument,
	type HarnessDocument,
} from "./harness-document.ts";

export const HARNESS_FILE_NAME = "harness.json" as const;

/**
 * Get the canonical path to the project-level harness.json file.
 */
export function getHarnessFilePath(cwd: string): string {
	return resolve(cwd, CONFIG_DIR_NAME, HARNESS_FILE_NAME);
}

/**
 * Check whether a project-level harness.json file exists.
 */
export function hasHarnessFile(cwd: string): boolean {
	return existsSync(getHarnessFilePath(cwd));
}

function deepFreeze<T>(obj: T): Readonly<T> {
	if (obj === null || typeof obj !== "object") {
		return obj;
	}
	Object.freeze(obj);
	for (const key of Object.keys(obj)) {
		const val = (obj as any)[key];
		if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
			deepFreeze(val);
		}
	}
	return obj;
}

const snapshotCache = new Map<string, { mtimeMs: number; snapshot: Readonly<HarnessDocument> }>();

/**
 * Load and validate the project-level harness configuration for a run.
 * - Missing file: returns null (callers must preserve existing legacy paths).
 * - Valid file: returns a frozen HarnessDocument snapshot.
 * - Corrupted or invalid file: throws a descriptive error and halts startup.
 */
export function loadHarnessSnapshot(cwd: string): Readonly<HarnessDocument> | null {
	const filePath = getHarnessFilePath(cwd);
	if (!existsSync(filePath)) {
		snapshotCache.delete(filePath);
		return null;
	}

	let stat;
	try {
		stat = statSync(filePath);
	} catch {
		// fall through if stat fails
	}
	if (stat) {
		const cached = snapshotCache.get(filePath);
		if (cached && cached.mtimeMs === stat.mtimeMs) {
			return cached.snapshot;
		}
	}

	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch (error: any) {
		throw new Error(
			`Failed to read Harness configuration at ${filePath}: ${error?.message || String(error)}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error: any) {
		throw new Error(
			`Failed to parse Harness configuration at ${filePath}: Invalid JSON - ${error?.message || String(error)}`,
		);
	}

	const validated = assertValidHarnessDocument(parsed, filePath);
	const frozen = deepFreeze(validated);
	if (stat) {
		snapshotCache.set(filePath, { mtimeMs: stat.mtimeMs, snapshot: frozen });
	}
	return frozen;
}
