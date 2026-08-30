import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	cancelExtensionUiRequest,
	submitExtensionUiRequest,
	toExtensionUiRequest,
} from "../desktop/src/lib/extension-ui.js";

describe("desktop extension UI dialog", () => {
	it("uses an in-window Electron renderer dialog for interactive OAuth requests", () => {
		const serverHook = readFileSync(new URL("../desktop/src/hooks/useMetisServer.ts", import.meta.url), "utf8");
		const app = readFileSync(new URL("../desktop/src/App.tsx", import.meta.url), "utf8");
		const dialog = readFileSync(new URL("../desktop/src/components/ExtensionUiDialog.tsx", import.meta.url), "utf8");

		expect(serverHook).toContain("toExtensionUiRequest(event");
		expect(serverHook).toContain("request('/extension/ui-response', 'POST', response)");
		expect(serverHook).not.toContain('window.prompt(');
		expect(app).toContain('<ExtensionUiDialog');
		expect(app).toContain("captureParams.has('capture-extension-ui')");
		expect(dialog).toContain('role="dialog"');
		expect(dialog).toContain('aria-modal="true"');
		expect(dialog).toContain("event.key === 'Escape'");
		expect(dialog).toContain("event.key !== 'Tab'");
	});

	it("preserves confirm, select, input, and editor response semantics", () => {
		const confirm = toExtensionUiRequest({ id: "confirm-1", method: "confirm", message: "Continue?" });
		const select = toExtensionUiRequest({ id: "select-1", method: "select", options: ["First", 2] });
		const input = toExtensionUiRequest({ id: "input-1", method: "input", prefill: "code" });
		const editor = toExtensionUiRequest({ id: "editor-1", method: "editor" });

		expect(confirm).toMatchObject({ id: "confirm-1", method: "confirm", options: [] });
		expect(select?.options).toEqual(["First", "2"]);
		expect(input?.prefill).toBe("code");
		expect(editor?.method).toBe("editor");
		expect(cancelExtensionUiRequest(confirm!)).toEqual({ id: "confirm-1", confirmed: false });
		expect(cancelExtensionUiRequest(input!)).toEqual({ id: "input-1", cancelled: true });
		expect(submitExtensionUiRequest(confirm!, "")).toEqual({ id: "confirm-1", confirmed: true });
		expect(submitExtensionUiRequest(select!, "First")).toEqual({ id: "select-1", value: "First" });
	});
});
