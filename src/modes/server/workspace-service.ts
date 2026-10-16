import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 300_000;
const MAX_FILE_READ_BYTES = 5 * 1024 * 1024;
const MAX_TREE_ITEMS = 3_000;

const IGNORED_DIRECTORIES = new Set([
	".git",
	".codegraph",
	".sessions",
	".metis",
	"node_modules",
	".next",
	".nuxt",
	".svelte-kit",
	"dist",
	"build",
	"out",
	".turbo",
	".cache",
	"target",
	"bin",
	"obj",
	".vs",
	".idea",
	".gradle",
	".venv",
	"venv",
	"__pycache__",
]);

const BINARY_EXTENSIONS = new Set([
	".7z", ".ai", ".aif", ".apk", ".app", ".avi", ".bin", ".bmp", ".bz2",
	".class", ".dat", ".db", ".dll", ".dmg", ".dylib", ".eot", ".exe",
	".flac", ".gif", ".gz", ".ico", ".iso", ".jar", ".jpeg", ".jpg",
	".m4a", ".mid", ".mkv", ".mov", ".mp3", ".mp4", ".mpeg", ".mpg",
	".ogg", ".otf", ".pdf", ".png", ".psd", ".pyc", ".rar", ".so",
	".sqlite", ".sqlite3", ".svgz", ".tar", ".tgz", ".tif", ".tiff",
	".ttf", ".wasm", ".wav", ".webm", ".webp", ".wma", ".wmv", ".woff",
	".woff2", ".xz", ".zip", ".zst",
]);

export interface TreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: TreeNode[];
}

export interface WorkspaceSummary {
	name: string;
	path: string;
	isGitRepo: boolean;
}

export interface WorkspaceTreeResult {
	root: WorkspaceSummary;
	nodes: TreeNode[];
	truncated: boolean;
}

export interface GitInfo {
	isRepo: boolean;
	branch: string | null;
	defaultBranch: string | null;
}

export interface GitFileStatus {
	file: string;
	additions: number;
	deletions: number;
	status: "added" | "deleted" | "modified";
	xy?: string;
	staged?: boolean;
	unstaged?: boolean;
}

export interface GitStatusResult {
	info: GitInfo;
	files: GitFileStatus[];
}

export interface GitDiffResult {
	path: string;
	diff: string;
	truncated: boolean;
}

export function resolveSafeWorkspacePath(baseDir: string, relativePath: string): string {
	const normalized = relativePath.replace(/\\/g, "/");
	const absolutePath = path.resolve(baseDir, normalized);
	const rel = path.relative(baseDir, absolutePath);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error("Path escapes workspace directory");
	}
	if (fs.existsSync(absolutePath)) {
		try {
			const realBase = fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : baseDir;
			const realTarget = fs.realpathSync(absolutePath);
			const relReal = path.relative(realBase, realTarget);
			if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
				throw new Error("Path escapes workspace directory");
			}
		} catch (err: any) {
			if (err.message === "Path escapes workspace directory") throw err;
		}
	}
	return absolutePath;
}

export function validateWorkspaceDirectory(targetPath: string): { valid: boolean; resolved?: string; error?: string } {
	if (!targetPath || typeof targetPath !== "string" || !targetPath.trim()) {
		return { valid: false, error: "Workspace path cannot be empty" };
	}
	const resolved = path.resolve(targetPath.trim());
	if (!fs.existsSync(resolved)) {
		return { valid: false, error: `Directory does not exist: ${resolved}` };
	}
	const stat = fs.statSync(resolved);
	if (!stat.isDirectory()) {
		return { valid: false, error: `Path is not a directory: ${resolved}` };
	}
	return { valid: true, resolved };
}

export function isGitRepoSync(dir: string): boolean {
	return fs.existsSync(path.join(dir, ".git"));
}

