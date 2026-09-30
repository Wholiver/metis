import * as fs from "node:fs";
import * as path from "node:path";
import { getScopeDir, getOutcomeLedger, updateOutcomeLedger, writeAdaptation, rollbackAdaptation, selectLowestValueSkill } from "./store.ts";
import type { AdaptationKind, AdaptationScope, GrowthReport, AdaptationSummary } from "./types.ts";

export { selectLowestValueSkill };

export interface TurnOutcomeRecord {
	id: string;
	turnIndex: number;
	sessionId: string;
	timestamp: string;
	intentTag?: string;
	commandFingerprints: Array<{ command: string; exitCode: number }>;
	recoveryPairs: Array<{ failedCommand: string; recoveredCommand: string }>;
	errorSignatures: string[];
	recalledAdaptationIds: string[];
	implicitFeedbackScore?: number;
	performanceSnapshot?: {
		status?: string;
		frontier?: string;
		reportsCount: number;
	};
	holdout?: boolean;
	success?: boolean;
	userCorrected?: boolean;
	errorCount?: number;
}

export function hashSessionTurn(sessionId: string, turnIndex: number): number {
	const str = `${sessionId}:${turnIndex}`;
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

/** 15% deterministic control group holdout for tentative adaptations */
export function isControlGroupHoldout(sessionId: string, turnIndex: number): boolean {
	return hashSessionTurn(sessionId, turnIndex) % 100 < 15;
}

export function getOutcomesLogPath(scopeDir: string): string {
	return path.join(scopeDir, "outcomes.jsonl");
}

export function readTurnOutcomes(scopeDir: string, limit = 500): TurnOutcomeRecord[] {
	const filePath = getOutcomesLogPath(scopeDir);
	if (!fs.existsSync(filePath)) return [];
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const lines = content.split("\n").filter((l) => l.trim().length > 0);
		const records = lines.map((l) => JSON.parse(l) as TurnOutcomeRecord);
		return records.slice(-limit);
	} catch {
		return [];
	}
}

/** A finished Performance run is a success even if an incidental tool error was recovered. */
export function turnSucceededForAdaptation(options: {
	errorOccurred: boolean;
	errorCount: number;
	performanceStatus?: string;
}): boolean {
	if (options.performanceStatus === "completed") return true;
	return !options.errorOccurred && options.errorCount === 0;
}

/** Only the user's own correction counts. Tool error text is not a user correction. */
export function isUserStatedCorrection(signals: ReadonlyArray<{ type: string }>): boolean {
	return signals.some((signal) => signal.type === "correction" || signal.type === "repeated_misunderstanding");
}

export function recordTurnOutcome(options: {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
	record: TurnOutcomeRecord;
}): void {
	const { agentDir, cwd, scope = "project", record } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	fs.mkdirSync(scopeDir, { recursive: true });

	const filePath = getOutcomesLogPath(scopeDir);
	let records: TurnOutcomeRecord[] = [];
	if (fs.existsSync(filePath)) {
		try {
			records = readTurnOutcomes(scopeDir, 1000);
		} catch {}
	}
	records.push(record);
	if (records.length > 500) {
		records = records.slice(records.length - 500);
	}

	fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

	if (record.recalledAdaptationIds && record.recalledAdaptationIds.length > 0) {
		if (record.implicitFeedbackScore !== undefined) {
			if (record.implicitFeedbackScore > 0) {
				recordAdaptationEffect({
					agentDir,
					cwd,
					scope,
					effect: "helped",
					activeAdaptationIds: record.recalledAdaptationIds,
				});
			} else if (record.implicitFeedbackScore < 0) {
				recordAdaptationEffect({
					agentDir,
					cwd,
					scope,
					effect: "hurt",
					activeAdaptationIds: record.recalledAdaptationIds,
				});
			}
		}
	}
}

export interface RecordAdaptationEffectResult {
	status: "trial" | "tentative" | "active" | "retired";
	promoted?: boolean;
	retired?: boolean;
	helped?: number;
	hurt?: number;
}

