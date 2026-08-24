const fsp = require("node:fs/promises");
const path = require("node:path");

class WorkspaceCreateError extends Error {
	constructor(code, detail) {
		super(detail || code);
		this.code = code;
	}
}

function validateProjectName(value) {
	const name = String(value || "").trim();
	if (!name || name === "." || name === ".." || /[<>:"/\\|?*\x00-\x1f]/.test(name)) {
		throw new WorkspaceCreateError("invalid_project_name");
	}
	return name;
}

async function createWorkspaceDirectory(parentPath, projectName) {
	if (typeof parentPath !== "string" || !parentPath.trim()) throw new WorkspaceCreateError("invalid_parent_path");
	const parent = path.resolve(parentPath);
	let parentStats;
	try {
		parentStats = await fsp.stat(parent);
	} catch {
		throw new WorkspaceCreateError("parent_missing", parent);
	}
	if (!parentStats.isDirectory()) throw new WorkspaceCreateError("parent_missing", parent);

	const name = validateProjectName(projectName);
	const target = path.resolve(parent, name);
	const relative = path.relative(parent, target);
	if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new WorkspaceCreateError("invalid_project_name");
	}

	try {
		await fsp.mkdir(target);
	} catch (error) {
		if (error && error.code === "EEXIST") throw new WorkspaceCreateError("target_exists", target);
		throw error;
	}
	return { name, path: target };
}

module.exports = { WorkspaceCreateError, createWorkspaceDirectory, validateProjectName };
