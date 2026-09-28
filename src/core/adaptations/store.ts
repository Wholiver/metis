import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveProjectIdentity } from "./project-identity.ts";
import {
	type AdaptationKind,
	type AdaptationScope,
	type AdaptationSummary,
	type JournalEntry,
	type OutcomeLedger,
} from "./types.ts";
import {
	assertNoHandwrittenCollision,
	assertNoPathTraversal,
	assertNoProtectedRoleCollision,
	assertProjectTrusted,
	assertSizeLimit,
	validateAdaptationName,
} from "./validate.ts";
import { validateArchitectureAdaptation } from "./architecture-schema.ts";
import { validateWorkflowAdaptation } from "./workflow-schema.ts";

export class RevisionConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RevisionConflictError";
	}
}

/** Get root path for user-scoped adaptations. */
export function getUserAdaptationsDir(agentDir: string): string {
	return path.join(agentDir, "adaptations");
}

/** Get root path for project-scoped adaptations. */
export function getProjectAdaptationsDir(agentDir: string, projectKey: string): string {
	return path.join(agentDir, "adaptations", "projects", projectKey);
}

/** Resolve base directory for a given scope. */
export function getScopeDir(agentDir: string, cwd: string, scope: AdaptationScope): string {
	if (scope === "user") {
		return getUserAdaptationsDir(agentDir);
	}
	const identity = resolveProjectIdentity(cwd);
	return getProjectAdaptationsDir(agentDir, identity.projectKey);
}

/** Resolve relative path inside scope directory for an adaptation kind and name. */
export function getRelativeArtifactPath(kind: AdaptationKind, name?: string): string {
	switch (kind) {
		case "profile":
			return "profile.md";
		case "skill":
			if (!name) throw new Error("Skill adaptation requires a name");
			return path.join("skills", name, "SKILL.md");
		case "role":
			if (!name) throw new Error("Role adaptation requires a name");
			return path.join("roles", `${name}.md`);
		case "tool":
			if (!name) throw new Error("Tool adaptation requires a name");
			return path.join("tools", `${name}.ts`);
		case "hook":
			if (!name) throw new Error("Hook adaptation requires a name");
			return path.join("hooks", `${name}.ts`);
		case "architecture":
			return "architecture.json";
		case "workflow":
			return "workflow.json";
		case "proposal":
			if (!name) throw new Error("Proposal adaptation requires a name");
			return path.join("workflow-proposals", `${name}.json`);
		default:
			throw new Error(`Unknown adaptation kind: ${kind}`);
	}
}

/** Read journal entries for a scope. */
export function readJournal(scopeDir: string): JournalEntry[] {
	const journalPath = path.join(scopeDir, "journal.jsonl");
	if (!fs.existsSync(journalPath)) return [];
	try {
		const content = fs.readFileSync(journalPath, "utf8");
		return content
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as JournalEntry);
	} catch {
		return [];
	}
}

/** Append an entry to the scope journal. */
export function appendJournal(scopeDir: string, entry: JournalEntry): void {
	fs.mkdirSync(scopeDir, { recursive: true });
	const journalPath = path.join(scopeDir, "journal.jsonl");
	fs.appendFileSync(journalPath, JSON.stringify(entry) + "\n", "utf8");
}

/** Calculate current revision for a specific artifact from journal. */
export function getLatestRevision(scopeDir: string, kind: AdaptationKind, name?: string): number {
	const entries = readJournal(scopeDir);
	let revision = 0;
	for (const entry of entries) {
		if (entry.kind === kind && entry.name === name) {
			if (entry.revision > revision) revision = entry.revision;
		}
	}
	return revision;
}

export interface WriteAdaptationOptions {
	agentDir: string;
	cwd: string;
	scope: AdaptationScope;
	kind: AdaptationKind;
	name?: string;
	content: string;
	expectedRevision?: number;
	reason?: string;
	projectTrusted?: boolean;
}