export function recordAdaptationEffect(
	optionsOrAgentDir:
		| {
				agentDir: string;
				cwd: string;
				scope?: AdaptationScope;
				effect: "helped" | "hurt";
				activeAdaptationIds: string[];
		  }
		| string,
	cwdArg?: string,
	idOrIdsArg?: string | string[],
	effectArg?: "helped" | "hurt",
): RecordAdaptationEffectResult {
	let agentDir: string;
	let cwd: string;
	let scope: AdaptationScope = "project";
	let effect: "helped" | "hurt";
	let activeAdaptationIds: string[];

	if (typeof optionsOrAgentDir === "object") {
		agentDir = optionsOrAgentDir.agentDir;
		cwd = optionsOrAgentDir.cwd;
		scope = optionsOrAgentDir.scope ?? "project";
		effect = optionsOrAgentDir.effect;
		activeAdaptationIds = optionsOrAgentDir.activeAdaptationIds;
	} else {
		agentDir = optionsOrAgentDir;
		cwd = cwdArg!;
		effect = effectArg ?? "helped";
		activeAdaptationIds = Array.isArray(idOrIdsArg) ? idOrIdsArg : (idOrIdsArg ? [idOrIdsArg] : []);
	}

	if (!activeAdaptationIds || activeAdaptationIds.length === 0) {
		return { status: "active" };
	}

	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const ledger = getOutcomeLedger(scopeDir);
	const perStats = { ...(ledger.perAdaptationStats ?? {}) };

	let lastStatus: "trial" | "tentative" | "active" | "retired" = "trial";
	let promoted = false;
	let retired = false;
	let lastHelped = 0;
	let lastHurt = 0;

	for (const id of activeAdaptationIds) {
		const existing = perStats[id] ?? {
			appliedCount: 0,
			recurredCorrections: 0,
			helped: 0,
			hurt: 0,
			trial: true,
			status: "trial" as const,
		};
		let currentStatus = existing.status ?? (existing.trial ? "trial" : "active");

		if (effect === "helped") {
			const helped = (existing.helped ?? 0) + 1;
			const hurt = existing.hurt ?? 0;
			if ((currentStatus === "trial" || currentStatus === "tentative") && helped >= 3 && hurt === 0) {
				currentStatus = "active";
				promoted = true;
			}
			perStats[id] = {
				...existing,
				appliedCount: existing.appliedCount + 1,
				helped,
				trial: currentStatus === "trial" || currentStatus === "tentative",
				status: currentStatus,
				lastOutcome: "success",
				lastRunAt: new Date().toISOString(),
			};
			lastHelped = helped;
			lastHurt = hurt;
		} else {
			const hurt = (existing.hurt ?? 0) + 1;
			const helped = existing.helped ?? 0;
			if (hurt >= 2) {
				currentStatus = "retired";
				retired = true;
			}
			perStats[id] = {
				...existing,
				appliedCount: existing.appliedCount + 1,
				hurt,
				trial: currentStatus === "trial" || currentStatus === "tentative",
				status: currentStatus,
				lastOutcome: "failure",
				lastRunAt: new Date().toISOString(),
			};
			lastHelped = helped;
			lastHurt = hurt;
		}
		lastStatus = currentStatus;
	}

	updateOutcomeLedger(scopeDir, { perAdaptationStats: perStats });

	return {
		status: lastStatus,
		promoted: promoted || undefined,
		retired: retired || undefined,
		helped: lastHelped,
		hurt: lastHurt,
	};
}

export async function handleAdaptationLoadFailure(options: {
	agentDir: string;
	cwd: string;
	filePath: string;
	error: unknown;
}): Promise<{ rolledBack: boolean; kind?: AdaptationKind; name?: string }> {
	const { agentDir, cwd, filePath, error } = options;
	const isProject = filePath.includes(path.join("adaptations", "projects"));
	const scope: AdaptationScope = isProject ? "project" : "user";
	let kind: AdaptationKind | undefined;
	let name: string | undefined;

	if (filePath.includes(path.join("tools", ""))) {
		kind = "tool";
		name = path.basename(filePath).replace(/\.(?:ts|js)$/, "");
	} else if (filePath.includes(path.join("hooks", ""))) {
		kind = "hook";
		name = path.basename(filePath).replace(/\.(?:ts|js)$/, "");
	} else if (filePath.includes(path.join("skills", ""))) {
		kind = "skill";
		const parts = filePath.split(path.sep);
		const skillIdx = parts.lastIndexOf("skills");
		if (skillIdx !== -1 && parts[skillIdx + 1]) {
			name = parts[skillIdx + 1];
		}
	}

	if (!kind || !name) {
		return { rolledBack: false };
	}

	try {
		await rollbackAdaptation({
			agentDir,
			cwd,
			scope,
			kind,
			name,
			actor: "evaluator",
			reason: `Load failure rollback: ${String(error)}`,
		});
		return { rolledBack: true, kind, name };
	} catch {
		return { rolledBack: false, kind, name };
	}
}

