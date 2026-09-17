/**
 * Minimal workspace probe and shared-cwd ownership helpers for reliable-headless.
 */

import { access, constants, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	findOverlappingOwnedPaths,
	type OwnedPathClaim,
	type TaskPaths,
	type WorkspaceProbeResult,
} from "./execution-types.ts";

async function resolveExistingPath(cwd: string, candidate: string | undefined): Promise<string | undefined> {
	if (!candidate) return undefined;
	const absolute = isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
	try {
		const st = await stat(absolute);
		if (!st.isDirectory() && !st.isFile()) {
			return undefined;
		}
		return await realpath(absolute).catch(() => absolute);
	} catch {
		return undefined;
	}
}

export async function probeWorkspace(cwd: string, taskPaths?: TaskPaths): Promise<WorkspaceProbeResult> {
	const canonicalCwd = await realpath(cwd).catch(() => resolve(cwd));
	try {
		await access(canonicalCwd, constants.R_OK | constants.W_OK);
	} catch {
		return {
			ok: false,
			code: "WORKSPACE_PROBE_FAILED",
			message: `Workspace cwd is not readable/writable: ${canonicalCwd}`,
			canonicalCwd,
			taskPaths: {},
		};
	}

	const resolved: WorkspaceProbeResult["taskPaths"] = {};
	for (const key of ["input", "output", "software"] as const) {
		const raw = taskPaths?.[key];
		if (!raw) continue;
		const found = await resolveExistingPath(canonicalCwd, raw);
		if (!found) {
			return {
				ok: false,
				code: "WORKSPACE_PROBE_FAILED",
				message: `Required task path missing or inaccessible: ${key}=${raw}`,
				canonicalCwd,
				taskPaths: resolved,
			};
		}
		resolved[key] = found;
	}

	return {
		ok: true,
		canonicalCwd,
		taskPaths: resolved,
	};
}

/** Roles that mutate the shared workspace and must serialize under reliable-headless. */
export function isMutatingChildRole(role: string): boolean {
	return [
		"implementer",
		"repairer",
		"contract-solver",
		"planner",
		"sweeper",
		"feature-implementer",
		"root",
	].includes(role);
}

export type WorkspacePolicy = "shared" | "isolated";

export function resolveWorkspacePolicy(env: NodeJS.ProcessEnv = process.env): WorkspacePolicy {
	if (env.METIS_WORKSPACE_POLICY === "isolated") return "isolated";
	return "shared";
}

export function isReliableHeadlessProfile(_env: NodeJS.ProcessEnv = process.env): boolean {
	return true;
}

/**
 * Under reliable-headless, mutating children default to shared cwd unless an
 * explicit isolated route sets METIS_WORKSPACE_POLICY=isolated.
 */
export function resolveChildWorktree(args: {
	role: string;
	requestedWorktree?: string;
	env?: NodeJS.ProcessEnv;
}): string | undefined {
	const env = args.env ?? process.env;
	if (!isReliableHeadlessProfile(env)) {
		return args.requestedWorktree;
	}
	const policy = resolveWorkspacePolicy(env);
	if (policy === "isolated") {
		return args.requestedWorktree;
	}
	// Shared policy: never isolate children into a drifted snapshot.
	return undefined;
}

export class SharedMutatingOwnerRegistry {
	private active = new Map<string, OwnedPathClaim>();

	claim(ownerId: string, ownedPaths: string[]): string | undefined {
		const next: OwnedPathClaim = { ownerId, ownedPaths: ownedPaths.length > 0 ? ownedPaths : ["."] };
		const overlap = findOverlappingOwnedPaths([...this.active.values(), next]);
		if (overlap) {
			return `OVERLAPPING_OWNED_PATHS: mutating owners ${overlap[0]!.ownerId} and ${overlap[1]!.ownerId} claim overlapping paths`;
		}
		if (this.active.size > 0 && isBroadClaim(next.ownedPaths) && [...this.active.values()].some((c) => isBroadClaim(c.ownedPaths))) {
			return `OVERLAPPING_OWNED_PATHS: only one shared-cwd mutating owner may run at a time`;
		}
		this.active.set(ownerId, next);
		return undefined;
	}

	release(ownerId: string): void {
		this.active.delete(ownerId);
	}

	list(): OwnedPathClaim[] {
		return [...this.active.values()];
	}
}

function isBroadClaim(paths: string[]): boolean {
	return paths.some((p) => p === "." || p === "/" || p === "*" || p === "");
}
