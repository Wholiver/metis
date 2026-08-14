/**
 * Durable memory control plane.
 *
 * Memory is deliberately data, never privileged instructions.  The session
 * loop owns when a checkpoint is written; this coordinator owns retention,
 * scope, retrieval and the idle background queue.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type MemoryPhase = "idle" | "extracting" | "consolidating" | "retry_wait" | "error" | "disabled";
export type MemoryScope = "global" | "project" | "checkout";
export type MemoryKind = "preference" | "fact" | "procedure" | "failure";
export type MemoryRecordStatus = "active" | "stale" | "conflicted";

export interface MemoryState {
	enabled: boolean;
	phase: MemoryPhase;
	globalCount: number;
	projectCount: number;
	pendingJobs: number;
	lastExtractedAt?: string;
	lastConsolidatedAt?: string;
	nextRetryAt?: string;
	error?: string;
	nextEligibleAt?: string;
	lastRunProcessed?: number;
	lastRunAdded?: number;
	lastRunSkipped?: number;
	lastExtractionMethod?: "model" | "fallback" | "none";
	fallbackUsed?: boolean;
	modelFailureReason?: string;
}

export interface MemoryRecordSummary {
	id: string;
	scope: MemoryScope;
	kind: MemoryKind;
	content: string;
	status: MemoryRecordStatus;
	sourceSessionIds: string[];
	updatedAt: string;
	lastUsedAt?: string;
}

export interface MemorySettings {
	enabled?: boolean;
	maxUnusedDays?: number;
	maxRolloutAgeDays?: number;
	minRolloutIdleHours?: number;
	maxRolloutsPerSweep?: number;
}

export const DEFAULT_MEMORY_SETTINGS: Required<MemorySettings> = {
	enabled: true,
	maxUnusedDays: 30,
	maxRolloutAgeDays: 10,
	minRolloutIdleHours: 6,
	maxRolloutsPerSweep: 2,
};

export interface SessionMemoryCheckpoint {
	sessionId: string;
	reason: "prompt_accepted" | "step_completed" | "compaction" | "aborted" | "error" | "completed";
	timestamp: string;
	goal?: string;
	constraints?: string[];
	workflowPlan?: unknown;
	workflowProposal?: { revision?: number; updatedAt?: string };
	verification?: string[];
	errors?: string[];
	contextWindowId?: string;
	recentTurn?: Array<{ role: string; content: string }>;
}

export interface MemoryProjectIdentity {
	projectKey: string;
	checkoutKey: string;
	projectRoot: string;
}

export interface MemoryCoordinatorOptions {
	agentDir: string;
	cwd: string;
	trusted: () => boolean;
	settings: () => MemorySettings | undefined;
	/** Test hook and the sole place a foreground session can expose its model. */
	extract?: (checkpoint: SessionMemoryCheckpoint, signal?: AbortSignal) => Promise<MemoryCandidate[] | MemoryExtractionResult>;
}

export interface MemoryCandidate {
	scope?: MemoryScope;
	kind: MemoryKind;
	content: string;
	confidence?: number;
}

export interface MemoryExtractionResult {
	candidates: MemoryCandidate[];
	failureReason?: string;
}

type Listener = (event: { type: "memory_state_changed"; state: MemoryState } | { type: "memory_records_changed" }) => void;

const SECRET = /(?:\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b|\b(?:api[_-]?key|authorization|password|token)\s*[:=]\s*[^\s,;]+)/gi;
const DAY = 86_400_000;

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function redact(value: string): string {
	return value.replace(SECRET, "[redacted]").replace(/\0/g, "").trim();
}

function now(): string {
	return new Date().toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
	if (!value) return fallback;
	try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** Stable project identity: remote when available, real root otherwise. */
export function resolveMemoryProjectIdentity(cwd: string): MemoryProjectIdentity {
	let resolved = resolve(cwd);
	try { resolved = realpathSync(resolved); } catch { /* cwd may disappear during shutdown */ }
	let root = resolved;
	for (;;) {
		if (existsSync(join(root, ".git"))) break;
		const parent = dirname(root);
		if (parent === root) break;
		root = parent;
	}
	const remote = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], {
		encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000,
	}).stdout?.trim();
	const canonical = remote ? remote.replace(/\.git$/i, "").toLowerCase() : root;
	return { projectKey: hash(`project:${canonical}`), checkoutKey: hash(`checkout:${resolved}`), projectRoot: root };
}

