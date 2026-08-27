import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import {
	parsePerformanceRoadmapItems,
	performanceItemGatePolicy,
	type PerformanceRoadmapItem,
} from "./performance-roadmap.ts";
import { getPerformanceFramework } from "./performance-frameworks.ts";

/**
 * Runtime control plane for the Codex variant of Performance.
 *
 * The model remains responsible for agent reasoning. This module owns the
	* deterministic parts: durable governance artifacts,
 * topology validation, and the run-wide live-agent ceiling.
 */
export type PerformanceConcurrency = "tokensaver" | "wide" | "custom";
export type PerformanceAttendance = "attended" | "unattended";
export type PerformanceEffortCapability = "selectable" | "inherited-only" | "unsupported" | "unknown";
export type PerformanceGate = "G0" | "G2" | "G2-assurance" | "G2-review" | "G2-verify" | "G1" | "G1-assurance" | "G1-review" | "G1-verify" | "G3.5" | "G4" | "G4-assurance" | "G5" | "G6" | "G7" | "G7-assurance" | "sweep" | "goal-check" | "complete" | "blocked";
export type PerformanceRunStatus = "active" | "completed" | "blocked" | "aborted";
export type PerformanceVerdict = "pass" | "fail" | "blocked";

export interface PerformanceGateReport {
	gate: Exclude<PerformanceGate, "complete" | "blocked">;
	/** G2 is run-wide. All downstream reports bind to the currently active roadmap item. */
	itemId?: string;
	actor: string;
	role: string;
	verdict: PerformanceVerdict;
	evidence: string;
	at: string;
}

export interface PerformanceAgentLease {
	agentId: string;
	role: string;
	startedAt: string;
}

export interface PerformanceCapabilityProbe {
	read: boolean;
	write: boolean;
	run: boolean;
	evidence: string;
	at: string;
}

/** Exact configured provider/model bindings requested for native child routing. */
export interface PerformanceModelSelection {
	provider: string;
	model: string;
}

export interface PerformanceRunState {
	schemaVersion: 1;
	runId: string;
	nonce: string;
	mission: string;
	missionSha256: string;
	missionBytes: number;
	status: PerformanceRunStatus;
	frontier: PerformanceGate;
	concurrency: PerformanceConcurrency;
	maxConcurrent: number;
	agentSelection: "off" | "auto" | "explicit";
	agentModels: PerformanceModelSelection[];
	attendance: PerformanceAttendance;
	effortCapability: PerformanceEffortCapability;
	maxReasoningEffort?: string;
	capabilityProbe: PerformanceCapabilityProbe;
	roadmapItems: PerformanceRoadmapItem[];
	completedItemIds: string[];
	activeItemId?: string;
	governanceRoot: string;
	createdAt: string;
	updatedAt: string;
	reports: PerformanceGateReport[];
	leases: PerformanceAgentLease[];
	repairRequired?: {
		gate: "G2";
		actor: string;
		message: string;
		at: string;
	};
}

/** Safe session/API view; excludes mission text, nonce, and gate evidence. */
export interface PerformanceRunSummary {
	runId: string;
	status: PerformanceRunStatus;
	frontier: PerformanceGate;
	concurrency: PerformanceConcurrency;
	maxConcurrent: number;
	activeItemId?: string;
	completedItemCount: number;
	governanceRoot: string;
	createdAt: string;
	updatedAt: string;
	reportCount: number;
	liveAgentCount: number;
}

export interface PerformanceStartInvocation {
	kind: "start";
	mission: string;
	concurrency?: PerformanceConcurrency;
	maxConcurrent?: number;
	agentSelection?: "off" | "auto" | "explicit";
	agentModels?: PerformanceModelSelection[];
	attendance?: PerformanceAttendance;
	effortCapability?: PerformanceEffortCapability;
	maxReasoningEffort?: string;
	capabilities?: { read: boolean; write: boolean; run: boolean };
}

export interface PerformanceSpawnRequest {
	parentRole: string;
	childRole: string;
	liveAgents: number;
}

export interface PerformanceSpawnDecision {
	valid: boolean;
	message?: string;
}

const TOP_LEVEL_ROLE = "scope-coordinator";
const L1_ROLES = new Set(["scope-coordinator", "feature-coordinator", "sweep-coordinator"]);
const L2_ROLES = new Set(["manager"]);
const L3_ROLES = new Set([
	"scoper", "researcher", "synthesizer", "planner", "implementer", "reviewer", "verifier", "sweeper", "execharness-resolver", "framework-generator",
]);
const L4_ROLES = new Set([
	"fresh-verifier", "depth-prober", "framework-validator", "juror", "goal-checker", "arbiter", "re-anchor", "scribe", "janitor",
]);
const KNOWN_ROLES = new Set(["coordinator", ...L1_ROLES, ...L2_ROLES, ...L3_ROLES, ...L4_ROLES, "intake", "preflight-probe"]);

