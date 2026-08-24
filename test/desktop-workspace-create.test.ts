import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const workspaceCreate = require("../desktop/workspace-create.cjs") as {
	createWorkspaceDirectory(parentPath: string, projectName: string): Promise<{ name: string; path: string }>;
};

describe("Desktop workspace creation", () => {
	let parent: string;

	beforeEach(async () => {
		parent = await fs.mkdtemp(path.join(os.tmpdir(), "metis-workspace-create-"));
	});

	afterEach(async () => {
		await fs.rm(parent, { recursive: true, force: true });
	});

	it("creates exactly one named child directory", async () => {
		const created = await workspaceCreate.createWorkspaceDirectory(parent, "first-project");
		expect(created).toEqual({ name: "first-project", path: path.join(parent, "first-project") });
		expect((await fs.stat(created.path)).isDirectory()).toBe(true);
	});

	it("rejects empty and traversal-shaped project names", async () => {
		for (const name of ["", " ", ".", "..", "../outside", "nested/project", "nested\\project"]) {
			await expect(workspaceCreate.createWorkspaceDirectory(parent, name)).rejects.toMatchObject({ code: "invalid_project_name" });
		}
	});

	it("never overwrites an existing project directory", async () => {
		await fs.mkdir(path.join(parent, "existing"));
		await expect(workspaceCreate.createWorkspaceDirectory(parent, "existing")).rejects.toMatchObject({ code: "target_exists" });
	});

	it("rejects a parent directory that does not exist", async () => {
		await expect(workspaceCreate.createWorkspaceDirectory(path.join(parent, "missing"), "project")).rejects.toMatchObject({ code: "parent_missing" });
	});
});