export class MemoryCoordinator {
	private readonly db: DatabaseSync;
	private readonly root: string;
	private readonly identity: MemoryProjectIdentity;
	private listeners = new Set<Listener>();
	private running = false;
	private closeWhenIdle = false;
	private disposed = false;
	private timer?: ReturnType<typeof setInterval>;
	private extractionAbortController?: AbortController;
	private state: MemoryState;
	private readonly options: MemoryCoordinatorOptions;

	constructor(options: MemoryCoordinatorOptions) {
		this.options = options;
		this.root = join(resolve(options.agentDir, ".."), "memories");
		mkdirSync(this.root, { recursive: true });
		this.db = new DatabaseSync(join(this.root, "state.sqlite"));
		this.identity = resolveMemoryProjectIdentity(options.cwd);
		this.initialize();
		this.migrateLegacyArtifacts();
		this.state = this.buildState();
	}

	private initialize(): void {
		this.db.exec(`
			PRAGMA busy_timeout=5000;
			PRAGMA journal_mode=WAL;
			CREATE TABLE IF NOT EXISTS memory_records (
				id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_key TEXT, checkout_key TEXT,
				kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
				sources TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT
			);
			CREATE TABLE IF NOT EXISTS memory_jobs (
				id TEXT PRIMARY KEY, session_id TEXT NOT NULL, checkpoint TEXT NOT NULL, status TEXT NOT NULL,
				due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, semantic_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, content);
		`);
		try { this.db.exec("ALTER TABLE memory_jobs ADD COLUMN semantic_hash TEXT"); } catch { /* already migrated */ }
	}

	/** Deliberately narrow, idempotent legacy removal. Other .metis data stays untouched. */
	private migrateLegacyArtifacts(): void {
		const migrated = this.db.prepare("SELECT value FROM memory_meta WHERE key = 'memory-v2-migrated'").get() as { value?: string } | undefined;
		if (migrated) return;
		const legacyRoot = resolve(this.options.agentDir, "..");
		for (const target of ["brain-map.md", "memory", "lessons", "dream_state.json"]) {
			const path = join(legacyRoot, target);
			try { if (existsSync(path)) rmSync(path, { recursive: true, force: true }); } catch { /* migration never blocks startup */ }
		}
		const temp = join(this.options.cwd, ".temp");
		// We only ever remove exact legacy file suffixes, never the directory.
		try {
			for (const name of readdirSync(temp, { withFileTypes: true })) {
				if (name.isFile() && /_(?:log|user_intent)\.md$/.test(name.name)) rmSync(join(temp, name.name), { force: true });
			}
		} catch { /* .temp is optional */ }
		this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("memory-v2-migrated", now());
	}

	private config(): Required<MemorySettings> { return { ...DEFAULT_MEMORY_SETTINGS, ...(this.options.settings() ?? {}) }; }
	private enabled(): boolean { return this.config().enabled; }

	private buildState(): MemoryState {
		const enabled = this.enabled();
		const counts = this.db.prepare("SELECT scope, count(*) AS count FROM memory_records WHERE status = 'active' GROUP BY scope").all() as Array<{ scope: string; count: number }>;
		const count = (scope: string) => counts.find((row) => row.scope === scope)?.count ?? 0;
		const pending = this.db.prepare("SELECT count(*) AS count FROM memory_jobs WHERE status IN ('pending','retry')").get() as { count: number };
		const meta = this.db.prepare("SELECT key, value FROM memory_meta WHERE key IN ('lastExtractedAt','lastConsolidatedAt','nextRetryAt','error','lastRunProcessed','lastRunAdded','lastRunSkipped','lastExtractionMethod','fallbackUsed','modelFailureReason')").all() as Array<{ key: string; value: string }>;
		const get = (key: string) => meta.find((row) => row.key === key)?.value;
		const next = this.db.prepare("SELECT MIN(due_at) AS dueAt FROM memory_jobs WHERE status IN ('pending','retry')").get() as { dueAt?: number };
		return {
			enabled, phase: enabled ? "idle" : "disabled", globalCount: count("global"), projectCount: count("project") + count("checkout"), pendingJobs: pending.count,
			lastExtractedAt: get("lastExtractedAt"), lastConsolidatedAt: get("lastConsolidatedAt"), nextRetryAt: get("nextRetryAt"), error: get("error"),
			nextEligibleAt: next.dueAt ? new Date(next.dueAt).toISOString() : undefined,
			lastRunProcessed: Number(get("lastRunProcessed") ?? 0), lastRunAdded: Number(get("lastRunAdded") ?? 0), lastRunSkipped: Number(get("lastRunSkipped") ?? 0),
			lastExtractionMethod: (get("lastExtractionMethod") as MemoryState["lastExtractionMethod"]) ?? "none",
			fallbackUsed: get("fallbackUsed") === "true", modelFailureReason: get("modelFailureReason"),
		};
	}

