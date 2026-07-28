import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { createMetisIco } from "./metis-icon.mjs";

const execFileAsync = promisify(execFile);
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(desktopDir, "..");
const releaseDir = path.join(desktopDir, "release");
const rootPackage = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const architecture = process.arch;

if (process.platform !== "win32") throw new Error("Windows ZIP 只能在 Windows 上构建");
if (!new Set(["arm64", "x64"]).has(architecture)) throw new Error(`不支持的 Windows 架构：${architecture}`);

const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "metis-windows-package-"));
const iconPath = path.join(temporaryDir, "Metis.ico");
const runtimeDir = path.join(temporaryDir, "metis-runtime");
const packagedAppsDir = path.join(temporaryDir, "apps");
const zipStageDir = path.join(temporaryDir, "zip");
const helpDir = path.join(zipStageDir, "打不开？");

function quoteWindowsArg(value) {
	const text = String(value);
	if (!/[ \t"]/u.test(text)) return text;
	return `"${text.replaceAll('"', '\\"')}"`;
}

async function run(command, args, { logOutput = true, ...options } = {}) {
	const isWindows = process.platform === "win32";
	const isNpm = command === "npm" || command === "npx";
	let stdout = "";
	let stderr = "";
	if (isWindows && isNpm) {
		const commandLine = [command, ...args].map(quoteWindowsArg).join(" ");
		({ stdout = "", stderr = "" } = await execFileAsync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
			cwd: rootDir,
			maxBuffer: 20 * 1024 * 1024,
			windowsHide: true,
			...options,
		}));
	} else {
		({ stdout = "", stderr = "" } = await execFileAsync(command, args, {
			cwd: rootDir,
			maxBuffer: 20 * 1024 * 1024,
			windowsHide: true,
			...options,
		}));
	}
	if (logOutput && stdout.trim()) process.stdout.write(stdout);
	if (logOutput && stderr.trim()) process.stderr.write(stderr);
	return stdout;
}

async function copyTree(source, destination, { materialize = process.platform === "win32" } = {}) {
	if (materialize) {
		await mkdir(destination, { recursive: true });
		try {
			await execFileAsync("robocopy", [source, destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"], {
				cwd: rootDir,
				maxBuffer: 20 * 1024 * 1024,
				windowsHide: true,
			});
		} catch (error) {
			const code = Number(error.code);
			if (Number.isFinite(code) && code >= 0 && code <= 7) return;
			throw error;
		}
		return;
	}
	await cp(source, destination, { recursive: true, force: true });
}

async function buildIcon() {
	await writeFile(iconPath, createMetisIco());
}

async function buildBundledRuntime() {
	await mkdir(runtimeDir, { recursive: true });
	const output = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryDir], {
		env: { ...process.env, METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE: "1" },
		logOutput: false,
	});
	const packResult = JSON.parse(output);
	const archivePath = path.join(temporaryDir, packResult[0].filename);
	await run("tar", ["-xzf", archivePath, "-C", runtimeDir, "--strip-components=1"], { logOutput: false });
	await copyTree(path.join(rootDir, "vendor"), path.join(runtimeDir, "vendor"));
	await run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
		cwd: runtimeDir,
		env: { ...process.env, METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE: "1" },
	});
	await run(process.execPath, [path.join(runtimeDir, "dist", "cli.js"), "--version"], {
		env: { ...process.env, METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE: "1" },
	});
}

async function writeOpenHelp() {
	await mkdir(helpDir, { recursive: true });
	const text = `Metis for Windows 打不开时请看

此安装包未经过 Windows 代码签名认证。仅在确认 ZIP 来源可信时继续。

若 SmartScreen 提示“Windows 已保护你的电脑”：
1. 点击“更多信息”。
2. 再点击“仍要运行”。

也可在资源管理器中右键 Metis.exe → 属性，如有“解除锁定”选项请勾选后确定，再重新打开。

不要对来源不明的软件执行上述操作。
`;
	await writeFile(path.join(helpDir, "Windows打不开时请看.txt"), text, "utf8");
}

async function createZipArchive(sourceDir, zipPath) {
	await run("tar", ["-a", "-cf", zipPath, "-C", sourceDir, "."], { logOutput: false });
}

async function writeSha256(filePath) {
	const hash = createHash("sha256");
	const data = await readFile(filePath);
	hash.update(data);
	const digest = hash.digest("hex");
	await writeFile(`${filePath}.sha256`, `${digest}  ${path.basename(filePath)}\n`, "utf8");
	return digest;
}

try {
	console.log("[1/6] 构建 Metis CLI 与 Server");
	await run("npm", ["run", "build"]);

	console.log("[2/6] 构建 Desktop renderer");
	await run("npm", ["run", "build"], { cwd: desktopDir });

	console.log("[3/6] 生成应用图标");
	await buildIcon();

	console.log("[4/6] 打包内置 CLI/Server 运行时");
	await buildBundledRuntime();

	console.log("[5/6] 生成 Metis Windows 应用");
	const appPaths = await packager({
		dir: path.join(desktopDir, "dist"),
		out: packagedAppsDir,
		name: "Metis",
		platform: "win32",
		arch: architecture,
		icon: iconPath,
		appVersion: rootPackage.version,
		buildVersion: rootPackage.version.match(/^\d+(?:\.\d+)*/)?.[0] ?? "1.0.0",
		asar: true,
		prune: false,
		overwrite: true,
	});
	const appDir = appPaths[0];
	await copyTree(runtimeDir, path.join(appDir, "resources", "metis-runtime"));

	console.log("[6/6] 生成 ZIP");
	await rm(zipStageDir, { recursive: true, force: true });
	await mkdir(zipStageDir, { recursive: true });
	await copyTree(appDir, path.join(zipStageDir, "Metis"));
	await writeOpenHelp();
	await rm(releaseDir, { recursive: true, force: true });
	await mkdir(releaseDir, { recursive: true });
	const zipPath = path.join(releaseDir, `Metis-${rootPackage.version}-win-${architecture}.zip`);
	await createZipArchive(zipStageDir, zipPath);
	const digest = await writeSha256(zipPath);
	console.log(`完成：${zipPath}`);
	console.log(`SHA256：${digest}`);
} finally {
	await rm(temporaryDir, { recursive: true, force: true });
}
