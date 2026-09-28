import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	recordRunOutcome,
	recordRecurringCorrection,
	retireExtraCheck,
	updateExtraCheckStatus,
} from "../src/core/adaptations/ledger.ts";
import {
	writeAdaptation,
	listAdaptations,
	getOutcomeLedger,
} from "../src/core/adaptations/store.ts";

describe("Self-Learning Outcome Ledger & Feedback Tracking", () => {
	let tempDir: string;
	let tempAgentDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-ledger-test-"));
		tempAgentDir = path.join(tempDir, "agent");
		fs.mkdirSync(tempAgentDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("records run outcomes and populates adaptation stats in listAdaptations", async () => {
		// Create an adaptation
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "profile",
			content: "Project coding preferences.",
		});

		const adaptationId = "project:profile";

		// Record a successful run
		recordRunOutcome({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			outcome: "success",
			activeAdaptationIds: [adaptationId],
		});

		let adaptations = listAdaptations(tempAgentDir, tempDir);
		let profile = adaptations.find((a) => a.id === adaptationId);
		expect(profile?.appliedCount).toBe(1);
		expect(profile?.lastOutcome).toBe("success");

		// Record a failed run
		recordRunOutcome({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			outcome: "failure",
			activeAdaptationIds: [adaptationId],
		});

		adaptations = listAdaptations(tempAgentDir, tempDir);
		profile = adaptations.find((a) => a.id === adaptationId);
		expect(profile?.appliedCount).toBe(2);
		expect(profile?.lastOutcome).toBe("failure");
	});

	it("detects recurring corrections and triggers rewrite after 2 recurrences", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({ hiddenTools: ["ls"] }),
		});

		const adaptationId = "project:architecture";

		// 1st correction: recurredCount = 1, not yet rewriting
		const res1 = recordRecurringCorrection({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			activeAdaptationIds: [adaptationId],
		});
		expect(res1.needsRewriteIds).toEqual([]);

		// 2nd correction: recurredCount = 2, triggers rewrite!
		const res2 = recordRecurringCorrection({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			activeAdaptationIds: [adaptationId],
		});
		expect(res2.needsRewriteIds).toContain(adaptationId);

		const adaptations = listAdaptations(tempAgentDir, tempDir);
		const arch = adaptations.find((a) => a.id === adaptationId);
		expect(arch?.recurredCorrections).toBe(2);
	});

	it("retires an extraCheck from workflow.json", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "workflow",
			content: JSON.stringify({
				extraChecks: [
					{ id: "check-lint", name: "Lint Check", command: "pnpm lint", status: "active" },
					{ id: "check-test", name: "Test Check", command: "pnpm test", status: "active" },
				],
			}),
		});

		const res = await retireExtraCheck({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			checkId: "check-lint",
		});

		expect(res.success).toBe(true);
		expect(res.found).toBe(true);

		// Verify workflow.json now has check-lint as retired
		const projectDir = path.join(tempAgentDir, "adaptations", "projects");
		const projectKey = fs.readdirSync(projectDir)[0]!;
		const wfPath = path.join(projectDir, projectKey, "workflow.json");
		const content = JSON.parse(fs.readFileSync(wfPath, "utf8"));
		const lintCheck = content.extraChecks.find((c: any) => c.id === "check-lint");
		expect(lintCheck.status).toBe("retired");
	});

	it("updates extraCheck status to pending on environment failure and lists pending checks", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			kind: "workflow",
			content: JSON.stringify({
				extraChecks: [
					{ id: "check-broken-env", name: "Broken Tool Check", command: "nonexistent-cmd", status: "active" },
				],
			}),
		});

		// Mark pending due to environment failure
		const updated = updateExtraCheckStatus({
			agentDir: tempAgentDir,
			cwd: tempDir,
			scope: "project",
			checkId: "check-broken-env",
			status: "pending",
		});
		expect(updated).toBe(true);

		// listAdaptations exposes pendingChecks
		const adaptations = listAdaptations(tempAgentDir, tempDir);
		const wf = adaptations.find((a) => a.kind === "workflow");
		expect(wf?.pendingChecks).toContain("Broken Tool Check");
	});
});
