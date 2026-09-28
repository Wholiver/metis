import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_FILE_NAME, HELP_FOLDER_NAME, getOpenHelpText } from "../desktop/scripts/dmg-help-content.mjs";

describe("macOS DMG troubleshooting guide and assets", () => {
	it("has bilingual names for the help folder and file", () => {
		expect(HELP_FOLDER_NAME).toMatch(/Cannot Open/i);
		expect(HELP_FOLDER_NAME).toContain("打不开");
		expect(HELP_FILE_NAME).toMatch(/How-to-Open/i);
		expect(HELP_FILE_NAME).toContain("打不开");
	});

	it("provides accurate, non-misleading troubleshooting instructions in both languages", () => {
		const text = getOpenHelpText();

		// Prerequisite warning: MUST drag to /Applications first!
		expect(text).toContain("/Applications");
		expect(text).toContain("Before doing anything below, you MUST drag \"Metis.app\" into the \"Applications\" folder!");
		expect(text).toContain("务必先将“Metis.app”拖入“Applications”（应用程序）文件夹中");
		expect(text).toContain("Do NOT run Terminal commands or run Metis directly inside this DMG disk image");

		// Issue 1: Damaged / Gatekeeper quarantine
		expect(text).toContain("xattr -cr /Applications/Metis.app");
		expect(text).toContain("sudo xattr -cr /Applications/Metis.app");
		expect(text).toMatch(/damaged/i);
		expect(text).toContain("已损坏");

		// Issue 2: Unidentified developer / System Settings
		expect(text).toContain("System Settings");
		expect(text).toContain("系统设置");
		expect(text).toContain("Privacy & Security");
		expect(text).toContain("隐私与安全性");
		expect(text).toContain("Open Anyway");
		expect(text).toContain("仍要打开");
		expect(text).toContain("Sequoia");

		// Issue 3: Apple Silicon codesign refresh
		expect(text).toContain("codesign --force --deep --sign - /Applications/Metis.app");
		expect(text).toContain("Apple Silicon");

		// Official reference link
		expect(text).toContain("https://support.apple.com/guide/mac-help/mh40616/mac");
	});

	it("contains a valid, well-proportioned DMG background SVG asset", () => {
		const svgPath = path.resolve(__dirname, "../desktop/public/assets/dmg-background.svg");
		expect(existsSync(svgPath)).toBe(true);

		const svgContent = readFileSync(svgPath, "utf8");
		expect(svgContent).toContain("<svg");
		expect(svgContent).toContain("</svg>");
		expect(svgContent).toContain("width=\"660\"");
		expect(svgContent).toContain("height=\"480\"");
		expect(svgContent).toContain("Drag Metis into Applications to install");
		expect(svgContent).toContain("拖拽 Metis 到 应用程序 完成安装");
		expect(svgContent).toMatch(/Troubleshooting/i);
		expect(svgContent).toContain("排障指南");
	});
});
