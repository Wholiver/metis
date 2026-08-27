import type { Component, Terminal } from "@earendil-works/metis-tui";

/**
 * A root container for fullscreen mode that keeps the bottom component
 * pinned to the bottom of the terminal by inserting empty lines between
 * the top and bottom components dynamically.
 */
export class FullscreenRootContainer implements Component {
	terminal: Terminal;
	top: Component;
	bottom: Component;

	constructor(terminal: Terminal, top: Component, bottom: Component) {
		this.terminal = terminal;
		this.top = top;
		this.bottom = bottom;
	}

	invalidate(): void {
		if (this.top && typeof this.top.invalidate === "function") {
			this.top.invalidate();
		}
		if (this.bottom && typeof this.bottom.invalidate === "function") {
			this.bottom.invalidate();
		}
	}

	render(width: number): string[] {
		const bottomLines = this.bottom.render(width);
		const topAvailableHeight = Math.max(0, this.terminal.rows - bottomLines.length);

		// Let the top container know its available height so it can scroll if needed
		if (this.top && typeof (this.top as any).setAvailableHeight === "function") {
			(this.top as any).setAvailableHeight(topAvailableHeight);
		}

		const topLines = this.top.render(width);
		const heightNeeded = this.terminal.rows - topLines.length - bottomLines.length;

		if (heightNeeded > 0) {
			const spacerLines = Array(heightNeeded).fill(" ".repeat(width));
			return [...topLines, ...spacerLines, ...bottomLines];
		}
		
		return [...topLines, ...bottomLines];
	}
}

