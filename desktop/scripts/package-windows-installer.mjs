import { execFile } from "node:child_process";
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
const version = rootPackage.version;

if (process.platform !== "win32") throw new Error("Windows installer can only be built on Windows.");
if (!new Set(["arm64", "x64"]).has(architecture)) throw new Error(`Unsupported Windows architecture: ${architecture}`);

const tempRoot = process.platform === "win32" ? path.join(process.env.SystemDrive || "C:", "tmp") : os.tmpdir();
await mkdir(tempRoot, { recursive: true });
const temporaryDir = await mkdtemp(path.join(tempRoot, "mwi-"));
const iconPath = path.join(temporaryDir, "Metis.ico");
const runtimeDir = path.join(temporaryDir, "metis-runtime");
const packagedAppsDir = path.join(temporaryDir, "apps");
const stageDir = path.join(temporaryDir, "stage");
const appStageDir = path.join(stageDir, "Metis");
const helpDir = path.join(stageDir, "Help");
const nsisScriptPath = path.join(temporaryDir, "installer.nsi");

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

async function runOptional(command, args) {
	try {
		await run(command, args, { logOutput: false });
		return true;
	} catch {
		return false;
	}
}

async function runRobocopy(source, destination) {
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
}

async function copyTree(source, destination) {
	if (process.platform === "win32") {
		await runRobocopy(source, destination);
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
	const text = `Metis for Windows - If the app does not open

This package is not code-signed on Windows. Continue only when the source is trusted.

If SmartScreen shows "Windows protected your PC":
1. Click "More info".
2. Click "Run anyway".

You can also right-click Metis.exe -> Properties, check "Unblock" if available, apply, then try again.

Do not perform these steps for untrusted software.
`;
	await writeFile(path.join(helpDir, "Windows-Open-Issue.txt"), text, "utf8");
}

async function resolveNsisCommand() {
	if (await runOptional("makensis", ["/VERSION"])) return { command: "makensis", args: [] };
	const defaultNsisPath = "C:\\Program Files (x86)\\NSIS\\makensis.exe";
	if (await runOptional(defaultNsisPath, ["/VERSION"])) return { command: defaultNsisPath, args: [] };
	throw new Error(
		"NSIS compiler not found. Install NSIS and ensure `makensis` is in PATH.",
	);
}

async function writeNsisScript(outPath) {
	const script = `Unicode true
Name "Metis"
OutFile "${outPath.replaceAll("\\", "\\\\")}"
InstallDir "$LOCALAPPDATA\\\\Metis"
InstallDirRegKey HKCU "Software\\\\Metis" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r /x *.d.ts /x *.d.mts /x *.map "${appStageDir.replaceAll("\\", "\\\\")}\\\\*"
  CreateDirectory "$INSTDIR\\\\Help"
  File /oname=$INSTDIR\\\\Help\\\\Windows-Open-Issue.txt "${path.join(helpDir, "Windows-Open-Issue.txt").replaceAll("\\", "\\\\")}"
  WriteUninstaller "$INSTDIR\\\\Uninstall Metis.exe"

  CreateDirectory "$SMPROGRAMS\\\\Metis"
  CreateShortcut "$SMPROGRAMS\\\\Metis\\\\Metis.lnk" "$INSTDIR\\\\Metis.exe"
  CreateShortcut "$SMPROGRAMS\\\\Metis\\\\Uninstall Metis.lnk" "$INSTDIR\\\\Uninstall Metis.exe"
  CreateShortcut "$DESKTOP\\\\Metis.lnk" "$INSTDIR\\\\Metis.exe"

  WriteRegStr HKCU "Software\\\\Metis" "InstallDir" "$INSTDIR"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\\\\Metis.lnk"
  Delete "$SMPROGRAMS\\\\Metis\\\\Metis.lnk"
  Delete "$SMPROGRAMS\\\\Metis\\\\Uninstall Metis.lnk"
  RMDir "$SMPROGRAMS\\\\Metis"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\\\\Metis"
SectionEnd
`;
	await writeFile(nsisScriptPath, script, "utf8");
}

try {
	console.log("[1/7] Build Metis CLI and Server");
	await run("npm", ["run", "build"]);

	console.log("[2/7] Build Desktop renderer");
	await run("npm", ["run", "build"], { cwd: desktopDir });

	console.log("[3/7] Generate app icon");
	await buildIcon();

	console.log("[4/7] Bundle CLI/Server runtime");
	await buildBundledRuntime();

	console.log("[5/7] Package Metis Windows app");
	const appPaths = await packager({
		dir: path.join(desktopDir, "dist"),
		out: packagedAppsDir,
		name: "Metis",
		platform: "win32",
		arch: architecture,
		icon: iconPath,
		appVersion: version,
		buildVersion: version.match(/^\d+(?:\.\d+)*/)?.[0] ?? "1.0.0",
		asar: true,
		prune: false,
		overwrite: true,
	});
	const appDir = appPaths[0];
	await copyTree(runtimeDir, path.join(appDir, "resources", "metis-runtime"));

	console.log("[6/7] Prepare NSIS stage");
	await rm(stageDir, { recursive: true, force: true });
	await mkdir(stageDir, { recursive: true });
	await copyTree(appDir, appStageDir);
	await writeOpenHelp();
	await rm(releaseDir, { recursive: true, force: true });
	await mkdir(releaseDir, { recursive: true });
	const installerPath = path.join(releaseDir, `Metis-${version}-win-${architecture}-setup.exe`);
	await writeNsisScript(installerPath);

	console.log("[7/7] Build NSIS installer");
	const nsis = await resolveNsisCommand();
	await run(nsis.command, [...nsis.args, nsisScriptPath], { cwd: desktopDir });
	console.log(`Done: ${installerPath}`);
} finally {
	await rm(temporaryDir, { recursive: true, force: true });
}
