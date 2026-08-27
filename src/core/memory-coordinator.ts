/**
 * Durable memory control plane.
 *
 * Memory is deliberately data, never privileged instructions.  The session
 * loop owns when a checkpoint is written; this coordinator owns retention,
 * scope, retrieval and the idle background queue.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type MemoryPhase = "idle" | "extracting" | "consolidating" | "retry_wait" | "error" | "disabled";
export type MemoryScope = "global" | "project" | "checkout";
export type MemoryKind = "preference" | "fact" | "procedure" | "failure";
export type MemoryRecordStatus = "active" | "stale" | "conflicted";

export type MemoryCategory =
	| "tech_stack"
	| "architecture_patterns"
	| "project_conventions"
	| "domain_knowledge"
	| "workflows_and_commands"
	| "known_failures_and_fixes"
	| "deployment_and_infra"
	| "user_preferences";

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
	"tech_stack",
	"architecture_patterns",
	"project_conventions",
	"domain_knowledge",
	"workflows_and_commands",
	"known_failures_and_fixes",
	"deployment_and_infra",
	"user_preferences",
] as const;

export const CATEGORY_DISPLAY_TITLES: Record<MemoryCategory, string> = {
	tech_stack: "Tech Stack & Runtime",
	architecture_patterns: "Architecture & Modular Patterns",
	project_conventions: "Project Conventions & Code Guidelines",
	domain_knowledge: "Domain Knowledge & Core Facts",
	workflows_and_commands: "Workflows & Standard Commands",
	known_failures_and_fixes: "Known Failures & Debugging Solutions",
	deployment_and_infra: "Deployment & Infrastructure",
	user_preferences: "User Preferences & Collaboration Style",
};

export function normalizeCategory(category?: string | null, kind?: string | null, content = ""): MemoryCategory {
	if (category && (MEMORY_CATEGORIES as readonly string[]).includes(category)) {
		return category as MemoryCategory;
	}
	const lower = content.toLowerCase();
	if (kind === "preference" || lower.includes("偏好") || lower.includes("preference") || lower.includes("习惯")) return "user_preferences";
	if (kind === "failure" || lower.includes("failed") || lower.includes("error") || lower.includes("eisdir") || lower.includes("enoent") || lower.includes("失败") || lower.includes("报错")) return "known_failures_and_fixes";
	if (kind === "procedure" || lower.includes("workflow") || lower.includes("command") || lower.includes("npm run") || lower.includes("npm test") || lower.includes("工作流") || lower.includes("命令")) return "workflows_and_commands";
	if (lower.includes("node.js") || lower.includes("typescript") || lower.includes("npm package") || lower.includes("@wholiver_hu") || lower.includes("license") || lower.includes("mit")) return "tech_stack";
	if (lower.includes("architecture") || lower.includes("agent layer") || lower.includes("架构") || lower.includes("context") || lower.includes("reusable")) return "architecture_patterns";
	if (lower.includes("readme") || lower.includes("docs") || lower.includes("documentation") || lower.includes("capabilities") || lower.includes("dream")) return "domain_knowledge";
	switch (kind) {
		case "preference":
			return "user_preferences";
		case "failure":
			return "known_failures_and_fixes";
		case "procedure":
			return "workflows_and_commands";
		case "fact":
		default:
			return "tech_stack";
	}
}

export function categoryToKind(category?: MemoryCategory | null): MemoryKind {
	switch (category) {
		case "user_preferences":
			return "preference";
		case "known_failures_and_fixes":
			return "failure";
		case "workflows_and_commands":
			return "procedure";
		default:
			return "fact";
	}
}

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
	extractingTotal?: number;
	extractingProcessed?: number;
	extractingAdded?: number;
	extractingSkipped?: number;
}

export interface MemoryRecordSummary {
	id: string;
	scope: MemoryScope;
	category?: MemoryCategory;
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

export interface MemorySearchOptions {
	category?: MemoryCategory;
	scope?: MemoryScope;
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
	extract?: (checkpoint: SessionMemoryCheckpoint, signal?: AbortSignal, existingMemoryMap?: string, existingMemoryOverview?: string) => Promise<MemoryCandidate[] | MemoryExtractionResult>;
}

export interface MemoryCandidate {
	scope?: MemoryScope;
	category?: MemoryCategory;
	kind?: MemoryKind;
	content: string;
	confidence?: number;
	supersedes?: string[];
}

export interface MemoryExtractionResult {
	candidates: MemoryCandidate[];
	memoryMap?: string;
	memoryOverview?: string;
	failureReason?: string;
}

type Listener = (event: { type: "memory_state_changed"; state: MemoryState } | { type: "memory_records_changed" }) => void;

const SECRET = /(?:\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b|\b(?:api[_-]?key|authorization|password|token)\s*[:=]\s*[^\s,;]+)/gi;
const DAY = 86_400_000;
const EXTRACTION_CONCURRENCY = 4;

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
	private currentExtractionStats?: {
		total: number;
		processed: number;
		added: number;
		skipped: number;
	};
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
		this.migrateCategoryConsolidation();
		this.state = this.buildState();
	}

	private initialize(): void {
		this.db.exec(`
			PRAGMA busy_timeout=5000;
			PRAGMA journal_mode=WAL;
			CREATE TABLE IF NOT EXISTS memory_records (
				id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_key TEXT, checkout_key TEXT,
				kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
				sources TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT,
				category TEXT
			);
			CREATE TABLE IF NOT EXISTS memory_jobs (
				id TEXT PRIMARY KEY, session_id TEXT NOT NULL, checkpoint TEXT NOT NULL, status TEXT NOT NULL,
				due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, semantic_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, content);
		`);
		try { this.db.exec("ALTER TABLE memory_records ADD COLUMN category TEXT"); } catch { /* already migrated */ }
		try { this.db.exec("ALTER TABLE memory_jobs ADD COLUMN semantic_hash TEXT"); } catch { /* already migrated */ }
	}

	/** Deliberately narrow, idempotent legacy removal. Other .metis data stays untouched. */
	private migrateLegacyArtifacts(): void {
		for (const target of ["MEMORY.md", "memory_summary.md", "projects"]) {
			const path = join(this.root, target);
			try { if (existsSync(path)) rmSync(path, { recursive: true, force: true }); } catch { /* ignore */ }
		}
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

	/** Deduplicate and structure legacy unpartitioned records. */
	private migrateCategoryConsolidation(): void {
		const migrated = this.db.prepare("SELECT value FROM memory_meta WHERE key = 'memory-v2-category-consolidated'").get() as { value?: string } | undefined;
		if (migrated) return;
		try {
			const rows = this.db.prepare("SELECT * FROM memory_records").all() as Array<Record<string, string | null>>;
			if (rows.length === 0) {
				this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("memory-v2-category-consolidated", now());
				return;
			}
			const tokenize = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []).filter((w) => w.length > 1));
			const similarity = (setA: Set<string>, setB: Set<string>) => {
				if (setA.size === 0 || setB.size === 0) return 0;
				let intersection = 0;
				for (const item of setA) if (setB.has(item)) intersection++;
				const union = new Set([...setA, ...setB]).size;
				const containment = intersection / Math.min(setA.size, setB.size);
				const jaccard = intersection / union;
				return Math.max(jaccard, containment * 0.75);
			};

			const groups = new Map<string, Array<Record<string, string | null>>>();
			for (const r of rows) {
				const cat = normalizeCategory(r.category, r.kind, r.content ?? "");
				const key = `${r.scope}:${r.project_key || ""}:${r.checkout_key || ""}:${cat}`;
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key)!.push({ ...r, category: cat });
			}

			const toDeleteIds: string[] = [];
			const toUpdate: Array<{ id: string; category: string; content: string; sources: string }> = [];

			for (const group of groups.values()) {
				const merged: Array<{ record: Record<string, string | null>; tokens: Set<string> }> = [];
				for (const item of group) {
					const tokens = tokenize(item.content ?? "");
					let matched = false;
					for (const m of merged) {
						if (similarity(tokens, m.tokens) >= 0.4) {
							matched = true;
							toDeleteIds.push(item.id!);
							const sourcesA = parseJson<string[]>(item.sources, []);
							const sourcesB = parseJson<string[]>(m.record.sources, []);
							m.record.sources = JSON.stringify([...new Set([...sourcesA, ...sourcesB])]);
							if ((item.content?.length ?? 0) > (m.record.content?.length ?? 0)) {
								m.record.content = item.content;
								m.tokens = tokens;
							}
							break;
						}
					}
					if (!matched) {
						merged.push({ record: { ...item }, tokens });
					}
				}
				for (const m of merged) {
					toUpdate.push({ id: m.record.id!, category: m.record.category!, content: m.record.content!, sources: m.record.sources! });
				}
			}

			for (const id of toDeleteIds) {
				this.db.prepare("DELETE FROM memory_records WHERE id = ?").run(id);
				this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
			}
			for (const u of toUpdate) {
				this.db.prepare("UPDATE memory_records SET category = ?, content = ?, sources = ?, updated_at = ? WHERE id = ?").run(u.category, u.content, u.sources, now(), u.id);
				this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(u.id);
				this.db.prepare("INSERT INTO memory_fts(id, content) VALUES (?, ?)").run(u.id, u.content);
			}
		} catch { /* never block startup */ }
		this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("memory-v2-category-consolidated", now());
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
		const error = get("error");
		return {
			enabled, phase: enabled ? (this.running ? this.state?.phase || "extracting" : (error ? "retry_wait" : "idle")) : "disabled", globalCount: count("global"), projectCount: count("project") + count("checkout"), pendingJobs: pending.count,
			lastExtractedAt: get("lastExtractedAt"), lastConsolidatedAt: get("lastConsolidatedAt"), nextRetryAt: get("nextRetryAt"), error: get("error"),
			nextEligibleAt: next.dueAt ? new Date(next.dueAt).toISOString() : undefined,
			lastRunProcessed: Number(get("lastRunProcessed") ?? 0), lastRunAdded: Number(get("lastRunAdded") ?? 0), lastRunSkipped: Number(get("lastRunSkipped") ?? 0),
			lastExtractionMethod: (get("lastExtractionMethod") as MemoryState["lastExtractionMethod"]) ?? "none",
			fallbackUsed: get("fallbackUsed") === "true", modelFailureReason: get("modelFailureReason"),
			extractingTotal: this.currentExtractionStats?.total,
			extractingProcessed: this.currentExtractionStats?.processed,
			extractingAdded: this.currentExtractionStats?.added,
			extractingSkipped: this.currentExtractionStats?.skipped,
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
		if (!this.enabled()) return this.getState();
		if (this.running) {
			if (force) throw new Error("Memory extraction is already running.");
			return this.getState();
		}
		this.running = true;
		this.extractionAbortController = new AbortController();
		let processed = 0;
		let added = 0;
		let skipped = 0;
		let fallbackUsed = false;
		let modelFailureReason: string | undefined;
		try {
			const settings = this.config();
			const max = force ? Number.MAX_SAFE_INTEGER : settings.maxRolloutsPerSweep;
			const oldest = new Date(Date.now() - settings.maxRolloutAgeDays * DAY).toISOString();
			const jobs = this.db.prepare("SELECT * FROM memory_jobs WHERE status IN ('pending','retry') AND due_at <= ? AND created_at >= ? ORDER BY created_at LIMIT ?").all(force ? Number.MAX_SAFE_INTEGER : Date.now(), oldest, max) as Array<Record<string, unknown>>;
			this.currentExtractionStats = {
				total: jobs.length,
				processed: 0,
				added: 0,
				skipped: 0,
			};
			this.phase("extracting");

			let jobIndex = 0;
			let fatalError: unknown;
			const abortController = this.extractionAbortController;

			const worker = async () => {
				while (jobIndex < jobs.length) {
					if (abortController?.signal.aborted || fatalError) break;
					const currentIndex = jobIndex++;
					if (currentIndex >= jobs.length) break;
					const job = jobs[currentIndex];
					try {
						const result = await this.extractJob(job, abortController?.signal);
						processed += 1;
						added += result.added;
						skipped += result.skipped;
						fallbackUsed ||= result.fallbackUsed;
						modelFailureReason = result.modelFailureReason ?? modelFailureReason;
						this.currentExtractionStats = {
							total: jobs.length,
							processed,
							added,
							skipped,
						};
						this.phase("extracting");
					} catch (err) {
						fatalError = err;
						abortController?.abort();
						break;
					}
				}
			};

			const workerCount = Math.min(EXTRACTION_CONCURRENCY, jobs.length);
			if (workerCount > 0) {
				const workers = Array.from({ length: workerCount }, () => worker());
				await Promise.all(workers);
			}

			if (fatalError) {
				throw fatalError;
			}
			this.storeRunStats(processed, added, skipped, fallbackUsed, modelFailureReason);
			this.db.prepare("DELETE FROM memory_meta WHERE key IN ('error', 'nextRetryAt')").run();
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastExtractedAt", now());
			this.currentExtractionStats = undefined;
			this.phase("consolidating");
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastConsolidatedAt", now());
			this.publish(true);
			return this.getState();
		} catch (error) {
			this.currentExtractionStats = undefined;
			const message = error instanceof Error ? error.message : String(error);
			const retry = new Date(Date.now() + 15 * 60_000).toISOString();
			this.storeRunStats(processed, added, skipped, fallbackUsed, modelFailureReason);
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("error", message);
			this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("nextRetryAt", retry);
			this.phase("retry_wait", message);
			if (force) throw error;
			return this.getState();
		} finally {
			this.running = false;
			this.currentExtractionStats = undefined;
			this.extractionAbortController = undefined;
			if (this.enabled()) this.publish();
			if (this.closeWhenIdle) this.db.close();
		}
	}

	private storeRunStats(processed: number, added: number, skipped: number, fallbackUsed: boolean, modelFailureReason?: string): void {
		this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastRunProcessed", String(processed));
		this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastRunAdded", String(added));
		this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastRunSkipped", String(skipped));
		this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("lastExtractionMethod", processed === 0 ? "none" : fallbackUsed ? "fallback" : "model");
		this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("fallbackUsed", String(fallbackUsed));
		if (modelFailureReason) this.db.prepare("INSERT OR REPLACE INTO memory_meta(key, value) VALUES (?, ?)").run("modelFailureReason", modelFailureReason);
		else this.db.prepare("DELETE FROM memory_meta WHERE key = 'modelFailureReason'").run();
	}

	private async extractJob(job: Record<string, unknown>, signal?: AbortSignal): Promise<{ added: number; skipped: number; fallbackUsed: boolean; modelFailureReason?: string }> {
		const checkpoint = parseJson<SessionMemoryCheckpoint>(String(job.checkpoint ?? ""), {} as SessionMemoryCheckpoint);
		let extracted: MemoryCandidate[] = [];
		let updatedMemoryMap: string | undefined;
		let updatedMemoryOverview: string | undefined;
		let modelFailureReason: string | undefined;
		let extractionFailed = !this.options.extract;
		const memoryMapPath = join(this.root, "memory-map.md");
		const memoryOverviewPath = join(this.root, "memory-overview.md");
		let existingMemoryMap: string | undefined;
		let existingMemoryOverview: string | undefined;
		let pendingMemoryOverview: string | undefined;
		try {
			if (existsSync(memoryMapPath)) existingMemoryMap = readFileSync(memoryMapPath, "utf8");
		} catch { /* ignore read error */ }
		try {
			if (existsSync(memoryOverviewPath)) existingMemoryOverview = readFileSync(memoryOverviewPath, "utf8");
		} catch { /* ignore read error */ }
		try {
			const result = this.options.extract ? await this.options.extract(checkpoint, signal, existingMemoryMap, existingMemoryOverview) : { candidates: [], failureReason: "No background model adapter is configured." };
			if (Array.isArray(result)) extracted = result;
			else {
				extracted = result.candidates;
				updatedMemoryMap = result.memoryMap;
				updatedMemoryOverview = result.memoryOverview;
				modelFailureReason = result.failureReason;
				extractionFailed ||= Boolean(result.failureReason);
			}
		} catch (error) {
			if (signal?.aborted) throw error;
			modelFailureReason = error instanceof Error ? error.message : String(error);
			extractionFailed = true;
		}
		if (updatedMemoryMap && typeof updatedMemoryMap === "string" && updatedMemoryMap.trim().length > 0) {
			try {
				const temp = `${memoryMapPath}.${randomUUID()}.tmp`;
				writeFileSync(temp, updatedMemoryMap.trim() + "\n", "utf8");
				renameSync(temp, memoryMapPath);
			} catch { /* atomic write error fallback */ }
		}
		if (updatedMemoryOverview && typeof updatedMemoryOverview === "string" && updatedMemoryOverview.trim().length > 0) {
			pendingMemoryOverview = updatedMemoryOverview.trim() + "\n";
		}
		const fallbackUsed = extractionFailed;
		const candidates = fallbackUsed ? this.deriveCandidates(checkpoint) : extracted;
		let added = 0;
		for (const candidate of candidates.slice(0, 6)) if (this.upsert({ ...candidate, content: redact(candidate.content) }, checkpoint.sessionId)) added += 1;
		// memory-overview.md is embedded in the system prompt, so any rewrite invalidates
		// the provider's prompt cache for the whole conversation. A background model
		// rewords the overview on every checkpoint; only persist it when memory actually
		// changed (or the overview is missing) and the bytes actually differ.
		if (pendingMemoryOverview && (added > 0 || !existingMemoryOverview?.trim()) && pendingMemoryOverview !== existingMemoryOverview) {
			try {
				const temp = `${memoryOverviewPath}.${randomUUID()}.tmp`;
				writeFileSync(temp, pendingMemoryOverview, "utf8");
				renameSync(temp, memoryOverviewPath);
			} catch { /* atomic write error fallback */ }
		}
		this.db.prepare("UPDATE memory_jobs SET status = 'done', updated_at = ? WHERE id = ?").run(now(), String(job.id));
		return { added, skipped: Math.max(0, candidates.length - added), fallbackUsed, modelFailureReason };
	}

	private deriveCandidates(checkpoint: SessionMemoryCheckpoint): MemoryCandidate[] {
		// Conservative deterministic fallback. It only retains explicitly verified procedures/errors;
		// semantic extraction can be supplied by the background model adapter later.
		const candidates: MemoryCandidate[] = [];
		for (const value of checkpoint.verification ?? []) candidates.push({ scope: "project", category: "workflows_and_commands", kind: "procedure", content: `Verified workflow: ${value}` });
		for (const value of checkpoint.errors ?? []) candidates.push({ scope: "project", category: "known_failures_and_fixes", kind: "failure", content: `Known failure: ${value}` });
		for (const value of checkpoint.constraints ?? []) candidates.push({ scope: "project", category: "user_preferences", kind: "preference", content: `Explicit user requirement: ${value}` });
		return candidates;
	}

	private upsert(candidate: MemoryCandidate, sessionId: string): boolean {
		if (!candidate.content || candidate.content.length < 8) return false;
		const scope = candidate.scope ?? "project";
		if (!["global", "project", "checkout"].includes(scope)) return false;
		if (candidate.confidence !== undefined && (!Number.isFinite(candidate.confidence) || candidate.confidence < 0.75 || candidate.confidence > 1)) return false;
		if (!this.options.trusted() && scope !== "global") return false;

		const category = normalizeCategory(candidate.category, candidate.kind, candidate.content);
		const kind = candidate.kind && ["preference", "fact", "procedure", "failure"].includes(candidate.kind)
			? candidate.kind
			: categoryToKind(category);

		const projectKey = scope === "global" ? null : this.identity.projectKey;
		const checkoutKey = scope === "checkout" ? this.identity.checkoutKey : null;

		// Handle supersedes: merge sources and remove superseded records
		const supersedes = Array.isArray(candidate.supersedes)
			? candidate.supersedes.map((id) => String(id).trim()).filter((id) => id.length > 0)
			: [];

		const collectedSources = [sessionId];

		if (supersedes.length > 0) {
			for (const oldId of supersedes) {
				const oldRow = this.db.prepare("SELECT sources FROM memory_records WHERE id = ?").get(oldId) as { sources?: string } | undefined;
				if (oldRow) {
					const oldSources = parseJson<string[]>(oldRow.sources, []);
					collectedSources.push(...oldSources);
					this.db.prepare("DELETE FROM memory_records WHERE id = ?").run(oldId);
					this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(oldId);
				}
			}
		}

		// Exact match deduplication check
		const existing = this.db.prepare("SELECT id, sources FROM memory_records WHERE scope = ? AND project_key IS ? AND checkout_key IS ? AND content = ?").get(scope, projectKey, checkoutKey, candidate.content) as { id: string; sources: string } | undefined;
		if (existing) {
			const mergedSources = [...new Set([...parseJson<string[]>(existing.sources, []), ...collectedSources])];
			this.db.prepare("UPDATE memory_records SET category = ?, kind = ?, sources = ?, updated_at = ?, status = 'active' WHERE id = ?").run(category, kind, JSON.stringify(mergedSources), now(), existing.id);
			return false;
		}

		const id = randomUUID();
		const finalSources = [...new Set(collectedSources)];
		this.db.prepare("INSERT INTO memory_records (id, scope, project_key, checkout_key, kind, content, status, sources, created_at, updated_at, last_used_at, category) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?)")
			.run(id, scope, projectKey, checkoutKey, kind, candidate.content.slice(0, 4000), JSON.stringify(finalSources), now(), now(), category);
		this.db.prepare("INSERT INTO memory_fts(id, content) VALUES (?, ?)").run(id, candidate.content);
		return true;
	}

	search(query?: string, limit = 6, filterOptions?: MemorySearchOptions): MemoryRecordSummary[] {
		const cutoff = new Date(Date.now() - this.config().maxUnusedDays * DAY).toISOString();
		const trimmedQuery = String(query ?? "").trim();
		const terms = trimmedQuery.match(/[\p{L}\p{N}_-]+/gu) ?? [];
		const match = terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" AND ");
		const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit) || 6));

		let base = `r.status = 'active' AND COALESCE(r.last_used_at, r.updated_at) >= ?`;
		const params: Array<string | null> = [cutoff];

		if (filterOptions?.scope) {
			if (filterOptions.scope === "global") {
				base += ` AND r.scope = 'global'`;
			} else if (filterOptions.scope === "project") {
				base += ` AND r.scope = 'project' AND r.project_key = ?`;
				params.push(this.identity.projectKey);
			} else if (filterOptions.scope === "checkout") {
				base += ` AND r.scope = 'checkout' AND r.checkout_key = ?`;
				params.push(this.identity.checkoutKey);
			}
		} else {
			base += ` AND (r.scope = 'global' OR (r.scope = 'project' AND r.project_key = ?) OR (r.scope = 'checkout' AND r.checkout_key = ?))`;
			params.push(this.identity.projectKey, this.identity.checkoutKey);
		}

		if (filterOptions?.category) {
			base += ` AND r.category = ?`;
			params.push(filterOptions.category);
		}

		let rows: Array<Record<string, string | null>> = [];

		if (match) {
			rows = this.db.prepare(`SELECT r.* FROM memory_fts f JOIN memory_records r ON r.id = f.id WHERE ${base} AND f.memory_fts MATCH ? ORDER BY bm25(memory_fts), COALESCE(r.last_used_at, r.updated_at) DESC LIMIT ?`).all(...params, match, safeLimit) as any;
		} else {
			rows = this.db.prepare(`SELECT r.* FROM memory_records r WHERE ${base} ORDER BY COALESCE(r.last_used_at, r.updated_at) DESC LIMIT ?`).all(...params, safeLimit) as any;
		}

		// SQLite's unicode61 tokenizer does not segment every CJK phrase. Keep FTS as
		// the primary path, then use a bounded substring fallback for CJK queries.
		if (rows.length === 0 && match && terms.some((term) => /\p{Script=Han}/u.test(term))) {
			const clauses = terms.map(() => "r.content LIKE ? ESCAPE '\\'").join(" AND ");
			const values = terms.map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`);
			rows = this.db.prepare(`SELECT r.* FROM memory_records r WHERE ${base} AND ${clauses} ORDER BY COALESCE(r.last_used_at, r.updated_at) DESC LIMIT ?`).all(...params, ...values, safeLimit) as any;
		}
		return rows.map((row) => this.summary(row));
	}

	searchAndTouch(query?: string, limit = 6, filterOptions?: MemorySearchOptions): MemoryRecordSummary[] {
		if (!this.enabled()) return [];
		const records = this.search(query, limit, filterOptions);
		const usedAt = now();
		for (const record of records) {
			this.db.prepare("UPDATE memory_records SET last_used_at = ? WHERE id = ?").run(usedAt, record.id);
			record.lastUsedAt = usedAt;
		}
		return records;
	}

	/**
	 * Executes a read-only SQL query against the SQLite database.
	 * Only SELECT, WITH, PRAGMA, and EXPLAIN statements are permitted.
	 */
	query(sql: string, params: Array<string | number | null | undefined> = []): Array<Record<string, unknown>> {
		if (!this.enabled()) return [];
		const normalized = sql.trim();
		if (!normalized) throw new Error("SQL query cannot be empty.");

		const firstWord = normalized.match(/^\s*([A-Za-z]+)/)?.[1]?.toUpperCase();
		if (!firstWord || !["SELECT", "WITH", "PRAGMA", "EXPLAIN"].includes(firstWord)) {
			throw new Error(`Only read-only queries (SELECT, WITH, PRAGMA, EXPLAIN) are permitted. Received: ${firstWord || "unknown"}`);
		}
		if (/;\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i.test(normalized)) {
			throw new Error("Multiple statements with mutating operations are strictly forbidden.");
		}

		const normalizedParams = params.map((p) => p ?? null);
		const rows = this.db.prepare(normalized).all(...normalizedParams) as Array<Record<string, unknown>>;
		return rows.slice(0, 100);
	}

	getMemoryOverview(): string | undefined {
		if (!this.enabled()) return undefined;
		const overviewPath = join(this.root, "memory-overview.md");
		try {
			if (existsSync(overviewPath)) {
				const content = readFileSync(overviewPath, "utf8").trim();
				return content.length > 0 ? content : undefined;
			}
		} catch {
			return undefined;
		}
		return undefined;
	}

	forget(id: string): boolean {
		const result = this.db.prepare("DELETE FROM memory_records WHERE id = ?").run(id);
		this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
		if (result.changes) this.publish(true);
		return result.changes > 0;
	}

	reset(confirm: string): void {
		if (confirm !== "RESET_MEMORY") throw new Error("Memory reset requires confirm=RESET_MEMORY");
		this.db.exec("DELETE FROM memory_records; DELETE FROM memory_fts; DELETE FROM memory_jobs;");
		const memoryMapPath = join(this.root, "memory-map.md");
		try { if (existsSync(memoryMapPath)) rmSync(memoryMapPath, { force: true }); } catch { /* ignore */ }
		const memoryOverviewPath = join(this.root, "memory-overview.md");
		try { if (existsSync(memoryOverviewPath)) rmSync(memoryOverviewPath, { force: true }); } catch { /* ignore */ }
		this.publish(true);
	}

	private summary(row: Record<string, string | null>): MemoryRecordSummary {
		const category = normalizeCategory(row.category, row.kind, row.content ?? "");
		return {
			id: row.id!,
			scope: row.scope as MemoryScope,
			category,
			kind: (row.kind as MemoryKind) ?? categoryToKind(category),
			content: row.content!,
			status: row.status as MemoryRecordStatus,
			sourceSessionIds: parseJson(row.sources, []),
			updatedAt: row.updated_at!,
			lastUsedAt: row.last_used_at ?? undefined,
		};
	}
}