export function adaptationId(scope: AdaptationScope, kind: AdaptationKind, name?: string): string {
	if (name) {
		return `${scope}:${kind}:${name}`;
	}
	return `${scope}:${kind}`;
}

export async function recordAdaptationRuntimeError(options: {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
	adaptationId: string;
	error: unknown;
}): Promise<{ rolledBack: boolean }> {
	const { agentDir, cwd, scope = "project", adaptationId: adaptId, error } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const ledger = getOutcomeLedger(scopeDir);
	const perStats = { ...(ledger.perAdaptationStats ?? {}) };
	const existing = perStats[adaptId] ?? {
		appliedCount: 0,
		recurredCorrections: 0,
		helped: 0,
		hurt: 0,
		trial: true,
	};
	const hurt = (existing.hurt ?? 0) + 1;
	perStats[adaptId] = {
		...existing,
		hurt,
		lastOutcome: "failure",
		lastRunAt: new Date().toISOString(),
	};
	updateOutcomeLedger(scopeDir, { perAdaptationStats: perStats });

	const parts = adaptId.split(":");
	let adaptScope: AdaptationScope = scope;
	let kind: AdaptationKind | undefined;
	let name: string | undefined;

	if (parts.length >= 3 && (parts[0] === "user" || parts[0] === "project")) {
		adaptScope = parts[0] as AdaptationScope;
		kind = parts[1] as AdaptationKind;
		name = parts.slice(2).join(":");
	} else if (parts.length === 2 && (parts[0] === "tool" || parts[0] === "hook")) {
		kind = parts[0] as AdaptationKind;
		name = parts[1];
	} else if (parts.length >= 2) {
		kind = parts[0] as AdaptationKind;
		name = parts.slice(1).join(":");
	}

	if (hurt >= 2 && (kind === "tool" || kind === "hook") && name) {
		try {
			await rollbackAdaptation({
				agentDir,
				cwd,
				scope: adaptScope,
				kind,
				name,
				actor: "evaluator",
				reason: `Auto-rollback after 2 runtime errors: ${String(error)}`,
			});
			return { rolledBack: true };
		} catch {
			return { rolledBack: false };
		}
	}
	return { rolledBack: false };
}

export async function recordAdaptationSuccess(options: {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
	adaptationId: string;
}): Promise<{ graduated: boolean }> {
	const { agentDir, cwd, scope = "project", adaptationId } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const ledger = getOutcomeLedger(scopeDir);
	const perStats = { ...(ledger.perAdaptationStats ?? {}) };
	const existing = perStats[adaptationId] ?? {
		appliedCount: 0,
		recurredCorrections: 0,
		helped: 0,
		hurt: 0,
		trial: true,
	};
	const appliedCount = existing.appliedCount + 1;
	const helped = (existing.helped ?? 0) + 1;
	const hurt = existing.hurt ?? 0;
	let trial = existing.trial;
	let status = existing.status;
	let graduated = false;

	if (trial && appliedCount >= 5 && hurt === 0) {
		trial = false;
		status = "active";
		graduated = true;
	}

	perStats[adaptationId] = {
		...existing,
		appliedCount,
		helped,
		trial,
		status,
		lastOutcome: "success",
		lastRunAt: new Date().toISOString(),
	};
	updateOutcomeLedger(scopeDir, { perAdaptationStats: perStats });
	return { graduated };
}

