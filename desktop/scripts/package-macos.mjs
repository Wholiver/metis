import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { HELP_FILE_NAME, HELP_FOLDER_NAME, getOpenHelpText } from "./dmg-help-content.mjs";
import { pruneBundledRuntime, pruneElectronLocales } from "./prune-packaged-app.mjs";

const execFileAsync = promisify(execFile);
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(desktopDir, "..");
const releaseDir = path.join(desktopDir, "release");
const rootPackage = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const architecture = process.arch;

if (process.platform !== "darwin") throw new Error("macOS DMG 只能在 macOS 上构建");
if (!new Set(["arm64", "x64"]).has(architecture)) throw new Error(`不支持的 macOS 架构：${architecture}`);

const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "metis-macos-package-"));
const iconsetDir = path.join(temporaryDir, "Metis.iconset");
const iconPath = path.join(temporaryDir, "Metis.icns");
const runtimeDir = path.join(temporaryDir, "metis-runtime");
const packagedAppsDir = path.join(temporaryDir, "apps");
const dmgRootDir = path.join(temporaryDir, "dmg");

async function run(command, args, { logOutput = true, ...options } = {}) {
	const { stdout = "", stderr = "" } = await execFileAsync(command, args, {
		cwd: rootDir,
		maxBuffer: 20 * 1024 * 1024,
		...options,
	});
	if (logOutput && stdout.trim()) process.stdout.write(stdout);
	if (logOutput && stderr.trim()) process.stderr.write(stderr);
	return stdout;
}

async function buildIcon() {
	await mkdir(iconsetDir, { recursive: true });
	const svgPath = path.join(desktopDir, "public", "assets", "metis-app-icon-centered.svg");
	const variants = [
		[16, "icon_16x16.png"],
		[32, "icon_16x16@2x.png"],
		[32, "icon_32x32.png"],
		[64, "icon_32x32@2x.png"],
		[128, "icon_128x128.png"],
		[256, "icon_128x128@2x.png"],
		[256, "icon_256x256.png"],
		[512, "icon_256x256@2x.png"],
		[512, "icon_512x512.png"],
		[1024, "icon_512x512@2x.png"],
	];
	for (const [size, filename] of variants) {
		await run("/usr/bin/sips", ["-s", "format", "png", "-z", String(size), String(size), svgPath, "--out", path.join(iconsetDir, filename)]);
	}
	await run("/usr/bin/iconutil", ["-c", "icns", iconsetDir, "-o", iconPath]);
}

async function buildBundledRuntime() {
	await mkdir(runtimeDir, { recursive: true });
	const output = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryDir], {
		env: { ...process.env, METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE: "1" },
		logOutput: false,
	});
	const packResult = JSON.parse(output);
	const archivePath = path.join(temporaryDir, packResult[0].filename);
	await run("/usr/bin/tar", ["-xzf", archivePath, "-C", runtimeDir, "--strip-components=1"]);
	// npm package bundling only carries explicitly bundled local packages. Install the
	await cp(path.join(rootDir, "vendor"), path.join(runtimeDir, "vendor"), { recursive: true, verbatimSymlinks: true });
	await cp(path.join(rootDir, "dist"), path.join(runtimeDir, "dist"), { recursive: true });
	await run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
		cwd: runtimeDir,
		env: { ...process.env, METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE: "1" },
	});
	for (const name of ["ffmpeg", "ffprobe"]) {
		await run(path.join(runtimeDir, "dist", "video-bin", name), ["-version"], { logOutput: false });
	}
	await run(process.execPath, [path.join(runtimeDir, "dist", "cli.js"), "--version"], {
		env: { ...process.env, METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE: "1" },
	});
	const pruned = await pruneBundledRuntime(runtimeDir, process.platform, architecture);
	console.log(`已裁剪内置运行时 ${pruned.length} 项（仅保留 ${process.platform}/${architecture} 的 ONNX 原生库）`);
}

async function buildDmgBackground() {
	const bgDir = path.join(dmgRootDir, ".background");
	await mkdir(bgDir, { recursive: true });
	const svgPath = path.join(desktopDir, "public", "assets", "dmg-background.svg");
	const png1xPath = path.join(bgDir, "background.png");
	const png2xPath = path.join(temporaryDir, "background@2x.png");
	const tiffPath = path.join(bgDir, "background.tiff");

	try {
		const { Resvg } = await import("@resvg/resvg-js");
		const svgContent = await readFile(svgPath, "utf8");
		const resvg1x = new Resvg(svgContent, { fitTo: { mode: "width", value: 660 } });
		await writeFile(png1xPath, resvg1x.render().asPng());
		const resvg2x = new Resvg(svgContent, { fitTo: { mode: "width", value: 1320 } });
		await writeFile(png2xPath, resvg2x.render().asPng());
	} catch {
		await run("/usr/bin/sips", ["-s", "format", "png", "-z", "480", "660", svgPath, "--out", png1xPath], { logOutput: false });
		await run("/usr/bin/sips", ["-s", "format", "png", "-z", "960", "1320", svgPath, "--out", png2xPath], { logOutput: false });
	}

	try {
		await run("/usr/bin/tiffutil", ["-cathidpicheck", png1xPath, png2xPath, "-out", tiffPath], { logOutput: false });
	} catch {}
}