/** Write an adaptation file with full validation, snapshotting, and journal tracking. */
export async function writeAdaptation(options: WriteAdaptationOptions): Promise<{ revision: number; filePath: string }> {
	const { agentDir, cwd, scope, kind, name, content, expectedRevision, reason } = options;
	const projectTrusted = options.projectTrusted ?? true;

	// 1. Trust assertion
	assertProjectTrusted(projectTrusted, scope);

	// 2. Name validation
	if (name) {
		validateAdaptationName(name);
		if (kind === "role") {
			assertNoProtectedRoleCollision(name);
		}
		assertNoHandwrittenCollision(agentDir, kind, name);
	}

	// 3. Schema and content validation
	const byteLength = Buffer.byteLength(content, "utf8");
	assertSizeLimit(kind, byteLength);

	if (kind === "architecture") {
		const parsed = JSON.parse(content);
		validateArchitectureAdaptation(parsed);
	} else if (kind === "workflow") {
		const parsed = JSON.parse(content);
		validateWorkflowAdaptation(parsed);
	}

	// 4. Path resolution & traversal check
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const relPath = getRelativeArtifactPath(kind, name);
	const fullPath = path.join(scopeDir, relPath);
	assertNoPathTraversal(scopeDir, fullPath);

	// 5. Optimistic locking
	const currentRevision = getLatestRevision(scopeDir, kind, name);
	if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
		throw new RevisionConflictError(
			`Revision conflict for ${kind}${name ? `/${name}` : ""}: expected ${expectedRevision}, current is ${currentRevision}`,
		);
	}

	const nextRevision = currentRevision + 1;
	const snapshotId = `rev-${nextRevision}-${crypto.randomUUID().slice(0, 8)}`;

	// 6. Write new content
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content, "utf8");

	// 7. Save revision snapshot
	const snapshotDir = path.join(scopeDir, "history", snapshotId);
	fs.mkdirSync(snapshotDir, { recursive: true });
	fs.copyFileSync(fullPath, path.join(snapshotDir, path.basename(fullPath)));

	// 8. Journal append
	const entry: JournalEntry = {
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		action: "apply",
		scope,
		kind,
		name,
		revision: nextRevision,
		previousRevision: currentRevision,
		reason: reason ?? "applied adaptation",
		snapshotId,
	};
	appendJournal(scopeDir, entry);

	return { revision: nextRevision, filePath: fullPath };
}

export interface RollbackOptions {
	agentDir: string;
	cwd: string;
	scope: AdaptationScope;
	kind: AdaptationKind;
	name?: string;
	targetRevision?: number;
	reason?: string;
	projectTrusted?: boolean;
}

/** Roll back an adaptation to a previous revision. */
export async function rollbackAdaptation(options: RollbackOptions): Promise<{ success: boolean; revision: number }> {
	const { agentDir, cwd, scope, kind, name, reason } = options;
	const projectTrusted = options.projectTrusted ?? true;

	assertProjectTrusted(projectTrusted, scope);
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const relPath = getRelativeArtifactPath(kind, name);
	const fullPath = path.join(scopeDir, relPath);
	assertNoPathTraversal(scopeDir, fullPath);

	const entries = readJournal(scopeDir).filter((e) => e.kind === kind && e.name === name);
	if (entries.length === 0) {
		throw new Error(`No journal history found for ${kind}${name ? `/${name}` : ""}`);
	}

	const lastEntry = entries[entries.length - 1];
	const currentRevision = lastEntry.revision;
	const targetRev = options.targetRevision ?? lastEntry.previousRevision ?? 0;

	if (targetRev === 0) {
		// Target is 0: remove file completely
		if (fs.existsSync(fullPath)) {
			fs.unlinkSync(fullPath);
		}
	} else {
		// Restore from snapshot
		const targetEntry = entries.find((e) => e.revision === targetRev);
		if (!targetEntry || !targetEntry.snapshotId) {
			throw new Error(`Cannot rollback: snapshot for revision ${targetRev} not found`);
		}
		const snapshotFile = path.join(scopeDir, "history", targetEntry.snapshotId, path.basename(fullPath));
		if (!fs.existsSync(snapshotFile)) {
			throw new Error(`Snapshot file missing at ${snapshotFile}`);
		}
		fs.copyFileSync(snapshotFile, fullPath);
	}

	const nextRevision = currentRevision + 1;
	const entry: JournalEntry = {
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		action: "rollback",
		scope,
		kind,
		name,
		revision: nextRevision,
		previousRevision: currentRevision,
		reason: reason ?? `rollback to revision ${targetRev}`,
	};
	appendJournal(scopeDir, entry);

	return { success: true, revision: nextRevision };
}

