import type { AutocompleteProvider, EditorTheme, TUI } from "@earendil-works/metis-tui";
import { setKeybindings } from "@earendil-works/metis-tui";
import { describe, expect, it, vi } from "vitest";
import { type AppKeybinding, KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";

const identity = (text: string) => text;
const theme: EditorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};

function createEditor(shouldTriggerFileCompletion = false) {
	const tui = { requestRender: vi.fn() } as unknown as TUI;
	const keybindings = KeybindingsManager.create();
	setKeybindings(keybindings);
	const editor = new CustomEditor(tui, theme, keybindings);
	const toggle = vi.fn();
	editor.onAction("app.workflow.toggle" satisfies AppKeybinding, toggle);

	const provider: AutocompleteProvider = {
		getSuggestions: vi.fn(async () => ({
			items: [{ value: "/model", label: "/model" }],
			prefix: editor.getText(),
		})),
		applyCompletion: (lines, cursorLine, _cursorCol, item) => ({
			lines: lines.map((line, index) => (index === cursorLine ? item.value : line)),
			cursorLine,
			cursorCol: item.value.length,
		}),
		shouldTriggerFileCompletion: () => shouldTriggerFileCompletion,
	};
	editor.setAutocompleteProvider(provider);
	return { editor, provider, toggle };
}

describe("CustomEditor Tab routing", () => {
	it("switches workflow mode in the empty normal composer", () => {
		const { editor, toggle } = createEditor(true);

		editor.handleInput("\t");

		expect(toggle).toHaveBeenCalledOnce();
	});

	it("switches workflow mode after normal message text", () => {
		const { editor, toggle } = createEditor(true);
		editor.setText("11231");

		editor.handleInput("\t");

		expect(toggle).toHaveBeenCalledOnce();
	});

	it("uses Tab to open and accept slash-command autocomplete", async () => {
		const { editor, provider, toggle } = createEditor();
		editor.setText("/mo");

		editor.handleInput("\t");
		await vi.waitFor(() => expect(editor.isShowingAutocomplete()).toBe(true));
		expect(provider.getSuggestions).toHaveBeenCalled();
		expect(toggle).not.toHaveBeenCalled();

		editor.handleInput("\t");
		expect(editor.getText()).toBe("/model");
		expect(toggle).not.toHaveBeenCalled();
	});

	it("reserves Tab for explicit file completion contexts", async () => {
		const { editor, provider, toggle } = createEditor(true);
		editor.setText("@src/mod");

		editor.handleInput("\t");
		await vi.waitFor(() => expect(provider.getSuggestions).toHaveBeenCalled());

		expect(toggle).not.toHaveBeenCalled();
	});
});
