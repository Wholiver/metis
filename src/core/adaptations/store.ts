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
	DEFAULT_MAX_LEARNED_SKILLS,
} from "./types.ts";
import {
	assertNoHandwrittenCollision,
	assertNoPathTraversal,
	assertNoProtectedRoleCollision,
	assertProjectTrusted,
	assertSizeLimit,
	validateAdaptationName,
	assertMainWorkflowInvariance,
	AdaptationValidationError,
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
			return name === "json" ? "profile.json" : "profile.md";
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

export function normalizeProfileContent(content: string, legacySource?: string): string {
	try {
		const parsed = JSON.parse(content);
		if (parsed && typeof parsed === "object" && (parsed.version === 2 || parsed.traits)) {
			return JSON.stringify(parsed, null, 2);
		}
	} catch {}

	let statement = content.trim();
	let initialEvidence: string[] = ["User configured preference"];
	if (!statement && legacySource) {
		statement = legacySource.trim();
		initialEvidence = ["Migrated from legacy profile.md"];
	}

	const profileData = {
		version: 2,
		traits: statement
			? [
					{
						dimension: "communication",
						statement,
						confidence: 1.0,
						evidence: initialEvidence,
						lastConfirmed: new Date().toISOString(),
						status: "active",
						userStated: true,
					},
			  ]
			: [],
		followUpPredictions: [],
		updatedAt: new Date().toISOString(),
	};
	return JSON.stringify(profileData, null, 2);
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
	actor?: "model" | "learner" | "evaluator";
	trial?: boolean;
	replaces?: string;
	maxLearnedSkills?: number;
}

/**
 * Skills are only loaded when SKILL.md has name and description frontmatter.
 * Learner output is often a bare procedure, so wrap it before it hits disk.
 */
export function ensureSkillDocument(name: string, content: string): string {
	const trimmed = content.trim();
	const fence = trimmed.startsWith("---\n") ? trimmed.indexOf("\n---", 4) : -1;
	if (fence !== -1) {
		const frontmatter = trimmed.slice(4, fence);
		const hasName = /^name\s*:/m.test(frontmatter);
		const hasDescription = /^description\s*:/m.test(frontmatter);
		if (hasName && hasDescription) {
			return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
		}
	}
	const body = fence === -1 ? trimmed : trimmed.slice(fence + 4).trim();
	const firstLine = body.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#")) ?? "Learned project procedure.";
	const description = firstLine.replace(/^description\s*:\s*/i, "").slice(0, 240);
	const safeName = name.trim() || "learned-skill";
	return `---\nname: ${safeName}\ndescription: ${description}\n---\n\n${body}\n`;
}

/** Extract CLI flags and special command tokens (e.g. --lang, CMS_STAMP, nonce) from text. */
export function extractCommandFlagsAndTokens(text: string): Set<string> {
	const tokens = new Set<string>();
	// 1. Long and short CLI flags: --lang, --dry-run, -v
	const flagMatches = text.matchAll(/(?:^|[\s"'`=])(--[a-zA-Z0-9_-]+|-[a-zA-Z0-9])(?=[\s"'`=]|$)/g);
	for (const m of flagMatches) {
		if (m[1]) tokens.add(m[1]);
	}
	// 2. Uppercase constant identifiers (length >= 3 or with underscore): CMS_STAMP, TOKEN
	const upperMatches = text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g);
	for (const m of upperMatches) {
		if (m[1]) tokens.add(m[1]);
	}
	// 3. Tokens like nonce or specific keywords in code/command contexts
	const nonceMatches = text.matchAll(/\b(nonce|token|stamp)\b/gi);
	for (const m of nonceMatches) {
		if (m[1]) tokens.add(m[1].toLowerCase());
	}
	// 4. Backticked inline code tokens
	const codeMatches = text.matchAll(/`([^`\n]+)`/g);
	for (const m of codeMatches) {
		const raw = m[1]?.trim();
		if (raw && !raw.includes(" ") && raw.length >= 3) {
			tokens.add(raw);
		}
	}
	return tokens;
}

/** Normalize skill names to canonical lowercase kebab-case. */
export function normalizeSkillName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[_.]/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export interface RetireSkillOptions {
	scopeDir: string;
	scope: AdaptationScope;
	name: string;
	reason?: string;
	actor?: "model" | "learner" | "evaluator";
}

/**
 * Retire a skill by taking a snapshot, writing journal entry with action: "retire",
 * moving directory to archive/skills/<name>, and marking status: "retired" in ledger.
 */
export function retireSkill(options: RetireSkillOptions): boolean {
	const { scopeDir, scope, name, reason, actor = "learner" } = options;
	const skillsDir = path.join(scopeDir, "skills");
	const safeName = normalizeSkillName(name) || name;
	let targetDirName = safeName;
	let skillDir = path.join(skillsDir, targetDirName);
	let skillFile = path.join(skillDir, "SKILL.md");

	if (!fs.existsSync(skillFile)) {
		if (fs.existsSync(skillsDir)) {
			const found = fs.readdirSync(skillsDir).find((d) => normalizeSkillName(d) === safeName);
			if (found) {
				targetDirName = found;
				skillDir = path.join(skillsDir, targetDirName);
				skillFile = path.join(skillDir, "SKILL.md");
			}
		}
	}

	if (!fs.existsSync(skillFile)) {
		return false;
	}

	const currentRevision = getLatestRevision(scopeDir, "skill", targetDirName);
	const nextRevision = currentRevision + 1;
	const snapshotId = `rev-${nextRevision}-${crypto.randomUUID().slice(0, 8)}`;

	// 1. Save revision snapshot to history/
	const snapshotDir = path.join(scopeDir, "history", snapshotId);
	fs.mkdirSync(snapshotDir, { recursive: true });
	fs.copyFileSync(skillFile, path.join(snapshotDir, path.basename(skillFile)));

	// 2. Append journal entry
	const entry: JournalEntry = {
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		action: "retire",
		scope,
		kind: "skill",
		name: targetDirName,
		revision: nextRevision,
		previousRevision: currentRevision,
		reason: reason ?? `Retired skill ${targetDirName}`,
		snapshotId,
		actor,
	};
	appendJournal(scopeDir, entry);

	// 3. Move skill directory to archive/skills/<name>
	const archiveDir = path.join(scopeDir, "archive", "skills", targetDirName);
	fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
	if (fs.existsSync(archiveDir)) {
		fs.rmSync(archiveDir, { recursive: true, force: true });
	}
	try {
		fs.renameSync(skillDir, archiveDir);
	} catch {
		fs.cpSync(skillDir, archiveDir, { recursive: true });
		fs.rmSync(skillDir, { recursive: true, force: true });
	}

	// 4. Update outcome ledger: mark status as retired
	try {
		const ledger = getOutcomeLedger(scopeDir);
		const id = `${scope}:skill:${targetDirName}`;
		const perStats = { ...(ledger.perAdaptationStats ?? {}) };
		if (perStats[id]) {
			perStats[id] = {
				...perStats[id],
				status: "retired",
			};
		} else {
			perStats[id] = {
				appliedCount: 0,
				recurredCorrections: 0,
				status: "retired",
			};
		}
		updateOutcomeLedger(scopeDir, { perAdaptationStats: perStats });
	} catch {}

	return true;
}

/** Get all active learned skill directory names in a scope directory. */
export function getLearnedSkillNames(scopeDir: string): string[] {
	const skillsDir = path.join(scopeDir, "skills");
	if (!fs.existsSync(skillsDir)) return [];
	const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	const names: string[] = [];
	for (const e of entries) {
		if (e.isDirectory()) {
			const skillFile = path.join(skillsDir, e.name, "SKILL.md");
			if (fs.existsSync(skillFile)) {
				names.push(e.name);
			}
		}
	}
	return names;
}

export interface LearnedSkillSummary {
	name: string;
	description: string;
	helped?: number;
	hurt?: number;
	appliedCount?: number;
	lastOutcome?: string;
}

/** Get structured summary of active learned skills in a scope directory. */
export function getLearnedSkillsSummary(scopeDir: string, scope: AdaptationScope): LearnedSkillSummary[] {
	const skillsDir = path.join(scopeDir, "skills");
	if (!fs.existsSync(skillsDir)) return [];
	const ledger = getOutcomeLedger(scopeDir);
	const statsMap = ledger.perAdaptationStats ?? {};

	const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	const list: LearnedSkillSummary[] = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const skillFile = path.join(skillsDir, e.name, "SKILL.md");
		if (!fs.existsSync(skillFile)) continue;

		let description = "";
		try {
			const raw = fs.readFileSync(skillFile, "utf8");
			const fence = raw.startsWith("---\n") ? raw.indexOf("\n---", 4) : -1;
			if (fence !== -1) {
				const front = raw.slice(4, fence);
				const match = /^description\s*:\s*(.+)$/m.exec(front);
				if (match && match[1]) description = match[1].trim().replace(/^['"]|['"]$/g, "");
			}
			if (!description) {
				const body = fence === -1 ? raw : raw.slice(fence + 4);
				const firstLine = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
				if (firstLine) description = firstLine.slice(0, 160);
			}
		} catch {}

		const id = `${scope}:skill:${e.name}`;
		const stat = statsMap[id] ?? Object.entries(statsMap).find(([k]) => k.endsWith(`:skill:${e.name}`))?.[1];

		list.push({
			name: e.name,
			description: description || "Learned skill",
			helped: stat?.helped,
			hurt: stat?.hurt,
			appliedCount: stat?.appliedCount,
			lastOutcome: stat?.lastOutcome,
		});
	}
	return list;
}

/**
 * Select the lowest value learned skill in a scope for eviction.
 * Priority for eviction:
 * 1. Skills already marked "retired" in outcome ledger
 * 2. Skills with high hurt count (hurt >= 2 and hurt > helped)
 * 3. Lowest composite score: (helped * 2) - (hurt * 3) - (recurredCorrections * 2)
 * 4. Tie-breaker: oldest lastRunMs or oldest file mtimeMs (LRU)
 */
export function selectLowestValueSkill(scopeDir: string, scope: AdaptationScope): string | undefined {
	const skillsDir = path.join(scopeDir, "skills");
	if (!fs.existsSync(skillsDir)) return undefined;

	const skillNames = getLearnedSkillNames(scopeDir);
	if (skillNames.length === 0) return undefined;

	const ledger = getOutcomeLedger(scopeDir);
	const statsMap = ledger.perAdaptationStats ?? {};

	interface Candidate {
		name: string;
		isRetired: boolean;
		helped: number;
		hurt: number;
		corrections: number;
		lastRunMs: number;
		mtimeMs: number;
	}

	const candidates: Candidate[] = skillNames.map((name) => {
		const skillFile = path.join(skillsDir, name, "SKILL.md");
		let mtimeMs = 0;
		try {
			mtimeMs = fs.statSync(skillFile).mtimeMs;
		} catch {}

		const targetId = `${scope}:skill:${name}`;
		const stat = statsMap[targetId] ?? Object.entries(statsMap).find(([k]) => k.endsWith(`:skill:${name}`))?.[1];

		const isRetired = stat?.status === "retired";
		const helped = stat?.helped ?? 0;
		const hurt = stat?.hurt ?? 0;
		const corrections = stat?.recurredCorrections ?? 0;
		const lastRunMs = stat?.lastRunAt ? new Date(stat.lastRunAt).getTime() : 0;

		return {
			name,
			isRetired,
			helped,
			hurt,
			corrections,
			lastRunMs,
			mtimeMs,
		};
	});

	candidates.sort((a, b) => {
		if (a.isRetired && !b.isRetired) return -1;
		if (!a.isRetired && b.isRetired) return 1;

		const aNetNegative = a.hurt >= 2 && a.hurt > a.helped;
		const bNetNegative = b.hurt >= 2 && b.hurt > b.helped;
		if (aNetNegative && !bNetNegative) return -1;
		if (!aNetNegative && bNetNegative) return 1;

		const scoreA = a.helped * 2 - a.hurt * 3 - a.corrections * 2;
		const scoreB = b.helped * 2 - b.hurt * 3 - b.corrections * 2;
		if (scoreA !== scoreB) {
			return scoreA - scoreB;
		}

		const timeA = a.lastRunMs || a.mtimeMs;
		const timeB = b.lastRunMs || b.mtimeMs;
		return timeA - timeB;
	});

	return candidates[0]?.name;
}

/** Extract executable commands from markdown blocks and inline code. */
export function extractExecutableCommands(text: string): string[] {
	const commands: string[] = [];
	const fenceRegex = /```(?:bash|sh|zsh)?\r?\n([\s\S]*?)```/g;
	for (const match of text.matchAll(fenceRegex)) {
		const block = match[1] || "";
		for (const line of block.split("\n")) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//")) {
				commands.push(trimmed);
			}
		}
	}
	const inlineRegex = /`([^`\n]+)`/g;
	for (const match of text.matchAll(inlineRegex)) {
		const candidate = match[1]?.trim() || "";
		if (
			candidate.startsWith("node ") ||
			candidate.startsWith("npm ") ||
			candidate.startsWith("pnpm ") ||
			candidate.startsWith("yarn ") ||
			candidate.startsWith("bun ") ||
			candidate.startsWith("python ") ||
			candidate.startsWith("python3 ") ||
			candidate.startsWith("git ") ||
			candidate.startsWith("bash ") ||
			candidate.startsWith("sh ") ||
			candidate.includes(" && ") ||
			/^[A-Z0-9_]+=\S+\s+(?:node|npm|pnpm|yarn|bun|python|python3|git|sh|bash)/.test(candidate)
		) {
			commands.push(candidate);
		}
	}
	return commands;
}

/** Extract command core signature ignoring variable prefixes and dynamic nonces. */
export function commandBaseSignature(command: string): string {
	let stripped = command.replace(/^[A-Z0-9_]+=\S+\s+/, "").trim();
	stripped = stripped.replace(/--nonce\s+[a-zA-Z0-9_-]+/g, "--nonce <val>");
	return stripped.replace(/\s+/g, " ");
}

/** Check if two sets of commands overlap in their core execution target. */
export function hasCommandOverlap(commandsA: string[], commandsB: string[]): boolean {
	if (commandsA.length === 0 || commandsB.length === 0) return false;
	const sigsA = new Set(commandsA.map(commandBaseSignature));
	for (const b of commandsB) {
		const sigB = commandBaseSignature(b);
		if (sigsA.has(sigB)) return true;
		for (const sigA of sigsA) {
			const wordsA = sigA.split(/\s+/).slice(0, 3).join(" ");
			const wordsB = sigB.split(/\s+/).slice(0, 3).join(" ");
			if (wordsA.length >= 8 && wordsA === wordsB) return true;
		}
	}
	return false;
}

/** Migrate adaptation history entries in journal.jsonl and outcome-ledger.json to a new name. */
export function migrateAdaptationHistory(
	scopeDir: string,
	kind: AdaptationKind,
	oldName: string,
	newName: string,
): void {
	if (oldName === newName) return;

	// 1. Update journal.jsonl
	const journalPath = path.join(scopeDir, "journal.jsonl");
	if (fs.existsSync(journalPath)) {
		try {
			const lines = fs.readFileSync(journalPath, "utf8").split("\n");
			const updatedLines = lines.map((line) => {
				if (!line.trim()) return line;
				try {
					const entry = JSON.parse(line) as JournalEntry;
					if (entry.kind === kind && entry.name === oldName) {
						entry.name = newName;
						return JSON.stringify(entry);
					}
				} catch {}
				return line;
			});
			fs.writeFileSync(journalPath, updatedLines.join("\n"), "utf8");
		} catch {}
	}

	// 2. Update outcome-ledger.json
	const ledgerPath = path.join(scopeDir, "outcome-ledger.json");
	if (fs.existsSync(ledgerPath)) {
		try {
			const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as OutcomeLedger;
			const oldIdSuffix = `:${kind}:${oldName}`;
			const newIdSuffix = `:${kind}:${newName}`;

			if (Array.isArray(ledger.activeAdaptations)) {
				ledger.activeAdaptations = ledger.activeAdaptations.map((id) =>
					id.endsWith(oldIdSuffix) ? id.replace(oldIdSuffix, newIdSuffix) : id,
				);
				ledger.activeAdaptations = Array.from(new Set(ledger.activeAdaptations));
			}

			if (ledger.perAdaptationStats) {
				let oldKey: string | undefined;
				for (const k of Object.keys(ledger.perAdaptationStats)) {
					if (k.endsWith(oldIdSuffix)) {
						oldKey = k;
						break;
					}
				}
				if (oldKey) {
					const newKey = oldKey.replace(oldIdSuffix, newIdSuffix);
					const oldStats = ledger.perAdaptationStats[oldKey];
					const newStats = ledger.perAdaptationStats[newKey];
					if (oldStats && newStats) {
						ledger.perAdaptationStats[newKey] = {
							appliedCount: (newStats.appliedCount ?? 0) + (oldStats.appliedCount ?? 0),
							helped: (newStats.helped ?? 0) + (oldStats.helped ?? 0),
							hurt: (newStats.hurt ?? 0) + (oldStats.hurt ?? 0),
							recurredCorrections: (newStats.recurredCorrections ?? 0) + (oldStats.recurredCorrections ?? 0),
							lastOutcome: newStats.lastOutcome ?? oldStats.lastOutcome,
							status: newStats.status ?? oldStats.status,
						};
					} else if (oldStats) {
						ledger.perAdaptationStats[newKey] = oldStats;
					}
					delete ledger.perAdaptationStats[oldKey];
				}
			}
			fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
		} catch {}
	}
}

const STOP_WORDS = new Set([
	"user", "prefers", "prefer", "preferred", "preference", "always", "should", "must", "please",
	"output", "format", "with", "in", "the", "and", "or", "for", "to", "of", "a", "an", "is", "be",
	"using", "use", "when", "all", "response", "responses",
	"用户", "偏好", "主要", "使用", "进行", "交互", "沟通", "回复", "呈现", "采用", "优先", "总是",
	"需要", "要求", "方式", "风格", "展示", "保持", "输出", "回答", "每次", "以后", "请", "与", "而非", "而不是"
]);

export function extractSignificantTokens(statement: string): Set<string> {
	const tokens = new Set<string>();
	const cleaned = statement
		.toLowerCase()
		.replace(/[.,!?;:，。！？；：、"'`~()（）[\]【】{}/\\-_*#<>@$%^&+=|]+/g, " ");

	const words = cleaned.split(/\s+/).filter(Boolean);
	for (const w of words) {
		if (/^[a-z0-9]+$/.test(w)) {
			if (w.length >= 2 && !STOP_WORDS.has(w)) {
				tokens.add(w);
			}
		} else {
			let rest = w;
			for (const sw of STOP_WORDS) {
				if (rest.includes(sw)) {
					rest = rest.replaceAll(sw, " ");
				}
			}
			const cjkParts = rest.split(/\s+/).filter(Boolean);
			for (const part of cjkParts) {
				if (part.length >= 2) {
					tokens.add(part);
				} else if (part.length === 1 && !STOP_WORDS.has(part)) {
					tokens.add(part);
				}
			}
		}
	}
	return tokens;
}

export function areStatementsSimilar(statement1: string, statement2: string, dimension?: string): boolean {
	const s1 = statement1.trim().toLowerCase();
	const s2 = statement2.trim().toLowerCase();
	if (s1 === s2) return true;
	if (!s1 || !s2) return false;

	if (s1.length >= 6 && s2.includes(s1)) return true;
	if (s2.length >= 6 && s1.includes(s2)) return true;

	if (dimension === "communication") {
		if ((s1.includes("中文") || s1.includes("chinese")) && (s2.includes("中文") || s2.includes("chinese"))) return true;
		if ((s1.includes("英文") || s1.includes("english")) && (s2.includes("英文") || s2.includes("english"))) return true;
		if ((s1.includes("表格") || s1.includes("table")) && (s2.includes("表格") || s2.includes("table"))) return true;
	}

	const toks1 = extractSignificantTokens(statement1);
	const toks2 = extractSignificantTokens(statement2);
	if (toks1.size === 0 || toks2.size === 0) return false;

	let common = 0;
	for (const t of toks1) {
		if (toks2.has(t)) common++;
	}

	const minSize = Math.min(toks1.size, toks2.size);
	const unionSize = toks1.size + toks2.size - common;

	if (minSize > 0 && common / minSize >= 0.6) return true;
	if (unionSize > 0 && common / unionSize >= 0.5) return true;

	return false;
}

export function mergeUserTraits(oldTrait: any, newTrait: any): any {
	const combinedEvidence = Array.from(
		new Set([
			...(Array.isArray(oldTrait.evidence) ? oldTrait.evidence : []),
			...(Array.isArray(newTrait.evidence) ? newTrait.evidence : []),
		]),
	);
	const userStated = Boolean(oldTrait.userStated || newTrait.userStated);

	let statement = oldTrait.statement;
	if (newTrait.userStated && !oldTrait.userStated) {
		statement = newTrait.statement;
	} else if (!oldTrait.userStated && typeof newTrait.statement === "string") {
		if (newTrait.statement.length > oldTrait.statement.length && newTrait.statement.length <= 200) {
			statement = newTrait.statement;
		}
	}

	return {
		...oldTrait,
		...newTrait,
		statement,
		userStated,
		evidence: combinedEvidence,
		confidence: Math.max(oldTrait.confidence ?? 0, newTrait.confidence ?? 0),
		lastConfirmed: newTrait.lastConfirmed || new Date().toISOString(),
		status: (oldTrait.status === "active" || newTrait.status === "active") ? "active" : (newTrait.status ?? oldTrait.status),
	};
}

export function normalizeTriggerPattern(pattern: string): string {
	return pattern
		.trim()
		.toLowerCase()
		.replace(/[.,!?;:，。！？；：、"'`~()（）[\]【】{}/\\-_*#<>@$%^&+=|]+/g, " ")
		.replace(/\s+/g, " ");
}

export function areGuidelinesSimilar(g1: any, g2: any): boolean {
	const text1 = typeof g1 === "string" ? g1.trim() : (g1?.text?.trim() ?? "");
	const text2 = typeof g2 === "string" ? g2.trim() : (g2?.text?.trim() ?? "");
	if (!text1 || !text2) return false;

	if (text1 === text2) return true;

	const id1 = typeof g1 === "object" ? g1?.id : undefined;
	const id2 = typeof g2 === "object" ? g2?.id : undefined;
	if (id1 && id2 && id1 === id2) return true;

	const getTriggerObj = (g: any) => (typeof g === "object" && g !== null && typeof g.trigger === "object" ? g.trigger : undefined);
	const t1 = getTriggerObj(g1);
	const t2 = getTriggerObj(g2);

	if (t1 && t2) {
		if (t1.regex && t2.regex && t1.regex.trim() === t2.regex.trim()) return true;
		if (t1.keyword && t2.keyword && t1.keyword.trim().toLowerCase() === t2.keyword.trim().toLowerCase()) return true;
		if (t1.command && t2.command && commandBaseSignature(t1.command) === commandBaseSignature(t2.command)) return true;
	}

	return areStatementsSimilar(text1, text2);
}

export function normalizeRoleName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[_.]/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function normalizeProposalName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[_.]/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/** Consolidate duplicate or near-identical adaptations across skills, architecture, profiles, roles, and proposals. */
export function consolidateDuplicateAdaptations(scopeDir: string): {
	mergedSkills: number;
	cleanedGuidelines: number;
	mergedTraits: number;
	mergedRoles: number;
	mergedProposals: number;
} {
	let mergedSkills = 0;
	let cleanedGuidelines = 0;
	let mergedTraits = 0;
	let mergedRoles = 0;
	let mergedProposals = 0;

	if (!fs.existsSync(scopeDir)) {
		return { mergedSkills, cleanedGuidelines, mergedTraits, mergedRoles, mergedProposals };
	}

	const skillsDir = path.join(scopeDir, "skills");
	const allSkillCommands: string[] = [];

	if (fs.existsSync(skillsDir)) {
		const dirs = fs.readdirSync(skillsDir);
		const skillGroups = new Map<string, string[]>();

		for (const dir of dirs) {
			const skillFile = path.join(skillsDir, dir, "SKILL.md");
			if (!fs.existsSync(skillFile)) continue;

			const canonName = normalizeSkillName(dir) || dir;
			let foundGroup = false;

			for (const [groupCanon, groupDirs] of skillGroups.entries()) {
				if (groupCanon === canonName) {
					groupDirs.push(dir);
					foundGroup = true;
					break;
				}
				try {
					const content1 = fs.readFileSync(skillFile, "utf8");
					const cmds1 = extractExecutableCommands(content1);
					const sampleFile = path.join(skillsDir, groupDirs[0]!, "SKILL.md");
					const content2 = fs.readFileSync(sampleFile, "utf8");
					const cmds2 = extractExecutableCommands(content2);
					if (hasCommandOverlap(cmds1, cmds2)) {
						groupDirs.push(dir);
						foundGroup = true;
						break;
					}
				} catch {}
			}

			if (!foundGroup) {
				skillGroups.set(canonName, [dir]);
			}
		}

		for (const [canonName, groupDirs] of skillGroups.entries()) {
			if (groupDirs.length > 1) {
				let bestContent = "";
				let bestScore = -1;

				for (const d of groupDirs) {
					const f = path.join(skillsDir, d, "SKILL.md");
					const content = fs.readFileSync(f, "utf8");
					const tokens = extractCommandFlagsAndTokens(content);
					const rev = getLatestRevision(scopeDir, "skill", d);
					const score = tokens.size * 10 + rev * 2 + content.length / 100;
					if (score > bestScore) {
						bestScore = score;
						bestContent = content;
					}
				}

				const targetSkillDir = path.join(skillsDir, canonName);
				fs.mkdirSync(targetSkillDir, { recursive: true });
				const finalSkillDoc = ensureSkillDocument(canonName, bestContent);
				fs.writeFileSync(path.join(targetSkillDir, "SKILL.md"), finalSkillDoc, "utf8");

				for (const d of groupDirs) {
					if (d !== canonName) {
						fs.rmSync(path.join(skillsDir, d), { recursive: true, force: true });
						migrateAdaptationHistory(scopeDir, "skill", d, canonName);
						mergedSkills++;
					}
				}
			}

			const targetFile = path.join(skillsDir, canonName, "SKILL.md");
			if (fs.existsSync(targetFile)) {
				try {
					allSkillCommands.push(...extractExecutableCommands(fs.readFileSync(targetFile, "utf8")));
				} catch {}
			}
		}
	}

	const archPath = path.join(scopeDir, "architecture.json");
	if (fs.existsSync(archPath)) {
		try {
			const arch = JSON.parse(fs.readFileSync(archPath, "utf8"));
			if (Array.isArray(arch.customGuidelines) && arch.customGuidelines.length > 0) {
				const originalLen = arch.customGuidelines.length;
				const filtered = arch.customGuidelines.filter((g: any) => {
					const gText = typeof g === "string" ? g : (g.text || "");
					const gCmds = extractExecutableCommands(gText);
					if (gCmds.length > 0 && hasCommandOverlap(gCmds, allSkillCommands)) {
						return false;
					}
					return true;
				});

				// Internal deduplication of architecture guidelines
				const dedupedGuidelines: any[] = [];
				for (const g of filtered) {
					const dupIdx = dedupedGuidelines.findIndex((existing) => areGuidelinesSimilar(existing, g));
					if (dupIdx !== -1) {
						if (typeof g === "object" && g.id && !dedupedGuidelines[dupIdx].id) {
							dedupedGuidelines[dupIdx] = g;
						}
					} else {
						dedupedGuidelines.push(g);
					}
				}
				arch.customGuidelines = dedupedGuidelines;

				if (arch.customGuidelines.length !== originalLen) {
					cleanedGuidelines += (originalLen - arch.customGuidelines.length);
					const hasTools = (Array.isArray(arch.hiddenTools) && arch.hiddenTools.length > 0) || (Array.isArray(arch.preferredTools) && arch.preferredTools.length > 0);
					if (arch.customGuidelines.length === 0 && !hasTools) {
						try { fs.unlinkSync(archPath); } catch {}
					} else {
						fs.writeFileSync(archPath, JSON.stringify(arch, null, 2), "utf8");
					}
				}
			}
		} catch {}
	}

	// 3. Profile (profile.json)
	const profilePath = path.join(scopeDir, "profile.json");
	if (fs.existsSync(profilePath)) {
		try {
			const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
			let profileChanged = false;
			if (Array.isArray(profile.traits) && profile.traits.length > 1) {
				const originalTraitsCount = profile.traits.length;
				const consolidatedTraits: any[] = [];
				for (const trait of profile.traits) {
					if (!trait || typeof trait.statement !== "string") continue;
					const matchIdx = consolidatedTraits.findIndex(
						(t) => t.dimension === trait.dimension && areStatementsSimilar(t.statement, trait.statement, t.dimension),
					);
					if (matchIdx !== -1) {
						consolidatedTraits[matchIdx] = mergeUserTraits(consolidatedTraits[matchIdx], trait);
					} else {
						consolidatedTraits.push(trait);
					}
				}
				if (consolidatedTraits.length !== originalTraitsCount) {
					mergedTraits += (originalTraitsCount - consolidatedTraits.length);
					profile.traits = consolidatedTraits;
					profileChanged = true;
				}
			}

			if (Array.isArray(profile.followUpPredictions) && profile.followUpPredictions.length > 1) {
				const originalPredsCount = profile.followUpPredictions.length;
				const consolidatedPreds: any[] = [];
				for (const pred of profile.followUpPredictions) {
					if (!pred || typeof pred.triggerPattern !== "string") continue;
					const norm = normalizeTriggerPattern(pred.triggerPattern);
					const matchIdx = consolidatedPreds.findIndex(
						(p) => typeof p.triggerPattern === "string" && normalizeTriggerPattern(p.triggerPattern) === norm,
					);
					if (matchIdx !== -1) {
						const old = consolidatedPreds[matchIdx];
						consolidatedPreds[matchIdx] = {
							...old,
							...pred,
							supportCount: Math.max(old.supportCount ?? 0, pred.supportCount ?? 0) + 1,
							confidence: Math.max(old.confidence ?? 0, pred.confidence ?? 0),
						};
					} else {
						consolidatedPreds.push(pred);
					}
				}
				if (consolidatedPreds.length !== originalPredsCount) {
					profile.followUpPredictions = consolidatedPreds;
					profileChanged = true;
				}
			}

			if (profileChanged) {
				fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");
			}
		} catch {}
	}

	// 4. Roles (roles/)
	const rolesDir = path.join(scopeDir, "roles");
	if (fs.existsSync(rolesDir)) {
		const files = fs.readdirSync(rolesDir).filter((f) => f.endsWith(".md"));
		const roleGroups = new Map<string, string[]>();
		for (const f of files) {
			const baseName = f.replace(/\.md$/, "");
			const canon = normalizeRoleName(baseName) || baseName;
			if (!roleGroups.has(canon)) roleGroups.set(canon, []);
			roleGroups.get(canon)!.push(baseName);
		}
		for (const [canon, group] of roleGroups.entries()) {
			if (group.length > 1) {
				let bestContent = "";
				let bestScore = -1;
				for (const name of group) {
					const f = path.join(rolesDir, `${name}.md`);
					try {
						const content = fs.readFileSync(f, "utf8");
						const rev = getLatestRevision(scopeDir, "role", name);
						const score = rev * 10 + content.length;
						if (score > bestScore) {
							bestScore = score;
							bestContent = content;
						}
					} catch {}
				}
				const targetFile = path.join(rolesDir, `${canon}.md`);
				fs.writeFileSync(targetFile, bestContent, "utf8");
				for (const name of group) {
					if (name !== canon) {
						try { fs.unlinkSync(path.join(rolesDir, `${name}.md`)); } catch {}
						migrateAdaptationHistory(scopeDir, "role", name, canon);
						mergedRoles++;
					}
				}
			}
		}
	}

	// 5. Workflow Proposals (workflow-proposals/)
	const propDir = path.join(scopeDir, "workflow-proposals");
	if (fs.existsSync(propDir)) {
		const files = fs.readdirSync(propDir).filter((f) => f.endsWith(".json"));
		const propGroups = new Map<string, string[]>();
		for (const f of files) {
			const baseName = f.replace(/\.json$/, "");
			const canon = normalizeProposalName(baseName) || baseName;
			if (!propGroups.has(canon)) propGroups.set(canon, []);
			propGroups.get(canon)!.push(baseName);
		}
		for (const [canon, group] of propGroups.entries()) {
			if (group.length > 1) {
				let bestContent = "";
				let bestScore = -1;
				for (const name of group) {
					const f = path.join(propDir, `${name}.json`);
					try {
						const content = fs.readFileSync(f, "utf8");
						const rev = getLatestRevision(scopeDir, "proposal", name);
						const score = rev * 10 + content.length;
						if (score > bestScore) {
							bestScore = score;
							bestContent = content;
						}
					} catch {}
				}
				const targetFile = path.join(propDir, `${canon}.json`);
				fs.writeFileSync(targetFile, bestContent, "utf8");
				for (const name of group) {
					if (name !== canon) {
						try { fs.unlinkSync(path.join(propDir, `${name}.json`)); } catch {}
						migrateAdaptationHistory(scopeDir, "proposal", name, canon);
						mergedProposals++;
					}
				}
			}
		}
	}

	return { mergedSkills, cleanedGuidelines, mergedTraits, mergedRoles, mergedProposals };
}

/** Write an adaptation file with full validation, snapshotting, and journal tracking. */
export async function writeAdaptation(options: WriteAdaptationOptions): Promise<{ revision: number; filePath: string }> {
	const { agentDir, cwd, scope, kind, name, content, expectedRevision, reason } = options;
	const projectTrusted = options.projectTrusted ?? true;

	// 0. Boundary guard: Autonomous learner only writes soft layer
	if (options.actor === "learner" && (kind === "workflow" || kind === "hook" || kind === "tool")) {
		throw new Error(`Learner cannot autonomously write ${kind} adaptations.`);
	}

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

	const scopeDir = getScopeDir(agentDir, cwd, scope);

	let targetName = name;
	if (kind === "profile") {
		const profileJsonPath = path.join(scopeDir, "profile.json");
		const hasExistingJson = fs.existsSync(profileJsonPath);
		const isJsonContent = content.trim().startsWith("{");
		if (isJsonContent || hasExistingJson || name === "json") {
			targetName = "json";
		}
	} else if (kind === "skill") {
		const safeName = name ? normalizeSkillName(name) : "learned-skill";
		targetName = name || safeName;
		const skillsDir = path.join(scopeDir, "skills");
		if (fs.existsSync(skillsDir)) {
			const existingDirs = fs.readdirSync(skillsDir);
			let matchedExistingDir: string | undefined;

			// 1. Direct normalized match
			for (const dir of existingDirs) {
				if (normalizeSkillName(dir) === safeName) {
					matchedExistingDir = dir;
					break;
				}
			}

			// 2. Command overlap match
			if (!matchedExistingDir) {
				const incomingCommands = extractExecutableCommands(content);
				if (incomingCommands.length > 0) {
					for (const dir of existingDirs) {
						const skillFile = path.join(skillsDir, dir, "SKILL.md");
						if (fs.existsSync(skillFile)) {
							try {
								const existingContent = fs.readFileSync(skillFile, "utf8");
								const existingCommands = extractExecutableCommands(existingContent);
								if (hasCommandOverlap(incomingCommands, existingCommands)) {
									matchedExistingDir = dir;
									break;
								}
							} catch {}
						}
					}
				}
			}

			if (matchedExistingDir) {
				targetName = matchedExistingDir;
			}
		}
	} else if (kind === "role") {
		const safeName = name ? normalizeRoleName(name) : "custom-role";
		targetName = name || safeName;
		const rolesDir = path.join(scopeDir, "roles");
		if (fs.existsSync(rolesDir)) {
			const existingFiles = fs.readdirSync(rolesDir).filter((f) => f.endsWith(".md"));
			for (const file of existingFiles) {
				const baseName = file.replace(/\.md$/, "");
				if (normalizeRoleName(baseName) === safeName) {
					targetName = baseName;
					break;
				}
			}
		}
	} else if (kind === "proposal") {
		const safeName = name ? normalizeProposalName(name) : "workflow-proposal";
		targetName = name || safeName;
		const propDir = path.join(scopeDir, "workflow-proposals");
		if (fs.existsSync(propDir)) {
			const existingFiles = fs.readdirSync(propDir).filter((f) => f.endsWith(".json"));
			let matchedFile: string | undefined;

			// 1. Direct normalized match
			for (const file of existingFiles) {
				const baseName = file.replace(/\.json$/, "");
				if (normalizeProposalName(baseName) === safeName) {
					matchedFile = baseName;
					break;
				}
			}

			// 2. ExtraChecks command or id match
			if (!matchedFile) {
				try {
					const incomingProp = JSON.parse(content);
					const incomingCmd = incomingProp.command || incomingProp.extraChecks?.[0]?.command;
					const incomingId = incomingProp.id || incomingProp.extraChecks?.[0]?.id;

					if (incomingCmd || incomingId) {
						for (const file of existingFiles) {
							const existingPath = path.join(propDir, file);
							try {
								const existingProp = JSON.parse(fs.readFileSync(existingPath, "utf8"));
								const existingCmd = existingProp.command || existingProp.extraChecks?.[0]?.command;
								const existingId = existingProp.id || existingProp.extraChecks?.[0]?.id;

								if (
									(incomingId && existingId && incomingId === existingId) ||
									(incomingCmd && existingCmd && commandBaseSignature(incomingCmd) === commandBaseSignature(existingCmd))
								) {
									matchedFile = file.replace(/\.json$/, "");
									break;
								}
							} catch {}
						}
					}
				} catch {}
			}

			if (matchedFile) {
				targetName = matchedFile;
			}
		}
	}

	// Path resolution & traversal check
	const relPath = getRelativeArtifactPath(kind, targetName);
	const fullPath = path.join(scopeDir, relPath);
	assertNoPathTraversal(scopeDir, fullPath);

	let finalContent = content;

	if (kind === "skill") {
		finalContent = ensureSkillDocument(targetName ?? "learned-skill", content);
		if (fs.existsSync(fullPath)) {
			let existingSkillContent = "";
			try {
				existingSkillContent = fs.readFileSync(fullPath, "utf8");
			} catch {}
			if (existingSkillContent && finalContent.trim().length < existingSkillContent.trim().length) {
				const existingTokens = extractCommandFlagsAndTokens(existingSkillContent);
				const droppedTokens: string[] = [];
				for (const token of existingTokens) {
					if (token === "nonce" || token === "token" || token === "stamp") {
						if (!finalContent.toLowerCase().includes(token)) {
							droppedTokens.push(token);
						}
					} else {
						if (!finalContent.includes(token)) {
							droppedTokens.push(token);
						}
					}
				}
				if (droppedTokens.length > 0) {
					const reasonMsg = `Rejected skill write: new content is shorter and drops command flag/token(s): ${droppedTokens.join(", ")}`;
					const currentRevision = getLatestRevision(scopeDir, kind, targetName);
					appendJournal(scopeDir, {
						id: crypto.randomUUID(),
						timestamp: new Date().toISOString(),
						action: "reject",
						scope,
						kind,
						name: targetName,
						revision: currentRevision,
						reason: reasonMsg,
						actor: options.actor ?? "model",
					});
					throw new AdaptationValidationError(reasonMsg);
				}
			}
		}
		assertMainWorkflowInvariance(finalContent);
	} else if (kind === "architecture") {
		const parsed = JSON.parse(finalContent);
		validateArchitectureAdaptation(parsed);

		// Operational command workflows belong in skills, not architecture guidelines
		if (Array.isArray(parsed.customGuidelines)) {
			const skillsDir = path.join(scopeDir, "skills");
			let existingSkillCommands: string[] = [];
			if (fs.existsSync(skillsDir)) {
				for (const dir of fs.readdirSync(skillsDir)) {
					const sFile = path.join(skillsDir, dir, "SKILL.md");
					if (fs.existsSync(sFile)) {
						try {
							const sContent = fs.readFileSync(sFile, "utf8");
							existingSkillCommands.push(...extractExecutableCommands(sContent));
						} catch {}
					}
				}
			}

			parsed.customGuidelines = parsed.customGuidelines.filter((g: any) => {
				const gText = typeof g === "string" ? g : (g.text || "");
				const gCommands = extractExecutableCommands(gText);
				if (gCommands.length > 0 && hasCommandOverlap(gCommands, existingSkillCommands)) {
					return false;
				}
				if (options.actor === "learner" && gCommands.length > 0 && /node\s+\S+\.(?:mjs|js|ts)|publish|build|deploy/.test(gText)) {
					return false;
				}
				return true;
			});
		}

		// Ensure guidelines have stable short id if object
		if (Array.isArray(parsed.customGuidelines)) {
			parsed.customGuidelines = parsed.customGuidelines.map((g: any) => {
				if (typeof g === "object" && g !== null) {
					const text = g.text.trim();
					const id = g.id || crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
					return { ...g, id };
				}
				return g;
			});
		}

		let existingArch: any = null;
		if (fs.existsSync(fullPath)) {
			try {
				existingArch = JSON.parse(fs.readFileSync(fullPath, "utf8"));
			} catch {}
		}

		if (existingArch) {
			const getText = (item: any) => (typeof item === "string" ? item.trim() : item?.text?.trim() ?? "");
			const getTriggerStr = (item: any) => {
				const tr = item?.trigger;
				if (!tr || typeof tr !== "object") return "";
				return tr.regex || tr.keyword || tr.command || "";
			};
			const mergedGuidelines = [...(existingArch.customGuidelines ?? [])];

			for (const incomingGuideline of parsed.customGuidelines ?? []) {
				const inText = getText(incomingGuideline);
				const inTrigger = getTriggerStr(incomingGuideline);
				const inId = incomingGuideline.id;

				const existingIdx = mergedGuidelines.findIndex((item) => {
					if (inId && item.id && inId === item.id) return true;
					if (getText(item) === inText) return true;
					if (inTrigger && getTriggerStr(item) === inTrigger) return true;
					if (areGuidelinesSimilar(item, incomingGuideline)) return true;
					return false;
				});

				if (existingIdx !== -1) {
					const existingItem = mergedGuidelines[existingIdx];
					const existingId = typeof existingItem === "object" ? existingItem.id : undefined;
					const finalId = existingId || inId;
					const updated = typeof incomingGuideline === "object" && incomingGuideline !== null
						? { ...incomingGuideline, ...(finalId ? { id: finalId } : {}) }
						: incomingGuideline;
					mergedGuidelines[existingIdx] = updated;
				} else {
					mergedGuidelines.push(incomingGuideline);
				}
			}

			// Internal deduplication of mergedGuidelines
			const dedupedGuidelines: any[] = [];
			for (const g of mergedGuidelines) {
				const dupIdx = dedupedGuidelines.findIndex((existing) => areGuidelinesSimilar(existing, g));
				if (dupIdx !== -1) {
					const ex = dedupedGuidelines[dupIdx];
					const exId = typeof ex === "object" ? ex.id : undefined;
					const gId = typeof g === "object" ? g.id : undefined;
					const finalId = exId || gId;
					dedupedGuidelines[dupIdx] = typeof g === "object" ? { ...g, ...(finalId ? { id: finalId } : {}) } : g;
				} else {
					dedupedGuidelines.push(g);
				}
			}

			const mergedHiddenTools = parsed.hiddenTools !== undefined ? parsed.hiddenTools : existingArch.hiddenTools;
			const mergedPreferredTools = parsed.preferredTools !== undefined ? parsed.preferredTools : existingArch.preferredTools;

			const mergedArch = {
				...(mergedHiddenTools !== undefined ? { hiddenTools: mergedHiddenTools } : {}),
				customGuidelines: dedupedGuidelines,
				...(mergedPreferredTools !== undefined ? { preferredTools: mergedPreferredTools } : {}),
			};
			finalContent = JSON.stringify(mergedArch, null, 2);
		} else {
			if (Array.isArray(parsed.customGuidelines)) {
				const dedupedGuidelines: any[] = [];
				for (const g of parsed.customGuidelines) {
					const dupIdx = dedupedGuidelines.findIndex((existing) => areGuidelinesSimilar(existing, g));
					if (dupIdx === -1) {
						dedupedGuidelines.push(g);
					}
				}
				parsed.customGuidelines = dedupedGuidelines;
			}
			finalContent = JSON.stringify(parsed, null, 2);
		}

		for (const g of (JSON.parse(finalContent).customGuidelines ?? [])) {
			assertMainWorkflowInvariance(typeof g === "string" ? g : g.text);
		}
	} else if (kind === "profile") {
		if (targetName === "json") {
			const normalized = normalizeProfileContent(content);
			let incomingData: any;
			try {
				incomingData = JSON.parse(normalized);
			} catch {
				incomingData = { version: 2, traits: [], followUpPredictions: [], updatedAt: new Date().toISOString() };
			}

			let existingData: any = null;
			if (fs.existsSync(fullPath)) {
				try {
					existingData = JSON.parse(fs.readFileSync(fullPath, "utf8"));
				} catch {}
			}

			if (existingData && Array.isArray(existingData.traits)) {
				const mergedTraits = [...existingData.traits];
				for (const newTrait of incomingData.traits ?? []) {
					if (!newTrait || typeof newTrait.statement !== "string") continue;
					const existingIndex = mergedTraits.findIndex(
						(t: any) =>
							typeof t?.statement === "string" &&
							t.dimension === newTrait.dimension &&
							areStatementsSimilar(t.statement, newTrait.statement, t.dimension),
					);
					if (existingIndex !== -1) {
						mergedTraits[existingIndex] = mergeUserTraits(mergedTraits[existingIndex]!, newTrait);
					} else {
						mergedTraits.push(newTrait);
					}
				}

				const mergedPredictions = [...(existingData.followUpPredictions ?? [])];
				for (const newPred of incomingData.followUpPredictions ?? []) {
					if (!newPred || typeof newPred.triggerPattern !== "string") continue;
					const normIn = normalizeTriggerPattern(newPred.triggerPattern);
					const predIdx = mergedPredictions.findIndex(
						(p: any) => typeof p?.triggerPattern === "string" && normalizeTriggerPattern(p.triggerPattern) === normIn,
					);
					if (predIdx !== -1) {
						const old = mergedPredictions[predIdx];
						mergedPredictions[predIdx] = {
							...old,
							...newPred,
							supportCount: Math.max(old.supportCount ?? 0, newPred.supportCount ?? 0) + 1,
							confidence: Math.max(old.confidence ?? 0, newPred.confidence ?? 0),
							lastTriggered: newPred.lastTriggered || new Date().toISOString(),
							prediction: newPred.prediction || old.prediction,
						};
					} else {
						mergedPredictions.push(newPred);
					}
				}

				finalContent = JSON.stringify(
					{
						version: 2,
						traits: mergedTraits,
						followUpPredictions: mergedPredictions,
						updatedAt: new Date().toISOString(),
					},
					null,
					2,
				);
			} else {
				if (Array.isArray(incomingData.traits)) {
					const dedupedTraits: any[] = [];
					for (const trait of incomingData.traits) {
						if (!trait || typeof trait.statement !== "string") continue;
						const matchIdx = dedupedTraits.findIndex(
							(t) => t.dimension === trait.dimension && areStatementsSimilar(t.statement, trait.statement, t.dimension),
						);
						if (matchIdx !== -1) {
							dedupedTraits[matchIdx] = mergeUserTraits(dedupedTraits[matchIdx], trait);
						} else {
							dedupedTraits.push(trait);
						}
					}
					incomingData.traits = dedupedTraits;
				}
				finalContent = JSON.stringify(incomingData, null, 2);
			}
		}
		assertMainWorkflowInvariance(finalContent);
	} else if (kind === "workflow") {
		const parsed = JSON.parse(finalContent);
		validateWorkflowAdaptation(parsed);

		let existingWf: any = null;
		if (fs.existsSync(fullPath)) {
			try {
				existingWf = JSON.parse(fs.readFileSync(fullPath, "utf8"));
			} catch {}
		}

		if (existingWf) {
			const mergedChecks = [...(existingWf.extraChecks ?? [])];
			for (const inCheck of parsed.extraChecks ?? []) {
				const inCmdSig = inCheck.command ? commandBaseSignature(inCheck.command) : "";
				const existingIdx = mergedChecks.findIndex((c: any) => {
					if (c.id === inCheck.id) return true;
					if (inCmdSig && c.command && commandBaseSignature(c.command) === inCmdSig) return true;
					return false;
				});
				if (existingIdx !== -1) {
					mergedChecks[existingIdx] = { ...mergedChecks[existingIdx], ...inCheck };
				} else {
					mergedChecks.push(inCheck);
				}
			}

			const dedupeStrings = (arr1?: string[], arr2?: string[]) => {
				const seen = new Set<string>();
				const res: string[] = [];
				for (const item of [...(arr1 ?? []), ...(arr2 ?? [])]) {
					if (typeof item !== "string") continue;
					const trimmed = item.trim();
					if (trimmed && !seen.has(trimmed.toLowerCase())) {
						seen.add(trimmed.toLowerCase());
						res.push(trimmed);
					}
				}
				return res.length > 0 ? res : undefined;
			};

			const merged = {
				...existingWf,
				...parsed,
				extraChecks: mergedChecks.length > 0 ? mergedChecks : undefined,
				routeBias: { ...(existingWf.routeBias ?? {}), ...(parsed.routeBias ?? {}) },
				verificationCommands: dedupeStrings(existingWf.verificationCommands, parsed.verificationCommands),
				userAddenda: dedupeStrings(existingWf.userAddenda, parsed.userAddenda),
				doneCriteria: dedupeStrings(existingWf.doneCriteria, parsed.doneCriteria),
			};
			finalContent = JSON.stringify(merged, null, 2);
		} else {
			if (Array.isArray(parsed.extraChecks)) {
				const seenCmds = new Set<string>();
				const seenIds = new Set<string>();
				parsed.extraChecks = parsed.extraChecks.filter((c: any) => {
					if (seenIds.has(c.id)) return false;
					seenIds.add(c.id);
					if (c.command) {
						const sig = commandBaseSignature(c.command);
						if (seenCmds.has(sig)) return false;
						seenCmds.add(sig);
					}
					return true;
				});
			}
			const dedupeUnique = (arr?: string[]) => {
				if (!Array.isArray(arr)) return arr;
				const seen = new Set<string>();
				return arr.filter((s) => {
					if (typeof s !== "string") return false;
					const t = s.trim().toLowerCase();
					if (!t || seen.has(t)) return false;
					seen.add(t);
					return true;
				});
			};
			parsed.verificationCommands = dedupeUnique(parsed.verificationCommands);
			parsed.userAddenda = dedupeUnique(parsed.userAddenda);
			parsed.doneCriteria = dedupeUnique(parsed.doneCriteria);
			finalContent = JSON.stringify(parsed, null, 2);
		}
		assertMainWorkflowInvariance(finalContent);
	} else {
		assertMainWorkflowInvariance(finalContent);
	}

	// Schema and content size validation
	const byteLength = Buffer.byteLength(finalContent, "utf8");
	assertSizeLimit(kind, byteLength);

	// 5. Optimistic locking
	const currentRevision = getLatestRevision(scopeDir, kind, targetName);
	if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
		throw new RevisionConflictError(
			`Revision conflict for ${kind}${targetName ? `/${targetName}` : ""}: expected ${expectedRevision}, current is ${currentRevision}`,
		);
	}

	const nextRevision = currentRevision + 1;
	const snapshotId = `rev-${nextRevision}-${crypto.randomUUID().slice(0, 8)}`;

	// 5b. Skill capacity enforcement & model-specified replacement
	if (kind === "skill") {
		const isNewSkill = !fs.existsSync(fullPath);
		if (isNewSkill) {
			// Retire explicit replacement if specified
			if (options.replaces && options.replaces.trim()) {
				retireSkill({
					scopeDir,
					scope,
					name: options.replaces.trim(),
					reason: `Replaced by ${targetName}: ${reason ?? "new skill created"}`,
					actor: options.actor ?? "learner",
				});
			}

			// If still at or over capacity, auto-evict lowest value skill
			const maxSkills = options.maxLearnedSkills ?? DEFAULT_MAX_LEARNED_SKILLS;
			const currentSkills = getLearnedSkillNames(scopeDir);
			if (currentSkills.length >= maxSkills) {
				const victim = selectLowestValueSkill(scopeDir, scope);
				if (victim && victim !== targetName) {
					retireSkill({
						scopeDir,
						scope,
						name: victim,
						reason: `Auto-evicted to stay within ${maxSkills} skills limit for new skill ${targetName}`,
						actor: options.actor ?? "learner",
					});
				}
			}
		}
	}

	// 6. Write new content
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, finalContent, "utf8");

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
		name: targetName,
		revision: nextRevision,
		previousRevision: currentRevision,
		reason: reason ?? "applied adaptation",
		snapshotId,
		actor: options.actor ?? "model",
		trial: options.trial ?? (kind === "tool" || kind === "hook" ? true : undefined),
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
	actor?: "model" | "learner" | "evaluator";
}

/** Roll back an adaptation to a previous revision. */
export async function rollbackAdaptation(options: RollbackOptions): Promise<{ success: boolean; revision: number }> {
	const { agentDir, cwd, scope, kind, name, reason } = options;
	const projectTrusted = options.projectTrusted ?? true;

	assertProjectTrusted(projectTrusted, scope);
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	let relPath = getRelativeArtifactPath(kind, name);
	let fullPath = path.join(scopeDir, relPath);
	if (kind === "profile" && !fs.existsSync(fullPath) && fs.existsSync(path.join(scopeDir, "profile.md"))) {
		relPath = "profile.md";
		fullPath = path.join(scopeDir, relPath);
	}
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
		if (kind === "profile" && fs.existsSync(path.join(scopeDir, "profile.md"))) {
			fs.unlinkSync(path.join(scopeDir, "profile.md"));
		}
	} else {
		// Restore from snapshot
		const targetEntry = entries.find((e) => e.revision === targetRev);
		if (!targetEntry || !targetEntry.snapshotId) {
			throw new Error(`Cannot rollback: snapshot for revision ${targetRev} not found`);
		}
		const snapshotDir = path.join(scopeDir, "history", targetEntry.snapshotId);
		let snapshotFile = path.join(snapshotDir, path.basename(fullPath));
		if (!fs.existsSync(snapshotFile) && fs.existsSync(snapshotDir)) {
			const files = fs.readdirSync(snapshotDir);
			if (files.length > 0) {
				snapshotFile = path.join(snapshotDir, files[0]);
			}
		}
		if (!fs.existsSync(snapshotFile)) {
			throw new Error(`Snapshot file missing at ${snapshotFile}`);
		}
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
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
		actor: options.actor ?? "model",
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
		consolidateDuplicateAdaptations(scopeDir);
		const ledger = getOutcomeLedger(scopeDir);
		const getStats = (id: string) => ledger.perAdaptationStats?.[id];
		const journalEntries = readJournal(scopeDir);
		const getLatestJournal = (kind: AdaptationKind, name?: string) => {
			for (let i = journalEntries.length - 1; i >= 0; i--) {
				const e = journalEntries[i];
				if (e.kind === kind && e.name === name) {
					return e;
				}
			}
			return undefined;
		};
		const getTrial = (kind: AdaptationKind, name?: string) => {
			return getLatestJournal(kind, name)?.trial;
		};

		// 1. Profile
		const profileJsonPath = path.join(scopeDir, "profile.json");
		const profileMdPath = path.join(scopeDir, "profile.md");
		const profilePath = fs.existsSync(profileJsonPath) ? profileJsonPath : fs.existsSync(profileMdPath) ? profileMdPath : null;
		if (profilePath) {
			const stat = fs.statSync(profilePath);
			const id = `${scope}:profile`;
			const stats = getStats(id);
			const journal = getLatestJournal("profile");
			let description: string | undefined;
			try {
				const content = fs.readFileSync(profilePath, "utf8");
				if (profilePath.endsWith(".json")) {
					const json = JSON.parse(content);
					if (Array.isArray(json.traits) && json.traits.length > 0) {
						description = `记录了 ${json.traits.length} 项用户协作与编码习惯偏好`;
					}
				} else {
					const firstLine = content.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
					if (firstLine) description = firstLine.slice(0, 160);
				}
			} catch {}
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
				helped: stats?.helped,
				hurt: stats?.hurt,
				trial: stats?.trial ?? journal?.trial,
				status: stats?.status,
				description: description || journal?.reason,
				reason: journal?.reason,
			});
		}

		// 2. Architecture
		const archPath = path.join(scopeDir, "architecture.json");
		if (fs.existsSync(archPath)) {
			const stat = fs.statSync(archPath);
			const id = `${scope}:architecture`;
			let stats = getStats(id);
			if (!stats && ledger.perAdaptationStats) {
				let appliedCount = 0;
				let helped = 0;
				let hurt = 0;
				let recurredCorrections = 0;
				let hasAny = false;
				for (const [k, s] of Object.entries(ledger.perAdaptationStats)) {
					if (k.startsWith(`${scope}:architecture:`)) {
						hasAny = true;
						appliedCount += s.appliedCount ?? 0;
						helped += s.helped ?? 0;
						hurt += s.hurt ?? 0;
						recurredCorrections += s.recurredCorrections ?? 0;
					}
				}
				if (hasAny) {
					stats = {
						appliedCount,
						helped,
						hurt,
						recurredCorrections,
						lastOutcome: hurt > 0 ? "failure" : "success",
					};
				}
			}
			const journal = getLatestJournal("architecture");
			let description: string | undefined;
			let hasAnyContent = false;
			try {
				const content = fs.readFileSync(archPath, "utf8");
				const json = JSON.parse(content);
				if (Array.isArray(json.customGuidelines) && json.customGuidelines.length > 0) {
					hasAnyContent = true;
					const first = json.customGuidelines[0];
					const firstText = typeof first === "string" ? first : (first.text || "");
					if (json.customGuidelines.length === 1) {
						description = firstText.slice(0, 160);
					} else {
						description = `${firstText.slice(0, 100)} (共 ${json.customGuidelines.length} 条定制规范)`;
					}
				} else if (Array.isArray(json.hiddenTools) && json.hiddenTools.length > 0) {
					hasAnyContent = true;
					description = `受限隐藏工具: ${json.hiddenTools.join(", ")}`;
				} else if (Array.isArray(json.preferredTools) && json.preferredTools.length > 0) {
					hasAnyContent = true;
					description = `偏好工具: ${json.preferredTools.join(", ")}`;
				}
			} catch {}
			if (hasAnyContent) {
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
					helped: stats?.helped,
					hurt: stats?.hurt,
					trial: stats?.trial ?? journal?.trial,
					status: stats?.status,
					description: description || journal?.reason,
					reason: journal?.reason,
				});
			}
		}

		// 3. Workflow
		const wfPath = path.join(scopeDir, "workflow.json");
		if (fs.existsSync(wfPath)) {
			const stat = fs.statSync(wfPath);
			const id = `${scope}:workflow`;
			const stats = getStats(id);
			const journal = getLatestJournal("workflow");
			const checks = extractPendingChecks(wfPath);
			let description: string | undefined;
			if (checks && checks.length > 0) {
				description = `包含 ${checks.length} 项工作流门禁守卫规则与检查`;
			}
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
				helped: stats?.helped,
				hurt: stats?.hurt,
				trial: stats?.trial ?? journal?.trial,
				status: stats?.status,
				pendingChecks: checks,
				description: description || journal?.reason,
				reason: journal?.reason,
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
					const journal = getLatestJournal("skill", skillName);
					let description: string | undefined;
					try {
						const content = fs.readFileSync(skillFile, "utf8");
						const fence = content.startsWith("---\n") ? content.indexOf("\n---", 4) : -1;
						if (fence !== -1) {
							const frontmatter = content.slice(4, fence);
							const match = /^description\s*:\s*(.+)$/m.exec(frontmatter);
							if (match && match[1]) {
								description = match[1].trim().replace(/^['"]|['"]$/g, "");
							}
						}
						if (!description) {
							const body = fence === -1 ? content : content.slice(fence + 4);
							const firstLine = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
							if (firstLine) description = firstLine.slice(0, 160);
						}
					} catch {}
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
						helped: stats?.helped,
						hurt: stats?.hurt,
						trial: stats?.trial ?? journal?.trial,
						status: stats?.status,
						description: description || journal?.reason,
						reason: journal?.reason,
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
					const journal = getLatestJournal("role", roleName);
					let description: string | undefined;
					try {
						const content = fs.readFileSync(filePath, "utf8");
						const firstLine = content.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
						if (firstLine) description = firstLine.slice(0, 160);
					} catch {}
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
						helped: stats?.helped,
						hurt: stats?.hurt,
						trial: stats?.trial ?? journal?.trial,
						status: stats?.status,
						description: description || journal?.reason,
						reason: journal?.reason,
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
					const journal = getLatestJournal("tool", toolName);
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
						helped: stats?.helped,
						hurt: stats?.hurt,
						trial: stats?.trial ?? journal?.trial,
						status: stats?.status,
						description: journal?.reason,
						reason: journal?.reason,
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
					const journal = getLatestJournal("hook", hookName);
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
						helped: stats?.helped,
						hurt: stats?.hurt,
						trial: stats?.trial ?? journal?.trial,
						status: stats?.status,
						description: journal?.reason,
						reason: journal?.reason,
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
					const journal = getLatestJournal("proposal", propName);
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
						helped: stats?.helped,
						hurt: stats?.hurt,
						trial: stats?.trial ?? journal?.trial,
						status: stats?.status,
						description: journal?.reason,
						reason: journal?.reason,
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

export function recordTouchedFileHashes(options: {
	agentDir: string;
	cwd: string;
	filePaths: string[];
	scope?: AdaptationScope;
}): void {
	const { agentDir, cwd, filePaths, scope = "project" } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const hashesPath = path.join(scopeDir, "file-hashes.json");
	let existing: Record<string, string> = {};
	if (fs.existsSync(hashesPath)) {
		try {
			existing = JSON.parse(fs.readFileSync(hashesPath, "utf8"));
		} catch {}
	}
	for (const fp of filePaths) {
		const full = path.isAbsolute(fp) ? fp : path.resolve(cwd, fp);
		if (fs.existsSync(full)) {
			try {
				const content = fs.readFileSync(full);
				const hash = crypto.createHash("sha256").update(content).digest("hex");
				existing[full] = hash;
			} catch {}
		}
	}
	try {
		fs.mkdirSync(scopeDir, { recursive: true });
		fs.writeFileSync(hashesPath, JSON.stringify(existing, null, 2), "utf8");
	} catch {}
}

export function detectUserModifiedFiles(options: {
	agentDir: string;
	cwd: string;
	scope?: AdaptationScope;
}): string[] {
	const { agentDir, cwd, scope = "project" } = options;
	const scopeDir = getScopeDir(agentDir, cwd, scope);
	const hashesPath = path.join(scopeDir, "file-hashes.json");
	if (!fs.existsSync(hashesPath)) return [];
	try {
		const hashes = JSON.parse(fs.readFileSync(hashesPath, "utf8")) as Record<string, string>;
		const modified: string[] = [];
		for (const [fullPath, originalHash] of Object.entries(hashes)) {
			if (fs.existsSync(fullPath)) {
				try {
					const content = fs.readFileSync(fullPath);
					const currentHash = crypto.createHash("sha256").update(content).digest("hex");
					if (currentHash !== originalHash) {
						modified.push(fullPath);
					}
				} catch {}
			}
		}
		return modified;
	} catch {
		return [];
	}
}
