import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
export type PerformanceTier = "T0" | "T1" | "T2" | "T3";
export type PerformanceTaskShape = "bounded" | "sequential-complex" | "parallel";
export type ExistingFrameworkId = "apply" | "backend-build" | "backend-fix" | "backend-implement" | "composition" | "docs" | "frontend-build" | "frontend-fix" | "frontend-implement" | "frontend-review" | "generation" | "plan-design" | "plan-research" | "plan-scope" | "polish" | "refactor";
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
	laneId?: string;
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

export interface PerformanceAdmissionLane {
	id: string;
	objective: string;
	framework: ExistingFrameworkId;
	ownedPaths: string[];
	deliverables: string[];
	acceptanceCriteria: string[];
	verificationCommands: string[];
	dependsOn: string[];
}

export interface PerformanceAdmission {
	tier: PerformanceTier;
	taskShape: PerformanceTaskShape;
	deliverables: string[];
	acceptanceCriteria: string[];
	verificationCommands: string[];
	sharedMutableState: boolean;
	lanes: PerformanceAdmissionLane[];
}

export interface PerformanceRunState {
	schemaVersion: 1 | 2;
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
	/** v2 T3 lanes whose implementation gate passed; assurance waits for integration. */
	implementedItemIds?: string[];
	activeItemId?: string;
	governanceRoot: string;
	createdAt: string;
	updatedAt: string;
	reports: PerformanceGateReport[];
	leases: PerformanceAgentLease[];
	/** Present on v2 runs. This typed value, not free-form Markdown, is canonical. */
	admission?: PerformanceAdmission;
	admissionSha256?: string;
	workspaceRoot?: string;
	routePolicy?: {
		implementation: "root" | "serial-shared" | "parallel-isolated";
		assuranceWorkspace: "integrated-shared";
		allowedRoles: string[];
	};
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

export interface PerformanceAdmitInvocation extends Omit<PerformanceStartInvocation, "kind"> {
	kind: "admit";
	workspaceRoot: string;
	admission: PerformanceAdmission;
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

export type PerformanceDispatchGate = "G0" | "G1" | "G2" | "G3.5" | "G4" | "G5" | "G6" | "G7" | "sweep" | "goal-check";

export interface PerformancePreparedSpawn {
	task: string;
	context?: string;
	laneId?: string;
	gate?: PerformanceDispatchGate;
	worktree?: "auto";
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

const TIER_ROLES: Record<PerformanceTier, ReadonlySet<string>> = {
	T0: new Set(),
	T1: new Set(["reviewer", "verifier", "fresh-verifier"]),
	T2: new Set(["planner", "implementer", "reviewer", "verifier", "fresh-verifier", "juror", "goal-checker", "depth-prober"]),
	T3: KNOWN_ROLES,
};
const STRICT_TDD_FRAMEWORKS = new Set(["backend-build", "backend-fix", "backend-implement", "frontend-build", "frontend-fix", "frontend-implement"]);

function hash(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function now(): string {
	return new Date().toISOString();
}

function normalizedAdmission(admission: PerformanceAdmission): PerformanceAdmission {
	const cleanList = (values: string[], label: string): string[] => {
		const result = values.map((value) => value.trim()).filter(Boolean);
		if (!result.length) throw new Error(`REPAIR_REQUIRED: ${label} must contain at least one concrete value.`);
		return result;
	};
	const lanes = admission.lanes.map((lane) => ({
		...lane,
		id: lane.id.trim(),
		objective: lane.objective.trim(),
		framework: lane.framework.trim() as ExistingFrameworkId,
		ownedPaths: cleanList(lane.ownedPaths, `lane ${lane.id} ownedPaths`),
		deliverables: cleanList(lane.deliverables, `lane ${lane.id} deliverables`),
		acceptanceCriteria: cleanList(lane.acceptanceCriteria, `lane ${lane.id} acceptanceCriteria`),
		verificationCommands: cleanList(lane.verificationCommands, `lane ${lane.id} verificationCommands`),
		dependsOn: lane.dependsOn.map((value) => value.trim()).filter(Boolean),
	}));
	if (!lanes.length) throw new Error("REPAIR_REQUIRED: admission requires at least one lane.");
	if (lanes.some((lane) => !/^[A-Za-z][A-Za-z0-9._-]*$/.test(lane.id))) throw new Error("REPAIR_REQUIRED: every lane id must be a stable identifier.");
	if (new Set(lanes.map((lane) => lane.id)).size !== lanes.length) throw new Error("REPAIR_REQUIRED: lane ids must be unique.");
	for (const lane of lanes) {
		if (!lane.objective) throw new Error(`REPAIR_REQUIRED: lane ${lane.id} needs an objective.`);
		if (!getPerformanceFramework(lane.framework)) throw new Error(`REPAIR_REQUIRED: lane ${lane.id} references unknown framework ${JSON.stringify(lane.framework)}.`);
		if (lane.dependsOn.includes(lane.id) || lane.dependsOn.some((id) => !lanes.some((candidate) => candidate.id === id))) {
			throw new Error(`REPAIR_REQUIRED: lane ${lane.id} has an invalid dependency.`);
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const byId = new Map(lanes.map((lane) => [lane.id, lane]));
	const visit = (id: string): void => {
		if (visited.has(id)) return;
		if (visiting.has(id)) throw new Error("REPAIR_REQUIRED: admission lane dependencies contain a cycle.");
		visiting.add(id);
		for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const lane of lanes) visit(lane.id);

	if ((admission.tier === "T0" || admission.tier === "T1") && (admission.taskShape !== "bounded" || lanes.length !== 1)) {
		throw new Error(`REPAIR_REQUIRED: ${admission.tier} requires taskShape=bounded and exactly one lane.`);
	}
	if (admission.tier === "T2" && admission.taskShape !== "sequential-complex") {
		throw new Error("REPAIR_REQUIRED: T2 requires taskShape=sequential-complex; downgrade invalid parallel work instead of fan-out.");
	}
	if (admission.tier === "T3") {
		if (admission.taskShape !== "parallel" || admission.sharedMutableState || lanes.length < 2) {
			throw new Error("REPAIR_REQUIRED: T3 requires parallel shape, at least two lanes, and no shared mutable state; use T2.");
		}
		for (let i = 0; i < lanes.length; i++) {
			for (let j = i + 1; j < lanes.length; j++) {
				for (const left of lanes[i]!.ownedPaths) {
					for (const right of lanes[j]!.ownedPaths) {
						const a = resolve("/", left);
						const b = resolve("/", right);
						if (a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`)) {
							throw new Error(`REPAIR_REQUIRED: T3 lanes ${lanes[i]!.id} and ${lanes[j]!.id} overlap; use T2.`);
						}
					}
				}
			}
		}
	}
	return {
		...admission,
		deliverables: cleanList(admission.deliverables, "deliverables"),
		acceptanceCriteria: cleanList(admission.acceptanceCriteria, "acceptanceCriteria"),
		verificationCommands: cleanList(admission.verificationCommands, "verificationCommands"),
		lanes,
	};
}

function categoryForFramework(frameworkId: string): PerformanceRoadmapItem["category"] {
	const category = getPerformanceFramework(frameworkId)?.category;
	if (category === "frontend" || category === "backend" || category === "data" || category === "integration" || category === "infra" || category === "docs") return category;
	return category === "planning" ? "plan" : frameworkId === "docs" ? "docs" : "backend";
}

function roadmapItemsForAdmission(admission: PerformanceAdmission): PerformanceRoadmapItem[] {
	return admission.lanes.map((lane, index) => ({
		id: lane.id,
		category: categoryForFramework(lane.framework),
		tag: lane.framework.endsWith("-fix") ? "debug" : lane.framework === "polish" ? "polish" : "none",
		tier: admission.tier,
		framework: lane.framework,
		ownedBoundaries: lane.ownedPaths.join(", "),
		dependencies: lane.dependsOn,
		launchGroup: admission.taskShape === "parallel" && lane.dependsOn.length === 0 ? "parallel-1" : `sequential-${index + 1}`,
		integrationLane: "root integration workspace",
		implementationSteps: lane.objective,
		acceptanceCriteria: lane.acceptanceCriteria.join("; "),
		unhappyPaths: "Exercise failure modes implied by the acceptance criteria and selected framework.",
		testsFirstSteps: lane.framework.endsWith("-fix") ? "Write and capture the smallest issue-derived regression before repair." : "Use framework-appropriate checks before implementation where behavior changes.",
		verificationCommands: lane.verificationCommands.join(" && "),
		exactChangeSpecification: lane.framework === "apply" ? lane.objective : undefined,
		requiresDetailedPlan: lane.framework === "plan-design",
		detailedPlanReason: lane.framework === "plan-design" ? "Admission identified an explicit design lane." : undefined,
	}));
}

function routePolicyForAdmission(admission: PerformanceAdmission): NonNullable<PerformanceRunState["routePolicy"]> {
	return {
		implementation: admission.tier === "T0" || admission.tier === "T1" ? "root" : admission.tier === "T2" ? "serial-shared" : "parallel-isolated",
		assuranceWorkspace: "integrated-shared",
		allowedRoles: [...TIER_ROLES[admission.tier]],
	};
}

function blockedRecoveryFrontier(state: PerformanceRunState): PerformanceGate {
	const gate = [...state.reports].reverse().find((report) => report.verdict === "blocked")?.gate;
	if (gate === "G2-review" || gate === "G2-verify") return "G2-assurance";
	if (gate === "G1-review" || gate === "G1-verify") return "G1-assurance";
	if (gate === "G5" || gate === "G6") return "G4-assurance";
	return gate ?? "G2";
}

function typedRoadmap(state: PerformanceRunState): string {
	const admission = state.admission!;
	const header = [
		"# Performance roadmap",
		`Run: ${state.runId}`,
		`Mission pointer: ${join(state.governanceRoot, "PROMPTS.txt")} (sha256=${state.missionSha256}; bytes=${state.missionBytes})`,
		`Run nonce: ${state.nonce}`,
		`Route: ${admission.tier}/${admission.taskShape}`,
		`Workspace root: ${state.workspaceRoot}`,
		"",
	];
	const items = state.roadmapItems.map((item) => [
		`## Item: ${item.id}`,
		`- Category: ${item.category}`,
		`- Tag: ${item.tag}`,
		`- Tier: ${item.tier}`,
		`- Framework: ${item.framework}`,
		`- Owned boundaries: ${item.ownedBoundaries}`,
		`- Dependencies: ${item.dependencies.join(", ") || "none"}`,
		`- Launch group: ${item.launchGroup}`,
		`- Integration lane: ${item.integrationLane}`,
		`- Implementation steps: ${item.implementationSteps}`,
		`- Acceptance criteria: ${item.acceptanceCriteria}`,
		`- Unhappy paths: ${item.unhappyPaths}`,
		`- Tests-first steps: ${item.testsFirstSteps}`,
		`- Verification commands: ${item.verificationCommands}`,
		...(item.exactChangeSpecification ? [`- Exact change specification: ${item.exactChangeSpecification}`] : []),
		`- requiresDetailedPlan: ${item.requiresDetailedPlan}`,
		`- Detailed plan reason: ${item.detailedPlanReason ?? "not required"}`,
		"",
	].join("\n"));
	return [...header, ...items].join("\n");
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
	if (state.admission && !TIER_ROLES[state.admission.tier].has(request.childRole)) {
		return { valid: false, message: `Performance ${state.admission.tier} route does not permit ${request.childRole}.` };
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
	private readonly boundLaneId?: string;
	private readonly boundGate?: string;
	private stateValue: PerformanceRunState | undefined;

	constructor(agentDir: string, environment: NodeJS.ProcessEnv = process.env) {
		this.agentDir = agentDir;
		this.boundLaneId = environment.METIS_PERFORMANCE_LANE_ID;
		this.boundGate = environment.METIS_PERFORMANCE_GATE;
		const governanceRoot = environment.METIS_PERFORMANCE_GOVERNANCE_ROOT;
		if (governanceRoot) this.stateValue = this.readFromDirectory(governanceRoot);
		const runId = environment.METIS_PERFORMANCE_RUN_ID;
		if (!this.stateValue && runId) this.stateValue = this.read(runId);
		if (this.stateValue && !this.matchesWorkerBinding(environment)) this.stateValue = undefined;
	}

	get state(): Readonly<PerformanceRunState> | undefined {
		return this.stateValue;
	}

	/** Start or revise a v2 run from a validated, typed admission contract. */
	admit(invocation: PerformanceAdmitInvocation): PerformanceRunState {
		const admission = normalizedAdmission(invocation.admission);
		const admissionSha256 = hash(JSON.stringify(admission));
		if (this.stateValue && (this.stateValue.status === "completed" || this.stateValue.status === "aborted")) {
			this.stateValue = undefined;
		}
		if (this.stateValue) {
			if (this.stateValue.schemaVersion === 2
				&& this.stateValue.mission === invocation.mission
				&& this.stateValue.admissionSha256 === admissionSha256
				&& this.stateValue.roadmapItems.length > 0) return this.stateValue;
			if (this.stateValue.leases.length > 0) throw new Error("Performance admission revision requires zero live agents.");
			if (!["G2", "G1", "blocked"].includes(this.stateValue.frontier)) {
				throw new Error(`Performance admission cannot be revised from ${this.stateValue.frontier}; backtrack to G2 or G1 first.`);
			}
			const roadmapItems = roadmapItemsForAdmission(admission);
			const existingMissionContent = readFileSync(join(this.stateValue.governanceRoot, "PROMPTS.txt"), "utf8");
			const missionContent = this.stateValue.mission !== invocation.mission && existingMissionContent.includes(invocation.mission)
				? existingMissionContent
				: `MISSION\n${invocation.mission}\n`;
			this.stateValue = {
				...this.stateValue,
				schemaVersion: 2,
				mission: invocation.mission,
				missionSha256: hash(missionContent),
				missionBytes: Buffer.byteLength(missionContent, "utf8"),
				status: "active",
				admission,
				admissionSha256,
				workspaceRoot: resolve(invocation.workspaceRoot),
				routePolicy: routePolicyForAdmission(admission),
				roadmapItems,
				completedItemIds: [],
				implementedItemIds: [],
				activeItemId: roadmapItems[0]?.id,
				reports: [],
				repairRequired: undefined,
				frontier: roadmapItems[0] ? this.initialFrontier(roadmapItems[0]) : "G2",
				updatedAt: now(),
			};
			writeFileSync(join(this.stateValue.governanceRoot, "PROMPTS.txt"), missionContent, "utf8");
			writeFileSync(join(this.stateValue.governanceRoot, "ROADMAP.md"), typedRoadmap(this.stateValue), "utf8");
			this.persist();
			this.log(`ADMISSION tier=${admission.tier} shape=${admission.taskShape} lanes=${roadmapItems.length} revision=true`);
			return this.stateValue;
		}

		const runId = `perf-${randomUUID()}`;
		let governanceRoot = getPerformanceRunDirectory(this.agentDir, runId);
		try {
			mkdirSync(governanceRoot, { recursive: true });
			mkdirSync(join(governanceRoot, "artifacts"), { recursive: true });
		} catch (error: any) {
			if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
			governanceRoot = join(tmpdir(), "metis-agent", "performance-runs", runId);
			mkdirSync(join(governanceRoot, "artifacts"), { recursive: true });
		}
		const capabilityProbe = this.probeCapabilities(governanceRoot, invocation.capabilities);
		const roadmapItems = roadmapItemsForAdmission(admission);
		const state: PerformanceRunState = {
			schemaVersion: 2,
			runId,
			nonce: randomBytes(16).toString("hex"),
			mission: invocation.mission,
			missionSha256: hash(`MISSION\n${invocation.mission}\n`),
			missionBytes: Buffer.byteLength(`MISSION\n${invocation.mission}\n`, "utf8"),
			status: "active",
			frontier: this.initialFrontier(roadmapItems[0]!),
			concurrency: invocation.concurrency ?? "tokensaver",
			maxConcurrent: invocation.maxConcurrent ?? (invocation.concurrency === "wide" ? 200 : 6),
			agentSelection: invocation.agentSelection ?? "off",
			agentModels: invocation.agentModels ?? [],
			attendance: invocation.attendance ?? "unattended",
			effortCapability: invocation.effortCapability ?? "unknown",
			maxReasoningEffort: invocation.maxReasoningEffort,
			capabilityProbe,
			roadmapItems,
			completedItemIds: [],
			implementedItemIds: [],
			activeItemId: roadmapItems[0]!.id,
			governanceRoot,
			createdAt: now(),
			updatedAt: now(),
			reports: [],
			leases: [],
			admission,
			admissionSha256,
			workspaceRoot: resolve(invocation.workspaceRoot),
			routePolicy: routePolicyForAdmission(admission),
		};
		writeFileSync(join(governanceRoot, "PROMPTS.txt"), `MISSION\n${state.mission}\n`, "utf8");
		writeFileSync(join(governanceRoot, "ROADMAP.md"), typedRoadmap(state), "utf8");
		writeFileSync(join(governanceRoot, "GATELOG.md"), `${line(state, `RUN mission=${join(governanceRoot, "PROMPTS.txt")} sha256=${state.missionSha256} bytes=${state.missionBytes}`)}
${line(state, `ADMISSION tier=${admission.tier} shape=${admission.taskShape} lanes=${roadmapItems.length} sharedMutableState=${admission.sharedMutableState}`)}
${line(state, `OPERATOR attendance=${state.attendance} concurrency=${state.concurrency} maxConcurrent=${state.maxConcurrent} agentSelection=${state.agentSelection} effortCapability=${state.effortCapability}${state.maxReasoningEffort ? ` maxReasoningEffort=${state.maxReasoningEffort}` : ""}`)}
${line(state, `FRONTIER ${state.frontier}`)}
`, "utf8");
		this.stateValue = state;
		this.persist();
		return state;
	}

	private initialFrontier(item: PerformanceRoadmapItem): PerformanceGate {
		const policy = performanceItemGatePolicy(item);
		return policy.requiresCharacterization ? "G0" : policy.requiresPlan ? "G1" : "G4";
	}

	allowedSpawnRoles(): string[] {
		const tier = this.stateValue?.admission?.tier;
		return tier ? [...TIER_ROLES[tier]] : [...KNOWN_ROLES];
	}

	/** Build a complete, hash-bound child brief from canonical v2 admission state. */
	prepareSpawn(input: { agent: string; task: string; context?: string; laneId?: string; gate?: PerformancePreparedSpawn["gate"] }): PerformancePreparedSpawn {
		const state = this.stateValue;
		if (!state?.admission) return { task: input.task, context: input.context, laneId: input.laneId, gate: input.gate };
		if (!TIER_ROLES[state.admission.tier].has(input.agent)) throw new Error(`Performance ${state.admission.tier} route does not permit ${input.agent}.`);
		const laneId = input.laneId ?? state.activeItemId;
		const lane = laneId ? state.admission.lanes.find((candidate) => candidate.id === laneId) : undefined;
		if (!lane) throw new Error(`Governed spawn requires a valid admitted laneId; received ${JSON.stringify(laneId)}.`);
		const defaultGateByRole: Record<string, PerformancePreparedSpawn["gate"]> = {
			planner: "G1", implementer: "G4", reviewer: "G5", verifier: "G6", "fresh-verifier": "G6",
			"depth-prober": "G3.5", juror: "G7", sweeper: "sweep", "goal-checker": "goal-check",
		};
		const gate = input.gate ?? defaultGateByRole[input.agent];
		if (!gate) throw new Error(`Governed spawn for ${input.agent} requires an explicit gate.`);
		const pointer = missionPointer(state);
		const brief = [
			"# Governed Performance dispatch",
			`Mission pointer: ${pointer.path}`,
			`Mission SHA-256: ${pointer.sha256}; bytes: ${pointer.bytes}; nonce: ${pointer.nonce}`,
			`Workspace root/cwd: ${state.workspaceRoot}`,
			`Governance root: ${state.governanceRoot}`,
			`Route: ${state.admission.tier}/${state.admission.taskShape}; lane: ${lane.id}; gate: ${gate}`,
			`Objective: ${lane.objective}`,
			`Framework: ${lane.framework}`,
			`Owned paths: ${lane.ownedPaths.join(", ")}`,
			`Dependencies: ${lane.dependsOn.join(", ") || "none"}`,
			`Deliverables: ${lane.deliverables.join(" | ")}`,
			`Acceptance criteria: ${lane.acceptanceCriteria.join(" | ")}`,
			`Verification commands: ${lane.verificationCommands.join(" | ")}`,
			"Governance: stay within owned paths; write evidence under governance root/artifacts; submit the assigned performance_gate. Exit 0 without that gate is no_verdict.",
			`Assigned task: ${input.task}`,
		].join("\n");
		const context = [input.context, `Canonical mission is file-bound at ${pointer.path}; do not reinterpret or broaden admitted scope.`].filter(Boolean).join("\n");
		const isolate = state.admission.tier === "T3" && input.agent === "implementer";
		return { task: brief, context, laneId: lane.id, gate, worktree: isolate ? "auto" : undefined };
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
		return this.withFreshState(() => this.steerCurrent(instruction));
	}

	private steerCurrent(instruction: string): PerformanceRunState {
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
			if ((parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) || typeof parsed.runId !== "string" || typeof parsed.nonce !== "string" || typeof parsed.mission !== "string" || typeof parsed.missionSha256 !== "string" || typeof parsed.missionBytes !== "number") return undefined;
			const state = parsed as PerformanceRunState;
			if (state.schemaVersion === 2 && (!state.admission || typeof state.admissionSha256 !== "string" || hash(JSON.stringify(state.admission)) !== state.admissionSha256)) return undefined;
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
			G0: ["G1", "G3.5", "G4", "blocked"],
			G2: ["G2-assurance", "blocked"],
			"G2-assurance": ["G0", "G2", "G1", "G3.5", "G4", "blocked"],
			"G2-review": [],
			"G2-verify": [],
			G1: ["G1-assurance", "blocked"],
			"G1-assurance": ["G1", "G3.5", "G4", "blocked"],
			"G1-review": [],
			"G1-verify": [],
			"G3.5": ["G1", "G4", "blocked"],
			G4: ["G0", "G1", "G4-assurance", "goal-check", "blocked"],
			"G4-assurance": ["G1", "G3.5", "G4", "G7", "sweep", "goal-check", "complete", "blocked"],
			G5: [],
			G6: [],
			G7: ["G7-assurance", "sweep", "goal-check", "G1", "G3.5", "G4", "blocked"],
			"G7-assurance": ["G7-assurance", "sweep", "goal-check", "G1", "G3.5", "G4", "blocked"],
			sweep: ["G2", "goal-check", "blocked"],
			"goal-check": ["complete", "G1", "G4", "blocked"],
			complete: [],
			blocked: ["G0", "G1", "G2", "G4", "sweep", "goal-check"],
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
				if (state.admission?.tier === "T1") {
					this.log("SKIP G7 reason=T1 route requires independent G5/G6 but no juror");
					this.log("SKIP goal-check reason=T1 acceptance converged through root G4 plus fresh G5/G6");
					return this.transition("complete", "completed");
				}
				return this.transition(this.requiresConvergenceSweep() ? "sweep" : "goal-check");
			}
			return this.transition("blocked", "blocked");
		}
		this.stateValue = { ...state, activeItemId: next.id, updatedAt: now() };
		this.persist();
		this.log(`ITEM ACTIVE id=${next.id} tier=${next.tier} category=${next.category} tag=${next.tag} framework=${next.framework} launchGroup=${next.launchGroup}`);
		if (state.admission?.tier === "T3" && (state.implementedItemIds ?? []).includes(next.id)) {
			this.transition("G4");
			return this.transition("G4-assurance");
		}
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
		this.withFreshState(() => this.recordCurrentGateReport(input));
	}

	private recordParallelImplementation(input: Omit<PerformanceGateReport, "at">, state: PerformanceRunState): boolean {
		if (state.admission?.tier !== "T3" || input.gate !== "G4") return false;
		if (state.frontier !== "G4") throw new Error(`Evidence is for G4, but current Performance frontier is ${state.frontier}.`);
		if (!input.itemId) throw new Error("T3 parallel G4 evidence requires an admitted lane itemId.");
		const item = state.roadmapItems.find((candidate) => candidate.id === input.itemId);
		if (!item) throw new Error(`Unknown T3 implementation lane ${input.itemId}.`);
		if (input.role !== "root" && input.role !== "primary" && input.role !== "implementer") throw new Error(`${input.role} cannot close Performance G4.`);
		if (this.initialFrontier(item) !== "G4" && item.id !== state.activeItemId) {
			throw new Error(`T3 lane ${item.id} requires its own pre-implementation gates; downgrade to T2 or make that lane active first.`);
		}
		if (!item.dependencies.every((dependency) => (state.implementedItemIds ?? []).includes(dependency))) {
			throw new Error(`T3 lane ${item.id} has incomplete implementation dependencies.`);
		}
		if (input.verdict === "pass" && (state.implementedItemIds ?? []).includes(item.id)) throw new Error(`T3 lane ${item.id} implementation is already complete.`);
		const evidence = this.resolveEvidence(input.evidence);
		if (input.verdict === "pass") this.assertImplementationEvidence(item, evidence);
		const report: PerformanceGateReport = { ...input, itemId: item.id, evidence, at: now() };
		const implementedItemIds = input.verdict === "pass"
			? [...new Set([...(state.implementedItemIds ?? []), item.id])]
			: (state.implementedItemIds ?? []);
		this.stateValue = { ...state, reports: [...state.reports, report], implementedItemIds, updatedAt: now() };
		this.persist();
		this.log(`VERDICT G4 ${report.verdict} actor=${report.actor} role=${report.role} item=${item.id} evidence=${JSON.stringify(report.evidence)}`);
		if (input.verdict === "blocked") this.transition("blocked", "blocked");
		if (input.verdict === "pass" && implementedItemIds.length === state.roadmapItems.length) {
			this.stateValue = { ...this.stateValue!, activeItemId: state.roadmapItems.find((candidate) => !state.completedItemIds.includes(candidate.id))?.id, updatedAt: now() };
			this.persist();
			this.transition("G4-assurance");
		} else if (input.verdict === "pass") {
			const nextPreGated = state.roadmapItems.find((candidate) => !implementedItemIds.includes(candidate.id)
				&& candidate.dependencies.every((dependency) => implementedItemIds.includes(dependency))
				&& this.initialFrontier(candidate) !== "G4");
			if (nextPreGated) {
				this.stateValue = { ...this.stateValue!, activeItemId: nextPreGated.id, updatedAt: now() };
				this.persist();
				this.transition(this.initialFrontier(nextPreGated));
			}
		}
		return true;
	}

	private recordCurrentGateReport(input: Omit<PerformanceGateReport, "at">): void {
		let state = this.stateValue;
		if (!state) throw new Error("No active Performance run.");
		if (state.status !== "active") throw new Error(`Performance run is ${state.status}.`);
		if (this.recordParallelImplementation(input, state)) return;
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
		if (input.role !== "primary" && input.role !== "root" && !expectedRoles[input.gate].includes(input.role)) {
			throw new Error(`${input.role} cannot close Performance ${input.gate}.`);
		}
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
		if (report.gate === "G4" && report.verdict === "pass" && state.admission?.tier === "T0") {
			this.log("SKIP G5 reason=T0 root-owned bounded execution");
			this.log("SKIP G6 reason=T0 verification captured in root G4 evidence");
			this.log("SKIP G7 reason=T0 route has no juror");
			this.completeActiveItem();
			this.log("SKIP goal-check reason=T0 mission acceptance captured in root G4 evidence");
			return this.transition("complete", "completed");
		}
		if (isAssurance) {
			if (report.verdict === "blocked") {
				return this.transition("blocked", "blocked");
			}
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
		if (report.verdict === "blocked") {
			return this.transition("blocked", "blocked");
		}
		if (report.verdict === "fail") {
			const fallbackGate = report.gate === "sweep" ? "G2" : report.gate === "G0" || report.gate === "G1" || report.gate === "G2" ? report.gate : report.gate === "G3.5" ? "G1" : "G4";
			return this.transition(fallbackGate);
		}
		if (report.gate === "sweep") return this.transition("goal-check");
		if (report.gate === "G7") {
			const requiredJurors = performanceItemGatePolicy(this.activeItem()).requiredJurors;
			const jurors = this.stateValue.reports.filter((entry) => entry.gate === "G7" && entry.itemId === this.activeItem().id && entry.verdict === "pass");
			if (jurors.length < requiredJurors) return this.transition("G7-assurance");
			return this.completeActiveItem();
		}
		if (report.gate === "G0") {
			const policy = performanceItemGatePolicy(this.activeItem());
			return this.transition(policy.requiresPlan ? "G1" : policy.requiresDepthLock ? "G3.5" : "G4");
		}
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
	reserveSpawn(parentRole: string, childRole: string, childAgentId: string, laneId?: string): PerformanceSpawnDecision {
		if (!this.stateValue) return { valid: true };
		return this.withStateLock(() => {
			const latest = this.readFromDirectory(this.stateValue!.governanceRoot);
			if (!latest) return { valid: false, message: "Performance run is unavailable." };
			if (latest.status !== "active") {
				if (parentRole === "root" || parentRole === "coordinator" || parentRole === "primary" || parentRole === "scope-coordinator") {
					const recoveryFrontier = blockedRecoveryFrontier(latest);
					latest.status = "active";
					latest.frontier = recoveryFrontier;
					this.stateValue = { ...latest, updatedAt: now() };
					this.persist();
					this.log(`RUN_UNBLOCK unblocked_by=${parentRole} target_role=${childRole} recovery_frontier=${recoveryFrontier}`);
				} else {
					return { valid: false, message: "Performance run is unavailable or no longer active." };
				}
			}
			const decision = validatePerformanceSpawn({ parentRole, childRole, liveAgents: latest.leases.length }, latest);
			if (!decision.valid) return decision;
			if (latest.admission?.tier === "T2" && childRole === "implementer" && latest.leases.some((lease) => lease.role === "implementer")) {
				return { valid: false, message: "Performance T2 serial route already has a live implementer." };
			}
			if (latest.admission?.tier === "T3" && childRole === "implementer") {
				const lane = latest.admission.lanes.find((candidate) => candidate.id === laneId);
				if (!lane) return { valid: false, message: "Performance T3 implementer requires a valid admitted laneId." };
				const item = latest.roadmapItems.find((candidate) => candidate.id === lane.id)!;
				if (latest.frontier !== "G4" || (this.initialFrontier(item) !== "G4" && latest.activeItemId !== lane.id)) {
					return { valid: false, message: `Performance T3 lane ${lane.id} has incomplete pre-implementation gates.` };
				}
				if (!lane.dependsOn.every((dependency) => (latest.implementedItemIds ?? []).includes(dependency))) {
					return { valid: false, message: `Performance T3 lane ${lane.id} has incomplete dependencies.` };
				}
				if (latest.leases.some((lease) => lease.role === "implementer" && lease.laneId === lane.id)) {
					return { valid: false, message: `Performance T3 lane ${lane.id} already has a live implementer.` };
				}
			}
			this.stateValue = { ...latest, leases: [...latest.leases, { agentId: childAgentId, role: childRole, laneId, startedAt: now() }], updatedAt: now() };
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
		const activeItem = state.roadmapItems.find((item) => item.id === (this.boundLaneId ?? state.activeItemId));
		// Scope starts under plan-scope; each accepted roadmap item then carries its
		// own full native protocol instead of relying on a lossy gate summary.
		const framework = getPerformanceFramework(activeItem?.framework ?? "plan-scope");
		const role = process.env.METIS_AGENT_NAME ?? "root";
		const coordinatorContext = role === "root" || L1_ROLES.has(role);
		const rootExecutesBoundedRoute = role === "root" && (state.admission?.tier === "T0" || state.admission?.tier === "T1");
		const workerInstructions: Record<string, string> = {
			implementer: "Act as the G4 implementation worker. Write code and tests directly inside the admitted lane; do not coordinate or reinterpret scope.",
			reviewer: "Act as the G5 independent reviewer. Inspect the integrated workspace and report a gate verdict; never edit production code.",
			verifier: "Act as the G6 verification worker. Run the admitted verification commands in the integrated workspace and report grounded results.",
			"fresh-verifier": "Act as a fresh G6 verification worker. Re-derive results from the mission, workspace, and raw command output; do not consume another verdict.",
			planner: "Act only at G1. Resolve the named design fork without implementing or expanding admitted scope.",
			"depth-prober": "Act only at G3.5. Independently establish the deepest issue-derived cause and reproduction.",
			juror: "Act only at G7. Judge opened G5/G6 evidence without editing the deliverable.",
			"goal-checker": "Perform the final mission-to-evidence goal check without editing the deliverable.",
		};
		const roleInstruction = rootExecutesBoundedRoute
			? `Act as root G4 executor for the admitted ${state.admission!.tier} bounded lane. Implement and verify directly; do not delegate implementation.${state.admission!.tier === "T1" ? " After G4, dispatch only fresh G5 reviewer and G6 verifier against this integrated cwd." : ""}`
			: coordinatorContext
			? `Act as ${role === "root" ? "L0 Primary Coordinator" : `${role} L1 coordinator`}. Follow the admitted ${state.admission?.tier ?? "legacy"} route; dispatch only roles allowed by runtime.`
			: (workerInstructions[role] ?? `You are the ${role} worker. Stay inside this role's legal hierarchy and admitted lane.`);
		const includeFullFramework = coordinatorContext && !rootExecutesBoundedRoute;
		const protocol = [
			"Performance run is active for the current user task.",
			roleInstruction,
			this.boundLaneId ? `Assigned lane: ${this.boundLaneId}; assigned gate: ${this.boundGate ?? "from canonical brief"}. This binding outranks the root run's global active-item display.` : "",
			state.schemaVersion === 1 ? "Legacy G2 closing order remains mandatory: G2 author, then independent G2-review and G2-verify." : "The typed admission and generated ROADMAP are canonical. Scope changes require re-admission; workers must not rewrite lane ownership.",
			includeFullFramework && framework ? `\n# Native execution protocol: ${framework.id}\n${framework.content.trim()}` : "",
			"Before finishing any gate role in a coordinated wave, write a non-empty receipt under <governance root>/artifacts/ then call performance_gate with verdict pass|fail|blocked and evidence set to that relative path (for example artifacts/g2-receipt.md). Do not exit after only writing the receipt. Goal-check is independent and runs only after every roadmap item is complete. Governance artifacts are outside the target workspace and must not be added to its diff.",
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
		const activeItem = state.roadmapItems.find((item) => item.id === (this.boundLaneId ?? state.activeItemId));
		const itemPolicy = activeItem ? performanceItemGatePolicy(activeItem) : undefined;
		return [
			`frontier: ${state.frontier}; active item: ${this.boundLaneId ?? state.activeItemId ?? "scope"}; live agents: ${state.leases.length}.${state.admission ? ` route: ${state.admission.tier}/${state.admission.taskShape}.` : ""}`,
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
		if (STRICT_TDD_FRAMEWORKS.has(item.framework)) {
			const coverage = content.match(/\bcoverage\b[^\d]*(\d+(?:\.\d+)?)\s*%/i);
			if (!coverage || Number(coverage[1]) < 95) {
				throw new Error(`G6 verification for ROADMAP.md item ${item.id} requires measured coverage >=95%.`);
			}
		}
		if (!/\bpreExistingRegressions\b\s*:\s*\S+/i.test(content)) {
			throw new Error(`G6 verification for ROADMAP.md item ${item.id} must record and isolate preExistingRegressions.`);
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
		if (STRICT_TDD_FRAMEWORKS.has(item.framework)) {
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
		// Verify scope profile presence (supports both English and Chinese section titles/keys)
		const scopeMatch = content.match(/(?:^|[\r\n])[^\S\r\n]*(?:[-*•]+[^\S\r\n]*)?(?:\*\*)?(?:Scope profile|scope_profile|Scope|范围分类|范围概述)(?:\*\*)?[^\S\r\n]*[:：][^\S\r\n]*([^\r\n]+)/i);
		if (!scopeMatch || /^(?:TBD|N\/A|\[.*\])\s*$/i.test(scopeMatch[1]!.trim().replace(/^[*_`]+|[*_`]+$/g, ""))) {
			throw new Error("ROADMAP.md is incomplete: Scope profile must be concrete before G2 passes.");
		}
		if (!/requiresDetailedPlan[`)]?\s*[:：]\s*[`(]?(?:true|false)\b/i.test(content)) {
			throw new Error("ROADMAP.md must declare requiresDetailedPlan: true or false.");
		}
		return parsePerformanceRoadmapItems(content);
	}

	/** Serialize every read-modify-write with lease acquisition and release. */
	private withFreshState<T>(operation: () => T): T {
		const previous = this.stateValue;
		if (!previous) throw new Error("No active Performance run.");
		return this.withStateLock(() => {
			const latest = this.readFromDirectory(previous.governanceRoot);
			if (!latest) throw new Error("Performance run is unavailable; governance state or mission integrity validation failed.");
			if (latest.runId !== previous.runId || latest.nonce !== previous.nonce
				|| latest.missionSha256 !== previous.missionSha256 || latest.missionBytes !== previous.missionBytes) {
				throw new Error("Performance run binding changed; reload the run before reporting evidence or changing scope.");
			}
			this.stateValue = latest;
			return operation();
		});
	}

	private persist(): void {
		if (!this.stateValue) return;
		const file = join(this.stateValue.governanceRoot, "run.json");
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			// Readers outside the mutation lock must see a complete old or new
			// snapshot, including when a worker is interrupted during the write.
			writeFileSync(temporary, `${JSON.stringify(this.stateValue, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
			renameSync(temporary, file);
		} finally {
			if (existsSync(temporary)) unlinkSync(temporary);
		}
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
			if (error?.code === "EEXIST") throw new Error("Performance governance is busy; retry the operation.");
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