function normalizeKeyPath(p: string): string {
	if (!p || typeof p !== "string") return "";
	const resolved = path.resolve(p).replace(/\\/g, "/");
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function runGit(cwd: string, args: string[], options: { maxBuffer?: number; timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
	try {
		const result = await execFileAsync("git", args, {
			cwd,
			maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
			timeout: options.timeout || 15_000,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		});
		return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
	} catch (error: any) {
		if (error.code === "ENOENT") throw new Error("Git is not installed");
		if (typeof error.stdout === "string" && error.stdout.length > 0) {
			return { stdout: String(error.stdout), stderr: String(error.stderr || "") };
		}
		throw error instanceof Error ? error : new Error(String(error?.message || error));
	}
}

export async function isGitRepo(cwd: string): Promise<boolean> {
	if (isGitRepoSync(cwd)) return true;
	try {
		const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], { timeout: 5_000 });
		return result.stdout.trim() === "true";
	} catch {
		return false;
	}
}

export async function readDefaultBranch(cwd: string): Promise<string | null> {
	try {
		const symbolic = await runGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"], { timeout: 5_000 });
		const match = symbolic.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
		if (match?.[1]) return match[1];
	} catch {}
	for (const candidate of ["main", "master"]) {
		try {
			await runGit(cwd, ["rev-parse", "--verify", candidate], { timeout: 5_000 });
			return candidate;
		} catch {}
	}
	return null;
}

const inflightGitInfo = new Map<string, Promise<GitInfo>>();

export function readGitInfo(cwd: string): Promise<GitInfo> {
	const key = normalizeKeyPath(cwd);
	const existing = inflightGitInfo.get(key);
	if (existing) return existing;
	const promise = (async () => {
		try {
			const isRepo = await isGitRepo(cwd);
			if (!isRepo) {
				return { isRepo: false, branch: null, defaultBranch: null };
			}
			let branch: string | null = null;
			try {
				const result = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 5_000 });
				branch = result.stdout.trim() || null;
				if (branch === "HEAD") branch = null;
			} catch {
				branch = null;
			}
			const defaultBranch = await readDefaultBranch(cwd);
			return { isRepo: true, branch, defaultBranch };
		} finally {
			inflightGitInfo.delete(key);
		}
	})();
	inflightGitInfo.set(key, promise);
	return promise;
}

function parsePorcelainPath(raw: string): string {
	const trimmed = raw.replace(/^\s+/, "").replace(/^"+|"+$/g, "");
	if (trimmed.includes(" -> ")) {
		return trimmed.split(" -> ").at(-1) || trimmed;
	}
	return trimmed;
}

function statusKind(xy: string): "added" | "deleted" | "modified" {
	const code = `${xy[0] || " "}${xy[1] || " "}`;
	if (code.includes("A") || code === "??" || code === "!!") return "added";
	if (code.includes("D")) return "deleted";
	return "modified";
}

async function numstatMap(cwd: string, args: string[]): Promise<Map<string, { additions: number; deletions: number }>> {
	const map = new Map<string, { additions: number; deletions: number }>();
	try {
		const result = await runGit(cwd, ["diff", "--numstat", ...args], { maxBuffer: MAX_DIFF_BYTES, timeout: 10_000 });
		for (const line of result.stdout.split("\n")) {
			if (!line.trim()) continue;
			const parts = line.split("\t");
			if (parts.length < 3) continue;
			const additions = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
			const deletions = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
			const file = parts.slice(2).join("\t");
			map.set(file, { additions, deletions });
		}
	} catch {
		// Return empty map on error or timeout
	}
	return map;
}

const inflightGitStatus = new Map<string, Promise<GitStatusResult>>();

