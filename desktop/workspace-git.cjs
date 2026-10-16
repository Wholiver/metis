'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 300_000;

const BINARY_EXTENSIONS = new Set([
	'.7z', '.ai', '.aif', '.apk', '.app', '.avi', '.bin', '.bmp', '.bz2',
	'.class', '.dat', '.db', '.dll', '.dmg', '.dylib', '.eot', '.exe',
	'.flac', '.gif', '.gz', '.ico', '.iso', '.jar', '.jpeg', '.jpg',
	'.m4a', '.mid', '.mkv', '.mov', '.mp3', '.mp4', '.mpeg', '.mpg',
	'.ogg', '.otf', '.pdf', '.png', '.psd', '.pyc', '.rar', '.so',
	'.sqlite', '.sqlite3', '.svgz', '.tar', '.tgz', '.tif', '.tiff',
	'.ttf', '.wasm', '.wav', '.webm', '.webp', '.wma', '.wmv', '.woff',
	'.woff2', '.xz', '.zip', '.zst',
]);

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
			timeout: options.timeout || 15_000,
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
		const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], { timeout: 5_000 });
		return result.stdout.trim() === 'true';
	} catch {
		return false;
	}
}

async function readDefaultBranch(cwd, translate) {
	try {
		const symbolic = await runGit(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'], { translate, timeout: 5_000 });
		const match = symbolic.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
		if (match?.[1]) return match[1];
	} catch {
		// fall through
	}
	for (const candidate of ['main', 'master']) {
		try {
			await runGit(cwd, ['rev-parse', '--verify', candidate], { translate, timeout: 5_000 });
			return candidate;
		} catch {
			// try next
		}
	}
	return null;
}

function normalizeKeyPath(p) {
	if (!p || typeof p !== 'string') return '';
	const resolved = path.resolve(p).replace(/\\/g, '/');
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

const inflightGitInfo = new Map();

function readGitInfo(cwd, translate) {
	const key = normalizeKeyPath(cwd);
	const existing = inflightGitInfo.get(key);
	if (existing) return existing;
	const promise = (async () => {
		try {
			const isRepo = await isGitRepo(cwd);
			if (!isRepo) {
				return { isRepo: false, branch: null, defaultBranch: null };
			}
			let branch = null;
			try {
				const result = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { translate, timeout: 5_000 });
				branch = result.stdout.trim() || null;
				if (branch === 'HEAD') branch = null;
			} catch {
				branch = null;
			}
			const defaultBranch = await readDefaultBranch(cwd, translate);
			return { isRepo: true, branch, defaultBranch };
		} finally {
			inflightGitInfo.delete(key);
		}
	})();
	inflightGitInfo.set(key, promise);
	return promise;
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
	const map = new Map();
	try {
		const result = await runGit(cwd, ['diff', '--numstat', ...args], { translate, maxBuffer: MAX_DIFF_BYTES, timeout: 10_000 });
		for (const line of result.stdout.split('\n')) {
			if (!line.trim()) continue;
			const parts = line.split('\t');
			if (parts.length < 3) continue;
			const additions = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
			const deletions = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
			const file = parts.slice(2).join('\t');
			map.set(file, { additions, deletions });
		}
	} catch {
		// Return empty map on failure or timeout
	}
	return map;
}

async function listWorkingTreeDiffs(cwd, translate) {
	let status;
	try {
		status = await runGit(cwd, ['status', '--porcelain', '-uall'], { translate, timeout: 10_000 });
	} catch {
		// If -uall timed out or failed on a large repository, fall back to fast -unormal
		status = await runGit(cwd, ['status', '--porcelain', '-unormal'], { translate, timeout: 10_000 }).catch(() => ({ stdout: '', stderr: '' }));
	}
	const [unstaged, staged] = await Promise.all([
		numstatMap(cwd, ['--no-ext-diff'], translate),
		numstatMap(cwd, ['--cached', '--no-ext-diff'], translate),
	]);
	const files = [];
	const seen = new Set();
	let untrackedInspectionCount = 0;
	const MAX_UNTRACKED_INSPECTION = 50;
	const MAX_DIFF_FILES = 2000;

	for (const line of status.stdout.split('\n')) {
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
		if (xy === '??' && stats.additions === 0 && stats.deletions === 0 && !file.endsWith('/')) {
			if (untrackedInspectionCount < MAX_UNTRACKED_INSPECTION) {
				untrackedInspectionCount++;
				const ext = path.extname(file).toLowerCase();
				if (!BINARY_EXTENSIONS.has(ext)) {
					try {
						const absolute = path.join(cwd, file);
						const st = await fsp.stat(absolute);
						if (st.isFile() && st.size <= MAX_DIFF_BYTES) {
							const content = await fsp.readFile(absolute, 'utf8');
							const trimmed = content.replace(/\r?\n$/, '');
							stats.additions = trimmed.length === 0 ? 0 : trimmed.split(/\r?\n/).length;
						}
					} catch {
						// ignore unreadable
					}
				}
			}
		}
		files.push({
			file,
			additions: stats.additions,
			deletions: stats.deletions,
			status: statusKind(xy),
			xy,
			staged: xy[0] !== ' ' && xy[0] !== '?',
			unstaged: xy[1] !== ' ' || xy === '??',
		});
	}
	return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function listBranchDiffs(cwd, defaultBranch, translate) {
	if (!defaultBranch) return [];
	let mergeBase;
	try {
		const result = await runGit(cwd, ['merge-base', 'HEAD', defaultBranch], { translate, timeout: 5_000 });
		mergeBase = result.stdout.trim();
	} catch {
		return [];
	}
	if (!mergeBase) return [];
	const range = `${mergeBase}...HEAD`;
	const nameStatus = await runGit(cwd, ['diff', '--name-status', range], { translate, timeout: 10_000 });
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

const inflightGitStatus = new Map();

function readGitStatus(cwd, mode, translate) {
	const key = `${normalizeKeyPath(cwd)}:${mode || 'git'}`;
	const existing = inflightGitStatus.get(key);
	if (existing) return existing;
	const promise = (async () => {
		try {
			const info = await readGitInfo(cwd, translate);
			if (!info.isRepo) return { info, files: [] };
			if (mode === 'branch') {
				return { info, files: await listBranchDiffs(cwd, info.defaultBranch, translate) };
			}
			return { info, files: await listWorkingTreeDiffs(cwd, translate) };
		} finally {
			inflightGitStatus.delete(key);
		}
	})();
	inflightGitStatus.set(key, promise);
	return promise;
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
				const ext = path.extname(normalized).toLowerCase();
				let isBinary = BINARY_EXTENSIONS.has(ext);
				if (!isBinary) {
					try {
						const st = await fsp.stat(absolutePath);
						if (st.size > MAX_DIFF_BYTES) isBinary = true;
					} catch {
						isBinary = true;
					}
				}
				if (isBinary) {
					diff = `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\nBinary files /dev/null and b/${normalized} differ`;
				} else {
					const buffer = await fsp.readFile(absolutePath);
					if (buffer.includes(0)) {
						diff = `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\nBinary files /dev/null and b/${normalized} differ`;
					} else {
						const source = buffer.toString('utf8');
						const sourceLines = source.split(/\r?\n/).slice(0, 500);
						const body = sourceLines.map((line) => `+${line}`).join('\n');
						diff = `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\n--- /dev/null\n+++ b/${normalized}\n@@ -0,0 +1,${sourceLines.length} @@\n${body}`;
					}
				}
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

async function stageFiles(cwd, files, translate) {
	if (!files || files.length === 0) {
		await runGit(cwd, ['add', '-A'], { translate });
	} else {
		try {
			await runGit(cwd, ['add', '--', ...files], { translate });
		} catch (error) {
			const errStr = String(error?.stderr || error?.message || '');
			if (errStr.includes('ignored by one of your .gitignore files') || errStr.includes('Use -f')) {
				await runGit(cwd, ['add', '-f', '--', ...files], { translate });
			} else {
				throw error;
			}
		}
	}
	return true;
}

async function hasHeadCommit(cwd) {
	try {
		await runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
		return true;
	} catch {
		return false;
	}
}

async function unstageFiles(cwd, files, translate) {
	const hasHead = await hasHeadCommit(cwd);
	if (hasHead) {
		if (!files || files.length === 0) {
			await runGit(cwd, ['reset', 'HEAD'], { translate });
		} else {
			await runGit(cwd, ['reset', 'HEAD', '--', ...files], { translate });
		}
	} else {
		if (!files || files.length === 0) {
			await runGit(cwd, ['rm', '--cached', '-r', '-f', '.'], { translate });
		} else {
			await runGit(cwd, ['rm', '--cached', '-r', '-f', '--', ...files], { translate });
		}
	}
	return true;
}

async function discardFiles(cwd, files, translate) {
	const hasHead = await hasHeadCommit(cwd);
	for (const file of files) {
		const absolutePath = path.resolve(cwd, file);
		try {
			const status = await runGit(cwd, ['status', '--porcelain', '--', file], { translate });
			const xy = status.stdout.slice(0, 2);
			if (xy === '??') {
				await fsp.rm(absolutePath, { recursive: true, force: true });
			} else if (xy.includes('A')) {
				try {
					await runGit(cwd, ['rm', '-f', '--', file], { translate });
				} catch {
					await runGit(cwd, ['reset', 'HEAD', '--', file], { translate }).catch(() => {});
					await fsp.rm(absolutePath, { recursive: true, force: true });
				}
			} else if (hasHead) {
				await runGit(cwd, ['checkout', 'HEAD', '--', file], { translate });
			} else {
				await runGit(cwd, ['checkout', '--', file], { translate });
			}
		} catch (err) {
			console.warn('[desktop] Failed to discard file:', file, err);
		}
	}
	return true;
}

async function commit(cwd, message, translate) {
	if (!message || !message.trim()) {
		throw new Error(translate ? translate('commitMessageRequired') : 'Commit message is required');
	}
	try {
		await runGit(cwd, ['commit', '-m', message.trim()], { translate });
	} catch (err) {
		const msg = String(err?.message || '');
		if (msg.includes('Author identity unknown') || msg.includes('tell me who you are')) {
			await runGit(
				cwd,
				['-c', 'user.name=Metis User', '-c', 'user.email=user@local', 'commit', '-m', message.trim()],
				{ translate },
			);
		} else {
			throw err;
		}
	}
	return true;
}

async function readCommitHistory(cwd, limit = 50, translate) {
	try {
		const result = await runGit(
			cwd,
			['log', `-n${Math.min(limit, 100)}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%ad%x1f%s', '--date=short'],
			{ translate },
		);
		const lines = result.stdout.split('\n').filter(Boolean);
		return lines.map((line) => {
			const [hash, shortHash, author, relativeDate, date, message] = line.split('\x1f');
			return {
				hash: hash || '',
				shortHash: shortHash || (hash ? hash.slice(0, 7) : ''),
				author: author || '',
				relativeDate: relativeDate || '',
				date: date || '',
				message: message || '',
			};
		});
	} catch {
		return [];
	}
}

async function readCommitDetail(cwd, hash, translate) {
	if (!hash) return null;
	try {
		const logRes = await runGit(
			cwd,
			['log', '-n1', '--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%ad%x1f%s%x1f%b', hash],
			{ translate },
		);
		const [fullHash, shortHash, author, relativeDate, date, subject, body] = logRes.stdout.split('\x1f');

		const nameStatus = await runGit(cwd, ['diff-tree', '--no-commit-id', '--name-status', '-r', hash], { translate });
		const numstat = await runGit(cwd, ['diff-tree', '--no-commit-id', '--numstat', '-r', hash], { translate });

		const statsMap = new Map();
		for (const line of numstat.stdout.split('\n')) {
			if (!line.trim()) continue;
			const parts = line.split('\t');
			if (parts.length >= 3) {
				const additions = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
				const deletions = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
				const file = parts.slice(2).join('\t');
				statsMap.set(file, { additions, deletions });
			}
		}

		const files = [];
		for (const line of nameStatus.stdout.split('\n')) {
			if (!line.trim()) continue;
			const parts = line.split('\t');
			const code = parts[0] || 'M';
			const file = parts.at(-1);
			if (!file) continue;
			const s = statsMap.get(file) || { additions: 0, deletions: 0 };
			files.push({
				file,
				status: code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified',
				additions: s.additions,
				deletions: s.deletions,
			});
		}

		return {
			hash: fullHash,
			shortHash: shortHash || fullHash.slice(0, 7),
			author,
			relativeDate,
			date,
			subject,
			body: body ? body.trim() : '',
			files,
		};
	} catch (err) {
		console.warn('[desktop] Failed to read commit detail:', hash, err);
		return null;
	}
}

async function readCommitFileDiff(cwd, hash, relativePath, translate) {
	if (!hash || !relativePath) return '';
	try {
		const result = await runGit(
			cwd,
			['show', '--no-ext-diff', '--format=', '--unified=4', `${hash}`, '--', relativePath],
			{ translate, maxBuffer: MAX_DIFF_BYTES },
		);
		return result.stdout.slice(0, MAX_DIFF_BYTES);
	} catch {
		return '';
	}
}

async function readBranches(cwd, translate) {
	try {
		const result = await runGit(cwd, ['branch', '--list'], { translate });
		const lines = result.stdout.split('\n').filter(Boolean);
		let current = '';
		const branches = [];
		for (const line of lines) {
			const isCurrent = line.startsWith('*');
			const name = line.replace(/^[\*\+]\s+/, '').trim();
			if (name) {
				if (isCurrent) current = name;
				branches.push(name);
			}
		}
		return { current, branches };
	} catch {
		return { current: '', branches: [] };
	}
}

async function checkoutBranch(cwd, branch, translate) {
	await runGit(cwd, ['checkout', branch], { translate });
	return true;
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
	stageFiles,
	unstageFiles,
	discardFiles,
	commit,
	readCommitHistory,
	readCommitDetail,
	readCommitFileDiff,
	readBranches,
	checkoutBranch,
};
