import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneBundledRuntime, pruneElectronLocales } from "../desktop/scripts/prune-packaged-app.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "metis-prune-"));
	tempDirs.push(dir);
	return dir;
}

async function write(file: string, contents = "x"): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, contents);
}

async function exists(file: string): Promise<boolean> {
	try {
		await readFile(file);
		return true;
	} catch {
		return false;
	}
}

describe("packaged app pruning", () => {
	it("keeps only the current ONNX native binding and drops wasm plus source maps", async () => {
		const root = await tempDir();
		const runtime = path.join(root, "runtime");
		await write(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node"), "arm64");
		await write(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/darwin/x64/onnxruntime_binding.node"), "x64");
		await write(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node"), "win");
		await write(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node"), "linux");
		await write(path.join(runtime, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"), "wasm");
		await write(path.join(runtime, "node_modules/onnxruntime-web/dist/ort.js"), "js");
		await write(path.join(runtime, "node_modules/onnxruntime-web/dist/ort.js.map"), "map");
		await write(path.join(runtime, "node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm"), "photon");
		await write(path.join(runtime, "dist/video-bin/ffmpeg"), "ffmpeg");
		await write(path.join(runtime, "node_modules/chalk/index.js"), "chalk");
		await write(path.join(runtime, "node_modules/chalk/index.js.map"), "map");

		const removed = await pruneBundledRuntime(runtime, "darwin", "arm64");

		expect(removed.length).toBeGreaterThan(0);
		expect(await exists(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node"))).toBe(true);
		expect(await exists(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/darwin/x64/onnxruntime_binding.node"))).toBe(false);
		expect(await exists(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node"))).toBe(false);
		expect(await exists(path.join(runtime, "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node"))).toBe(false);
		expect(await exists(path.join(runtime, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"))).toBe(false);
		expect(await exists(path.join(runtime, "node_modules/onnxruntime-web/dist/ort.js"))).toBe(true);
		expect(await exists(path.join(runtime, "node_modules/onnxruntime-web/dist/ort.js.map"))).toBe(false);
		expect(await exists(path.join(runtime, "node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm"))).toBe(true);
		expect(await exists(path.join(runtime, "dist/video-bin/ffmpeg"))).toBe(true);
		expect(await exists(path.join(runtime, "node_modules/chalk/index.js"))).toBe(true);
		expect(await exists(path.join(runtime, "node_modules/chalk/index.js.map"))).toBe(false);
	});

	it("keeps English and Chinese Electron locales", async () => {
		const app = await tempDir();
		const resources = path.join(app, "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources");
		await write(path.join(resources, "en.lproj/locale.pak"), "en");
		await write(path.join(resources, "zh_CN.lproj/locale.pak"), "zh");
		await write(path.join(resources, "fr.lproj/locale.pak"), "fr");
		await write(path.join(resources, "resources.pak"), "resources");
		await write(path.join(app, "locales/en-US.pak"), "en");
		await write(path.join(app, "locales/zh-CN.pak"), "zh");
		await write(path.join(app, "locales/ja.pak"), "ja");
		await write(path.join(app, "resources.pak"), "root");

		await pruneElectronLocales(app);

		expect(await exists(path.join(resources, "en.lproj/locale.pak"))).toBe(true);
		expect(await exists(path.join(resources, "zh_CN.lproj/locale.pak"))).toBe(true);
		expect(await exists(path.join(resources, "fr.lproj/locale.pak"))).toBe(false);
		expect(await exists(path.join(resources, "resources.pak"))).toBe(true);
		expect(await exists(path.join(app, "locales/en-US.pak"))).toBe(true);
		expect(await exists(path.join(app, "locales/zh-CN.pak"))).toBe(true);
		expect(await exists(path.join(app, "locales/ja.pak"))).toBe(false);
		expect(await exists(path.join(app, "resources.pak"))).toBe(true);
	});
});