export function generateDailyGrowthReport(
	scopeDirOrAgentDir: string,
	cwdArg?: string,
	scopeArg: AdaptationScope = "project",
	knownAdaptations?: AdaptationSummary[],
): GrowthReport {
	let scopeDir = scopeDirOrAgentDir;
	if (cwdArg) {
		scopeDir = getScopeDir(scopeDirOrAgentDir, cwdArg, scopeArg);
	}

	const outcomes = readTurnOutcomes(scopeDir, 100);
	const today = new Date().toISOString().slice(0, 10);
	const totalTurns = outcomes.length;
	const ledger = getOutcomeLedger(scopeDir);

	let activeCount = 0;
	let trialCount = 0;
	let retiredCount = 0;
	if (knownAdaptations && knownAdaptations.length > 0) {
		for (const a of knownAdaptations) {
			if (a.status === "retired" || a.isRetired) {
				retiredCount++;
			} else if (a.trial || a.status === "trial" || a.status === "tentative") {
				trialCount++;
			} else {
				activeCount++;
			}
		}
	} else if (ledger.perAdaptationStats) {
		for (const stats of Object.values(ledger.perAdaptationStats)) {
			if (stats.status === "retired") {
				retiredCount++;
			} else if (stats.status === "trial" || stats.status === "tentative" || stats.trial) {
				trialCount++;
			} else {
				activeCount++;
			}
		}
	}

	if (totalTurns === 0) {
		const emptyReport: GrowthReport = {
			date: today,
			correctionRate: 0,
			predictionHitRate: 0,
			recurringErrorRate: 0,
			toolErrorRate: 0,
			totalEvaluatedRuns: 0,
			adaptationSuccessRate: undefined,
			activeCount,
			trialCount,
			retiredCount,
			summary: `今日尚无评估记录 (活跃: ${activeCount}, 试用: ${trialCount})`,
		};
		updateOutcomeLedger(scopeDir, { growth: emptyReport });
		return emptyReport;
	}

	let corrections = 0;
	let toolErrors = 0;
	let totalToolCalls = 0;
	let recurringErrors = 0;
	let successfulTurns = 0;

	for (const turn of outcomes) {
		if (turn.success) {
			successfulTurns++;
		}
		if (turn.userCorrected || (turn.implicitFeedbackScore !== undefined && turn.implicitFeedbackScore < 0)) {
			corrections++;
		}
		if (turn.commandFingerprints) {
			for (const fp of turn.commandFingerprints) {
				totalToolCalls++;
				if (fp.exitCode !== 0) toolErrors++;
			}
		}
		if (turn.errorSignatures && turn.errorSignatures.length > 1) {
			recurringErrors++;
		}
	}

	const adaptationSuccessRate = Number((successfulTurns / totalTurns).toFixed(2));

	const report: GrowthReport = {
		date: today,
		correctionRate: Number((corrections / totalTurns).toFixed(2)),
		predictionHitRate: Number((outcomes.filter((o) => (o.implicitFeedbackScore ?? 0) > 0).length / totalTurns).toFixed(2)),
		recurringErrorRate: Number((recurringErrors / totalTurns).toFixed(2)),
		toolErrorRate: totalToolCalls > 0 ? Number((toolErrors / totalToolCalls).toFixed(2)) : 0,
		totalEvaluatedRuns: totalTurns,
		adaptationSuccessRate,
		activeCount,
		trialCount,
		retiredCount,
		summary: `已评估 ${totalTurns} 回合，成功率 ${Math.round(adaptationSuccessRate * 100)}% (活跃: ${activeCount}, 试用: ${trialCount}, 已淘汰: ${retiredCount})`,
	};

	updateOutcomeLedger(scopeDir, { growth: report });
	return report;
}

export interface RecordRunOutcomeOptions {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
	outcome: "success" | "failure";
	activeAdaptationIds: string[];
	isProjectTrusted?: boolean;
}

