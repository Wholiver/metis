import {
	type AutocompleteProvider,
	Editor,
	type EditorOptions,
	type EditorTheme,
	type TUI,
} from "@earendil-works/metis-tui";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.ts";

/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor {
	private keybindings: KeybindingsManager;
	private appAutocompleteProvider?: AutocompleteProvider;
	public actionHandlers: Map<AppKeybinding, () => void> = new Map();

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.appAutocompleteProvider = provider;
		super.setAutocompleteProvider(provider);
	}

	private shouldHandleTabAsAutocomplete(): boolean {
		if (this.isShowingAutocomplete()) return true;
		if (this.getText().trim().length === 0) return false;

		const lines = this.getLines();
		const cursor = this.getCursor();
		const textBeforeCursor = (lines[cursor.line] ?? "").slice(0, cursor.col);
		if (cursor.line === 0 && textBeforeCursor.trimStart().startsWith("/")) return true;
		const currentToken = textBeforeCursor.match(/\S+$/)?.[0] ?? "";
		const isExplicitFileReference =
			currentToken.startsWith("@")
			|| currentToken.startsWith("./")
			|| currentToken.startsWith("../")
			|| currentToken.startsWith("~/")
			|| currentToken.startsWith("/")
			|| currentToken.includes("/");
		if (!isExplicitFileReference) return false;

		return this.appAutocompleteProvider?.shouldTriggerFileCompletion?.(lines, cursor.line, cursor.col) ?? false;
	}

	handleInput(data: string): void {
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		// Check for paste image keybinding
		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}

		// Check app keybindings first

		// Escape/interrupt - only if autocomplete is NOT active
		if (this.keybindings.matches(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				// Use dynamic onEscape if set, otherwise registered handler
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			// Let parent handle escape for autocomplete cancellation
			super.handleInput(data);
			return;
		}

		// Exit (Ctrl+D) - only when editor is empty
		if (this.keybindings.matches(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
			// Fall through to editor handling for delete-char-forward when not empty
		}

		// Check all other app actions
		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
				if (
					action === "app.workflow.toggle"
					&& this.keybindings.matches(data, "tui.input.tab")
					&& this.shouldHandleTabAsAutocomplete()
				) {
					super.handleInput(data);
					return;
				}
				handler();
				return;
			}
		}

		// Pass to parent for editor handling
		super.handleInput(data);
	}
}
