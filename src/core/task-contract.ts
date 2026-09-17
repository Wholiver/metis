/**
 * Compile a TaskContract from instruction text + public workspace facts.
 * Instruction is the highest authority; filesystem discovery only adds facts.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type {
	ConstraintOracle,
	EvidenceLevel,
	ExecutionRequest,
	TaskContract,
	TaskKind,
	TaskPaths,
} from "./execution-types.ts";

const HIDDEN_GRADER_PATTERNS = [
	/(^|\/)\.hidden(\/|$)/i,
	/(^|\/)hidden[_-]?tests?(\/|$)/i,
	/(^|\/)official[_-]?grader(\/|$)/i,
	/(^|\/)__grader(\/|$)/i,
	/(^|\/)private[_-]?tests?(\/|$)/i,
];

const PUBLIC_CHECK_NAMES = [
	"check.sh",
	"verify.sh",
	"validate.sh",
	"run_tests.sh",
	"test.sh",
	"pytest.ini",
	"pyproject.toml",
	"package.json",
];

export interface CompileTaskContractOptions {
	instruction: string;
	cwd: string;
	taskPaths?: TaskPaths;
	/** Optional agent-proposed contract; host still validates. */
	proposed?: Partial<TaskContract>;
}

export function isHiddenGraderPath(pathValue: string): boolean {
	const normalized = pathValue.replace(/\\/g, "/");
	return HIDDEN_GRADER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function classifyTaskKind(instruction: string, paths: TaskPaths | undefined): TaskKind {
	const text = instruction.toLowerCase();
	const hints = [
		paths?.input ? "input" : "",
		paths?.output ? "output" : "",
		paths?.software ? "software" : "",
	].join(" ");
	const blob = `${text} ${hints}`;
	const hasCode = /\b(pytest|unittest|jest|vitest|typescript|python|compile|refactor|bugfix|tdd)\b/.test(blob);
	const hasNumeric = /\b(csv|tsv|jsonl|tolerance|numeric|dataframe|accuracy|rmse|mse)\b/.test(blob);
	const hasService = /\b(server|http|port|endpoint|nginx|systemd|listen|curl)\b/.test(blob);
	const hasArtifact = /\b(output|artifact|file|image|model|weights|compress|archive|tar|zip)\b/.test(blob)
		|| Boolean(paths?.output);

	const flags = [hasCode, hasNumeric, hasService, hasArtifact].filter(Boolean).length;
	if (flags > 1) return "mixed";
	if (hasCode) return "code";
	if (hasNumeric) return "numeric-data";
	if (hasService) return "service-config";
	if (hasArtifact) return "artifact";
	return "mixed";
}

function safeList(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function discoverPublicChecks(cwd: string, taskPaths?: TaskPaths): TaskContract["checks"] {
	const searchRoots = [cwd];
	if (taskPaths?.software) searchRoots.push(taskPaths.software);
	if (taskPaths?.input) searchRoots.push(taskPaths.input);
	const checks: TaskContract["checks"] = [];
	for (const root of searchRoots) {
		for (const name of PUBLIC_CHECK_NAMES) {
			const full = join(root, name);
			if (!existsSync(full) || isHiddenGraderPath(full)) continue;
			if (name.endsWith(".sh")) {
				checks.push({
					id: `public:${name}`,
					command: ["bash", full],
					// Script-local cwd: software/input checkers must run where the script and markers live.
					cwd: root,
					timeoutMs: 120_000,
					authority: "bundled-public",
				});
			} else if (name === "package.json") {
				try {
					const pkg = JSON.parse(readFileSync(full, "utf8")) as { scripts?: Record<string, string> };
					if (pkg.scripts?.test) {
						checks.push({
							id: "public:npm-test",
							command: ["npm", "test", "--", "--run"],
							cwd: root,
							timeoutMs: 180_000,
							authority: "bundled-public",
						});
					}
				} catch {
					// ignore malformed package.json
				}
			} else if (name === "pytest.ini") {
				checks.push({
					id: "public:pytest",
					command: ["python", "-m", "pytest", "-q"],
					cwd: root,
					timeoutMs: 180_000,
					authority: "bundled-public",
				});
			} else if (name === "pyproject.toml") {
				// Only admit pytest when the project clearly configures or ships tests.
				if (!pyprojectAdmitsPytest(full, root)) continue;
				checks.push({
					id: "public:pytest",
					command: ["python", "-m", "pytest", "-q"],
					cwd: root,
					timeoutMs: 180_000,
					authority: "bundled-public",
				});
			}
		}
	}
	return checks;
}

function pyprojectAdmitsPytest(pyprojectPath: string, root: string): boolean {
	try {
		const text = readFileSync(pyprojectPath, "utf8");
		if (/\[tool\.pytest/.test(text) || /pytest/.test(text) && /testpaths\s*=/.test(text)) return true;
	} catch {
		return false;
	}
	return existsSync(join(root, "tests")) || existsSync(join(root, "test"));
}

export function resolveConstraintOracle(
	constraint: { id: string; description: string; oracle?: import("./execution-types.ts").ConstraintOracle },
	requiredArtifacts: TaskContract["requiredArtifacts"],
): import("./execution-types.ts").ConstraintOracle {
	if (constraint.oracle) return constraint.oracle;
	const contain = constraint.description.match(/must contain\s+[`"']?([^`"'\s.,;]+)[`"']?/i);
	if (contain) {
		const pathFromDesc = constraint.description.match(/((?:output|dist|artifacts)\/[A-Za-z0-9._\/-]+)/);
		const pathValue = pathFromDesc?.[1] ?? requiredArtifacts.find((a) => a.type !== "directory")?.path ?? requiredArtifacts[0]?.path;
		if (pathValue) {
			return { type: "file-contains", path: pathValue, substring: contain[1]! };
		}
	}
	if (/required artifact present:/i.test(constraint.description)) {
		const pathValue = constraint.description.replace(/^.*present:\s*/i, "").trim();
		if (pathValue) return { type: "file-exists", path: pathValue };
	}
	if (constraint.id === "output-not-polluted") {
		return { type: "unexecutable", reason: "handled-by-pollution-check" };
	}
	return { type: "unexecutable", reason: `No host oracle for constraint ${constraint.id}: ${constraint.description}` };
}

/**
 * Extract deterministic semantic constraints from clear task text (no proposed injection).
 * Complex/ambiguous instructions intentionally yield no oracle — fail closed or use contract-solver.
 */
export function extractSemanticConstraints(
	instruction: string,
	requiredArtifacts: TaskContract["requiredArtifacts"],
): TaskContract["constraints"] {
	const constraints: TaskContract["constraints"] = [];
	const seen = new Set<string>();

	const pushContains = (pathValue: string, substring: string) => {
		const id = `must-contain-${substring}`.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
		if (seen.has(id)) return;
		seen.add(id);
		constraints.push({
			id,
			description: `artifact ${pathValue} must contain ${substring}`,
			authority: "task",
			oracle: { type: "file-contains", path: pathValue, substring },
		});
	};

	// "Create output/a.txt containing foo" / "output/a.txt containing 'foo'"
	const pathContaining =
		instruction.matchAll(
			/((?:output|dist|artifacts)\/[A-Za-z0-9._\/-]+)\s+(?:that\s+)?(?:must\s+)?contain(?:s|ing)?\s+[`"']?([^`"'\n.,;]+)[`"']?/gi,
		) ?? [];
	for (const match of pathContaining) {
		pushContains(match[1]!, match[2]!.trim());
	}

	// "containing foo" with a known required artifact path
	if (constraints.length === 0) {
		const bare = instruction.match(/\bcontain(?:s|ing)?\s+[`"']?([^`"'\n.,;]+)[`"']?/i);
		const artifactPath =
			requiredArtifacts.find((a) => a.type !== "directory")?.path ??
			(instruction.match(/((?:output|dist|artifacts)\/[A-Za-z0-9._\/-]+)/)?.[1]);
		if (bare && artifactPath) {
			pushContains(artifactPath, bare[1]!.trim());
		}
	}

	// Valid JSON requirement
	if (/\bvalid\s+json\b|\bjson\s+(?:object|file)\b/i.test(instruction)) {
		const jsonPath =
			requiredArtifacts.find((a) => a.path.endsWith(".json"))?.path ??
			instruction.match(/((?:output|dist|artifacts)\/[A-Za-z0-9._\/-]+\.json)/i)?.[1];
		if (jsonPath) {
			constraints.push({
				id: "format-json-valid",
				description: `Artifact ${jsonPath} must be valid JSON`,
				authority: "task",
				oracle: { type: "file-contains", path: jsonPath, substring: "{" }, // structural; verifier also validates .json type
			});
		}
	}

	// Exactly N lines → declarative host oracle (never shell/python -c)
	const lineCount = instruction.match(/\bexactly\s+(\d+)\s+lines?\b/i);
	if (lineCount) {
		const pathValue =
			requiredArtifacts.find((a) => a.type !== "directory")?.path ??
			instruction.match(/((?:output|dist|artifacts)\/[A-Za-z0-9._\/-]+)/)?.[1];
		if (pathValue) {
			constraints.push({
				id: `exactly-${lineCount[1]}-lines`,
				description: `artifact ${pathValue} must contain exactly ${lineCount[1]} lines`,
				authority: "task",
				oracle: { type: "line-count", path: pathValue, lines: Number(lineCount[1]) },
			});
		}
	}

	return constraints;
}

function extractRequiredArtifacts(instruction: string, taskPaths?: TaskPaths): TaskContract["requiredArtifacts"] {
	const artifacts: TaskContract["requiredArtifacts"] = [];
	const outputRoot = taskPaths?.output ? resolve(taskPaths.output) : undefined;
	const pathMatches = instruction.match(/(?:^|[\s`"'(])((?:output|dist|artifacts)\/[A-Za-z0-9._\/-]+)/g) ?? [];
	for (const raw of pathMatches) {
		const cleaned = raw.trim().replace(/^[\s`"'(]+/, "");
		if (!cleaned || isHiddenGraderPath(cleaned)) continue;
		artifacts.push({ path: cleaned, nonEmpty: true });
	}
	if (artifacts.length === 0 && outputRoot) {
		// Soft expectation: output directory must exist and eventually hold deliverables.
		artifacts.push({ path: outputRoot, nonEmpty: false, type: "directory" });
	}
	return dedupeArtifacts(artifacts);
}

function dedupeArtifacts(artifacts: TaskContract["requiredArtifacts"]): TaskContract["requiredArtifacts"] {
	const seen = new Set<string>();
	return artifacts.filter((item) => {
		if (seen.has(item.path)) return false;
		seen.add(item.path);
		return true;
	});
}

function validateProposedPaths(cwd: string, proposed: Partial<TaskContract> | undefined): string[] {
	const unresolved: string[] = [];
	if (!proposed) return unresolved;
	for (const check of proposed.checks ?? []) {
		if (!Array.isArray(check.command) || check.command.length === 0) {
			unresolved.push(`invalid-check:${check.id ?? "unknown"}`);
			continue;
		}
		if (check.command.some((part) => isHiddenGraderPath(part))) {
			unresolved.push(`hidden-grader-rejected:${check.id}`);
		}
		const checkCwd = check.cwd ? resolve(cwd, check.cwd) : cwd;
		if (!existsSync(checkCwd)) unresolved.push(`missing-check-cwd:${check.id}`);
	}
	for (const artifact of proposed.requiredArtifacts ?? []) {
		if (isHiddenGraderPath(artifact.path)) unresolved.push(`hidden-artifact-rejected:${artifact.path}`);
	}
	return unresolved;
}

export function hashContractMaterial(parts: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function compileTaskContract(options: CompileTaskContractOptions): TaskContract {
	const { instruction, cwd, taskPaths, proposed } = options;
	const kind = proposed?.kind ?? classifyTaskKind(instruction, taskPaths);
	const publicChecks = discoverPublicChecks(cwd, taskPaths);
	const proposedChecks = (proposed?.checks ?? []).filter((check) => !check.command.some((part) => isHiddenGraderPath(part)));
	const checks = [...publicChecks, ...proposedChecks.filter((c) => !publicChecks.some((p) => p.id === c.id))];

	const requiredArtifacts = dedupeArtifacts([
		...extractRequiredArtifacts(instruction, taskPaths),
		...(proposed?.requiredArtifacts ?? []).filter((a) => !isHiddenGraderPath(a.path)),
	]);

	const forbiddenArtifacts = [
		...(proposed?.forbiddenArtifacts ?? []),
		".venv",
		"venv",
		"__pycache__",
		".pytest_cache",
		"node_modules",
	];

	const extractedConstraints = extractSemanticConstraints(instruction, requiredArtifacts);
	const constraints: TaskContract["constraints"] = [
		...extractedConstraints,
		...(proposed?.constraints ?? []).map((constraint) => ({
			...constraint,
			oracle: resolveConstraintOracle(constraint, requiredArtifacts),
		})),
		...requiredArtifacts.map((artifact, index) => ({
			id: `artifact-required-${index}`,
			description: `Required artifact present: ${artifact.path}`,
			authority: "task" as const,
			oracle: { type: "file-exists" as const, path: artifact.path },
		})),
		{
			id: "output-not-polluted",
			description: "Output must not contain runtime pollution (.venv, caches)",
			authority: "derived-invariant" as const,
			oracle: { type: "unexecutable" as const, reason: "handled-by-pollution-check" },
		},
	];

	const requiredPaths = [
		...(taskPaths?.input ? [taskPaths.input] : []),
		...(taskPaths?.output ? [taskPaths.output] : []),
		...(taskPaths?.software ? [taskPaths.software] : []),
		...(proposed?.environment?.requiredPaths ?? []),
	];

	const unresolved = [
		...validateProposedPaths(cwd, proposed),
		...(proposed?.unresolved ?? []),
	];

	let evidenceLevel: EvidenceLevel = "none";
	if (checks.some((c) => c.authority === "bundled-public" || c.authority === "task")) {
		evidenceLevel = "public-check";
	} else if (requiredArtifacts.length > 0 || constraints.length > 0) {
		evidenceLevel = "structural";
	} else {
		evidenceLevel = "derived-invariant";
	}

	const contractHash = hashContractMaterial({
		instruction,
		kind,
		requiredArtifacts,
		forbiddenArtifacts,
		checks: checks.map((c) => ({ id: c.id, command: c.command, cwd: c.cwd })),
		requiredPaths,
	});

	return {
		kind,
		requiredArtifacts,
		forbiddenArtifacts,
		constraints,
		checks,
		environment: {
			requiredPaths,
			requiredCommands: proposed?.environment?.requiredCommands ?? [],
		},
		unresolved,
		compiled: true,
		contractHash,
		evidenceLevel,
	};
}

export function compileTaskContractFromRequest(request: ExecutionRequest, proposed?: Partial<TaskContract>): TaskContract {
	return compileTaskContract({
		instruction: request.instruction,
		cwd: request.cwd,
		taskPaths: request.taskPaths,
		proposed,
	});
}

/** Invalidate prior evidence when workspace snapshot diverges from a previous evidence hash. */
export function isEvidenceStale(priorEvidenceHash: string | undefined, currentEvidenceHash: string): boolean {
	return Boolean(priorEvidenceHash && priorEvidenceHash !== currentEvidenceHash);
}

export function listOutputEntries(outputDir: string | undefined): string[] {
	if (!outputDir || !existsSync(outputDir)) return [];
	try {
		const st = statSync(outputDir);
		if (!st.isDirectory()) return [];
		return safeList(outputDir);
	} catch {
		return [];
	}
}

/** Join initial + follow-up messages so contract compilation sees the full task sequence. */
export function buildContractInstruction(initialMessage?: string, messages: string[] = []): string {
	return [initialMessage, ...messages].filter((part): part is string => Boolean(part && part.trim())).join("\n\n");
}

function isSemanticOracleForSufficiency(
	oracle: ConstraintOracle | undefined,
	constraintId: string,
): boolean {
	if (constraintId === "output-not-polluted") return false;
	if (!oracle || oracle.type === "unexecutable" || oracle.type === "file-exists") return false;
	return oracle.type === "file-contains" || oracle.type === "valid-json" || oracle.type === "line-count" || oracle.type === "command";
}

/**
 * Canonicalize a solver-supplied relative path under request cwd.
 * Rejects absolute paths, `..` escape, symlink escape outside cwd, and hidden grader paths.
 */
export function resolveSolverSafePath(
	cwd: string,
	pathValue: string,
	taskPaths?: TaskPaths,
): { ok: true; relativePath: string } | { ok: false; reason: string } {
	if (typeof pathValue !== "string" || !pathValue.trim()) {
		return { ok: false, reason: "empty path" };
	}
	const trimmed = pathValue.trim();
	if (isAbsolute(trimmed) || trimmed.includes("\0")) {
		return { ok: false, reason: `absolute or illegal path ${trimmed}` };
	}
	if (trimmed.split(/[/\\]/).includes("..") || trimmed.includes("..")) {
		return { ok: false, reason: `path escape ${trimmed}` };
	}
	if (isHiddenGraderPath(trimmed)) {
		return { ok: false, reason: `hidden grader path ${trimmed}` };
	}

	const root = resolve(cwd);
	const candidate = resolve(root, trimmed);
	const rel = relative(root, candidate);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		return { ok: false, reason: `path escapes cwd: ${trimmed}` };
	}

	// If the path exists, require realpath to remain under cwd (symlink escape).
	try {
		if (existsSync(candidate)) {
			const realRoot = realpathSync(root);
			const realCandidate = realpathSync(candidate);
			const realRel = relative(realRoot, realCandidate);
			if (realRel.startsWith("..") || isAbsolute(realRel)) {
				return { ok: false, reason: `symlink escapes cwd: ${trimmed}` };
			}
		} else {
			// For non-existent paths, ensure no symlink parent escapes.
			let parent = candidate;
			while (parent !== root && parent.startsWith(root + sep)) {
				const next = resolve(parent, "..");
				if (next === parent) break;
				if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
					const realParent = realpathSync(parent);
					const realRoot = realpathSync(root);
					const realRel = relative(realRoot, realParent);
					if (realRel.startsWith("..") || isAbsolute(realRel)) {
						return { ok: false, reason: `symlink parent escapes cwd: ${trimmed}` };
					}
				}
				parent = next;
			}
		}
	} catch {
		return { ok: false, reason: `cannot resolve path ${trimmed}` };
	}

	// Optional: when taskPaths are provided, prefer deliverables under those roots if they exist.
	if (taskPaths) {
		const allowedRoots = [taskPaths.input, taskPaths.output, taskPaths.software]
			.filter(Boolean)
			.map((p) => resolve(cwd, p!));
		if (allowedRoots.length > 0) {
			const underTask = allowedRoots.some((base) => candidate === base || candidate.startsWith(base + sep));
			const underCwdRoot = !underTask; // still allow cwd-relative deliverables like output/...
			void underCwdRoot;
		}
	}

	return { ok: true, relativePath: normalize(rel).split(sep).join("/") };
}

/** True when the compiled contract has host-runnable independent evidence (not mere file existence). */
export function contractHasIndependentOracle(contract: TaskContract): boolean {
	if (contract.checks.length > 0) return true;
	if (contract.kind === "service-config") return true;
	return contract.constraints.some((c) => isSemanticOracleForSufficiency(c.oracle, c.id));
}

/**
 * Instruction-owned evidence suitable for chat-aware Controller entry.
 * Ambient `bundled-public` discovery (e.g. root package.json `npm test`) and
 * keyword-only kind classification (e.g. `service-config` from "server"/"port")
 * must not alone force Desktop/TUI chat or Plan turns into the host verification loop.
 */
export function contractHasInstructionOwnedOracle(contract: TaskContract): boolean {
	if (contract.checks.some((c) => c.authority === "task" || c.authority === "agent-authored")) {
		return true;
	}
	return contract.constraints.some((c) => isSemanticOracleForSufficiency(c.oracle, c.id));
}

export function buildContractSolverPrompt(instruction: string, contract: TaskContract): string {
	return [
		"You are the host-owned contract-solver for reliable-headless.",
		"Emit exactly one JSON object and nothing else (no markdown fences, no commentary).",
		"Schema:",
		'{"constraints":[{"id":"string","description":"string","authority":"task","oracle":{"type":"file-contains","path":"rel/path","substring":"token"}}]}',
		"Allowed oracle types ONLY: file-contains | file-exists | valid-json | line-count.",
		"Do NOT propose command oracles, shell checks, python -c, node -e, or rm.",
		"Paths must be relative to the task cwd (no absolute paths, no .., no hidden graders).",
		"Do not claim success; only propose declarative oracles the host can re-verify.",
		"",
		`Current contractHash: ${contract.contractHash}`,
		`Current kind: ${contract.kind}`,
		`Required artifacts: ${JSON.stringify(contract.requiredArtifacts)}`,
		"",
		"## Task instruction",
		instruction,
	].join("\n");
}

export type SolverProposalResult =
	| { ok: true; proposed: Partial<TaskContract> }
	| { ok: false; reason: string };

function extractSingleJsonObject(raw: string): { ok: true; text: string } | { ok: false; reason: string } {
	const text = raw.trim();
	if (!text) return { ok: false, reason: "CONTRACT_SOLVER_INVALID: empty output" };
	if (text.startsWith("```")) {
		return { ok: false, reason: "CONTRACT_SOLVER_INVALID: markdown fence not allowed; emit exactly one JSON object" };
	}
	const firstBrace = text.indexOf("{");
	const lastBrace = text.lastIndexOf("}");
	if (firstBrace !== 0 || lastBrace <= firstBrace) {
		return { ok: false, reason: "CONTRACT_SOLVER_INVALID: output must be exactly one JSON object" };
	}
	const jsonText = text.slice(firstBrace, lastBrace + 1);
	const trailing = text.slice(lastBrace + 1).trim();
	if (trailing) {
		return { ok: false, reason: "CONTRACT_SOLVER_INVALID: trailing content after JSON object" };
	}
	if (text.includes("}\n{") || text.includes("}\r\n{")) {
		return { ok: false, reason: "CONTRACT_SOLVER_INVALID: multiple JSON objects" };
	}
	return { ok: true, text: jsonText };
}

/**
 * Parse and validate a contract-solver JSON proposal.
 * Only declarative host oracles are accepted; free-form commands fail closed.
 */
export function parseAndValidateSolverProposal(
	raw: string,
	cwd: string,
	taskPaths?: TaskPaths,
): SolverProposalResult {
	const extracted = extractSingleJsonObject(raw);
	if (!extracted.ok) return extracted;

	let parsed: unknown;
	try {
		parsed = JSON.parse(extracted.text);
	} catch {
		return { ok: false, reason: "CONTRACT_SOLVER_INVALID: output is not JSON" };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: "CONTRACT_SOLVER_INVALID: root must be an object" };
	}
	const record = parsed as Record<string, unknown>;
	if (record.checks !== undefined) {
		return {
			ok: false,
			reason: "CONTRACT_SOLVER_INVALID: solver must not propose checks; use declarative constraint oracles only",
		};
	}
	const constraintsRaw = record.constraints;
	if (!Array.isArray(constraintsRaw) || constraintsRaw.length === 0) {
		return { ok: false, reason: "CONTRACT_SOLVER_INVALID: constraints must be a non-empty array" };
	}

	const constraints: TaskContract["constraints"] = [];
	for (const entry of constraintsRaw) {
		if (!entry || typeof entry !== "object") {
			return { ok: false, reason: "CONTRACT_SOLVER_INVALID: constraint entry must be an object" };
		}
		const c = entry as Record<string, unknown>;
		if (typeof c.id !== "string" || !c.id.trim()) {
			return { ok: false, reason: "CONTRACT_SOLVER_INVALID: constraint.id required" };
		}
		if (typeof c.description !== "string" || !c.description.trim()) {
			return { ok: false, reason: "CONTRACT_SOLVER_INVALID: constraint.description required" };
		}
		const oracle = c.oracle;
		if (!oracle || typeof oracle !== "object") {
			return { ok: false, reason: `CONTRACT_SOLVER_INVALID: constraint ${c.id} missing oracle` };
		}
		const o = oracle as Record<string, unknown>;
		const type = o.type;

		if (type === "command") {
			return {
				ok: false,
				reason: `CONTRACT_SOLVER_INVALID: command oracles are forbidden from solver (${c.id}); use file-contains|valid-json|line-count`,
			};
		}

		if (type === "file-contains") {
			if (typeof o.path !== "string" || typeof o.substring !== "string" || !o.substring) {
				return { ok: false, reason: `CONTRACT_SOLVER_INVALID: file-contains oracle malformed for ${c.id}` };
			}
			const safe = resolveSolverSafePath(cwd, o.path, taskPaths);
			if (!safe.ok) return { ok: false, reason: `CONTRACT_SOLVER_INVALID: ${safe.reason}` };
			constraints.push({
				id: c.id,
				description: c.description,
				authority: "task",
				oracle: { type: "file-contains", path: safe.relativePath, substring: o.substring },
			});
			continue;
		}

		if (type === "file-exists") {
			if (typeof o.path !== "string") {
				return { ok: false, reason: `CONTRACT_SOLVER_INVALID: file-exists oracle malformed for ${c.id}` };
			}
			const safe = resolveSolverSafePath(cwd, o.path, taskPaths);
			if (!safe.ok) return { ok: false, reason: `CONTRACT_SOLVER_INVALID: ${safe.reason}` };
			constraints.push({
				id: c.id,
				description: c.description,
				authority: "task",
				oracle: { type: "file-exists", path: safe.relativePath },
			});
			continue;
		}

		if (type === "valid-json") {
			if (typeof o.path !== "string") {
				return { ok: false, reason: `CONTRACT_SOLVER_INVALID: valid-json oracle malformed for ${c.id}` };
			}
			const safe = resolveSolverSafePath(cwd, o.path, taskPaths);
			if (!safe.ok) return { ok: false, reason: `CONTRACT_SOLVER_INVALID: ${safe.reason}` };
			constraints.push({
				id: c.id,
				description: c.description,
				authority: "task",
				oracle: { type: "valid-json", path: safe.relativePath },
			});
			continue;
		}

		if (type === "line-count") {
			const lines = typeof o.lines === "number" ? o.lines : Number(o.lines);
			if (typeof o.path !== "string" || !Number.isInteger(lines) || lines < 0) {
				return { ok: false, reason: `CONTRACT_SOLVER_INVALID: line-count oracle malformed for ${c.id}` };
			}
			const safe = resolveSolverSafePath(cwd, o.path, taskPaths);
			if (!safe.ok) return { ok: false, reason: `CONTRACT_SOLVER_INVALID: ${safe.reason}` };
			constraints.push({
				id: c.id,
				description: c.description,
				authority: "task",
				oracle: { type: "line-count", path: safe.relativePath, lines },
			});
			continue;
		}

		return { ok: false, reason: `CONTRACT_SOLVER_INVALID: unsupported oracle type for ${c.id}` };
	}

	if (!constraints.some((c) => isSemanticOracleForSufficiency(c.oracle, c.id))) {
		return { ok: false, reason: "CONTRACT_SOLVER_INSUFFICIENT: no semantic executable oracle in proposal" };
	}

	const proposed: Partial<TaskContract> = { constraints };
	if (Array.isArray(record.requiredArtifacts)) {
		const artifacts: TaskContract["requiredArtifacts"] = [];
		for (const a of record.requiredArtifacts) {
			if (!a || typeof a !== "object") continue;
			const art = a as Record<string, unknown>;
			if (typeof art.path !== "string") {
				return { ok: false, reason: "CONTRACT_SOLVER_INVALID: illegal requiredArtifacts path" };
			}
			const safe = resolveSolverSafePath(cwd, art.path, taskPaths);
			if (!safe.ok) return { ok: false, reason: `CONTRACT_SOLVER_INVALID: ${safe.reason}` };
			artifacts.push({
				path: safe.relativePath,
				nonEmpty: art.nonEmpty !== false,
				type: typeof art.type === "string" ? art.type : undefined,
			});
		}
		if (artifacts.length > 0) proposed.requiredArtifacts = artifacts;
	}

	return { ok: true, proposed };
}
