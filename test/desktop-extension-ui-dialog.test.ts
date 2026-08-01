import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop extension UI dialog", () => {
	it("uses an in-window Electron renderer dialog for interactive OAuth requests", () => {
		const html = readFileSync(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
		const app = readFileSync(new URL("../desktop/renderer/app.js", import.meta.url), "utf8");

		expect(html).toContain('id="extensionUiDialog"');
		expect(html).toContain('id="extensionUiInput"');
		expect(html).toContain('id="extensionUiSelect"');
		expect(app).toContain('new Set(["confirm", "select", "input", "editor"])');
		expect(app).toContain('requestServer("/extension/ui-response", "POST", response)');
		expect(app).not.toContain("window.prompt(");
	});
});
