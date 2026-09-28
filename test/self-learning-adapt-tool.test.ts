import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdaptToolDefinition } from "../src/core/tools/adapt.ts";

describe("Adapt Tool & Dynamic Refresh", () => {
	let tempDir: string;
	let tempAgentDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-adapt-tool-test-"));
		tempAgentDir = path.join(tempDir, "agent");
		fs.mkdirSync(tempAgentDir, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("applies a skill adaptation, records journal, and calls onRefreshAdaptations", async () => {
		const refreshSpy = vi.fn();
		const tool = createAdaptToolDefinition(tempDir, {
			agentDir: tempAgentDir,
			isProjectTrusted: () => true,
			getCollaborationMode: () => "build",
			isNamedAgentSession: () => false,
			onRefreshAdaptations: refreshSpy,
		});

		const result = await tool.execute("call-1", {
			action: "apply",
			scope: "project",
			kind: "skill",
			name: "code-style",
			content: "---\nname: code-style\ndescription: Project coding style\n---\nUse functional style.",
		});

		expect(result.content[0]?.text).toContain("Successfully applied skill adaptation 'code-style'");
		expect(result.details?.revision).toBe(1);
		expect(refreshSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "apply",
				kind: "skill",
				name: "code-style",
				scope: "project",
			}),
		);

		// Verify file written
		expect(fs.existsSync(result.details?.filePath as string)).toBe(true);
		expect(fs.readFileSync(result.details?.filePath as string, "utf8")).toContain("Use functional style.");
	});

	it("rolls back an adaptation to revision 0 (deletion) and restores on rollback to revision 1", async () => {
		const refreshSpy = vi.fn();
		const tool = createAdaptToolDefinition(tempDir, {
			agentDir: tempAgentDir,
			isProjectTrusted: () => true,
			getCollaborationMode: () => "build",
			isNamedAgentSession: () => false,
			onRefreshAdaptations: refreshSpy,
		});

		// Rev 1
		await tool.execute("call-1", {
			action: "apply",
			scope: "user",
			kind: "profile",
			content: "I prefer typescript.",
		});

		// Rev 2
		await tool.execute("call-2", {
			action: "apply",
			scope: "user",
			kind: "profile",
			content: "I prefer typescript and vitest.",
		});

		// Rollback to rev 1
		const rbResult = await tool.execute("call-3", {
			action: "rollback",
			scope: "user",
			kind: "profile",
			targetRevision: 1,
		});

		expect(rbResult.content[0]?.text).toContain("Successfully rolled back profile adaptation");
		expect(refreshSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "rollback",
				kind: "profile",
				scope: "user",
			}),
		);

		// Rollback to 0 (delete)
		await tool.execute("call-4", {
			action: "rollback",
			scope: "user",
			kind: "profile",
			targetRevision: 0,
		});

		const userProfilePath = path.join(tempAgentDir, "adaptations", "profile.md");
		expect(fs.existsSync(userProfilePath)).toBe(false);
	});

	it("lists active adaptations across scopes", async () => {
		const tool = createAdaptToolDefinition(tempDir, {
			agentDir: tempAgentDir,
			isProjectTrusted: () => true,
			getCollaborationMode: () => "build",
			isNamedAgentSession: () => false,
		});

		// Empty list
		const emptyResult = await tool.execute("call-1", { action: "list" });
		expect(emptyResult.content[0]?.text).toContain("No active adaptations found");

		// Apply profile
		await tool.execute("call-2", {
			action: "apply",
			scope: "user",
			kind: "profile",
			content: "User profile preferences.",
		});

		const listResult = await tool.execute("call-3", { action: "list" });
		expect(listResult.content[0]?.text).toContain("Active adaptations (1):");
		expect(listResult.content[0]?.text).toContain("user");
		expect(listResult.content[0]?.text).toContain("profile");
	});

	it("rejects execution in named child agent sessions", async () => {
		const tool = createAdaptToolDefinition(tempDir, {
			agentDir: tempAgentDir,
			isProjectTrusted: () => true,
			getCollaborationMode: () => "build",
			isNamedAgentSession: () => true,
		});

		await expect(
			tool.execute("call-1", {
				action: "list",
			}),
		).rejects.toThrow("The 'adapt' tool is only available in root sessions.");
	});

	it("allows data-only products in Plan mode, but strictly rejects tool and hook products", async () => {
		const tool = createAdaptToolDefinition(tempDir, {
			agentDir: tempAgentDir,
			isProjectTrusted: () => true,
			getCollaborationMode: () => "plan",
			isNamedAgentSession: () => false,
		});

		// Data products allowed in Plan mode
		const profileResult = await tool.execute("call-1", {
			action: "apply",
			scope: "project",
			kind: "profile",
			content: "Plan mode data product test",
		});
		expect(profileResult.details?.revision).toBe(1);

		const skillResult = await tool.execute("call-2", {
			action: "apply",
			scope: "project",
			kind: "skill",
			name: "plan-skill",
			content: "---\nname: plan-skill\ndescription: Plan skill\n---\nPrompt",
		});
		expect(skillResult.details?.revision).toBe(1);

		// Code products (tools, hooks) rejected in Plan mode
		await expect(
			tool.execute("call-3", {
				action: "apply",
				scope: "project",
				kind: "tool",
				name: "custom-tool",
				content: "export default {}",
			}),
		).rejects.toThrow("Modifying tool adaptations is not permitted in Plan mode");

		await expect(
			tool.execute("call-4", {
				action: "apply",
				scope: "project",
				kind: "hook",
				name: "custom-hook",
				content: "export default {}",
			}),
		).rejects.toThrow("Modifying hook adaptations is not permitted in Plan mode");
	});

	it("enforces optimistic locking with expectedRevision", async () => {
		const tool = createAdaptToolDefinition(tempDir, {
			agentDir: tempAgentDir,
			isProjectTrusted: () => true,
			getCollaborationMode: () => "build",
			isNamedAgentSession: () => false,
		});

		// Rev 1
		await tool.execute("call-1", {
			action: "apply",
			scope: "user",
			kind: "profile",
			content: "Rev 1 content",
		});

		// Rev 2 with correct expectedRevision
		await tool.execute("call-2", {
			action: "apply",
			scope: "user",
			kind: "profile",
			content: "Rev 2 content",
			expectedRevision: 1,
		});

		// Rev 3 with stale expectedRevision fails
		await expect(
			tool.execute("call-3", {
				action: "apply",
				scope: "user",
				kind: "profile",
				content: "Rev 3 content",
				expectedRevision: 1, // Current is 2!
			}),
		).rejects.toThrow("Revision conflict");
	});
});
