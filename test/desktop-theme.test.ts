import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync(new URL("../desktop/src/components/settings/SettingsDialog.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");
const preload = readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");

describe("Desktop appearance capability", () => {
	it("does not expose theme controls while the React renderer has no theme implementation", () => {
		expect(settings).not.toContain('label="Appearance"');
		expect(settings).not.toContain("setUiTheme");
		expect(settings).not.toContain('<option value="dark">');
		expect(settings).not.toContain('<option value="light">');
	});

	it("keeps the Electron theme bridge available without claiming renderer support", () => {
		expect(main).toContain("nativeTheme");
		expect(main).toContain('ipcMain.handle("app:set-theme"');
		expect(preload).toContain("setUiTheme");
		expect(preload).toContain('ipcRenderer.invoke("app:set-theme"');
	});
});
