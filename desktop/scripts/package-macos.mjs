import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

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
const helpDir = path.join(dmgRootDir, "打不开？");

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
}

async function writeOpenHelp() {
	await mkdir(helpDir, { recursive: true });
	const text = `Metis for macOS 打不开时请看

此安装包未经过 Apple Developer ID 公共签名与公证。仅在确认 DMG 来源可信时继续。

推荐方法（macOS 系统设置）
1. 先把 Metis.app 拖入 Applications，并尝试打开一次。
2. 打开“系统设置”>“隐私与安全性”。
3. 向下找到“安全性”，点击 Metis 对应的“仍要打开”。
4. 按系统提示输入登录密码，然后再次确认打开。

Apple 官方说明：
https://support.apple.com/zh-cn/guide/mac-help/mh40616/mac

若系统设置中没有按钮，可在“终端”执行：

xattr -dr com.apple.quarantine "/Applications/Metis.app"
open "/Applications/Metis.app"

xattr 命令会移除下载隔离属性。不要对来源不明的软件执行此命令。
`;
	await writeFile(path.join(helpDir, "Mac打不开时请看.txt"), text, "utf8");
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
	await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);

	console.log("[6/6] 生成 DMG");
	await mkdir(dmgRootDir, { recursive: true });
	await cp(appPath, path.join(dmgRootDir, "Metis.app"), { recursive: true, verbatimSymlinks: true });
	await symlink("/Applications", path.join(dmgRootDir, "Applications"));
	await writeOpenHelp();
	await rm(releaseDir, { recursive: true, force: true });
	await mkdir(releaseDir, { recursive: true });
	const dmgPath = path.join(releaseDir, `Metis-${rootPackage.version}-macos-${architecture}.dmg`);
	await run("/usr/bin/hdiutil", ["create", "-volname", "Metis", "-srcfolder", dmgRootDir, "-ov", "-format", "UDZO", dmgPath]);
	const checksum = await run("/usr/bin/shasum", ["-a", "256", dmgPath]);
	const checksumHash = checksum.trim().split(/\s+/)[0];
	await writeFile(`${dmgPath}.sha256`, `${checksumHash}  ${path.basename(dmgPath)}\n`, "utf8");
	console.log(`完成：${dmgPath}`);
} finally {
	await rm(temporaryDir, { recursive: true, force: true });
}

