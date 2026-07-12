import { chmodSync, cpSync, mkdirSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

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

for (const executable of ["cli.js", "rpc-entry.js"]) {
	chmodSync(join(root, "dist", executable), 0o755);
}
