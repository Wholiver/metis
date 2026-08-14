import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const i18n = require("../desktop/renderer/i18n.js") as {
	catalogs: Record<string, Record<string, string>>;
	languages: string[];
	t: (key: string, language: string) => string;
};

const html = readFileSync(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../desktop/renderer/styles.css", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../desktop/renderer/app.js", import.meta.url), "utf8");
const mainCjs = readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");
const preloadCjs = readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");

describe("Desktop dark mode and theme switching", () => {
	it("provides theme translation keys across all locales", () => {
		const themeKeys = ["theme", "themeDescription", "themeAuto", "themeLight", "themeDark"];
		for (const lang of Object.keys(i18n.catalogs)) {
			for (const key of themeKeys) {
				expect(i18n.catalogs[lang][key], `Missing ${key} in ${lang}`).toBeDefined();
				expect(i18n.catalogs[lang][key].length).toBeGreaterThan(0);
			}
		}
	});

	it("renders #settingsThemeSelect in settings dialog with auto, light, and dark options", () => {
		const $ = load(html);
		const select = $("#settingsThemeSelect");
		expect(select.length).toBe(1);
		const options = select.find("option").map((_, el) => $(el).attr("value")).get();
		expect(options).toEqual(["auto", "light", "dark"]);
		expect(select.find('option[value="auto"]').attr("data-i18n")).toBe("themeAuto");
		expect(select.find('option[value="light"]').attr("data-i18n")).toBe("themeLight");
		expect(select.find('option[value="dark"]').attr("data-i18n")).toBe("themeDark");
	});

	it("configures Electron nativeTheme IPC handler and preload bridge", () => {
		expect(mainCjs).toContain("nativeTheme");
		expect(mainCjs).toContain('ipcMain.handle("app:set-theme"');
		expect(preloadCjs).toContain("setUiTheme");
		expect(preloadCjs).toContain('ipcRenderer.invoke("app:set-theme"');
	});

	it("implements renderer theme state, persistence, and system matchMedia listener", () => {
		expect(appJs).toContain("resolveUiTheme");
		expect(appJs).toContain("applyUiTheme");
		expect(appJs).toContain("settingsThemeSelect");
		expect(appJs).toContain("prefers-color-scheme");
		expect(appJs).toContain("metis.desktopTheme.v2");
	});

	it("defines CSS variables for explicit light and dark themes", () => {
		expect(styles).toContain(':root[data-theme="light"]');
		expect(styles).toContain(':root[data-theme="dark"]');
		expect(styles).toContain(':root:not([data-theme="dark"])');
	});

	it("provides comprehensive dark theme styling for settings, chat, onboarding, and queue", () => {
		// Settings dialog
		expect(styles).toContain("--settings-canvas: #17191b;");
		expect(styles).toContain("--settings-card-bg: #1e2124;");
		expect(styles).toContain("--settings-input-bg: #141719;");
		expect(styles).toContain("--settings-input-border: #33383b;");
		expect(styles).toContain("--settings-canvas: #fdfdfc;");

		// Main chat
		expect(styles).toContain("--chat-canvas: #17191b;");
		expect(styles).toContain("--chat-canvas: #ffffff;");
		expect(styles).toContain("--chat-surface-soft: #202326;");
		expect(styles).toContain("--chat-surface-soft: #f3f3f4;");

		// Onboarding
		expect(styles).toContain("--onboarding-canvas: #111315;");
		expect(styles).toContain("--onboarding-canvas: #fdfdfc;");

		// Message queue
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.message-queue\s*\{[^}]*background:\s*var\(--surface-soft\)/);
	});

	it("ensures model menu and project switcher menu are visible when open", () => {
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.model-picker\.open \.model-menu\s*\{[\s\S]*?opacity:\s*1\s*!important[\s\S]*?visibility:\s*visible\s*!important/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.project-switch-capsule/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] #dreamTokenCard/);
	});
});
