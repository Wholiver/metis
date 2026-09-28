import * as fs from "node:fs";
import * as path from "node:path";
import { getScopeDir, getOutcomeLedger, updateOutcomeLedger, writeAdaptation } from "./store.ts";
import type { AdaptationScope } from "./types.ts";

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
