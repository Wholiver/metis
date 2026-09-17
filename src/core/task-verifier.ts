/**
 * Host-owned task-kind verifier. Returns per-constraint results; never auto-PASS
 * when public evidence is missing.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
	detectOutputPollution,
	normalizeFailureFingerprint,
	type CompletionDecision,
	type ConstraintOracle,
	type ConstraintResult,
	type EvidenceLevel,
	type TaskContract,
	type TaskPaths,
	type VerificationFailure,
} from "./execution-types.ts";
import { isEvidenceStale, listOutputEntries } from "./task-contract.ts";

export interface ServiceTarget {
	id: string;
	host: string;
	port: number;
}

export interface VerifyTaskOptions {
	contract: TaskContract;
	cwd: string;
	taskPaths?: TaskPaths;
	/** Previously recorded workspace evidence hash; if provided and stale, fail closed. */
	priorEvidenceHash?: string;
	/** Optional numeric expectations keyed by artifact basename or constraint id. */
	numericExpectations?: Record<string, { expected: number; tolerance: number; actualPath?: string }>;
	/** Optional service reachability probes (argv-only; never shell-interpolated). */
	serviceTargets?: ServiceTarget[];
	independentVerifierEvidence?: {
		passed: boolean;
		summary: string;
		authority: "host" | "external";
	};
	/** When true (default), missing runnable oracle fails closed. */
	failClosed?: boolean;
	signal?: AbortSignal;
}

export interface VerifyTaskResult {
	completion: CompletionDecision;
	constraints: ConstraintResult[];
	constraintResults: ConstraintResult[];
	failures: VerificationFailure[];
	evidenceLevel: EvidenceLevel;
	evidenceHash: string;
	workspaceSnapshotHash: string;
	fingerprint?: string;
	passed: boolean;
}

async function runCommand(
	argv: string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
	return new Promise((resolvePromise) => {
		const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"], signal });
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolvePromise({ exitCode: code, stdout, stderr });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolvePromise({ exitCode: 127, stdout, stderr: err.message });
		});
	});
}

function artifactExists(cwd: string, artifactPath: string): { exists: boolean; isFile: boolean; size: number; absolute: string } {
	const absolute = resolve(cwd, artifactPath);
	if (!existsSync(absolute)) return { exists: false, isFile: false, size: 0, absolute };
	const st = statSync(absolute);
	return { exists: true, isFile: st.isFile(), size: st.size, absolute };
}

function readJsonSafe(pathValue: string): unknown {
	try {
		return JSON.parse(readFileSync(pathValue, "utf8"));
	} catch {
		return undefined;
	}
}

function listFilesRecursive(root: string, max = 200): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const walk = (dir: string) => {
		if (out.length >= max) return;
		let entries: string[] = [];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (out.length >= max) return;
			const full = join(dir, entry);
			try {
				const st = statSync(full);
				if (st.isDirectory()) walk(full);
				else out.push(full);
			} catch {
				// ignore
			}
		}
	};
	walk(root);
	return out;
}

function fileDigest(pathValue: string): string {
	try {
		const st = statSync(pathValue);
		if (st.isDirectory()) {
			return `dir:${st.mtimeMs}:${listFilesRecursive(pathValue, 50).length}`;
		}
		return createHash("sha256").update(readFileSync(pathValue)).digest("hex").slice(0, 16);
	} catch {
		return "missing";
	}
}