async function writeOpenHelp() {
	const helpDir = path.join(dmgRootDir, HELP_FOLDER_NAME);
	await mkdir(helpDir, { recursive: true });
	await writeFile(path.join(helpDir, HELP_FILE_NAME), getOpenHelpText(), "utf8");
}

try {
	console.log("[1/6] 构建 Metis CLI 与 Server");
	await run("npm", ["run", "build"]);

	console.log("[2/6] 构建 Desktop renderer");
	await run("npm", ["--prefix", desktopDir, "run", "build"]);

	console.log("[3/6] 生成应用图标");
	await buildIcon();

	console.log("[4/6] 打包内置 CLI/Server 运行时");
	await buildBundledRuntime();

	console.log("[5/6] 生成 Metis.app");
	const appPaths = await packager({
		dir: path.join(desktopDir, "dist"),
		out: packagedAppsDir,
		name: "Metis",
		platform: "darwin",
		arch: architecture,
		icon: iconPath,
		appBundleId: "com.wholiver.metis",
		appVersion: rootPackage.version,
		buildVersion: rootPackage.version.match(/^\d+(?:\.\d+)*/)?.[0] ?? "1.0.0",
		asar: true,
		prune: false,
		overwrite: true,
	});
	const appPath = path.join(appPaths[0], "Metis.app");
	await cp(runtimeDir, path.join(appPath, "Contents", "Resources", "metis-runtime"), {
		recursive: true,
		verbatimSymlinks: true,
	});
	const prunedLocales = await pruneElectronLocales(appPath);
	console.log(`已移除 ${prunedLocales.length} 个未使用的 Electron 语言包`);
	await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);

	console.log("[6/6] 生成 DMG");
	await mkdir(dmgRootDir, { recursive: true });
	await cp(appPath, path.join(dmgRootDir, "Metis.app"), { recursive: true, verbatimSymlinks: true });
	await symlink("/Applications", path.join(dmgRootDir, "Applications"));
	await writeOpenHelp();
	await buildDmgBackground();

	await rm(releaseDir, { recursive: true, force: true });
	await mkdir(releaseDir, { recursive: true });
	const dmgPath = path.join(releaseDir, `Metis-${rootPackage.version}-macos-${architecture}.dmg`);
	const tempDmgPath = path.join(temporaryDir, "metis-layout.dmg");

	let styled = false;
	try {
		await run("/usr/bin/hdiutil", ["create", "-srcfolder", dmgRootDir, "-volname", "Metis", "-format", "UDRW", "-ov", tempDmgPath]);
		await run("/usr/bin/hdiutil", ["attach", tempDmgPath, "-readwrite", "-noverify", "-noautoopen"]);

		const appleScript = `
tell application "Finder"
	tell disk "Metis"
		open
		set current view of container window to icon view
		set toolbar visible of container window to false
		set statusbar visible of container window to false
		set the bounds of container window to {200, 150, 860, 630}
		set viewOptions to the icon view options of container window
		set arrangement of viewOptions to not arranged
		set icon size of viewOptions to 110
		set text size of viewOptions to 12
		try
			set background picture of viewOptions to file ".background:background.tiff"
		on error
			try
				set background picture of viewOptions to file ".background:background.png"
			end try
		end try
		set position of item "Metis.app" of container window to {165, 175}
		set position of item "Applications" of container window to {495, 175}
		set position of item "${HELP_FOLDER_NAME}" of container window to {330, 365}
		close
		open
		update without registering applications
		delay 1
	end tell
end tell`;

		try {
			await run("/usr/bin/osascript", ["-e", appleScript], { logOutput: false });
			styled = true;
		} catch (error) {
			console.warn("提示：未能通过 Finder AppleScript 调整 DMG 视图（可能是无头 CI 环境），将使用默认视图布局。错误：", error.message);
		}

		try {
			await run("/bin/chmod", ["-Rf", "go-w", "/Volumes/Metis"], { logOutput: false });
		} catch {}

		await run("/usr/bin/hdiutil", ["detach", "/Volumes/Metis", "-force"], { logOutput: false });

		if (styled) {
			await run("/usr/bin/hdiutil", ["convert", tempDmgPath, "-format", "UDZO", "-imagekey", "zlib-level=9", "-ov", "-o", dmgPath]);
		}
	} catch (error) {
		console.warn("提示：高级 DMG 样式生成异常，自动降级至标准 hdiutil 生成。原因：", error.message);
		styled = false;
	}

	if (!styled) {
		await run("/usr/bin/hdiutil", ["create", "-volname", "Metis", "-srcfolder", dmgRootDir, "-ov", "-format", "UDZO", dmgPath]);
	}
	console.log(`完成：${dmgPath}`);
} finally {
	try {
		await run("/usr/bin/hdiutil", ["detach", "/Volumes/Metis", "-force"], { logOutput: false });
	} catch {}
	await rm(temporaryDir, { recursive: true, force: true });
}

