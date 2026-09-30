import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const ONNX_PLATFORMS = new Set(["darwin", "linux", "win32"]);

/** Electron locale folders/paks to keep. Metis UI is English and Simplified Chinese. */
const KEEP_LOCALE = new Set([
	"en",
	"en_us",
	"en-us",
	"en_gb",
	"en-gb",
	"zh",
	"zh_cn",
	"zh-cn",
	"zh_tw",
	"zh-tw",
	"zh_hans",
	"zh-hans",
	"zh_hant",
	"zh-hant",
]);

function keepLocale(name) {
	return KEEP_LOCALE.has(name.toLowerCase());
}

async function readDirIfExists(dir) {
	try {
		return await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
}

/**
 * Drop ONNX binaries for other OS/CPU targets, browser WASM fallbacks, and
 * source maps from the bundled CLI runtime. Video ffmpeg binaries and the
 * current platform's onnxruntime-node binding stay in place.
 */
export async function pruneBundledRuntime(runtimeDir, platform = process.platform, arch = process.arch) {
	const removed = [];
	const binRoot = path.join(runtimeDir, "node_modules", "onnxruntime-node", "bin");
	for (const napi of await readDirIfExists(binRoot)) {
		if (!napi.isDirectory() || napi.isSymbolicLink()) continue;
		const napiDir = path.join(binRoot, napi.name);
		for (const platformEntry of await readDirIfExists(napiDir)) {
			if (!platformEntry.isDirectory() || platformEntry.isSymbolicLink()) continue;
			if (!ONNX_PLATFORMS.has(platformEntry.name)) continue;
			const platformDir = path.join(napiDir, platformEntry.name);
			if (platformEntry.name !== platform) {
				await rm(platformDir, { recursive: true, force: true });
				removed.push(platformDir);
				continue;
			}
			for (const archEntry of await readDirIfExists(platformDir)) {
				if (!archEntry.isDirectory() || archEntry.isSymbolicLink()) continue;
				if (archEntry.name === arch) continue;
				const archDir = path.join(platformDir, archEntry.name);
				await rm(archDir, { recursive: true, force: true });
				removed.push(archDir);
			}
		}
	}

	const webRoot = path.join(runtimeDir, "node_modules", "onnxruntime-web");
	await removeMatchingFiles(webRoot, (name) => name.endsWith(".wasm") || name.endsWith(".map"), removed);

	const modulesRoot = path.join(runtimeDir, "node_modules");
	await removeMatchingFiles(modulesRoot, (name) => name.endsWith(".map"), removed);
	return removed;
}

/** Remove unused Chromium locale packs from a packaged Electron app. */
export async function pruneElectronLocales(appRoot) {
	const removed = [];
	await walk(appRoot, async (full, entry) => {
		if (entry.isDirectory() && entry.name.endsWith(".lproj")) {
			const lang = entry.name.slice(0, -".lproj".length);
			if (!keepLocale(lang)) {
				await rm(full, { recursive: true, force: true });
				removed.push(full);
				return "skip";
			}
		}
		if (entry.isFile() && entry.name.endsWith(".pak") && path.basename(path.dirname(full)) === "locales") {
			const lang = entry.name.slice(0, -".pak".length);
			if (!keepLocale(lang)) {
				await rm(full, { force: true });
				removed.push(full);
			}
		}
		return undefined;
	});
	return removed;
}

async function removeMatchingFiles(root, match, removed) {
	await walk(root, async (full, entry) => {
		if (!entry.isFile() || !match(entry.name)) return undefined;
		await rm(full, { force: true });
		removed.push(full);
		return undefined;
	});
}

async function walk(root, visit) {
	for (const entry of await readDirIfExists(root)) {
		if (entry.isSymbolicLink()) continue;
		const full = path.join(root, entry.name);
		const action = await visit(full, entry);
		if (action === "skip" || !entry.isDirectory()) continue;
		await walk(full, visit);
	}
}
