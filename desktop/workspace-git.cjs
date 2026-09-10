'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 300_000;

/**
 * OpenCode-aligned VCS helpers for Desktop Review V2.
 * Modes: git (working tree), branch (vs default), turn (handled in renderer).
 */

function gitError(error, translate) {
	if (error && error.code === 'ENOENT') {
		return new Error(translate ? translate('gitNotInstalled') : 'Git is not installed');
	}
	return error instanceof Error ? error : new Error(String(error?.message || error));
}

async function runGit(cwd, args, options = {}) {
	try {
		const result = await execFileAsync('git', args, {
			cwd,
			maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
		});
		return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
	} catch (error) {
		if (error.code === 'ENOENT') throw gitError(error, options.translate);
		// git often returns non-zero with useful stdout (e.g. diff with conflicts)
		if (typeof error.stdout === 'string' && error.stdout.length > 0) {
			return { stdout: String(error.stdout), stderr: String(error.stderr || '') };
		}
		throw gitError(error, options.translate);
	}
}

function isGitRepoSync(cwd) {
	return fs.existsSync(path.join(cwd, '.git'));
}

async function isGitRepo(cwd) {
	if (isGitRepoSync(cwd)) return true;
	try {
		const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
		return result.stdout.trim() === 'true';
	} catch {
		return false;
	}
}

async function readDefaultBranch(cwd, translate) {
	try {
		const symbolic = await runGit(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'], { translate });
		const match = symbolic.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
		if (match?.[1]) return match[1];
	} catch {
		// fall through
	}
	for (const candidate of ['main', 'master']) {
		try {
			await runGit(cwd, ['rev-parse', '--verify', candidate], { translate });
			return candidate;
		} catch {
			// try next
		}
	}
	return null;
}

async function readGitInfo(cwd, translate) {
	const isRepo = await isGitRepo(cwd);
	if (!isRepo) {
		return { isRepo: false, branch: null, defaultBranch: null };
	}
	let branch = null;
	try {
		const result = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { translate });
		branch = result.stdout.trim() || null;
		if (branch === 'HEAD') branch = null;
	} catch {
		branch = null;
	}
	const defaultBranch = await readDefaultBranch(cwd, translate);
	return { isRepo: true, branch, defaultBranch };
}

function parsePorcelainPath(raw) {
	const trimmed = raw.replace(/^\s+/, '').replace(/^"+|"+$/g, '');
	if (trimmed.includes(' -> ')) {
		return trimmed.split(' -> ').at(-1) || trimmed;
	}
	return trimmed;
}

function statusKind(xy) {
	const code = `${xy[0] || ' '}${xy[1] || ' '}`;
	if (code.includes('A') || code === '??' || code === '!!') return 'added';
	if (code.includes('D')) return 'deleted';
	return 'modified';
}

async function numstatMap(cwd, args, translate) {
	const result = await runGit(cwd, ['diff', '--numstat', ...args], { translate, maxBuffer: MAX_DIFF_BYTES });
	const map = new Map();
	for (const line of result.stdout.split('\n')) {
		if (!line.trim()) continue;
		const parts = line.split('\t');
		if (parts.length < 3) continue;
		const additions = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
		const deletions = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
		const file = parts.slice(2).join('\t');
		map.set(file, { additions, deletions });
	}
	return map;
}