export function readGitStatus(cwd: string, mode: "git" | "branch" = "git"): Promise<GitStatusResult> {
	const key = `${normalizeKeyPath(cwd)}:${mode || "git"}`;
	const existing = inflightGitStatus.get(key);
	if (existing) return existing;
	const promise = (async () => {
		try {
			const info = await readGitInfo(cwd);
			if (!info.isRepo) return { info, files: [] };

			if (mode === "branch") {
				if (!info.defaultBranch) return { info, files: [] };
				let mergeBase: string;
				try {
					const result = await runGit(cwd, ["merge-base", "HEAD", info.defaultBranch], { timeout: 5_000 });
					mergeBase = result.stdout.trim();
				} catch {
					return { info, files: [] };
				}
				if (!mergeBase) return { info, files: [] };
				const range = `${mergeBase}...HEAD`;
				const nameStatus = await runGit(cwd, ["diff", "--name-status", range], { timeout: 10_000 });
				const stats = await numstatMap(cwd, ["--no-ext-diff", range]);
				const files: GitFileStatus[] = [];
				for (const line of nameStatus.stdout.split("\n")) {
					if (!line.trim()) continue;
					const parts = line.split("\t");
					const code = parts[0] || "M";
					const file = parts.at(-1);
					if (!file) continue;
					const fileStats = stats.get(file) || { additions: 0, deletions: 0 };
					files.push({
						file,
						additions: fileStats.additions,
						deletions: fileStats.deletions,
						status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
					});
				}
				return { info, files: files.sort((a, b) => a.file.localeCompare(b.file)) };
			}

			let status;
			try {
				status = await runGit(cwd, ["status", "--porcelain", "-uall"], { timeout: 10_000 });
			} catch {
				status = await runGit(cwd, ["status", "--porcelain", "-unormal"], { timeout: 10_000 }).catch(() => ({ stdout: "", stderr: "" }));
			}
			const [unstaged, staged] = await Promise.all([
				numstatMap(cwd, ["--no-ext-diff"]),
				numstatMap(cwd, ["--cached", "--no-ext-diff"]),
			]);
			const files: GitFileStatus[] = [];
			const seen = new Set<string>();
			let untrackedInspectionCount = 0;
			const MAX_UNTRACKED_INSPECTION = 50;
			const MAX_DIFF_FILES = 2000;

			for (const line of status.stdout.split("\n")) {
				if (!line || line.length < 3) continue;
				if (files.length >= MAX_DIFF_FILES) break;
				const xy = line.slice(0, 2);
				const file = parsePorcelainPath(line.slice(3));
				if (!file || seen.has(file)) continue;
				seen.add(file);
				const u = unstaged.get(file);
				const s = staged.get(file);
				const stats = {
					additions: (u?.additions || 0) + (s?.additions || 0),
					deletions: (u?.deletions || 0) + (s?.deletions || 0),
				};
				if (xy === "??" && stats.additions === 0 && stats.deletions === 0 && !file.endsWith("/")) {
					if (untrackedInspectionCount < MAX_UNTRACKED_INSPECTION) {
						untrackedInspectionCount++;
						const ext = path.extname(file).toLowerCase();
						if (!BINARY_EXTENSIONS.has(ext)) {
							try {
								const absolute = path.join(cwd, file);
								const st = await fsp.stat(absolute);
								if (st.isFile() && st.size <= MAX_DIFF_BYTES) {
									const content = await fsp.readFile(absolute, "utf8");
									const trimmed = content.replace(/\r?\n$/, "");
									stats.additions = trimmed.length === 0 ? 0 : trimmed.split(/\r?\n/).length;
								}
							} catch {}
						}
					}
				}
				files.push({
					file,
					additions: stats.additions,
					deletions: stats.deletions,
					status: statusKind(xy),
					xy,
					staged: xy[0] !== " " && xy[0] !== "?",
					unstaged: xy[1] !== " " || xy === "??",
				});
			}
			return { info, files: files.sort((a, b) => a.file.localeCompare(b.file)) };
		} finally {
			inflightGitStatus.delete(key);
		}
	})();
	inflightGitStatus.set(key, promise);
	return promise;
}