/** Hash required artifacts + input/output trees so content changes invalidate evidence. */
export function hashWorkspaceSnapshot(cwd: string, taskPaths: TaskPaths | undefined, contract: TaskContract): string {
	const parts: string[] = [];
	for (const artifact of contract.requiredArtifacts) {
		const full = resolve(cwd, artifact.path);
		parts.push(`${artifact.path}:${fileDigest(full)}`);
	}
	for (const rootName of [taskPaths?.input, taskPaths?.output, taskPaths?.software]) {
		if (!rootName) continue;
		const full = resolve(cwd, rootName);
		parts.push(`${rootName}:${fileDigest(full)}`);
		for (const file of listFilesRecursive(full, 80)) {
			parts.push(`${file}:${fileDigest(file)}`);
		}
	}
	return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function isSemanticOracle(oracle: ConstraintOracle | undefined, constraintId: string): boolean {
	if (constraintId === "output-not-polluted") return false;
	if (!oracle || oracle.type === "unexecutable") return false;
	if (oracle.type === "file-exists") return false;
	return oracle.type === "file-contains" || oracle.type === "valid-json" || oracle.type === "line-count" || oracle.type === "command";
}

function hasRunnableOracle(
	contract: TaskContract,
	options: Pick<VerifyTaskOptions, "numericExpectations" | "serviceTargets" | "independentVerifierEvidence">,
): boolean {
	if (options.independentVerifierEvidence) return true;
	if (contract.checks.length > 0) return true;
	if (options.numericExpectations && Object.keys(options.numericExpectations).length > 0) return true;
	if (options.serviceTargets && options.serviceTargets.length > 0) return true;
	if (contract.kind === "service-config") return true;
	return contract.constraints.some((c) => isSemanticOracle(c.oracle, c.id));
}

function executeConstraintOracle(constraint: TaskContract["constraints"][number], cwd: string): ConstraintResult {
	const oracle = constraint.oracle;
	if (constraint.id === "output-not-polluted") {
		return {
			id: constraint.id,
			passed: true,
			message: "deferred to pollution scan",
			authority: constraint.authority,
			evidenceLevel: "derived-invariant",
		};
	}
	if (!oracle || oracle.type === "unexecutable") {
		return {
			id: constraint.id,
			passed: false,
			code: "CONSTRAINT_UNEXECUTABLE",
			message:
				oracle && oracle.type === "unexecutable"
					? oracle.reason
					: `Constraint ${constraint.id} has no executable oracle`,
			authority: constraint.authority,
			evidenceLevel: "none",
		};
	}
	if (oracle.type === "file-exists") {
		const info = artifactExists(cwd, oracle.path);
		return {
			id: constraint.id,
			passed: info.exists,
			code: info.exists ? undefined : "REQUIRED_ARTIFACT_MISSING",
			message: info.exists ? `Artifact present: ${oracle.path}` : `Missing artifact: ${oracle.path}`,
			evidence: info.absolute,
			authority: constraint.authority,
			evidenceLevel: "structural",
		};
	}
	if (oracle.type === "file-contains") {
		const info = artifactExists(cwd, oracle.path);
		if (!info.exists || !info.isFile) {
			return {
				id: constraint.id,
				passed: false,
				code: "REQUIRED_ARTIFACT_MISSING",
				message: `Missing artifact for contains check: ${oracle.path}`,
				evidence: info.absolute,
				authority: constraint.authority,
				evidenceLevel: "structural",
			};
		}
		const body = readFileSync(info.absolute, "utf8");
		const ok = body.includes(oracle.substring);
		return {
			id: constraint.id,
			passed: ok,
			code: ok ? undefined : "CONSTRAINT_FAILED",
			message: ok
				? `Artifact ${oracle.path} contains expected token`
				: `Artifact ${oracle.path} must contain ${oracle.substring}`,
			evidence: body.slice(0, 200),
			authority: constraint.authority,
			evidenceLevel: "structural",
		};
	}
	if (oracle.type === "valid-json") {
		const info = artifactExists(cwd, oracle.path);
		if (!info.exists || !info.isFile) {
			return {
				id: constraint.id,
				passed: false,
				code: "REQUIRED_ARTIFACT_MISSING",
				message: `Missing artifact for JSON check: ${oracle.path}`,
				evidence: info.absolute,
				authority: constraint.authority,
				evidenceLevel: "structural",
			};
		}
		try {
			JSON.parse(readFileSync(info.absolute, "utf8"));
			return {
				id: constraint.id,
				passed: true,
				message: `Artifact ${oracle.path} is valid JSON`,
				authority: constraint.authority,
				evidenceLevel: "structural",
			};
		} catch (error) {
			return {
				id: constraint.id,
				passed: false,
				code: "FORMAT_INVALID",
				message: `Artifact ${oracle.path} is not valid JSON`,
				evidence: error instanceof Error ? error.message : String(error),
				authority: constraint.authority,
				evidenceLevel: "structural",
			};
		}
	}
	if (oracle.type === "line-count") {
		const info = artifactExists(cwd, oracle.path);
		if (!info.exists || !info.isFile) {
			return {
				id: constraint.id,
				passed: false,
				code: "REQUIRED_ARTIFACT_MISSING",
				message: `Missing artifact for line-count check: ${oracle.path}`,
				evidence: info.absolute,
				authority: constraint.authority,
				evidenceLevel: "structural",
			};
		}
		const body = readFileSync(info.absolute, "utf8");
		const lineCount = body.length === 0 ? 0 : body.replace(/\n$/, "").split("\n").length;
		const ok = lineCount === oracle.lines;
		return {
			id: constraint.id,
			passed: ok,
			code: ok ? undefined : "CONSTRAINT_FAILED",
			message: ok
				? `Artifact ${oracle.path} has ${oracle.lines} lines`
				: `Artifact ${oracle.path} has ${lineCount} lines, expected ${oracle.lines}`,
			evidence: `lines=${lineCount}`,
			authority: constraint.authority,
			evidenceLevel: "structural",
		};
	}
	if (oracle.type === "command") {
		return {
			id: constraint.id,
			passed: false,
			code: "CONSTRAINT_UNEXECUTABLE",
			message: `Command oracle for ${constraint.id} requires async execution`,
			authority: constraint.authority,
			evidenceLevel: "none",
		};
	}
	return {
		id: constraint.id,
		passed: false,
		code: "CONSTRAINT_UNEXECUTABLE",
		message: `Unknown oracle for ${constraint.id}`,
		authority: constraint.authority,
		evidenceLevel: "none",
	};
}

async function executeConstraintOracleAsync(
	constraint: TaskContract["constraints"][number],
	cwd: string,
	signal?: AbortSignal,
): Promise<ConstraintResult> {
	const oracle = constraint.oracle;
	if (oracle?.type === "command") {
		const result = await runCommand(oracle.command, oracle.cwd ?? cwd, oracle.timeoutMs ?? 60_000, signal);
		const passed = result.exitCode === 0;
		return {
			id: constraint.id,
			passed,
			code: passed ? undefined : "CONSTRAINT_FAILED",
			message: passed ? `Constraint command passed` : `Constraint command failed exit=${result.exitCode}`,
			evidence: (result.stderr || result.stdout).slice(0, 400),
			authority: constraint.authority,
			evidenceLevel: "public-check",
		};
	}
	return executeConstraintOracle(constraint, cwd);
}

async function probeServiceArgvOnly(
	cwd: string,
	target: ServiceTarget,
	signal?: AbortSignal,
): Promise<{ ok: boolean; detail: string }> {
	const result = await runCommand(
		[
			"python",
			"-c",
			"import socket,sys; s=socket.socket(); s.settimeout(1); host=sys.argv[1]; port=int(sys.argv[2]);\n" +
				"try:\n s.connect((host,port)); print('ok'); sys.exit(0)\n" +
				"except Exception as e:\n print(e); sys.exit(1)",
			String(target.host),
			String(target.port),
		],
		cwd,
		5_000,
		signal,
	);
	return {
		ok: result.exitCode === 0,
		detail: `${target.id}@${target.host}:${target.port}`,
	};
}

function failClosed(
	constraints: ConstraintResult[],
	failures: VerificationFailure[],
	evidenceLevel: EvidenceLevel,
	workspaceSnapshotHash: string,
): VerifyTaskResult {
	return {
		passed: false,
		completion: {
			passed: false,
			reasons: failures.map((f) => ({ code: f.code, message: f.message, evidence: f.evidence })),
			requiredArtifactsPresent: false,
			forbiddenArtifactsAbsent: true,
			checksPassed: false,
			unresolvedFindings: failures.length,
		},
		constraints,
		constraintResults: constraints,
		failures,
		evidenceLevel,
		evidenceHash: workspaceSnapshotHash,
		workspaceSnapshotHash,
		fingerprint: failures[0]?.fingerprint,
	};
}

export async function verifyTaskContract(options: VerifyTaskOptions): Promise<VerifyTaskResult> {
	const {
		contract,
		cwd,
		taskPaths,
		priorEvidenceHash,
		numericExpectations,
		serviceTargets,
		independentVerifierEvidence,
		failClosed: failClosedFlag = true,
		signal,
	} = options;
	const constraints: ConstraintResult[] = [];
	const failures: VerificationFailure[] = [];
	const workspaceSnapshotHash = hashWorkspaceSnapshot(cwd, taskPaths, contract);

	if (!contract.compiled) {
		const result: ConstraintResult = {
			id: "contract-compiled",
			passed: false,
			code: "CONTRACT_NOT_COMPILED",
			message: "TaskContract was not host-compiled; refusing success",
			authority: "derived-invariant",
			evidenceLevel: "none",
		};
		constraints.push(result);
		failures.push({ code: "CONTRACT_NOT_COMPILED", message: result.message });
		return failClosed(constraints, failures, "none", workspaceSnapshotHash);
	}

	if (isEvidenceStale(priorEvidenceHash, workspaceSnapshotHash)) {
		const result: ConstraintResult = {
			id: "evidence-freshness",
			passed: false,
			code: "EVIDENCE_STALE",
			message: `Evidence hash stale: prior=${priorEvidenceHash} current=${workspaceSnapshotHash}`,
			authority: "derived-invariant",
			evidenceLevel: "structural",
		};
		constraints.push(result);
		failures.push({
			code: "EVIDENCE_STALE",
			message: result.message,
			fingerprint: normalizeFailureFingerprint({
				checkId: result.id,
				exitCode: 1,
				errorSummary: result.message,
				artifactHash: workspaceSnapshotHash,
			}),
		});
		return failClosed(constraints, failures, contract.evidenceLevel, workspaceSnapshotHash);
	}

	let requiredArtifactsPresent = true;
	for (const artifact of contract.requiredArtifacts) {
		const info = artifactExists(cwd, artifact.path);
		const passed = info.exists && (!artifact.nonEmpty || info.size > 0 || !info.isFile);
		if (!passed) requiredArtifactsPresent = false;
		constraints.push({
			id: `artifact:${artifact.path}`,
			passed,
			code: passed ? undefined : "REQUIRED_ARTIFACT_MISSING",
			message: passed ? `Artifact present: ${artifact.path}` : `Required artifact missing or empty: ${artifact.path}`,
			evidence: info.absolute,
			authority: "task",
			evidenceLevel: "structural",
		});
		if (!passed) {
			failures.push({
				code: "REQUIRED_ARTIFACT_MISSING",
				message: `Missing ${artifact.path}`,
				checkId: `artifact:${artifact.path}`,
			});
		} else if (artifact.type === "json" || artifact.path.endsWith(".json")) {
			const parsed = readJsonSafe(info.absolute);
			if (parsed === undefined) {
				requiredArtifactsPresent = false;
				constraints.push({
					id: `format:${artifact.path}`,
					passed: false,
					code: "FORMAT_INVALID",
					message: `Artifact is not valid JSON: ${artifact.path}`,
					authority: "task",
					evidenceLevel: "structural",
				});
				failures.push({
					code: "FORMAT_INVALID",
					message: `Invalid JSON ${artifact.path}`,
					checkId: `format:${artifact.path}`,
				});
			}
		} else if (artifact.type === "directory" && info.isFile) {
			failures.push({
				code: "ARTIFACT_CONTENT_INVALID",
				message: `Expected directory: ${artifact.path}`,
				checkId: artifact.path,
			});
		}
	}

	const outputDir = taskPaths?.output ?? (existsSync(join(cwd, "output")) ? join(cwd, "output") : undefined);
	const outputEntries = listOutputEntries(outputDir);
	const polluters = detectOutputPollution(outputEntries);
	const pollutionPassed = polluters.length === 0;
	constraints.push({
		id: "output-not-polluted",
		passed: pollutionPassed,
		code: pollutionPassed ? undefined : "OUTPUT_POLLUTION",
		message: pollutionPassed ? "Output has no runtime pollution" : `Output pollution: ${polluters.join(", ")}`,
		authority: "derived-invariant",
		evidenceLevel: "structural",
	});
	if (!pollutionPassed) {
		failures.push({
			code: "OUTPUT_POLLUTION",
			message: `Pollution: ${polluters.join(", ")}`,
			checkId: "output-not-polluted",
		});
	}

	for (const constraint of contract.constraints) {
		if (constraint.id === "output-not-polluted") continue;
		// Skip auto-generated artifact-required-* when we already emitted artifact:* results
		if (constraint.id.startsWith("artifact-required-") && constraint.oracle?.type === "file-exists") continue;
		const result = await executeConstraintOracleAsync(constraint, cwd, signal);
		constraints.push(result);
		if (!result.passed) {
			failures.push({
				code: result.code ?? "CONSTRAINT_FAILED",
				message: result.message,
				checkId: constraint.id,
				evidence: result.evidence,
				fingerprint: normalizeFailureFingerprint({
					checkId: constraint.id,
					exitCode: 1,
					errorSummary: result.message.slice(0, 200),
					artifactHash: workspaceSnapshotHash,
				}),
			});
		}
	}

	let checksPassed = true;
	for (const check of contract.checks) {
		const result = await runCommand(check.command, check.cwd || cwd, check.timeoutMs, signal);
		const passed = result.exitCode === 0;
		if (!passed) checksPassed = false;
		const summary = (result.stderr || result.stdout || `exit ${result.exitCode}`).slice(0, 240);
		constraints.push({
			id: check.id,
			passed,
			code: passed ? undefined : "CHECK_FAILED",
			message: passed ? `Check passed: ${check.id}` : `Check failed: ${check.id}: ${summary}`,
			evidence: summary,
			authority:
				check.authority === "agent-authored"
					? "derived-invariant"
					: check.authority === "bundled-public"
						? "public-check"
						: "task",
			evidenceLevel:
				check.authority === "bundled-public" || check.authority === "task" ? "public-check" : "derived-invariant",
		});
		if (!passed) {
			const fingerprint = normalizeFailureFingerprint({
				checkId: check.id,
				exitCode: result.exitCode,
				errorSummary: summary,
				artifactHash: workspaceSnapshotHash,
			});
			failures.push({ code: "CHECK_FAILED", message: summary, checkId: check.id, fingerprint, evidence: summary });
		}
	}

	if (numericExpectations) {
		for (const [id, spec] of Object.entries(numericExpectations)) {
			const pathValue = spec.actualPath ? resolve(cwd, spec.actualPath) : undefined;
			const payload = pathValue && existsSync(pathValue) ? readJsonSafe(pathValue) : undefined;
			const actual =
				typeof payload === "object" && payload && id in (payload as Record<string, unknown>)
					? Number((payload as Record<string, unknown>)[id])
					: Number.NaN;
			const delta = Math.abs(actual - spec.expected);
			const passed = Number.isFinite(actual) && delta <= spec.tolerance;
			constraints.push({
				id: `numeric:${id}`,
				passed,
				code: passed ? undefined : "NUMERIC_TOLERANCE_FAILED",
				message: passed
					? `Numeric ${id} within tolerance`
					: `Numeric ${id} delta=${delta} exceeds tolerance=${spec.tolerance}`,
				authority: "task",
				evidenceLevel: "structural",
			});
			if (!passed) {
				failures.push({
					code: "NUMERIC_TOLERANCE_FAILED",
					message: `delta=${delta}`,
					checkId: `numeric:${id}`,
					fingerprint: normalizeFailureFingerprint({
						checkId: `numeric:${id}`,
						exitCode: 1,
						errorSummary: `delta=${delta}`,
						artifactHash: workspaceSnapshotHash,
					}),
				});
			}
		}
	}

	const targets =
		serviceTargets ??
		(contract.kind === "service-config"
			? [
					{ id: "default-8000", host: "127.0.0.1", port: 8000 },
					{ id: "default-8080", host: "127.0.0.1", port: 8080 },
					{ id: "default-3000", host: "127.0.0.1", port: 3000 },
				]
			: []);
	if (targets.length > 0) {
		let anyOk = false;
		const details: string[] = [];
		for (const target of targets) {
			const probe = await probeServiceArgvOnly(cwd, target, signal);
			details.push(probe.detail);
			if (probe.ok) {
				anyOk = true;
				constraints.push({
					id: target.id,
					passed: true,
					message: `Service reachable ${target.host}:${target.port}`,
					authority: "task",
					evidenceLevel: "structural",
				});
				break;
			}
		}
		if (!anyOk) {
			constraints.push({
				id: targets[0]!.id,
				passed: false,
				code: "SERVICE_UNREACHABLE",
				message: `Service unreachable (${details.join(", ")})`,
				authority: "task",
				evidenceLevel: "structural",
			});
			failures.push({
				code: "SERVICE_UNREACHABLE",
				message: details.join(", "),
				checkId: targets[0]!.id,
			});
		}
	}

	if (independentVerifierEvidence) {
		if (!independentVerifierEvidence.passed) {
			failures.push({
				code: "CHECK_FAILED",
				message: independentVerifierEvidence.summary,
				evidence: independentVerifierEvidence.authority,
			});
		}
	}

	const unresolvedFindings = failures.length + contract.unresolved.length;

	if (failClosedFlag && !hasRunnableOracle(contract, { numericExpectations, serviceTargets, independentVerifierEvidence })) {
		constraints.push({
			id: "evidence-sufficiency",
			passed: false,
			code: "INSUFFICIENT_EVIDENCE",
			message: "No public checker or semantic constraint oracle evidence; refusing auto PASS",
			authority: "derived-invariant",
			evidenceLevel: "none",
		});
		failures.push({ code: "INSUFFICIENT_EVIDENCE", message: "Insufficient host evidence for completion" });
	}

	if (contract.unresolved.length > 0) {
		constraints.push({
			id: "unresolved-contract",
			passed: false,
			code: "COMPLETION_EVIDENCE_MISSING",
			message: `Unresolved contract items: ${contract.unresolved.join(", ")}`,
			authority: "derived-invariant",
			evidenceLevel: "none",
		});
		failures.push({ code: "COMPLETION_EVIDENCE_MISSING", message: contract.unresolved.join(", ") });
	}

	const passed = failures.length === 0 && constraints.every((c) => c.passed);
	const fingerprint = failures[0]?.fingerprint;

	return {
		passed,
		completion: {
			passed,
			reasons: failures.map((f) => ({ code: f.code, message: f.message, evidence: f.evidence })),
			requiredArtifactsPresent,
			forbiddenArtifactsAbsent: pollutionPassed,
			checksPassed,
			unresolvedFindings,
		},
		constraints,
		constraintResults: constraints,
		failures,
		evidenceLevel: contract.evidenceLevel,
		evidenceHash: workspaceSnapshotHash,
		workspaceSnapshotHash,
		fingerprint,
	};
}

export function toCompletionDecision(result: VerifyTaskResult): CompletionDecision {
	return result.completion;
}
