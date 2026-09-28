import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AdaptationValidationError,
	listAdaptations,
	RevisionConflictError,
	rollbackAdaptation,
	writeAdaptation,
} from "../src/core/adaptations/index.ts";

describe("Adaptation Store and Validation", () => {
	let tempAgentDir: string;
	let tempCwd: string;

	beforeEach(() => {
		tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-test-agent-"));
		tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "metis-test-cwd-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tempAgentDir, { recursive: true, force: true });
			fs.rmSync(tempCwd, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("rejects invalid adaptation names with path traversal or special chars", async () => {
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "../evil",
				content: "# Evil Skill",
			}),
		).rejects.toThrow(AdaptationValidationError);

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "evil/subpath",
				content: "# Evil Skill",
			}),
		).rejects.toThrow(AdaptationValidationError);

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "INVALID_UPPERCASE",
				content: "# Skill",
			}),
		).rejects.toThrow(AdaptationValidationError);
	});

	it("protects built-in performance role names from collision", async () => {
		for (const role of ["architect", "implementer", "reviewer", "verifier"]) {
			await expect(
				writeAdaptation({
					agentDir: tempAgentDir,
					cwd: tempCwd,
					scope: "user",
					kind: "role",
					name: role,
					content: "role description",
				}),
			).rejects.toThrow(AdaptationValidationError);
		}
	});

	it("protects user handwritten resources from collision", async () => {
		// Create a handwritten skill
		const handwrittenDir = path.join(tempAgentDir, "skills", "my-handwritten-skill");
		fs.mkdirSync(handwrittenDir, { recursive: true });
		fs.writeFileSync(path.join(handwrittenDir, "SKILL.md"), "User authored skill", "utf8");

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "skill",
				name: "my-handwritten-skill",
				content: "# Overwriting attempt",
			}),
		).rejects.toThrow(/collides with user-authored resource/);
	});

	it("enforces per-kind file size limits", async () => {
		const hugeContent = "x".repeat(10 * 1024); // 10KB (profile limit is 8KB)
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "profile",
				content: hugeContent,
			}),
		).rejects.toThrow(/exceeds limit/);
	});

	it("prevents architecture adaptation from hiding control-plane safety tools", async () => {
		const evilArch = JSON.stringify({
			hiddenTools: ["update_plan", "bash"],
		});

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "architecture",
				content: evilArch,
			}),
		).rejects.toThrow(/Cannot hide control plane tools: update_plan/);
	});

	it("validates workflow adaptation routeBias and extraChecks", async () => {
		const invalidRouteBias = JSON.stringify({
			routeBias: { implementer: "malicious-nonexistent-role" },
		});

		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "workflow",
				content: invalidRouteBias,
			}),
		).rejects.toThrow(/routeBias target role 'malicious-nonexistent-role' is invalid/);

		const validWorkflow = JSON.stringify({
			extraChecks: [
				{ id: "lint", name: "Run Lint", command: "npm run lint", status: "active" },
			],
			routeBias: { architect: "lead" },
			verificationCommands: ["npm test"],
		});

		const res = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "workflow",
			content: validWorkflow,
		});
		expect(res.revision).toBe(1);
	});

	it("blocks project-level adaptation when project is not trusted", async () => {
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "project",
				kind: "profile",
				content: "project profile",
				projectTrusted: false,
			}),
		).rejects.toThrow(/Cannot load or apply project-level adaptations in an untrusted project/);
	});

	it("supports optimistic revision locking", async () => {
		const r1 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "profile v1",
		});
		expect(r1.revision).toBe(1);

		// Conflict if expectedRevision does not match current (1)
		await expect(
			writeAdaptation({
				agentDir: tempAgentDir,
				cwd: tempCwd,
				scope: "user",
				kind: "profile",
				content: "profile v2 conflict",
				expectedRevision: 0,
			}),
		).rejects.toThrow(RevisionConflictError);

		// Success if expectedRevision matches current (1)
		const r2 = await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "profile v2",
			expectedRevision: 1,
		});
		expect(r2.revision).toBe(2);
	});

	it("supports atomic rollback to previous revision or initial clean state", async () => {
		// Revision 1
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "Initial profile content",
		});

		// Revision 2
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "Updated profile content",
		});

		const profilePath = path.join(tempAgentDir, "adaptations", "profile.md");
		expect(fs.readFileSync(profilePath, "utf8")).toBe("Updated profile content");

		// Rollback to revision 1
		await rollbackAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			targetRevision: 1,
		});

		expect(fs.readFileSync(profilePath, "utf8")).toBe("Initial profile content");

		// Rollback to revision 0 (clean slate, deletes file)
		await rollbackAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			targetRevision: 0,
		});

		expect(fs.existsSync(profilePath)).toBe(false);
	});

	it("lists adaptations across user and project scopes", async () => {
		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "profile",
			content: "user profile",
		});

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "user",
			kind: "skill",
			name: "custom-skill",
			content: "---\nname: custom-skill\n---\nBody",
		});

		await writeAdaptation({
			agentDir: tempAgentDir,
			cwd: tempCwd,
			scope: "project",
			kind: "architecture",
			content: JSON.stringify({ customGuidelines: ["Use pnpm"] }),
			projectTrusted: true,
		});

		const list = listAdaptations(tempAgentDir, tempCwd, { projectTrusted: true });
		expect(list).toHaveLength(3);
		expect(list.map((a) => a.id)).toEqual(
			expect.arrayContaining(["user:profile", "user:skill:custom-skill", "project:architecture"]),
		);
	});
});
