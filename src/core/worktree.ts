import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Information representing an isolated workspace or worktree (Feat 25)
 */
export interface IsolatedWorkspace {
	workspacePath: string;
	isGitWorktree: boolean;
	branchName?: string;
	preserveOnExit?: boolean;
	cleanup: () => Promise<void>;
}

/**
 * Options for creating an isolated workspace or worktree
 */
export interface CreateIsolatedWorkspaceOptions {
	cwd: string;
	worktree?: string; // "auto", "isolate", "temp", "branch:<name>", or explicit directory path
	agentId?: string;
	preserveOnExit?: boolean;
}

/**
 * Check if a directory is inside a Git working tree
 */
export async function isGitRepository(cwd: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			timeout: 5000,
		});
		return stdout.trim() === "true";
	} catch {
		return false;
	}
}

/**
 * Create an isolated workspace using Git Worktree or a temporary directory (Feat 25)
 */
export async function createIsolatedWorkspace(
	options: CreateIsolatedWorkspaceOptions,
): Promise<IsolatedWorkspace> {
	const { cwd, worktree, agentId, preserveOnExit = false } = options;

	// 1. No worktree requested: use original working directory
	if (!worktree) {
		return {
			workspacePath: cwd,
			isGitWorktree: false,
			preserveOnExit: true,
			cleanup: async () => {},
		};
	}

	const isAuto = worktree === "auto" || worktree === "isolate";
	const isBranch = worktree.startsWith("branch:");
	const isTemp = worktree === "temp" || worktree === "temporary";

	// 2. Explicit directory path (not a special mode)
	if (!isAuto && !isBranch && !isTemp) {
		const resolvedPath = path.isAbsolute(worktree) ? worktree : path.resolve(cwd, worktree);
		await fs.mkdir(resolvedPath, { recursive: true });
		return {
			workspacePath: resolvedPath,
			isGitWorktree: false,
			preserveOnExit: true,
			cleanup: async () => {},
		};
	}

	// 3. Git Worktree mode (auto, isolate, or branch:*)
	if (!isTemp) {
		const isGit = await isGitRepository(cwd);
		if (isGit) {
			const randomSuffix = randomBytes(3).toString("hex");
			const branchName = isBranch
				? worktree.slice("branch:".length).trim()
				: `metis-wt-${agentId ? agentId.replace(/[^a-zA-Z0-9_-]/g, "") : "agent"}-${randomSuffix}`;

			const targetDirName = `metis-worktree-${branchName}`;
			const worktreePath = path.join(tmpdir(), targetDirName);

			try {
				// Try creating git worktree with a new branch first
				try {
					await execFileAsync("git", ["worktree", "add", "-b", branchName, worktreePath, "HEAD"], {
						cwd,
						timeout: 10000,
					});
				} catch {
					// If branch already exists, attach without -b
					await execFileAsync("git", ["worktree", "add", worktreePath, branchName], {
						cwd,
						timeout: 10000,
					});
				}

				const cleanup = async () => {
					if (preserveOnExit) return;
					try {
						await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
							cwd,
							timeout: 10000,
						});
					} catch {
						// Fallback manual rm if git worktree remove fails
						try {
							await fs.rm(worktreePath, { recursive: true, force: true });
							await execFileAsync("git", ["worktree", "prune"], { cwd, timeout: 5000 }).catch(() => {});
						} catch {
							// Ignore cleanup errors
						}
					}

					// Try to delete temporary branch if it was auto-generated
					if (!isBranch) {
						try {
							await execFileAsync("git", ["branch", "-D", branchName], { cwd, timeout: 5000 });
						} catch {
							// Ignore branch delete error
						}
					}
				};

				return {
					workspacePath: worktreePath,
					isGitWorktree: true,
					branchName,
					preserveOnExit,
					cleanup,
				};
			} catch {
				// Fall through to temporary directory mode on git worktree failure
			}
		}
	}

	// 4. Temporary isolated directory mode (fallback or explicit temp mode)
	const randomSuffix = randomBytes(4).toString("hex");
	const tempDir = path.join(
		tmpdir(),
		`metis-isolated-${agentId ? agentId.replace(/[^a-zA-Z0-9_-]/g, "") : "agent"}-${randomSuffix}`,
	);
	await fs.mkdir(tempDir, { recursive: true });

	const cleanup = async () => {
		if (preserveOnExit) return;
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup error
		}
	};

	return {
		workspacePath: tempDir,
		isGitWorktree: false,
		preserveOnExit,
		cleanup,
	};
}

/**
 * Clean up an isolated workspace
 */
export async function cleanupIsolatedWorkspace(workspace: IsolatedWorkspace): Promise<void> {
	await workspace.cleanup();
}