function hash(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function now(): string {
	return new Date().toISOString();
}

function line(state: PerformanceRunState, event: string): string {
	const elapsedMs = Math.max(0, Date.now() - Date.parse(state.createdAt));
	return `[${now()}] ${event} run=${state.runId} nonce=${state.nonce} frontier=${state.frontier} status=${state.status} elapsed_ms=${elapsedMs}`;
}

const ROADMAP_FIELDS = [
	"Scope profile", "Repository intelligence", "Framework/tool decisions", "Items", "Stable item IDs", "Owned boundaries", "Dependencies", "Launch groups", "Integration lane",
	"Implementation steps", "Acceptance criteria", "Unhappy paths", "Tests-first steps", "Verification commands", "Coverage requirement",
] as const;

function roadmapTemplate(state: PerformanceRunState, pointer: ReturnType<typeof missionPointer>): string {
	return [
		"# Performance roadmap",
		`Run: ${state.runId}`,
		`Mission pointer: ${pointer.path} (sha256=${pointer.sha256}; bytes=${pointer.bytes})`,
		`Run nonce: ${state.nonce}`,
		"",
		"## Scope profile\n- Scope profile: TBD",
		"## Repository intelligence\n- Repository intelligence: TBD",
		"## Framework and tool decisions\n- Framework/tool decisions: TBD",
		"## Items\n- Items: add one or more sections below\n- Stable item IDs: declared by each Item heading",
		"## Boundaries and dependencies\n- Owned boundaries: TBD\n- Dependencies: TBD\n- Launch groups: TBD\n- Integration lane: TBD",
		"## Delivery contract\n- Implementation steps: TBD\n- Acceptance criteria: TBD\n- Unhappy paths: TBD\n- Tests-first steps: TBD\n- Verification commands: TBD\n- Coverage requirement: >=95% changed-line and touched-module coverage\n- requiresDetailedPlan: false",
		"",
		"## Item: TBD-ID",
		"- Category: TBD",
		"- Tag: none",
		"- Tier: TBD",
		"- Framework: TBD",
		"- Owned boundaries: TBD",
		"- Dependencies: none",
		"- Launch group: TBD",
		"- Integration lane: TBD",
		"- Implementation steps: TBD",
		"- Acceptance criteria: TBD",
		"- Unhappy paths: TBD",
		"- Tests-first steps: TBD",
		"- Verification commands: TBD",
		"- requiresDetailedPlan: false",
		"- Detailed plan reason: not required",
		"",
	].join("\n");
}

export function getPerformanceGovernanceRoot(agentDir: string): string {
	return resolve(agentDir, "performance-runs");
}

export function getPerformanceRunDirectory(agentDir: string, runId: string): string {
	return join(getPerformanceGovernanceRoot(agentDir), runId);
}

export function missionPointer(state: PerformanceRunState): { path: string; sha256: string; bytes: number; nonce: string } {
	const path = join(state.governanceRoot, "PROMPTS.txt");
	const content = readFileSync(path, "utf8");
	const sha256 = hash(content);
	const bytes = Buffer.byteLength(content, "utf8");
	if (sha256 !== state.missionSha256 || bytes !== state.missionBytes) throw new Error("Performance mission pointer no longer matches PROMPTS.txt.");
	return { path, sha256, bytes, nonce: state.nonce };
}

export function summarizePerformanceRun(state: Readonly<PerformanceRunState> | undefined): PerformanceRunSummary | undefined {
	if (!state) return undefined;
	return {
		runId: state.runId,
		status: state.status,
		frontier: state.frontier,
		concurrency: state.concurrency,
		maxConcurrent: state.maxConcurrent,
		activeItemId: state.activeItemId,
		completedItemCount: state.completedItemIds.length,
		governanceRoot: state.governanceRoot,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		reportCount: state.reports.length,
		liveAgentCount: state.leases.length,
	};
}

export function validatePerformanceSpawn(request: PerformanceSpawnRequest, state: PerformanceRunState): PerformanceSpawnDecision {
	if (!KNOWN_ROLES.has(request.childRole)) return { valid: false, message: `Performance rejects unknown role "${request.childRole}".` };
	if (request.liveAgents >= state.maxConcurrent) {
		return { valid: false, message: `Performance live-agent ceiling reached (${state.maxConcurrent}); collect a worker before dispatching another.` };
	}
	if (request.parentRole === "root" || request.parentRole === "coordinator") {
		return { valid: true };
	}
	if (L1_ROLES.has(request.parentRole)) {
		if (request.childRole === "manager" || L3_ROLES.has(request.childRole) || L4_ROLES.has(request.childRole)) return { valid: true };
		return { valid: false, message: `Performance L1 cannot dispatch ${request.childRole}.` };
	}
	if (L2_ROLES.has(request.parentRole)) {
		if (L3_ROLES.has(request.childRole) || L4_ROLES.has(request.childRole)) return { valid: true };
		return { valid: false, message: `Performance L2 cannot dispatch ${request.childRole}.` };
	}
	if (request.parentRole === "implementer") {
		return L4_ROLES.has(request.childRole)
			? { valid: true }
			: { valid: false, message: "Only an L3 implementer may fan out, and only to an L4 terminal leaf." };
	}
	return { valid: false, message: `Performance ${request.parentRole} is a terminal worker and may not spawn subagents.` };
}

export class PerformanceRuntime {
	private readonly agentDir: string;
	private stateValue: PerformanceRunState | undefined;

	constructor(agentDir: string, environment: NodeJS.ProcessEnv = process.env) {
		this.agentDir = agentDir;
		const governanceRoot = environment.METIS_PERFORMANCE_GOVERNANCE_ROOT;
		if (governanceRoot) this.stateValue = this.readFromDirectory(governanceRoot);
		const runId = environment.METIS_PERFORMANCE_RUN_ID;
		if (!this.stateValue && runId) this.stateValue = this.read(runId);
		if (this.stateValue && !this.matchesWorkerBinding(environment)) this.stateValue = undefined;
	}

	get state(): Readonly<PerformanceRunState> | undefined {
		return this.stateValue;
	}

	start(invocation: PerformanceStartInvocation): PerformanceRunState {
		const runId = `perf-${randomUUID()}`;
		let governanceRoot = getPerformanceRunDirectory(this.agentDir, runId);
		try {
			mkdirSync(governanceRoot, { recursive: true });
			mkdirSync(join(governanceRoot, "artifacts"), { recursive: true });
		} catch (error: any) {
			if (error?.code === "EPERM" || error?.code === "EACCES") {
				const fallbackDir = join(tmpdir(), "metis-agent", "performance-runs", runId);
				mkdirSync(fallbackDir, { recursive: true });
				mkdirSync(join(fallbackDir, "artifacts"), { recursive: true });
				governanceRoot = fallbackDir;
			} else {
				throw error;
			}
		}
		const capabilityProbe = this.probeCapabilities(governanceRoot, invocation.capabilities);
		const state: PerformanceRunState = {
			schemaVersion: 1,
			runId,
			nonce: randomBytes(16).toString("hex"),
			mission: invocation.mission,
			missionSha256: hash(`MISSION\n${invocation.mission}\n`),
			missionBytes: Buffer.byteLength(`MISSION\n${invocation.mission}\n`, "utf8"),
			status: "active",
			frontier: "G2",
			concurrency: invocation.concurrency ?? "tokensaver",
			maxConcurrent: invocation.maxConcurrent ?? (invocation.concurrency === "wide" ? 200 : 6),
			agentSelection: invocation.agentSelection ?? "off",
			agentModels: invocation.agentModels ?? [],
			attendance: invocation.attendance ?? "unattended",
			effortCapability: invocation.effortCapability ?? "unknown",
			maxReasoningEffort: invocation.maxReasoningEffort,
			capabilityProbe,
			roadmapItems: [],
			completedItemIds: [],
			governanceRoot,
			createdAt: now(),
			updatedAt: now(),
			reports: [],
			leases: [],
		};
		writeFileSync(join(governanceRoot, "PROMPTS.txt"), `MISSION\n${state.mission}\n`, "utf8");
		const pointer = missionPointer(state);
		writeFileSync(join(governanceRoot, "ROADMAP.md"), roadmapTemplate(state, pointer), "utf8");
		writeFileSync(join(governanceRoot, "GATELOG.md"), `${line(state, `RUN mission=${pointer.path} sha256=${pointer.sha256} bytes=${pointer.bytes}`)}
${line(state, `OPERATOR attendance=${state.attendance} concurrency=${state.concurrency} maxConcurrent=${state.maxConcurrent} agentSelection=${state.agentSelection} effortCapability=${state.effortCapability}${state.maxReasoningEffort ? ` maxReasoningEffort=${state.maxReasoningEffort}` : ""}`)}
${line(state, `CAPABILITY read=${capabilityProbe.read} write=${capabilityProbe.write} run=${capabilityProbe.run} evidence=${capabilityProbe.evidence}`)}
${line(state, "FRONTIER G2")}
`, "utf8");
		this.stateValue = state;
		this.persist();
		return state;
	}

	/**
	 * Incorporate an in-run user steering block without silently opening a second
	 * governance lane. Scope is deliberately reopened against the new exact
	 * prompt ledger; prior substantive receipts remain append-only in GATELOG.
	 */
	steer(instruction: string): PerformanceRunState {
		const state = this.stateValue;
		if (!state || state.status !== "active") throw new Error("Performance steering requires an active run.");
		if (state.leases.length > 0) throw new Error("Performance steering requires collected subagents; resolve live leases before changing scope.");
		const text = instruction.trim();
		if (!text) throw new Error("Performance steering instruction cannot be empty.");
		const promptPath = join(state.governanceRoot, "PROMPTS.txt");
		appendFileSync(promptPath, `\n## Prompt block ${state.reports.length + 2}\n${text}\n`, "utf8");
		const prompt = readFileSync(promptPath, "utf8");
		this.stateValue = {
			...state,
			missionSha256: hash(prompt),
			missionBytes: Buffer.byteLength(prompt, "utf8"),
			frontier: "G2",
			roadmapItems: [],
			completedItemIds: [],
			activeItemId: undefined,
			reports: [],
			updatedAt: now(),
		};
		const pointer = missionPointer(this.stateValue);
		writeFileSync(join(state.governanceRoot, "ROADMAP.md"), roadmapTemplate(this.stateValue, pointer), "utf8");
		this.persist();
		this.log(`STEERING mission=${pointer.path} sha256=${pointer.sha256} bytes=${pointer.bytes}`);
		this.log("FRONTIER G2");
		return this.stateValue;
	}

	read(runId: string): PerformanceRunState | undefined {
		return this.readFromDirectory(getPerformanceRunDirectory(this.agentDir, runId));
	}

	private readFromDirectory(directory: string): PerformanceRunState | undefined {
		const file = join(directory, "run.json");
		if (!existsSync(file)) return undefined;
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PerformanceRunState>;
			if (parsed.schemaVersion !== 1 || typeof parsed.runId !== "string" || typeof parsed.nonce !== "string" || typeof parsed.mission !== "string" || typeof parsed.missionSha256 !== "string" || typeof parsed.missionBytes !== "number") return undefined;
			const state = parsed as PerformanceRunState;
			if (state.governanceRoot !== resolve(directory)) return undefined;
			const promptPath = join(directory, "PROMPTS.txt");
			if (!existsSync(promptPath)) return undefined;
			const prompt = readFileSync(promptPath, "utf8");
			if (hash(prompt) !== state.missionSha256 || Buffer.byteLength(prompt, "utf8") !== state.missionBytes) return undefined;
			return {
				...state,
				attendance: state.attendance === "attended" ? "attended" : "unattended",
				agentModels: Array.isArray(state.agentModels) ? state.agentModels.filter((model): model is PerformanceModelSelection => typeof model?.provider === "string" && typeof model?.model === "string") : [],
				effortCapability: state.effortCapability ?? "unknown",
				roadmapItems: Array.isArray(state.roadmapItems) ? state.roadmapItems : [],
				completedItemIds: Array.isArray(state.completedItemIds) ? state.completedItemIds : [],
				capabilityProbe: state.capabilityProbe ?? { read: false, write: false, run: false, evidence: "missing", at: state.createdAt },
				reports: Array.isArray(state.reports) ? state.reports : [],
				leases: Array.isArray(state.leases) ? state.leases : [],
			};
		} catch {
			return undefined;
		}
	}

	resume(runId: string): PerformanceRunState | undefined {
		const state = this.read(runId);
		if (!state || state.status !== "active") return undefined;
		this.stateValue = state;
		try {
			this.assertResumeIntegrity();
			this.log("RESUME integrity=verified");
			return state;
		} catch (error) {
			this.stateValue = undefined;
			throw error;
		}
	}

	private transition(frontier: PerformanceGate, status: PerformanceRunStatus = frontier === "complete" ? "completed" : frontier === "blocked" ? "blocked" : "active"): void {
		if (!this.stateValue) throw new Error("No active Performance run.");
		const allowed: Record<PerformanceGate, readonly PerformanceGate[]> = {
			G0: ["G1", "G4", "blocked"],
			G2: ["G2-assurance", "blocked"],
			"G2-assurance": ["G0", "G2", "G1", "G3.5", "G4", "blocked"],
			"G2-review": [],
			"G2-verify": [],
			G1: ["G1-assurance", "blocked"],
			"G1-assurance": ["G1", "G3.5", "G4", "blocked"],
			"G1-review": [],
			"G1-verify": [],
			"G3.5": ["G1", "G4", "blocked"],
			G4: ["G0", "G1", "G4-assurance", "blocked"],
			"G4-assurance": ["G1", "G3.5", "G4", "G7", "sweep", "goal-check", "blocked"],
			G5: [],
			G6: [],
			G7: ["G7-assurance", "sweep", "goal-check", "G1", "G3.5", "G4", "blocked"],
			"G7-assurance": ["G7-assurance", "sweep", "goal-check", "G1", "G3.5", "G4", "blocked"],
			sweep: ["G2", "goal-check", "blocked"],
			"goal-check": ["complete", "G1", "G4", "blocked"],
			complete: [],
			blocked: [],
		};
		if (frontier !== this.stateValue.frontier && !allowed[this.stateValue.frontier].includes(frontier)) {
			throw new Error(`Illegal Performance gate transition ${this.stateValue.frontier} -> ${frontier}.`);
		}
		this.stateValue = { ...this.stateValue, frontier, status, updatedAt: now() };
		this.persist();
		this.log(`FRONTIER ${frontier}`);
	}

	private activeItem(): PerformanceRoadmapItem {
		const state = this.stateValue!;
		const item = state.roadmapItems.find((candidate) => candidate.id === state.activeItemId);
		if (!item) throw new Error("Performance has no active ROADMAP.md item for this gate.");
		return item;
	}

	private beginNextRoadmapItem(): void {
		const state = this.stateValue!;
		const completed = new Set(state.completedItemIds);
		const next = state.roadmapItems.find((item) => !completed.has(item.id) && item.dependencies.every((dependency) => completed.has(dependency)));
		if (!next) {
			if (completed.size === state.roadmapItems.length) {
				this.stateValue = { ...state, activeItemId: undefined, updatedAt: now() };
				return this.transition(this.requiresConvergenceSweep() ? "sweep" : "goal-check");
			}
			return this.transition("blocked", "blocked");
		}
		this.stateValue = { ...state, activeItemId: next.id, updatedAt: now() };
		this.persist();
		this.log(`ITEM ACTIVE id=${next.id} tier=${next.tier} category=${next.category} tag=${next.tag} framework=${next.framework} launchGroup=${next.launchGroup}`);
		const policy = performanceItemGatePolicy(next);
		this.transition(policy.requiresCharacterization ? "G0" : policy.requiresPlan ? "G1" : "G4");
	}

	private completeActiveItem(): void {
		const state = this.stateValue!;
		const item = this.activeItem();
		if (state.completedItemIds.includes(item.id)) throw new Error(`ROADMAP.md item ${item.id} is already complete.`);
		this.stateValue = { ...state, activeItemId: undefined, completedItemIds: [...state.completedItemIds, item.id], updatedAt: now() };
		this.persist();
		this.log(`ITEM COMPLETE id=${item.id}`);
		this.beginNextRoadmapItem();
	}

	private requiresConvergenceSweep(): boolean {
		return this.stateValue!.roadmapItems.some((item) => item.tier === "T3");
	}

	/** Record a role-bound evidence verdict and move to its deterministic next gate. */
	recordGateReport(input: Omit<PerformanceGateReport, "at">): void {
		let state = this.stateValue;
		if (!state) throw new Error("No active Performance run.");
		if (state.status !== "active") throw new Error(`Performance run is ${state.status}.`);
		const assuranceParent = input.gate.startsWith("G2-") ? "G2" : input.gate.startsWith("G1-") ? "G1" : input.gate === "G5" || input.gate === "G6" ? "G4" : undefined;
		const isAssurance = input.gate === "G2-review" || input.gate === "G2-verify" || input.gate === "G1-review" || input.gate === "G1-verify" || input.gate === "G5" || input.gate === "G6";
		const isG7Assurance = input.gate === "G7" && (state.frontier === "G7" || state.frontier === "G7-assurance");
		if (isAssurance ? state.frontier !== `${assuranceParent}-assurance` : !isG7Assurance && input.gate !== state.frontier) {
			throw new Error(`Evidence is for ${input.gate}, but current Performance frontier is ${state.frontier}.`);
		}
		const activeItem = input.gate === "G2" || input.gate === "G2-review" || input.gate === "G2-verify" || input.gate === "sweep" || input.gate === "goal-check" ? undefined : this.activeItem();
		if (activeItem && input.itemId && input.itemId !== activeItem.id) {
			throw new Error(`Evidence is for ROADMAP.md item ${input.itemId}, but active item is ${activeItem.id}.`);
		}
		if (!activeItem && input.itemId) throw new Error(`${input.gate} is run-wide and cannot bind an itemId.`);
		const evidence = this.resolveEvidence(input.evidence);
		if (input.verdict === "blocked" && state.repairRequired?.gate === input.gate) {
			throw new Error(`REPAIR_REQUIRED: ${input.actor} must repair ROADMAP.md and retry ${input.gate}; a native validation error is not a runtime blocker. Original error: ${state.repairRequired.message}`);
		}
		const expectedRoles: Record<Exclude<PerformanceGate, "complete" | "blocked">, readonly string[]> = {
			G0: ["implementer"],
			G2: ["scope-coordinator", "scoper"],
			"G2-assurance": [],
			"G2-review": ["reviewer"],
			"G2-verify": ["fresh-verifier"],
			G1: ["planner"],
			"G1-assurance": [],
			"G1-review": ["reviewer"],
			"G1-verify": ["fresh-verifier"],
			"G3.5": ["depth-prober"],
			G4: ["implementer"],
			"G4-assurance": [],
			G5: ["reviewer"],
			G6: ["verifier", "fresh-verifier"],
			G7: ["juror", "arbiter"],
			"G7-assurance": [],
			sweep: ["sweeper"],
			"goal-check": ["goal-checker"],
		};
		if (!expectedRoles[input.gate].includes(input.role)) throw new Error(`${input.role} cannot close Performance ${input.gate}.`);
		if (input.gate === "G2" && input.verdict === "pass") {
			let roadmapItems: PerformanceRoadmapItem[];
			try {
				roadmapItems = this.assertExecutableRoadmap();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.stateValue = {
					...state,
					repairRequired: { gate: "G2", actor: input.actor, message, at: now() },
					updatedAt: now(),
				};
				this.persist();
				this.log(`REPAIR REQUIRED gate=G2 actor=${input.actor} error=${JSON.stringify(message)}`);
				throw new Error(`REPAIR_REQUIRED: ${message} Repair the canonical ROADMAP.md and retry G2; do not report blocked or runtime unavailable.`);
			}
			this.stateValue = { ...state, roadmapItems, completedItemIds: [], activeItemId: undefined, repairRequired: undefined, updatedAt: now() };
			state = this.stateValue;
		}
		const itemReports = activeItem ? state.reports.filter((report) => report.itemId === activeItem.id) : state.reports;
		const assuranceAuthor = assuranceParent ? itemReports.find((report) => report.gate === assuranceParent && report.verdict === "pass") : undefined;
		const isReview = input.gate.endsWith("-review") || input.gate === "G5";
		const isVerify = input.gate.endsWith("-verify") || input.gate === "G6";
		if (isReview && assuranceAuthor?.actor === input.actor) {
			throw new Error(`${assuranceParent} review must be independent of its author.`);
		}
		const reviewGate = assuranceParent === "G4" ? "G5" : `${assuranceParent}-review`;
		const verifyGate = assuranceParent === "G4" ? "G6" : `${assuranceParent}-verify`;
		const assuranceReview = assuranceParent ? itemReports.find((report) => report.gate === reviewGate && report.verdict === "pass") : undefined;
		if (isVerify && (assuranceAuthor?.actor === input.actor || assuranceReview?.actor === input.actor)) {
			throw new Error(`${assuranceParent} fresh verification must be independent of author and reviewer.`);
		}
		const implementers = new Set(itemReports.filter((report) => report.gate === "G4").map((report) => report.actor));
		if ((input.gate === "G5" || input.gate === "G6") && implementers.has(input.actor)) {
			throw new Error(`${input.gate} must be independent of the implementation author.`);
		}
		if (input.gate === "G6" && itemReports.some((report) => report.gate === "G5" && report.verdict === "pass" && report.actor === input.actor)) {
			throw new Error("G6 verification must be independent of the G5 reviewer.");
		}
		if (input.gate === "G3.5" && input.verdict === "pass" && !performanceItemGatePolicy(activeItem!).requiresDepthLock) {
			throw new Error(`ROADMAP.md item ${activeItem!.id} does not require G3.5 depth-lock.`);
		}
		if (input.gate === "G0" && input.verdict === "pass") this.assertCharacterizationEvidence(activeItem!, evidence);
		if (input.gate === "G4" && input.verdict === "pass") this.assertImplementationEvidence(activeItem!, evidence);
		if (input.gate === "G6" && input.verdict === "pass") this.assertVerificationEvidence(activeItem!, evidence);
		if (input.gate === "G7" && input.verdict === "pass") {
			const review = [...itemReports].reverse().find((report) => report.gate === "G5" && report.verdict === "pass");
			const verification = [...itemReports].reverse().find((report) => report.gate === "G6" && report.verdict === "pass");
			if (!review || !verification) throw new Error("G7 requires prior passing G5 review and G6 verification evidence.");
			if (review.actor === verification.actor || implementers.has(input.actor) || review.actor === input.actor || verification.actor === input.actor) throw new Error("G7 sign-off must be independent of implementation, review, and verification.");
			if (itemReports.some((report) => report.gate === "G7" && report.verdict === "pass" && report.actor === input.actor)) throw new Error("G7 jurors must be distinct agent instances.");
		}
		if (input.gate === "goal-check" && input.verdict === "pass") {
			if (state.completedItemIds.length !== state.roadmapItems.length) throw new Error("Goal check requires every ROADMAP.md item to be complete.");
			if (JSON.stringify(this.assertExecutableRoadmap()) !== JSON.stringify(state.roadmapItems)) {
				throw new Error("Goal check requires ROADMAP.md to match the approved item state.");
			}
			for (const priorReport of state.reports) this.assertReceiptIntegrity(priorReport.evidence);
			if (this.requiresConvergenceSweep() && !state.reports.some((report) => report.gate === "sweep" && report.verdict === "pass")) {
				throw new Error("Goal check requires a passing independent T3 convergence sweep.");
			}
			const deliveryActors = new Set(state.reports.filter((report) => ["G4", "G5", "G6", "G7"].includes(report.gate)).map((report) => report.actor));
			if (deliveryActors.has(input.actor) || state.leases.length > 0) throw new Error("Goal check must be independent of delivery gates and requires zero live subagents.");
			this.assertGoalEvidence(evidence);
		}
		const report: PerformanceGateReport = { ...input, itemId: activeItem?.id, evidence, at: now() };
		this.stateValue = { ...state, reports: [...state.reports, report], updatedAt: now() };
		this.persist();
		this.log(`VERDICT ${report.gate} ${report.verdict} actor=${report.actor} role=${report.role} evidence=${JSON.stringify(report.evidence)}`);
		if (isAssurance) {
			if (report.verdict === "blocked") return this.transition("blocked", "blocked");
			if (report.verdict === "fail") return this.transition(assuranceParent!);
			const assuranceReports = activeItem
				? this.stateValue.reports.filter((entry) => entry.itemId === activeItem.id)
				: this.stateValue.reports;
			const passedReview = assuranceReports.some((entry) => entry.gate === reviewGate && entry.verdict === "pass");
			const passedVerify = assuranceReports.some((entry) => entry.gate === verifyGate && entry.verdict === "pass");
			if (passedReview && passedVerify) {
				if (assuranceParent === "G2") return this.beginNextRoadmapItem();
				if (assuranceParent === "G1") return this.transition(performanceItemGatePolicy(this.activeItem()).requiresDepthLock ? "G3.5" : "G4");
				return performanceItemGatePolicy(this.activeItem()).requiredJurors > 0 ? this.transition("G7") : this.completeActiveItem();
			}
			this.log(`ASSURANCE WAITING_FOR=${passedReview ? verifyGate : reviewGate}`);
			return;
		}
		if (report.verdict === "blocked") return this.transition("blocked", "blocked");
		if (report.verdict === "fail") return this.transition(report.gate === "sweep" ? "G2" : report.gate === "G0" || report.gate === "G1" || report.gate === "G2" ? "blocked" : report.gate === "G3.5" ? "G1" : "G4");
		if (report.gate === "sweep") return this.transition("goal-check");
		if (report.gate === "G7") {
			const requiredJurors = performanceItemGatePolicy(this.activeItem()).requiredJurors;
			const jurors = this.stateValue.reports.filter((entry) => entry.gate === "G7" && entry.itemId === this.activeItem().id && entry.verdict === "pass");
			if (jurors.length < requiredJurors) return this.transition("G7-assurance");
			return this.completeActiveItem();
		}
		if (report.gate === "G0") return this.transition(performanceItemGatePolicy(this.activeItem()).requiresPlan ? "G1" : "G4");
		const next: Record<Exclude<PerformanceGate, "complete" | "blocked">, PerformanceGate> = {
			G0: "G4",
			G2: "G2-assurance", "G2-assurance": "G2", "G2-review": "G2", "G2-verify": "G2",
			G1: "G1-assurance", "G1-assurance": "G1", "G1-review": "G1", "G1-verify": "G1",
			"G3.5": "G4",
			G4: "G4-assurance", "G4-assurance": "G4", G5: "G4", G6: "G4", G7: "G7-assurance", "G7-assurance": "G7", sweep: "goal-check", "goal-check": "complete",
		};
		this.transition(next[report.gate]);
	}

	validateSpawn(parentRole: string, childRole: string, liveAgents: number): PerformanceSpawnDecision {
		if (!this.stateValue) return { valid: true };
		return validatePerformanceSpawn({ parentRole, childRole, liveAgents }, this.stateValue);
	}

	/** Atomically reserve a process slot shared by every child in this run. */
	reserveSpawn(parentRole: string, childRole: string, childAgentId: string): PerformanceSpawnDecision {
		if (!this.stateValue) return { valid: true };
		return this.withStateLock(() => {
			const latest = this.readFromDirectory(this.stateValue!.governanceRoot);
			if (!latest || latest.status !== "active") return { valid: false, message: "Performance run is unavailable or no longer active." };
			const decision = validatePerformanceSpawn({ parentRole, childRole, liveAgents: latest.leases.length }, latest);
			if (!decision.valid) return decision;
			this.stateValue = { ...latest, leases: [...latest.leases, { agentId: childAgentId, role: childRole, startedAt: now() }], updatedAt: now() };
			this.persist();
			this.log(`LEASE ACQUIRE agent=${childAgentId} role=${childRole}`);
			return { valid: true };
		});
	}

	/** Idempotently release a process slot when a child exits or launch fails. */
	releaseSpawn(childAgentId: string): void {
		if (!this.stateValue) return;
		this.withStateLock(() => {
			const latest = this.readFromDirectory(this.stateValue!.governanceRoot);
			if (!latest) return;
			const leases = latest.leases.filter((lease) => lease.agentId !== childAgentId);
			if (leases.length === latest.leases.length) return;
			this.stateValue = { ...latest, leases, updatedAt: now() };
			this.persist();
			this.log(`LEASE RELEASE agent=${childAgentId}`);
		});
	}

	/**
	 * Model-visible run context, split so that neither block changes between turns.
	 *
	 * `performance-protocol` holds the static role contract plus the full native
	 * framework text (several KB) and only changes when the active framework
	 * changes. `performance-state` holds run identity and operator settings, which
	 * are fixed for the life of the run. Both are injected once and then served
	 * from the provider's cached prefix.
	 *
	 * Everything that moves per turn (frontier, active item, leases, mission
	 * pointer, repair requests) lives in `liveStateSummary()` and rides the
	 * `performance_gate` / `read_plan` tool results instead — those are the calls
	 * through which the model advances and inspects that state, so it always sees
	 * fresh values without appending a contradicting state block every turn.
	 */
	contextBlocks(): Array<{ id: string; content: string }> {
		const state = this.stateValue;
		if (!state) return [];
		const activeItem = state.roadmapItems.find((item) => item.id === state.activeItemId);
		// Scope starts under plan-scope; each accepted roadmap item then carries its
		// own full native protocol instead of relying on a lossy gate summary.
		const framework = getPerformanceFramework(activeItem?.framework ?? "plan-scope");
		const role = process.env.METIS_AGENT_NAME ?? "root";
		const roleInstruction = role === "root"
			? "Act as L0 Primary Coordinator. In Wave 1, dispatch scope-coordinator to generate and freeze ROADMAP.md. In Wave 2, dispatch feature-coordinator to execute feature waves (or dispatch implementer/planner directly for focused tasks). In Wave 3, dispatch sweep-coordinator or goal-checker for final convergence and verification. If subagent dispatch is unavailable or encounters an unrecoverable error, execute tools directly to accomplish the user's intent."
			: `You are the ${role} worker. Stay inside this role's legal hierarchy and task boundary.`;
		const protocol = [
			"Performance run is active for the current user task.",
			roleInstruction,
			"G2 closing order is mandatory: (1) scoper or scope-coordinator calls performance_gate with gate=G2 after ROADMAP.md is executable, (2) only then reviewer calls gate=G2-review, (3) fresh-verifier calls gate=G2-verify. Writing a JSON receipt alone does not advance the frontier. Every Item must have stable id, category, tag, tier, framework, owned boundary, dependency IDs, launch group, integration lane, implementation, acceptance, unhappy paths, tests-first, verification, and requiresDetailedPlan.",
			framework ? `\n# Native execution protocol: ${framework.id}\n${framework.content.trim()}` : "",
			"Before finishing any gate role, write a non-empty receipt under <governance root>/artifacts/ then call performance_gate with verdict pass|fail|blocked and evidence set to that relative path (for example artifacts/g2-receipt.md). Do not exit after only writing the receipt. Goal-check is independent and runs only after every roadmap item is complete. Governance artifacts are outside the target workspace and must not be added to its diff.",
			"A REPAIR_REQUIRED response from performance_gate is a schema/content repair request, never a runtime outage or blocker: repair the canonical governance artifact and retry the same gate. Claim that subagent dispatch is unavailable only after a structured spawn_agent error or timed_out payload, and quote its errorCode/error; never infer runtime availability from a rejected gate or worker report.",
		].join("\n");
		const runIdentity = [
			`RUN-ID: ${state.runId}; RUN-NONCE: ${state.nonce}; budget: ${state.maxConcurrent}; governance root: ${state.governanceRoot}.`,
			`Operator mode: ${state.attendance}; concurrency: ${state.concurrency}; agent selection: ${state.agentSelection}; effort capability: ${state.effortCapability}${state.maxReasoningEffort ? ` (max ${state.maxReasoningEffort})` : ""}.`,
			"Live run state (frontier, active item, mission pointer, repair requests) is reported by every performance_gate and read_plan result. Trust the most recent one; call read_plan when you need it again.",
		].join("\n");
		return [
			{ id: "performance-protocol", content: protocol },
			{ id: "performance-state", content: runIdentity },
		];
	}

	/**
	 * Per-turn run state, delivered through tool results rather than the context
	 * blocks so that advancing a gate appends only the tool result instead of a new
	 * state block that contradicts the previous turn's.
	 */
	liveStateSummary(): string | undefined {
		const state = this.stateValue;
		if (!state) return undefined;
		const pointer = missionPointer(state);
		const activeItem = state.roadmapItems.find((item) => item.id === state.activeItemId);
		const itemPolicy = activeItem ? performanceItemGatePolicy(activeItem) : undefined;
		return [
			`frontier: ${state.frontier}; active item: ${state.activeItemId ?? "scope"}; live agents: ${state.leases.length}.`,
			`MISSION POINTER: ${pointer.path}; SHA-256: ${pointer.sha256}; bytes: ${pointer.bytes}.`,
			state.repairRequired ? `REPAIR REQUIRED at ${state.repairRequired.gate}: ${state.repairRequired.message}` : "",
			activeItem
				? `Active item ${activeItem.id}: ${activeItem.category}/${activeItem.tag}/${activeItem.tier}/${activeItem.framework}. ${itemPolicy!.requiresCharacterization ? "G0 characterization is required before planning or implementation." : "No G0 characterization."} ${itemPolicy!.requiresPlan ? "G1 is required." : "G1 is skipped."} ${itemPolicy!.requiresDepthLock ? "G3.5 depth-lock follows G1." : "No G3.5 depth-lock."} ${activeItem.framework === "apply" ? "Apply admission requires an exact change specification and uses G4/G5/G6 only." : ""} ${itemPolicy!.requiredJurors ? `G7 requires ${itemPolicy!.requiredJurors} independent juror(s).` : "G7 is skipped for this framework/tier."}`
				: "No item is active until G2 assurance accepts the structured roadmap.",
			this.requiresConvergenceSweep() ? "After the final T3 item, dispatch one fresh sweeper. A passing sweep is required before goal-check; named findings reopen scope rather than being silently downgraded." : "",
		]
			.filter(Boolean)
			.join("\n");
	}

	context(): string | undefined {
		const blocks = this.contextBlocks();
		if (!blocks.length) return undefined;
		return [...blocks.map((block) => block.content), this.liveStateSummary() ?? ""].filter(Boolean).join("\n");
	}

	private resolveEvidence(value: string): string {
		const state = this.stateValue!;
		const artifactRoot = resolve(state.governanceRoot, "artifacts");
		const file = resolve(state.governanceRoot, value.trim());
		if (!value.trim() || !file.startsWith(`${artifactRoot}${sep}`)) {
			throw new Error("Performance evidence must be a non-empty relative path under the governance artifacts directory.");
		}
		try {
			const content = readFileSync(file, "utf8");
			if (!content.trim()) throw new Error("empty");
			return `${relative(state.governanceRoot, file)} sha256=${hash(content)} bytes=${Buffer.byteLength(content, "utf8")}`;
		} catch {
			throw new Error(`Performance evidence artifact is unreadable or empty: ${relative(state.governanceRoot, file)}`);
		}
	}

	private evidenceContent(receipt: string): string {
		const state = this.stateValue!;
		const path = receipt.replace(/ sha256=[a-f0-9]{64} bytes=\d+$/, "");
		return readFileSync(resolve(state.governanceRoot, path), "utf8");
	}

	private assertVerificationEvidence(item: PerformanceRoadmapItem, receipt: string): void {
		const content = this.evidenceContent(receipt);
		if (!/\b(?:testCommand|verificationCommand)\b\s*:\s*\S+/i.test(content)) {
			throw new Error(`G6 verification for ROADMAP.md item ${item.id} requires the real testCommand it ran.`);
		}
		if (!/\b(?:exitCode|testStatus)\b\s*:\s*(?:0|pass|green)/i.test(content)) {
			throw new Error(`G6 verification for ROADMAP.md item ${item.id} requires a passing test exitCode.`);
		}
		if (!/\btestOutput\b\s*:\s*\S+/i.test(content)) {
			throw new Error(`G6 verification for ROADMAP.md item ${item.id} requires captured real testOutput.`);
		}
		const coverage = content.match(/\bcoverage\b[^\d]*(\d+(?:\.\d+)?)\s*%/i);
		if (!coverage || Number(coverage[1]) < 95) {
			throw new Error(`G6 verification for ROADMAP.md item ${item.id} requires measured coverage >=95%.`);
		}
		if (!/\bpreExistingRegressions\b\s*:\s*(?:0|none|\[\s*\])/i.test(content)) {
			throw new Error(`G6 verification for ROADMAP.md item ${item.id} must prove zero preExistingRegressions.`);
		}
		if (performanceItemGatePolicy(item).requiresDepthLock && (!/\breproWasRed\b\s*:\s*(?:true|pass|yes)/i.test(content) || !/\breproNowGreen\b\s*:\s*(?:true|pass|yes)/i.test(content))) {
			throw new Error(`Debug G6 verification for ROADMAP.md item ${item.id} requires reproWasRed and reproNowGreen proof.`);
		}
	}

	private assertImplementationEvidence(item: PerformanceRoadmapItem, receipt: string): void {
		const content = this.evidenceContent(receipt);
		if (!/\bchangedFiles\b\s*:\s*\S+/i.test(content)) {
			throw new Error(`G4 implementation for ROADMAP.md item ${item.id} requires changedFiles evidence.`);
		}
		if (!/\btestCommand\b\s*:\s*\S+/i.test(content) || !/\btestOutput\b\s*:\s*\S+/i.test(content)) {
			throw new Error(`G4 implementation for ROADMAP.md item ${item.id} requires a real testCommand and testOutput.`);
		}
		if (item.framework !== "apply" && item.framework !== "refactor") {
			if (!/\bredTestOutput\b\s*:\s*\S+/i.test(content) || !/\bgreenTestOutput\b\s*:\s*\S+/i.test(content)) {
				throw new Error(`G4 implementation for ROADMAP.md item ${item.id} requires real TDD redTestOutput and greenTestOutput.`);
			}
			if (!/\breproWasRed\b\s*:\s*(?:true|pass|yes)/i.test(content) || !/\breproNowGreen\b\s*:\s*(?:true|pass|yes)/i.test(content)) {
				throw new Error(`G4 implementation for ROADMAP.md item ${item.id} requires reproWasRed and reproNowGreen proof.`);
			}
		}
	}

	private assertCharacterizationEvidence(item: PerformanceRoadmapItem, receipt: string): void {
		const content = this.evidenceContent(receipt);
		if (!/\bcharacterizationTests\b\s*:\s*\S+/i.test(content) || !/\btestCommand\b\s*:\s*\S+/i.test(content) || !/\btestOutput\b\s*:\s*\S+/i.test(content)) {
			throw new Error(`G0 characterization for ROADMAP.md item ${item.id} requires characterizationTests, testCommand, and passing testOutput.`);
		}
	}

	private assertGoalEvidence(receipt: string): void {
		const content = this.evidenceContent(receipt);
		if (!/\bopenFindings\b\s*:\s*(?:0|none|\[\s*\])/i.test(content)) throw new Error("Goal check requires evidence of zero openFindings.");
		if (!/\bendToEnd\b\s*:\s*(?:pass|green|true)/i.test(content)) throw new Error("Goal check requires a passing real endToEnd exercise.");
	}

	private roadmapContent(): string {
		return readFileSync(join(this.stateValue!.governanceRoot, "ROADMAP.md"), "utf8");
	}

	/** Re-anchor a resumed run to its external governance receipts before it can continue. */
	private assertResumeIntegrity(): void {
		const state = this.stateValue!;
		missionPointer(state);
		const gateLog = join(state.governanceRoot, "GATELOG.md");
		if (!existsSync(gateLog) || !readFileSync(gateLog, "utf8").includes(`run=${state.runId} nonce=${state.nonce}`)) {
			throw new Error("Performance resume integrity check failed: GATELOG.md is missing its run binding.");
		}
		if (!state.capabilityProbe.read || !state.capabilityProbe.write || !state.capabilityProbe.run) {
			throw new Error("Performance resume integrity check failed: required capability probe did not pass.");
		}
		this.assertArtifactPresent(state.capabilityProbe.evidence);
		for (const report of state.reports) this.assertReceiptIntegrity(report.evidence);
		if (state.frontier !== "G2" || state.roadmapItems.length > 0) {
			const parsed = this.assertExecutableRoadmap();
			if (JSON.stringify(parsed) !== JSON.stringify(state.roadmapItems)) {
				throw new Error("Performance resume integrity check failed: ROADMAP.md diverged from persisted item state.");
			}
			const knownItems = new Set(state.roadmapItems.map((item) => item.id));
			if (state.completedItemIds.some((id) => !knownItems.has(id)) || (state.activeItemId && !knownItems.has(state.activeItemId))) {
				throw new Error("Performance resume integrity check failed: active or completed item is absent from ROADMAP.md.");
			}
		}
	}

	private assertReceiptIntegrity(receipt: string): void {
		const state = this.stateValue!;
		const match = receipt.match(/^(.+) sha256=([a-f0-9]{64}) bytes=(\d+)$/);
		if (!match) throw new Error("Performance resume integrity check failed: malformed evidence receipt.");
		const artifactRoot = resolve(state.governanceRoot, "artifacts");
		const file = resolve(state.governanceRoot, match[1]!);
		if (!file.startsWith(`${artifactRoot}${sep}`)) throw new Error("Performance resume integrity check failed: evidence escaped artifacts.");
		try {
			const content = readFileSync(file, "utf8");
			if (hash(content) !== match[2] || Buffer.byteLength(content, "utf8") !== Number(match[3])) {
				throw new Error("receipt hash mismatch");
			}
		} catch {
			throw new Error(`Performance resume integrity check failed: evidence receipt is unavailable or changed (${match[1]}).`);
		}
	}

	private assertArtifactPresent(value: string): void {
		const state = this.stateValue!;
		const artifactRoot = resolve(state.governanceRoot, "artifacts");
		const file = resolve(state.governanceRoot, value.trim());
		if (!value.trim() || !file.startsWith(`${artifactRoot}${sep}`)) {
			throw new Error("Performance resume integrity check failed: required artifact escaped artifacts.");
		}
		try {
			if (!readFileSync(file, "utf8").trim()) throw new Error("empty");
		} catch {
			throw new Error(`Performance resume integrity check failed: required artifact is unavailable (${value}).`);
		}
	}

	private probeCapabilities(governanceRoot: string, requested = { read: true, write: true, run: true }): PerformanceCapabilityProbe {
		const probePath = join(governanceRoot, "artifacts", "capability-probe.md");
		const scratchPath = join(governanceRoot, ".capability-probe.txt");
		let read = false;
		let write = false;
		let run = false;
		try {
			if (requested.write) {
				writeFileSync(scratchPath, "metis performance capability probe\n", "utf8");
				write = true;
			}
			if (requested.read && write) {
				read = readFileSync(scratchPath, "utf8") === "metis performance capability probe\n";
			}
			if (requested.run) {
				const isElectron = Boolean(process.versions.electron || process.env.ELECTRON_RUN_AS_NODE);
				const runEnv = isElectron ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env;
				const probeResult = spawnSync(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore", env: runEnv });
				if (probeResult.status === 0) {
					run = true;
				} else if (isElectron) {
					run = spawnSync("node", ["-e", "process.exit(0)"], { stdio: "ignore" }).status === 0;
				}
			}
		} catch {
			// Result is recorded below and hard-stops the run.
		}
		const evidence = "artifacts/capability-probe.md";
		writeFileSync(probePath, `# Capability probe\n\n- requested read: ${requested.read}\n- requested write: ${requested.write}\n- requested run: ${requested.run}\n- READ: ${read ? "PASS" : "FAIL"}\n- WRITE: ${write ? "PASS" : "FAIL"}\n- RUN: ${run ? "PASS" : "FAIL"}\n`, "utf8");
		if (!read || !write || !run) throw new Error(`Performance capability probe failed (READ=${read}, WRITE=${write}, RUN=${run}).`);
		return { read, write, run, evidence, at: now() };
	}

	private matchesWorkerBinding(environment: NodeJS.ProcessEnv): boolean {
		const state = this.stateValue!;
		const nonce = environment.METIS_PERFORMANCE_NONCE;
		const sha256 = environment.METIS_PERFORMANCE_MISSION_SHA256;
		const bytes = environment.METIS_PERFORMANCE_MISSION_BYTES;
		return (!nonce || nonce === state.nonce)
			&& (!sha256 || sha256 === state.missionSha256)
			&& (!bytes || Number(bytes) === state.missionBytes);
	}

	private assertExecutableRoadmap(): PerformanceRoadmapItem[] {
		const state = this.stateValue!;
		const content = this.roadmapContent();
		const pointer = missionPointer(state);
		const hasPointer =
			content.includes(`Mission pointer: ${pointer.path} (sha256=${pointer.sha256}; bytes=${pointer.bytes})`)
			|| (
				content.includes(pointer.path)
				&& content.includes(pointer.sha256)
				&& new RegExp(`bytes\\s*=\\s*${pointer.bytes}\\b`).test(content)
			);
		const hasNonce =
			content.includes(`Run nonce: ${state.nonce}`)
			|| new RegExp(`(?:run\\s*)?nonce\\s*[:=]\\s*\`?${state.nonce}\`?`, "i").test(content);
		if (!hasPointer || !hasNonce) {
			throw new Error(
				`ROADMAP.md mission pointer/hash or nonce does not match this run. Keep the seeded header lines: "Mission pointer: ${pointer.path} (sha256=${pointer.sha256}; bytes=${pointer.bytes})" and "Run nonce: ${state.nonce}".`,
			);
		}
		for (const field of ROADMAP_FIELDS) {
			const match = content.match(new RegExp(`-\\s*(?:\\*\\*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, "i"));
			if (!match || /^(?:TBD|N\/A|\[.*\])\s*$/i.test(match[1]!.trim().replace(/^[*_`]+|[*_`]+$/g, ""))) {
				throw new Error(`ROADMAP.md is incomplete: ${field} must be concrete before G2 passes.`);
			}
		}
		if (!/-\s*(?:\*\*)?requiresDetailedPlan(?:\*\*)?\s*:\s*(?:true|false)\b/i.test(content)) {
			throw new Error("ROADMAP.md must declare requiresDetailedPlan: true or false.");
		}
		return parsePerformanceRoadmapItems(content);
	}

	private persist(): void {
		if (!this.stateValue) return;
		writeFileSync(join(this.stateValue.governanceRoot, "run.json"), `${JSON.stringify(this.stateValue, null, 2)}\n`, "utf8");
	}

	private withStateLock<T>(operation: () => T): T {
		const state = this.stateValue;
		if (!state) return operation();
		const lockPath = join(state.governanceRoot, ".run.lock");
		let fd: number | undefined;
		try {
			fd = openSync(lockPath, "wx");
			return operation();
		} catch (error: any) {
			if (error?.code === "EEXIST") throw new Error("Performance governance is busy; retry the spawn operation.");
			throw error;
		} finally {
			if (fd !== undefined) closeSync(fd);
			if (fd !== undefined && existsSync(lockPath)) unlinkSync(lockPath);
		}
	}

	private log(event: string): void {
		if (!this.stateValue) return;
		const agent = process.env.METIS_AGENT_NAME ?? "root";
		const model = process.env.METIS_MODEL ?? "unknown";
		const effort = process.env.METIS_THINKING ?? "unknown";
		appendFileSync(join(this.stateValue.governanceRoot, "GATELOG.md"), `${line(this.stateValue, `${event} agent=${agent} model=${model} effort=${effort}`)}\n`, "utf8");
	}
}

