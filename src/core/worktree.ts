import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SNAPSHOT_MAX_BUFFER = 64 * 1024 * 1024;
const TRANSIENT_AGENT_FILE = /^\.metis-(?:agent-task-|subagent-|agent-.*\.log$)/;

function isSafeSnapshotPath(relativePath: string): boolean {
	return Boolean(relativePath)
		&& !path.isAbsolute(relativePath)
		&& !relativePath.split(/[\\/]/).includes("..")
		&& !TRANSIENT_AGENT_FILE.test(path.basename(relativePath));
}

async function copyUntrackedFiles(cwd: string, workspacePath: string): Promise<void> {
	const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
		cwd,
		maxBuffer: SNAPSHOT_MAX_BUFFER,
	});
	for (const relativePath of stdout.split("\0").filter(isSafeSnapshotPath)) {
		const source = path.join(cwd, relativePath);
		const target = path.join(workspacePath, relativePath);
		const stat = await fs.lstat(source);
		await fs.mkdir(path.dirname(target), { recursive: true });
		if (stat.isSymbolicLink()) {
			try {
				await fs.symlink(await fs.readlink(source), target);
			} catch {
				try {
					await fs.copyFile(source, target);
				} catch {}
			}
		} else if (stat.isFile()) {
			await fs.copyFile(source, target);
			await fs.chmod(target, stat.mode).catch(() => {});
		}
	}
}

async function seedGitWorktreeFromParent(cwd: string, workspacePath: string): Promise<void> {
	const { stdout } = await execFileAsync("git", ["diff", "--binary", "HEAD", "--", "."], {
		cwd,
		maxBuffer: SNAPSHOT_MAX_BUFFER,
	});
	if (stdout) {
		const patchPath = path.join(workspacePath, `.metis-worktree-snapshot-${randomBytes(3).toString("hex")}.patch`);
		await fs.writeFile(patchPath, stdout, "utf8");
		try {
			await execFileAsync("git", ["apply", "--whitespace=nowarn", patchPath], {
				cwd: workspacePath,
				maxBuffer: SNAPSHOT_MAX_BUFFER,
			});
		} finally {
			await fs.unlink(patchPath).catch(() => {});
		}
	}
	await copyUntrackedFiles(cwd, workspacePath);
}

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
 * Check if a Git branch exists in local refs
 */
export async function isGitBranchExists(cwd: string, branchName: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
			cwd,
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
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
 * Check if a directory is specifically the root / top-level of a Git repository
 */
export async function isGitRepositoryRoot(cwd: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 5000,
		});
		const realToplevel = await fs.realpath(stdout.trim()).catch(() => path.resolve(stdout.trim()));
		const realCwd = await fs.realpath(cwd).catch(() => path.resolve(cwd));
		if (realToplevel !== realCwd) return false;
		const gitEntry = path.join(cwd, ".git");
		return await fs.stat(gitEntry).then(() => true).catch(() => false);
	} catch {
		return false;
	}
}

/**
 * Copy directory snapshot recursively for non-git-root workspaces,
 * preserving relative layout, permissions, and symlinks while omitting transient files.
 */
export async function copyDirectorySnapshot(sourceDir: string, targetDir: string): Promise<void> {
	try {
		const entries = await fs.readdir(sourceDir, { withFileTypes: true });
		for (const entry of entries) {
			const name = entry.name;
			if (TRANSIENT_AGENT_FILE.test(name)) continue;
			const srcPath = path.join(sourceDir, name);
			const dstPath = path.join(targetDir, name);

			if (entry.isSymbolicLink()) {
				try {
					const linkTarget = await fs.readlink(srcPath);
					await fs.symlink(linkTarget, dstPath);
				} catch {
					try {
						await fs.copyFile(srcPath, dstPath);
					} catch {}
				}
			} else if (entry.isDirectory()) {
				await fs.mkdir(dstPath, { recursive: true });
				await copyDirectorySnapshot(srcPath, dstPath);
			} else if (entry.isFile()) {
				try {
					await fs.copyFile(srcPath, dstPath);
					const stat = await fs.stat(srcPath).catch(() => null);
					if (stat) {
						await fs.chmod(dstPath, stat.mode).catch(() => {});
					}
				} catch {}
			}
		}
	} catch {
		// Ignore readdir failure on non-existent or inaccessible source
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
		const isGitRoot = await isGitRepositoryRoot(cwd);
		if (isBranch && !isGitRoot) {
			throw new Error(`Failed to create current-state worktree: Git branch worktree requested ("${worktree}"), but directory is not a Git repository root: ${cwd}`);
		}
		if (isGitRoot) {
			const randomSuffix = randomBytes(3).toString("hex");
			const branchName = isBranch
				? worktree.slice("branch:".length).trim()
				: `metis-wt-${agentId ? agentId.replace(/[^a-zA-Z0-9_-]/g, "") : "agent"}-${randomSuffix}`;

			const targetDirName = `metis-worktree-${branchName}`;
			const worktreePath = path.join(tmpdir(), targetDirName);

			// Clean up any stale directory or leftover worktree state before attempting creation
			try {
				await fs.rm(worktreePath, { recursive: true, force: true });
			} catch {}
			await execFileAsync("git", ["worktree", "prune"], { cwd, timeout: 5000 }).catch(() => {});

			let worktreeCreated = false;
			try {
				const branchExists = await isGitBranchExists(cwd, branchName);
				if (branchExists) {
					await execFileAsync("git", ["worktree", "add", worktreePath, branchName], {
						cwd,
						timeout: 10000,
					});
				} else {
					await execFileAsync("git", ["worktree", "add", "-b", branchName, worktreePath, "HEAD"], {
						cwd,
						timeout: 10000,
					});
				}
				worktreeCreated = true;
				await seedGitWorktreeFromParent(cwd, worktreePath);

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
			} catch (error) {
				if (worktreeCreated) {
					await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], { cwd, timeout: 10000 }).catch(() => {});
					if (!isBranch) await execFileAsync("git", ["branch", "-D", branchName], { cwd, timeout: 5000 }).catch(() => {});
				} else {
					await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
					await execFileAsync("git", ["worktree", "prune"], { cwd, timeout: 5000 }).catch(() => {});
				}

				if (isBranch) {
					throw new Error(`Failed to create current-state worktree: ${error instanceof Error ? error.message : String(error)}`);
				}
				// In auto/isolate mode, fall through to step 4 (temporary directory mode)
			}
		}
	}

	// 4. Temporary isolated directory mode (fallback, non-git root, or explicit temp mode)
	const randomSuffix = randomBytes(4).toString("hex");
	const tempDir = path.join(
		tmpdir(),
		`metis-isolated-${agentId ? agentId.replace(/[^a-zA-Z0-9_-]/g, "") : "agent"}-${randomSuffix}`,
	);
	await fs.mkdir(tempDir, { recursive: true });
	await copyDirectorySnapshot(cwd, tempDir);

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

