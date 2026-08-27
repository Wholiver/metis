import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Desktop unified memory state", () => {
	it("connects every visible session-default and retry control to typed Server state", () => {
		const html = read("desktop/renderer/index.html");
		for (const id of ["settingsAutoRetryInput", "settingsDefaultModelSelect", "settingsDefaultThinkingSelect"]) {
			expect(html).toContain(`id="${id}"`);
		}
		const app = read("desktop/renderer/app.js");
		expect(app).toContain('requestServer("/settings/defaults")');
		expect(app).toContain('requestServer("/settings/defaults", "PUT"');
		expect(app).toContain("autoRetryEnabled");
		expect(app).toContain('uiText("settingsNoDefault")');
	});

	it("keeps Metis project trust and Provider credentials connected to their existing commands", () => {
		const html = read("desktop/renderer/index.html");
		for (const id of ["settingsTrustSelect", "settingsOauthProvider", "settingsApiKeyProvider", "settingsLogoutProvider"]) {
			expect(html).toContain(`id="${id}"`);
		}
		const app = read("desktop/renderer/app.js");
		expect(app).toContain('command: "/trust"');
		expect(app).toContain('command: "/login"');
		expect(app).toContain('command: "/logout"');
		expect(app).toContain("`/trust ${elements.settingsTrustSelect.value}`");
		expect(app).toContain("`/login ${provider}`");
		expect(app).toContain("`/logout ${provider}`");
	});

	it("uses typed MemoryState without a persistent chat indicator", () => {
		const app = read("desktop/renderer/app.js");
		expect(app).toContain("function setMemoryState(memoryState)");
		expect(app).toContain('event.type === "memory_state_changed"');
		expect(app).not.toContain("function setDreamStatus(");
		expect(app).not.toContain("renderDreamCardPresentation");
		expect(read("desktop/renderer/index.html")).not.toContain('id="dreamCardWrap"');
	});

	it("keeps memory controls in Agent settings with an explicit destructive reset", () => {
		const html = read("desktop/renderer/index.html");
		expect(html).toContain('id="settingsMemoryInput"');
		expect(html).toContain('id="settingsMemoryDashboard"');
		expect(html).toContain('id="settingsMemoryRun"');
		expect(html).toContain('id="settingsMemoryReset"');
		const app = read("desktop/renderer/app.js");
		expect(app).toContain('confirm: "RESET_MEMORY"');
	});

	it("keeps a manual run single-flight and reports failed extraction as an error", () => {
		const app = read("desktop/renderer/app.js");
		expect(app).toContain("let memoryRunPending = false");
		expect(app).toContain("|| memoryRunPending");
		expect(app).toContain('uiText("settingsMemoryFailure"');
		expect(app).toContain("memoryRunPending = false");
	});
});