	getState(): MemoryState { return { ...this.state }; }
	on(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private publish(records = false): void {
		this.state = this.buildState();
		for (const listener of this.listeners) listener(records ? { type: "memory_records_changed" } : { type: "memory_state_changed", state: this.getState() });
		if (records) for (const listener of this.listeners) listener({ type: "memory_state_changed", state: this.getState() });
	}
	private phase(phase: MemoryPhase, error?: string): void {
		this.state = { ...this.buildState(), phase, error };
		for (const listener of this.listeners) listener({ type: "memory_state_changed", state: this.getState() });
	}

	setEnabled(enabled: boolean): MemoryState {
		// Settings persistence belongs to SettingsManager; this state reflects its new value next read.
		this.state = { ...this.buildState(), enabled, phase: enabled ? "idle" : "disabled" };
		for (const listener of this.listeners) listener({ type: "memory_state_changed", state: this.getState() });
		return this.getState();
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.run(), 15 * 60_000);
		this.timer.unref?.();
	}
	stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
	abort(): void { this.extractionAbortController?.abort(); }
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.stop();
		this.abort();
		if (this.running) this.closeWhenIdle = true;
		else this.db.close();
	}

	recordCheckpoint(checkpoint: SessionMemoryCheckpoint): void {
		if (!this.enabled()) return;
		const sanitized: SessionMemoryCheckpoint = {
			...checkpoint,
			goal: checkpoint.goal ? redact(checkpoint.goal).slice(0, 4000) : undefined,
			constraints: checkpoint.constraints?.map(redact).filter(Boolean).slice(0, 12),
			verification: checkpoint.verification?.map(redact).filter(Boolean).slice(0, 12),
			errors: checkpoint.errors?.map(redact).filter(Boolean).slice(0, 8),
			recentTurn: checkpoint.recentTurn?.map((item) => ({ role: redact(item.role).slice(0, 40), content: redact(item.content).slice(0, 4000) })).filter((item) => item.content).slice(-12),
		};
		const due = Date.now() + this.config().minRolloutIdleHours * 3_600_000;
		const semanticHash = hash(JSON.stringify({ goal: sanitized.goal, constraints: sanitized.constraints, verification: sanitized.verification, errors: sanitized.errors, workflowPlan: sanitized.workflowPlan, workflowProposal: sanitized.workflowProposal, recentTurn: sanitized.recentTurn }));
		const duplicate = this.db.prepare("SELECT id FROM memory_jobs WHERE session_id = ? AND semantic_hash = ? AND status IN ('pending','retry') LIMIT 1").get(sanitized.sessionId, semanticHash);
		if (duplicate) return;
		this.db.prepare("INSERT INTO memory_jobs(id, session_id, checkpoint, status, due_at, semantic_hash, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)")
			.run(randomUUID(), sanitized.sessionId, JSON.stringify(sanitized), due, semanticHash, now(), now());
		this.publish();
	}

	async run(force = false): Promise<MemoryState> {
		if (!this.enabled() || this.running) return this.getState();
		this.running = true;
		this.extractionAbortController = new AbortController();
		try {
			this.phase("extracting");
			const settings = this.config();
			const max = force ? Number.MAX_SAFE_INTEGER : settings.maxRolloutsPerSweep;
			const oldest = new Date(Date.now() - settings.maxRolloutAgeDays * DAY).toISOString();
			const jobs = this.db.prepare("SELECT * FROM memory_jobs WHERE status IN ('pending','retry') AND due_at <= ? AND created_at >= ? ORDER BY created_at LIMIT ?").all(force ? Number.MAX_SAFE_INTEGER : Date.now(), oldest, max) as Array<Record<string, unknown>>;
			let added = 0;
			let skipped = 0;
			let fallbackUsed = false;
			let modelFailureReason: string | undefined;
			for (const job of jobs) {
				const result = await this.extractJob(job, this.extractionAbortController.signal);
				added += result.added;
				skipped += result.skipped;
				fallbackUsed ||= result.fallbackUsed;
				modelFailureReason = result.modelFailureReason ?? modelFailureReason;
			}
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastRunProcessed", String(jobs.length));
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastRunAdded", String(added));
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastRunSkipped", String(skipped));
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastExtractionMethod", jobs.length === 0 ? "none" : fallbackUsed ? "fallback" : "model");
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("fallbackUsed", String(fallbackUsed));
			if (modelFailureReason) this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("modelFailureReason", modelFailureReason);
			else this.db.prepare("DELETE FROM memory_meta WHERE key = 'modelFailureReason'").run();
			this.db.prepare("DELETE FROM memory_meta WHERE key IN ('error', 'nextRetryAt')").run();
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastExtractedAt", now());
			this.phase("consolidating");
			this.writeViews();
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastConsolidatedAt", now());
			this.publish(true);
			return this.getState();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const retry = new Date(Date.now() + 15 * 60_000).toISOString();
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("error", message);
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("nextRetryAt", retry);
			this.phase("retry_wait", message);
			return this.getState();
		} finally {
			this.running = false;
			this.extractionAbortController = undefined;
			if (this.enabled()) this.publish();
			if (this.closeWhenIdle) this.db.close();
		}
	}

	private async extractJob(job: Record<string, unknown>, signal?: AbortSignal): Promise<{ added: number; skipped: number; fallbackUsed: boolean; modelFailureReason?: string }> {
		const checkpoint = parseJson<SessionMemoryCheckpoint>(String(job.checkpoint ?? ""), {} as SessionMemoryCheckpoint);
		let extracted: MemoryCandidate[] = [];
		let modelFailureReason: string | undefined;
		let extractionFailed = !this.options.extract;
		try {
			const result = this.options.extract ? await this.options.extract(checkpoint, signal) : { candidates: [], failureReason: "No background model adapter is configured." };
			if (Array.isArray(result)) extracted = result;
			else { extracted = result.candidates; modelFailureReason = result.failureReason; extractionFailed ||= Boolean(result.failureReason); }
		} catch (error) {
			if (signal?.aborted) throw error;
			modelFailureReason = error instanceof Error ? error.message : String(error);
			extractionFailed = true;
		}
		const fallbackUsed = extractionFailed;
		const candidates = fallbackUsed ? this.deriveCandidates(checkpoint) : extracted;
		let added = 0;
		for (const candidate of candidates.slice(0, 6)) if (this.upsert({ ...candidate, content: redact(candidate.content) }, checkpoint.sessionId)) added += 1;
		this.db.prepare("UPDATE memory_jobs SET status = 'done', updated_at = ? WHERE id = ?").run(now(), String(job.id));
		return { added, skipped: Math.max(0, candidates.length - added), fallbackUsed, modelFailureReason };
	}

	private deriveCandidates(checkpoint: SessionMemoryCheckpoint): MemoryCandidate[] {
		// Conservative deterministic fallback. It only retains explicitly verified procedures/errors;
		// semantic extraction can be supplied by the background model adapter later.
		const candidates: MemoryCandidate[] = [];
		for (const value of checkpoint.verification ?? []) candidates.push({ scope: "project", kind: "procedure", content: `Verified workflow: ${value}` });
		for (const value of checkpoint.errors ?? []) candidates.push({ scope: "project", kind: "failure", content: `Known failure: ${value}` });
		for (const value of checkpoint.constraints ?? []) candidates.push({ scope: "project", kind: "preference", content: `Explicit user requirement: ${value}` });
		return candidates;
	}

	private upsert(candidate: MemoryCandidate, sessionId: string): boolean {
		if (!candidate.content || candidate.content.length < 8 || !["preference", "fact", "procedure", "failure"].includes(candidate.kind) || (candidate.scope && !["global", "project", "checkout"].includes(candidate.scope)) || (candidate.confidence !== undefined && (!Number.isFinite(candidate.confidence) || candidate.confidence < 0.75 || candidate.confidence > 1)) || !this.options.trusted() && candidate.scope !== "global") return false;
		const scope = candidate.scope ?? "project";
		const projectKey = scope === "global" ? null : this.identity.projectKey;
		const checkoutKey = scope === "checkout" ? this.identity.checkoutKey : null;
		const existing = this.db.prepare("SELECT id, sources FROM memory_records WHERE scope = ? AND project_key IS ? AND checkout_key IS ? AND content = ?").get(scope, projectKey, checkoutKey, candidate.content) as { id: string; sources: string } | undefined;
		if (existing) {
			const sources = [...new Set([...parseJson<string[]>(existing.sources, []), sessionId])];
			this.db.prepare("UPDATE memory_records SET sources = ?, updated_at = ?, status = 'active' WHERE id = ?").run(JSON.stringify(sources), now(), existing.id);
			return false;
		}
		const id = randomUUID();
		this.db.prepare("INSERT INTO memory_records VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)")
			.run(id, scope, projectKey, checkoutKey, candidate.kind, candidate.content.slice(0, 4000), JSON.stringify([sessionId]), now(), now());
		this.db.prepare("INSERT INTO memory_fts(id, content) VALUES (?, ?)").run(id, candidate.content);
		return true;
	}

	search(query: string, limit = 6): MemoryRecordSummary[] {
		const cutoff = new Date(Date.now() - this.config().maxUnusedDays * DAY).toISOString();
		const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
		const match = terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" AND ");
		const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit) || 6));
		const base = `r.status = 'active' AND (r.scope = 'global' OR (r.scope = 'project' AND r.project_key = ?) OR (r.scope = 'checkout' AND r.checkout_key = ?)) AND COALESCE(r.last_used_at, r.updated_at) >= ?`;
		let rows = match
			? this.db.prepare(`SELECT r.* FROM memory_fts f JOIN memory_records r ON r.id = f.id WHERE ${base} AND f.memory_fts MATCH ? ORDER BY bm25(memory_fts), COALESCE(r.last_used_at, r.updated_at) DESC LIMIT ?`).all(this.identity.projectKey, this.identity.checkoutKey, cutoff, match, safeLimit)
			: this.db.prepare(`SELECT r.* FROM memory_records r WHERE ${base} ORDER BY COALESCE(r.last_used_at, r.updated_at) DESC LIMIT ?`).all(this.identity.projectKey, this.identity.checkoutKey, cutoff, safeLimit);
		// SQLite's unicode61 tokenizer does not segment every CJK phrase. Keep FTS as
		// the primary path, then use a bounded substring fallback for CJK queries.
		if (rows.length === 0 && terms.some((term) => /\p{Script=Han}/u.test(term))) {
			const clauses = terms.map(() => "r.content LIKE ? ESCAPE '\\'").join(" AND ");
			const values = terms.map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`);
			rows = this.db.prepare(`SELECT r.* FROM memory_records r WHERE ${base} AND ${clauses} ORDER BY COALESCE(r.last_used_at, r.updated_at) DESC LIMIT ?`).all(this.identity.projectKey, this.identity.checkoutKey, cutoff, ...values, safeLimit);
		}
		return (rows as Array<Record<string, string | null>>).map((row) => this.summary(row));
	}

	searchAndTouch(query: string, limit = 6): MemoryRecordSummary[] {
		if (!this.enabled()) return [];
		const records = this.search(query, limit);
		const usedAt = now();
		for (const record of records) {
			this.db.prepare("UPDATE memory_records SET last_used_at = ? WHERE id = ?").run(usedAt, record.id);
			record.lastUsedAt = usedAt;
		}
		return records;
	}

	forget(id: string): boolean {
		const result = this.db.prepare("DELETE FROM memory_records WHERE id = ?").run(id);
		this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
		if (result.changes) { this.writeViews(); this.publish(true); }
		return result.changes > 0;
	}

	reset(confirm: string): void {
		if (confirm !== "RESET_MEMORY") throw new Error("Memory reset requires confirm=RESET_MEMORY");
		this.db.exec("DELETE FROM memory_records; DELETE FROM memory_fts; DELETE FROM memory_jobs;");
		this.writeViews(); this.publish(true);
	}

	private summary(row: Record<string, string | null>): MemoryRecordSummary {
		return { id: row.id!, scope: row.scope as MemoryScope, kind: row.kind as MemoryKind, content: row.content!, status: row.status as MemoryRecordStatus, sourceSessionIds: parseJson(row.sources, []), updatedAt: row.updated_at!, lastUsedAt: row.last_used_at ?? undefined };
	}

	private writeViews(): void {
		const rows = this.db.prepare("SELECT * FROM memory_records WHERE status = 'active' ORDER BY updated_at DESC").all() as Array<Record<string, string | null>>;
		const write = (path: string, content: string) => { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, content, "utf8"); renameSync(temp, path); };
		const render = (title: string, values: Array<Record<string, string | null>>) => `# ${title}\n\n${values.map((row) => `- [${row.kind}] ${row.content}`).join("\n") || "No consolidated memories yet."}\n`;
		write(join(this.root, "MEMORY.md"), render("Metis memory", rows.filter((row) => row.scope === "global")));
		write(join(this.root, "projects", this.identity.projectKey, "MEMORY.md"), render("Project memory", rows.filter((row) => row.scope !== "global")));
		write(join(this.root, "memory_summary.md"), render("Memory index", rows.slice(0, 20)).slice(0, 6000));
	}
}
