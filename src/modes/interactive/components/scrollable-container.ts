import type { Component, Terminal } from "@earendil-works/metis-tui";

export class ScrollableContainer implements Component {
	public terminal: Terminal;
	public child: Component;
	private scrollOffset: number = 0;
	private availableHeight: number = 0;
	private lastRenderedChildLines: number = 0;

	constructor(terminal: Terminal, child: Component) {
		this.terminal = terminal;
		this.child = child;
	}

	setAvailableHeight(height: number): void {
		this.availableHeight = Math.max(0, height);
	}

	invalidate(): void {
		if (this.child && typeof this.child.invalidate === "function") {
			this.child.invalidate();
		}
	}

	scrollBy(delta: number): void {
		const maxScroll = Math.max(0, this.lastRenderedChildLines - this.availableHeight);
		this.scrollOffset += delta;
		if (this.scrollOffset < 0) {
			this.scrollOffset = 0;
		} else if (this.scrollOffset > maxScroll) {
			this.scrollOffset = maxScroll;
		}
	}

	scrollToBottom(): void {
		this.scrollOffset = 0;
	}

	render(width: number): string[] {
		const childLines = this.child.render(width);
		this.lastRenderedChildLines = childLines.length;

		// Re-clamp scroll offset in case child lines shrunk
		const maxScroll = Math.max(0, this.lastRenderedChildLines - this.availableHeight);
		if (this.scrollOffset > maxScroll) {
			this.scrollOffset = maxScroll;
		}

		// If child content fits entirely within available height, no slicing needed.
		if (childLines.length <= this.availableHeight) {
			return childLines;
		}

		// Calculate slice range.
		// scrollOffset = 0 means at the bottom.
		// scrollOffset = maxScroll means at the top.
		const endIndex = childLines.length - this.scrollOffset;
		const startIndex = Math.max(0, endIndex - this.availableHeight);

		return childLines.slice(startIndex, endIndex);
	}
}