/** List all active adaptations across user and (optionally) project scopes. */
function extractPendingChecks(filePath: string): string[] | undefined {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (Array.isArray(parsed.extraChecks)) {
			const pending = parsed.extraChecks
				.filter((c: any) => c.status === "pending")
				.map((c: any) => c.name || c.id);
			return pending.length > 0 ? pending : undefined;
		}
	} catch {}
	return undefined;
}

export function listAdaptations(
	agentDir: string,
	cwd: string,
	options: { projectTrusted?: boolean } = {},
): AdaptationSummary[] {
	const summaries: AdaptationSummary[] = [];

	const scanScope = (scopeDir: string, scope: AdaptationScope) => {
		if (!fs.existsSync(scopeDir)) return;
		const ledger = getOutcomeLedger(scopeDir);
		const getStats = (id: string) => ledger.perAdaptationStats?.[id];

		// 1. Profile
		const profilePath = path.join(scopeDir, "profile.md");
		if (fs.existsSync(profilePath)) {
			const stat = fs.statSync(profilePath);
			const id = `${scope}:profile`;
			const stats = getStats(id);
			summaries.push({
				id,
				scope,
				kind: "profile",
				filePath: profilePath,
				sizeBytes: stat.size,
				revision: getLatestRevision(scopeDir, "profile"),
				updatedAt: stat.mtime.toISOString(),
				appliedCount: stats?.appliedCount,
				lastOutcome: stats?.lastOutcome,
				recurredCorrections: stats?.recurredCorrections,
			});
		}

		// 2. Architecture
		const archPath = path.join(scopeDir, "architecture.json");
		if (fs.existsSync(archPath)) {
			const stat = fs.statSync(archPath);
			const id = `${scope}:architecture`;
			const stats = getStats(id);
			summaries.push({
				id,
				scope,
				kind: "architecture",
				filePath: archPath,
				sizeBytes: stat.size,
				revision: getLatestRevision(scopeDir, "architecture"),
				updatedAt: stat.mtime.toISOString(),
				appliedCount: stats?.appliedCount,
				lastOutcome: stats?.lastOutcome,
				recurredCorrections: stats?.recurredCorrections,
			});
		}

		// 3. Workflow
		const wfPath = path.join(scopeDir, "workflow.json");
		if (fs.existsSync(wfPath)) {
			const stat = fs.statSync(wfPath);
			const id = `${scope}:workflow`;
			const stats = getStats(id);
			summaries.push({
				id,
				scope,
				kind: "workflow",
				filePath: wfPath,
				sizeBytes: stat.size,
				revision: getLatestRevision(scopeDir, "workflow"),
				updatedAt: stat.mtime.toISOString(),
				appliedCount: stats?.appliedCount,
				lastOutcome: stats?.lastOutcome,
				recurredCorrections: stats?.recurredCorrections,
				pendingChecks: extractPendingChecks(wfPath),
			});
		}

		// 4. Skills
		const skillsDir = path.join(scopeDir, "skills");
		if (fs.existsSync(skillsDir)) {
			for (const skillName of fs.readdirSync(skillsDir)) {
				const skillFile = path.join(skillsDir, skillName, "SKILL.md");
				if (fs.existsSync(skillFile)) {
					const stat = fs.statSync(skillFile);
					const id = `${scope}:skill:${skillName}`;
					const stats = getStats(id);
					summaries.push({
						id,
						scope,
						kind: "skill",
						name: skillName,
						filePath: skillFile,
						sizeBytes: stat.size,
						revision: getLatestRevision(scopeDir, "skill", skillName),
						updatedAt: stat.mtime.toISOString(),
						appliedCount: stats?.appliedCount,
						lastOutcome: stats?.lastOutcome,
						recurredCorrections: stats?.recurredCorrections,
					});
				}
			}
		}

		// 5. Roles
		const rolesDir = path.join(scopeDir, "roles");
		if (fs.existsSync(rolesDir)) {
			for (const file of fs.readdirSync(rolesDir)) {
				if (file.endsWith(".md")) {
					const roleName = file.replace(/\.md$/, "");
					const filePath = path.join(rolesDir, file);
					const stat = fs.statSync(filePath);
					const id = `${scope}:role:${roleName}`;
					const stats = getStats(id);
					summaries.push({
						id,
						scope,
						kind: "role",
						name: roleName,
						filePath,
						sizeBytes: stat.size,
						revision: getLatestRevision(scopeDir, "role", roleName),
						updatedAt: stat.mtime.toISOString(),
						appliedCount: stats?.appliedCount,
						lastOutcome: stats?.lastOutcome,
						recurredCorrections: stats?.recurredCorrections,
					});
				}
			}
		}

		// 6. Tools
		const toolsDir = path.join(scopeDir, "tools");
		if (fs.existsSync(toolsDir)) {
			for (const file of fs.readdirSync(toolsDir)) {
				if (file.endsWith(".ts")) {
					const toolName = file.replace(/\.ts$/, "");
					const filePath = path.join(toolsDir, file);
					const stat = fs.statSync(filePath);
					const id = `${scope}:tool:${toolName}`;
					const stats = getStats(id);
					summaries.push({
						id,
						scope,
						kind: "tool",
						name: toolName,
						filePath,
						sizeBytes: stat.size,
						revision: getLatestRevision(scopeDir, "tool", toolName),
						updatedAt: stat.mtime.toISOString(),
						appliedCount: stats?.appliedCount,
						lastOutcome: stats?.lastOutcome,
						recurredCorrections: stats?.recurredCorrections,
					});
				}
			}
		}

		// 7. Hooks
		const hooksDir = path.join(scopeDir, "hooks");
		if (fs.existsSync(hooksDir)) {
			for (const file of fs.readdirSync(hooksDir)) {
				if (file.endsWith(".ts")) {
					const hookName = file.replace(/\.ts$/, "");
					const filePath = path.join(hooksDir, file);
					const stat = fs.statSync(filePath);
					const id = `${scope}:hook:${hookName}`;
					const stats = getStats(id);
					summaries.push({
						id,
						scope,
						kind: "hook",
						name: hookName,
						filePath,
						sizeBytes: stat.size,
						revision: getLatestRevision(scopeDir, "hook", hookName),
						updatedAt: stat.mtime.toISOString(),
						appliedCount: stats?.appliedCount,
						lastOutcome: stats?.lastOutcome,
						recurredCorrections: stats?.recurredCorrections,
					});
				}
			}
		}

		// 8. Proposals
		const propDir = path.join(scopeDir, "workflow-proposals");
		if (fs.existsSync(propDir)) {
			for (const file of fs.readdirSync(propDir)) {
				if (file.endsWith(".json")) {
					const propName = file.replace(/\.json$/, "");
					const filePath = path.join(propDir, file);
					const stat = fs.statSync(filePath);
					const id = `${scope}:proposal:${propName}`;
					const stats = getStats(id);
					summaries.push({
						id,
						scope,
						kind: "proposal",
						name: propName,
						filePath,
						sizeBytes: stat.size,
						revision: getLatestRevision(scopeDir, "proposal", propName),
						updatedAt: stat.mtime.toISOString(),
						appliedCount: stats?.appliedCount,
						lastOutcome: stats?.lastOutcome,
						recurredCorrections: stats?.recurredCorrections,
					});
				}
			}
		}
	};

	// Scan user scope
	scanScope(getUserAdaptationsDir(agentDir), "user");

	// Scan project scope if trusted
	if (options.projectTrusted ?? true) {
		const identity = resolveProjectIdentity(cwd);
		scanScope(getProjectAdaptationsDir(agentDir, identity.projectKey), "project");
	}

	return summaries;
}

/** Read outcome ledger for a scope. */
export function getOutcomeLedger(scopeDir: string): OutcomeLedger {
	const ledgerPath = path.join(scopeDir, "outcome-ledger.json");
	if (!fs.existsSync(ledgerPath)) {
		return {
			totalRuns: 0,
			appliedCount: 0,
			recurredCorrections: 0,
			activeAdaptations: [],
		};
	}
	try {
		return JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as OutcomeLedger;
	} catch {
		return {
			totalRuns: 0,
			appliedCount: 0,
			recurredCorrections: 0,
			activeAdaptations: [],
		};
	}
}

/** Update outcome ledger for a scope. */
export function updateOutcomeLedger(scopeDir: string, update: Partial<OutcomeLedger>): OutcomeLedger {
	const current = getOutcomeLedger(scopeDir);
	const next: OutcomeLedger = {
		...current,
		...update,
	};
	fs.mkdirSync(scopeDir, { recursive: true });
	fs.writeFileSync(path.join(scopeDir, "outcome-ledger.json"), JSON.stringify(next, null, 2), "utf8");
	return next;
}
