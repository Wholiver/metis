import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
	HarnessCheck,
	HarnessDocument,
	HarnessGateNodeData,
	HarnessGateOnFail,
} from "./harness-document.ts";

export interface DeclarativeCheckResult {
	passed: boolean;
	check: HarnessCheck;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	error?: string;
	artifactExists?: boolean;
}

export interface DeclarativeGateExecutionResult {
	passed: boolean;
	gateId: string;
	results: DeclarativeCheckResult[];
	onFail?: HarnessGateOnFail;
	failureReason?: string;
}

/**
 * Execute declarative checks for a gate within the given workspace directory.
 * The host runs shell commands directly with timeout and captures exit code,
 * verifying expected exit codes and optional artifact file existence.
 * Does not execute arbitrary scripts or eval.
 */
export function executeDeclarativeGateChecks(
	gate: HarnessGateNodeData,
	cwd: string,
): DeclarativeGateExecutionResult {
	if (!gate.checks || gate.checks.length === 0) {
		return {
			passed: true,
			gateId: gate.id,
			results: [],
			onFail: gate.onFail,
		};
	}

	const results: DeclarativeCheckResult[] = [];

	for (const check of gate.checks) {
		let exitCode: number | null = null;
		let stdout = "";
		let stderr = "";
		let error: string | undefined;
		let artifactExists: boolean | undefined;

		try {
			const res = spawnSync(check.command, {
				cwd,
				shell: true,
				timeout: 60_000,
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			});
			exitCode = res.status ?? (res.signal ? 1 : 0);
			stdout = res.stdout ?? "";
			stderr = res.stderr ?? "";
			if (res.error) {
				error = res.error.message;
			}
		} catch (err: any) {
			error = err.message;
			exitCode = 1;
		}

		if (check.artifactPath) {
			const fullPath = resolve(cwd, check.artifactPath);
			artifactExists = existsSync(fullPath);
		}

		const exitCodePassed = exitCode === check.expectExit;
		const artifactPassed = check.artifactPath ? Boolean(artifactExists) : true;
		const checkPassed = exitCodePassed && artifactPassed && !error;

		let failReason: string | undefined;
		if (!exitCodePassed) {
			failReason = `Command "${check.command}" exited with ${exitCode}, expected ${check.expectExit}.`;
		} else if (!artifactPassed) {
			failReason = `Required artifact at "${check.artifactPath}" does not exist.`;
		} else if (error) {
			failReason = `Command error: ${error}`;
		}

		results.push({
			passed: checkPassed,
			check,
			exitCode: exitCode ?? undefined,
			stdout,
			stderr,
			error: failReason,
			artifactExists,
		});
	}

	const passed = results.every((r) => r.passed);
	const failureReason = passed
		? undefined
		: results
				.filter((r) => !r.passed)
				.map((r) => r.error)
				.join("; ");

	return {
		passed,
		gateId: gate.id,
		results,
		onFail: gate.onFail,
		failureReason,
	};
}

/**
 * Locate a gate definition in a Harness document by its ID.
 */
export function findHarnessGate(
	harness: HarnessDocument | undefined | null,
	gateId: string,
): HarnessGateNodeData | undefined {
	if (!harness) return undefined;
	const node = harness.nodes.find((n) => n.type === "gate" && n.id === gateId);
	return node?.data as HarnessGateNodeData | undefined;
}

/**
 * Retrieve rubric instructions for a gate in a Harness document.
 */
export function findHarnessRubric(
	harness: HarnessDocument | undefined | null,
	gateId: string,
): string | undefined {
	const gate = findHarnessGate(harness, gateId);
	return gate?.rubric?.trim() || undefined;
}