export async function readFileDiff(cwd: string, relativePath: string, mode: "git" | "branch" = "git"): Promise<GitDiffResult> {
	const absolutePath = resolveSafeWorkspacePath(cwd, relativePath);
	const normalized = path.relative(cwd, absolutePath).replace(/\\/g, "/");

	let diff = "";
	if (mode === "branch") {
		const info = await readGitInfo(cwd);
		if (!info.defaultBranch) return { path: normalized, diff: "", truncated: false };
		let mergeBase = "";
		try {
			const result = await runGit(cwd, ["merge-base", "HEAD", info.defaultBranch]);
			mergeBase = result.stdout.trim();
		} catch {
			return { path: normalized, diff: "", truncated: false };
		}
		const result = await runGit(
			cwd,
			["diff", "--no-ext-diff", "--unified=4", `${mergeBase}...HEAD`, "--", normalized],
			{ maxBuffer: MAX_DIFF_BYTES },
		);
		diff = result.stdout;
	} else {
		let isUntracked = false;
		try {
			const status = await runGit(cwd, ["status", "--porcelain", "--", normalized], { maxBuffer: 16_384 });
			isUntracked = status.stdout.startsWith("??");
			const unstaged = await runGit(
				cwd,
				["diff", "--no-ext-diff", "--unified=4", "--", normalized],
				{ maxBuffer: MAX_DIFF_BYTES },
			);
			diff = unstaged.stdout;
			if (!diff) {
				const staged = await runGit(
					cwd,
					["diff", "--cached", "--no-ext-diff", "--unified=4", "--", normalized],
					{ maxBuffer: MAX_DIFF_BYTES },
				);
				diff = staged.stdout;
			}
		} catch (error: any) {
			if (error?.message?.includes("Git is not installed")) throw error;
			diff = error?.stdout || "";
		}
		if (!diff && isUntracked && fs.existsSync(absolutePath)) {
			try {
				const source = await fsp.readFile(absolutePath, "utf8");
				const sourceLines = source.split(/\r?\n/).slice(0, 500);
				const body = sourceLines.map((line) => `+${line}`).join("\n");
				diff = `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\n--- /dev/null\n+++ b/${normalized}\n@@ -0,0 +1,${sourceLines.length} @@\n${body}`;
			} catch {}
		}
	}
	return { path: normalized, diff: diff.slice(0, MAX_DIFF_BYTES), truncated: diff.length > MAX_DIFF_BYTES };
}

export async function readWorkspaceTree(rootCwd: string, targetDir?: string): Promise<WorkspaceTreeResult> {
	let currentRoot = rootCwd;
	if (targetDir) {
		if (path.isAbsolute(targetDir)) {
			const rel = path.relative(rootCwd, targetDir);
			if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
				currentRoot = targetDir;
			} else {
				const val = validateWorkspaceDirectory(targetDir);
				if (val.valid && val.resolved) {
					currentRoot = val.resolved;
				} else {
					throw new Error("Path escapes workspace directory");
				}
			}
		} else {
			currentRoot = resolveSafeWorkspacePath(rootCwd, targetDir);
		}
	}
	let count = 0;

	async function walk(directory: string, depth: number): Promise<TreeNode[]> {
		if (depth > 6 || count >= MAX_TREE_ITEMS) return [];
		let entries: fs.Dirent[] = [];
		try {
			entries = await fsp.readdir(directory, { withFileTypes: true });
		} catch {
			return [];
		}
		entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
		const nodes: TreeNode[] = [];
		for (const entry of entries) {
			if (count >= MAX_TREE_ITEMS) break;
			if (entry.name === ".DS_Store") continue;
			if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
			if (entry.isSymbolicLink()) continue;
			const absolutePath = path.join(directory, entry.name);
			const relativePath = path.relative(currentRoot, absolutePath).replace(/\\/g, "/");
			count += 1;
			if (entry.isDirectory()) {
				nodes.push({ name: entry.name, path: relativePath, type: "directory", children: await walk(absolutePath, depth + 1) });
			} else {
				nodes.push({ name: entry.name, path: relativePath, type: "file" });
			}
		}
		return nodes;
	}

	const isRepo = isGitRepoSync(currentRoot);
	const rootSummary: WorkspaceSummary = {
		name: path.basename(currentRoot),
		path: currentRoot,
		isGitRepo: isRepo,
	};
	return { root: rootSummary, nodes: await walk(currentRoot, 0), truncated: count >= MAX_TREE_ITEMS };
}

export async function readWorkspaceFileContent(cwd: string, relativePath: string): Promise<{ path: string; content: string; size: number }> {
	const absolutePath = resolveSafeWorkspacePath(cwd, relativePath);
	const stat = await fsp.stat(absolutePath);
	if (!stat.isFile()) throw new Error("Path is not a regular file");
	if (stat.size > MAX_FILE_READ_BYTES) throw new Error(`File exceeds max readable size (${Math.round(MAX_FILE_READ_BYTES / 1024 / 1024)}MB)`);
	const content = await fsp.readFile(absolutePath, "utf8");
	const normalized = path.relative(cwd, absolutePath).replace(/\\/g, "/");
	return { path: normalized, content, size: stat.size };
}