async function listWorkingTreeDiffs(cwd, translate) {
	const status = await runGit(cwd, ['status', '--porcelain', '-uall'], { translate });
	const unstaged = await numstatMap(cwd, ['--no-ext-diff'], translate);
	const staged = await numstatMap(cwd, ['--cached', '--no-ext-diff'], translate);
	const files = [];
	const seen = new Set();

	for (const line of status.stdout.split('\n')) {
		if (!line || line.length < 3) continue;
		const xy = line.slice(0, 2);
		const file = parsePorcelainPath(line.slice(3));
		if (!file || seen.has(file)) continue;
		seen.add(file);
		const stats = unstaged.get(file) || staged.get(file) || { additions: 0, deletions: 0 };
		if (xy === '??' && stats.additions === 0 && stats.deletions === 0) {
			try {
				const absolute = path.join(cwd, file);
				const content = await fsp.readFile(absolute, 'utf8');
				stats.additions = content.length === 0 ? 0 : content.split(/\r?\n/).length;
			} catch {
				// ignore unreadable
			}
		}
		files.push({
			file,
			additions: stats.additions,
			deletions: stats.deletions,
			status: statusKind(xy),
		});
	}
	return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function listBranchDiffs(cwd, defaultBranch, translate) {
	if (!defaultBranch) return [];
	let mergeBase;
	try {
		const result = await runGit(cwd, ['merge-base', 'HEAD', defaultBranch], { translate });
		mergeBase = result.stdout.trim();
	} catch {
		return [];
	}
	if (!mergeBase) return [];
	const range = `${mergeBase}...HEAD`;
	const nameStatus = await runGit(cwd, ['diff', '--name-status', range], { translate });
	const stats = await numstatMap(cwd, ['--no-ext-diff', range], translate);
	const files = [];
	for (const line of nameStatus.stdout.split('\n')) {
		if (!line.trim()) continue;
		const parts = line.split('\t');
		const code = parts[0] || 'M';
		const file = parts.at(-1);
		if (!file) continue;
		const fileStats = stats.get(file) || { additions: 0, deletions: 0 };
		files.push({
			file,
			additions: fileStats.additions,
			deletions: fileStats.deletions,
			status: code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified',
		});
	}
	return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function readGitStatus(cwd, mode, translate) {
	const info = await readGitInfo(cwd, translate);
	if (!info.isRepo) return { info, files: [] };
	if (mode === 'branch') {
		return { info, files: await listBranchDiffs(cwd, info.defaultBranch, translate) };
	}
	return { info, files: await listWorkingTreeDiffs(cwd, translate) };
}

async function readFileDiff(cwd, relativePath, mode, translate) {
	const normalized = relativePath.replace(/\\/g, '/');
	const absolutePath = path.resolve(cwd, normalized);
	const relative = path.relative(cwd, absolutePath);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(translate ? translate('pathEscapesWorkspace') : 'Path escapes workspace');
	}

	let diff = '';
	if (mode === 'branch') {
		const info = await readGitInfo(cwd, translate);
		if (!info.defaultBranch) return { path: normalized, diff: '', truncated: false };
		let mergeBase = '';
		try {
			const result = await runGit(cwd, ['merge-base', 'HEAD', info.defaultBranch], { translate });
			mergeBase = result.stdout.trim();
		} catch {
			return { path: normalized, diff: '', truncated: false };
		}
		const result = await runGit(
			cwd,
			['diff', '--no-ext-diff', '--unified=4', `${mergeBase}...HEAD`, '--', normalized],
			{ translate, maxBuffer: MAX_DIFF_BYTES },
		);
		diff = result.stdout;
	} else {
		let isUntracked = false;
		try {
			const status = await runGit(cwd, ['status', '--porcelain', '--', normalized], { translate, maxBuffer: 16_384 });
			isUntracked = status.stdout.startsWith('??');
			const unstaged = await runGit(
				cwd,
				['diff', '--no-ext-diff', '--unified=4', '--', normalized],
				{ translate, maxBuffer: MAX_DIFF_BYTES },
			);
			diff = unstaged.stdout;
			if (!diff) {
				const staged = await runGit(
					cwd,
					['diff', '--cached', '--no-ext-diff', '--unified=4', '--', normalized],
					{ translate, maxBuffer: MAX_DIFF_BYTES },
				);
				diff = staged.stdout;
			}
			if (!diff && isUntracked) {
				const source = await fsp.readFile(absolutePath, 'utf8');
				const sourceLines = source.split(/\r?\n/).slice(0, 500);
				const body = sourceLines.map((line) => `+${line}`).join('\n');
				diff = `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\n--- /dev/null\n+++ b/${normalized}\n@@ -0,0 +1,${sourceLines.length} @@\n${body}`;
			}
		} catch (error) {
			throw gitError(error, translate);
		}
	}

	return {
		path: normalized,
		diff: diff.slice(0, MAX_DIFF_BYTES),
		truncated: diff.length > MAX_DIFF_BYTES,
	};
}

async function initGitRepo(cwd, translate) {
	if (await isGitRepo(cwd)) {
		return readGitInfo(cwd, translate);
	}
	await runGit(cwd, ['init'], { translate });
	return readGitInfo(cwd, translate);
}

module.exports = {
	MAX_DIFF_BYTES,
	isGitRepoSync,
	isGitRepo,
	readGitInfo,
	readGitStatus,
	readFileDiff,
	initGitRepo,
	parsePorcelainPath,
	statusKind,
};
