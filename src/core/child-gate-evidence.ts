/**
 * Normalize ChildResult events into host-owned gate evidence for reliable-headless.
 */

import type { ChildResult, CompletionDecision } from "./execution-types.ts";

export interface ChildGateEvidence {
	passed: boolean;
	reasons: CompletionDecision["reasons"];
}

export function evaluateChildGateEvidence(results: ChildResult[]): ChildGateEvidence {
	const reasons: CompletionDecision["reasons"] = [];

	for (const result of results) {
		if (result.status === "invalid") {
			reasons.push({ code: "CHILD_RESULT_INVALID", message: result.summary || "invalid ChildResult" });
			continue;
		}
		if (result.status === "failed") {
			reasons.push({ code: "CHILD_RESULT_FAILED", message: result.summary || "child failed", evidence: result.findings[0]?.message });
		}
		if (result.status === "blocked") {
			reasons.push({ code: "CHILD_RESULT_FAILED", message: result.summary || "child blocked", evidence: "blocked" });
		}
		for (const finding of result.findings) {
			reasons.push({
				code: "CHILD_FINDINGS_PRESENT",
				message: `${finding.code}: ${finding.message}`,
				evidence: finding.evidence,
			});
		}
		for (const command of result.commands) {
			if (command.exitCode !== 0 && command.exitCode !== null) {
				reasons.push({
					code: "CHECK_FAILED",
					message: `Child command failed: ${command.argv.join(" ")} exit=${command.exitCode}`,
					evidence: command.cwd,
				});
			}
		}
	}

	return { passed: reasons.length === 0, reasons };
}
