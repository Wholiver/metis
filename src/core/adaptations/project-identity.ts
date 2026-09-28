import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface ProjectIdentity {
	projectKey: string;
	checkoutKey: string;
	projectRoot: string;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

/** Stable project identity: remote when available, real root otherwise. */
export function resolveProjectIdentity(cwd: string): ProjectIdentity {
	let resolved = resolve(cwd);
	try {
		resolved = realpathSync(resolved);
	} catch {
		/* cwd may disappear during shutdown */
	}
	let root = resolved;
	for (;;) {
		if (existsSync(join(root, ".git"))) break;
		const parent = dirname(root);
		if (parent === root) break;
		root = parent;
	}
	const remote = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 1000,
	}).stdout?.trim();
	const canonical = remote ? remote.replace(/\.git$/i, "").toLowerCase() : root;
	return {
		projectKey: hash(`project:${canonical}`),
		checkoutKey: hash(`checkout:${resolved}`),
		projectRoot: root,
	};
}