/** Record the outcome of a completed performance run for active adaptations */
export function recordRunOutcome(options: RecordRunOutcomeOptions): void {
	const { agentDir, cwd, scope = "project", outcome, activeAdaptationIds } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const ledger = getOutcomeLedger(scopeDir);

	const perAdaptationStats = { ...(ledger.perAdaptationStats ?? {}) };
	const now = new Date().toISOString();

	for (const id of activeAdaptationIds) {
		const existing = perAdaptationStats[id] ?? {
			appliedCount: 0,
			recurredCorrections: 0,
		};
		perAdaptationStats[id] = {
			...existing,
			appliedCount: existing.appliedCount + 1,
			lastOutcome: outcome,
			lastRunAt: now,
		};
	}

	updateOutcomeLedger(scopeDir, {
		totalRuns: ledger.totalRuns + 1,
		appliedCount: ledger.appliedCount + 1,
		lastOutcome: outcome,
		lastRunAt: now,
		activeAdaptations: activeAdaptationIds,
		perAdaptationStats,
	});
}

export interface RecordCorrectionOptions {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
	activeAdaptationIds: string[];
}

/**
 * Record a user correction occurring after adaptations were active.
 * If an adaptation reaches 2 or more recurring corrections, it is returned in needsRewriteIds.
 */
export function recordRecurringCorrection(options: RecordCorrectionOptions): { needsRewriteIds: string[] } {
	const { agentDir, cwd, scope = "project", activeAdaptationIds } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const ledger = getOutcomeLedger(scopeDir);
	const perAdaptationStats = { ...(ledger.perAdaptationStats ?? {}) };
	const needsRewriteIds: string[] = [];

	for (const id of activeAdaptationIds) {
		const existing = perAdaptationStats[id] ?? {
			appliedCount: 0,
			recurredCorrections: 0,
		};
		const recurred = existing.recurredCorrections + 1;
		perAdaptationStats[id] = {
			...existing,
			recurredCorrections: recurred,
		};
		if (recurred >= 2) {
			needsRewriteIds.push(id);
		}
	}

	updateOutcomeLedger(scopeDir, {
		recurredCorrections: ledger.recurredCorrections + 1,
		perAdaptationStats,
	});

	return { needsRewriteIds };
}

export interface RetireExtraCheckOptions {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
	checkId: string;
	isProjectTrusted?: boolean;
}

/** Retire an extraCheck from workflow.json so it is no longer executed */
export async function retireExtraCheck(options: RetireExtraCheckOptions): Promise<{ success: boolean; found: boolean }> {
	const { agentDir, cwd, scope = "project", checkId, isProjectTrusted = true } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const wfPath = path.join(scopeDir, "workflow.json");

	if (!fs.existsSync(wfPath)) {
		return { success: false, found: false };
	}

	try {
		const raw = JSON.parse(fs.readFileSync(wfPath, "utf8"));
		if (!Array.isArray(raw.extraChecks)) {
			return { success: false, found: false };
		}
		let found = false;
		for (const check of raw.extraChecks) {
			if (check.id === checkId) {
				check.status = "retired";
				found = true;
			}
		}
		if (!found) {
			return { success: true, found: false };
		}
		await writeAdaptation({
			agentDir,
			cwd,
			scope,
			kind: "workflow",
			content: JSON.stringify(raw, null, 2),
			reason: `retire check ${checkId}`,
			projectTrusted: isProjectTrusted,
		});
		return { success: true, found: true };
	} catch {
		return { success: false, found: false };
	}
}

/** Update the status of an extraCheck (e.g. mark pending on environment error) */
export function updateExtraCheckStatus(options: {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
	checkId: string;
	status: "active" | "pending" | "retired";
}): boolean {
	const { agentDir, cwd, scope = "project", checkId, status } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const wfPath = path.join(scopeDir, "workflow.json");
	if (!fs.existsSync(wfPath)) return false;

	try {
		const raw = JSON.parse(fs.readFileSync(wfPath, "utf8"));
		if (!Array.isArray(raw.extraChecks)) return false;
		let found = false;
		for (const check of raw.extraChecks) {
			if (check.id === checkId) {
				check.status = status;
				found = true;
			}
		}
		if (found) {
			fs.writeFileSync(wfPath, JSON.stringify(raw, null, 2), "utf8");
			return true;
		}
		return false;
	} catch {
		return false;
	}
}
