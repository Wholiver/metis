import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distUrl = new URL("../dist", import.meta.url);
const distPath = fileURLToPath(distUrl);

if (process.env.METIS_PRESERVE_DIST === "1" || process.env.METIS_SAFE_BUILD === "1") {
	process.exit(0);
}

if (existsSync(distPath)) {
	try {
		rmSync(distUrl, { force: true, recursive: true });
	} catch (err) {
		console.warn("Warning: Could not clean dist directory completely:", err?.message || err);
	}
}

