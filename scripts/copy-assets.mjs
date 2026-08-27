import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const numberedConflictDirectoryPattern = / \d+$/;

function shouldCopyRuntimeAsset(source) {
	return !numberedConflictDirectoryPattern.test(basename(source));
}

function copyMatching(source, target, extensions) {
	mkdirSync(target, { recursive: true });
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		if (entry.isFile() && extensions.has(extname(entry.name))) {
			cpSync(join(source, entry.name), join(target, entry.name));
		}
	}
}

copyMatching(
	join(root, "src/modes/interactive/theme"),
	join(root, "dist/modes/interactive/theme"),
	new Set([".json"]),
);
copyMatching(
	join(root, "src/modes/interactive/assets"),
	join(root, "dist/modes/interactive/assets"),
	new Set([".png", ".svg"]),
);
copyMatching(
	join(root, "src/core/export-html"),
	join(root, "dist/core/export-html"),
	new Set([".html", ".css", ".js"]),
);
copyMatching(
	join(root, "src/core/export-html/vendor"),
	join(root, "dist/core/export-html/vendor"),
	new Set([".js"]),
);

if (existsSync(join(root, "src/core/builtins"))) {
	cpSync(join(root, "src/core/builtins"), join(root, "dist/core/builtins"), {
		recursive: true,
		filter: shouldCopyRuntimeAsset,
	});
}

const executableExtension = process.platform === "win32" ? ".exe" : "";
const videoBinaries = [
	["ffmpeg", join(root, "node_modules/ffmpeg-static", `ffmpeg${executableExtension}`)],
	["ffprobe", join(root, "node_modules/@derhuerst/ffprobe-static", `ffprobe${executableExtension}`)],
];
for (const [name, source] of videoBinaries) {
	if (!existsSync(source)) throw new Error(`Required ${name} binary is missing: ${source}`);
	const target = join(root, "dist/video-bin", `${name}${executableExtension}`);
	mkdirSync(dirname(target), { recursive: true });
	cpSync(source, target);
	chmodSync(target, 0o755);
}

for (const executable of ["cli.js", "rpc-entry.js"]) {
	chmodSync(join(root, "dist", executable), 0o755);
}

