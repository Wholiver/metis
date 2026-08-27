const fs = require("node:fs");
const path = require("node:path");

const NUMBERED_RUNTIME_DIRECTORY_PATTERN = / \d+$/;
const REQUIRED_RUNTIME_FILES = [
	"cli.js",
	"config.js",
	"core/agent-session.js",
	"modes/server/server-mode.js",
	"utils/child-process.js",
];

function getMetisRuntimeIntegrityError(cliPath) {
	const runtimeDir = path.dirname(cliPath);
	const missing = REQUIRED_RUNTIME_FILES.filter((relativePath) => !fs.existsSync(path.join(runtimeDir, relativePath)));
	if (missing.length > 0) return `missing ${missing.join(", ")}`;

	const pending = [runtimeDir];
	while (pending.length > 0) {
		const directory = pending.pop();
		if (!directory) continue;
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === "node_modules") continue;
			if (NUMBERED_RUNTIME_DIRECTORY_PATTERN.test(entry.name)) {
				return `iCloud-style conflict directory ${path.relative(runtimeDir, path.join(directory, entry.name))}`;
			}
			pending.push(path.join(directory, entry.name));
		}
	}
	return undefined;
}

module.exports = { getMetisRuntimeIntegrityError };

