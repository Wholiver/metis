import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../desktop/renderer/styles.css", import.meta.url), "utf8");

function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || "";
}

describe("Desktop flat accent palette", () => {
	it("uses neutral global accents with color reserved for scoped data and workflow surfaces", () => {
		expect(styles).toContain("--accent: #d0d2d3;");
		expect(styles).toContain("--accent: #343638;");
		expect(styles).toContain("--accent-contrast: #17191a;");
		expect(styles).toContain("--accent-contrast: #ffffff;");
		expect(styles).not.toMatch(/#(?:8d7cf6|635bda|7447e8|4338ca|5b21b6|6546c7|8b5cf6|6f9ed8|3976bb|2478df)/i);
		expect(rule(".tool-name.shimmering")).toContain("background: none");
		expect(rule(".working-shimmer")).toContain("background: none");
		expect(rule(".cot-header-bar:hover .cot-title")).toContain("background: none");
		expect(rule(".proposed-plan-card")).toContain("--proposed-plan-accent: var(--ink-soft)");
		expect(rule(".proposed-plan-process")).toContain("background: var(--btn-secondary-bg)");
	});

	it("uses a dedicated blue scale for Token activity", () => {
		expect(rule('[data-purpose="main-chat"] #dreamTokenCard')).toContain("--token-accent: #627fc4");
		expect(styles).toContain('dream-token-cell[data-level="1"] { background-color: #d4dff2; }');
		expect(styles).toContain('dream-token-cell[data-level="2"] { background-color: #aabfe5; }');
		expect(styles).toContain('dream-token-cell[data-level="3"] { background-color: #789bd5; }');
	});

	it("keeps chat restrained and settings achromatic without changing global accents", () => {
		expect(styles).toContain("--chat-accent: #80758d");
		expect(styles).toContain("--chat-canvas: #ffffff");
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.user-bubble\s*\{[^}]*background:\s*var\(--chat-surface-soft\)/);
		expect(styles).toContain("--settings-accent: #5f5f5d");
		expect(styles).toContain("--settings-accent-soft: #eeeeec");
		expect(styles).not.toContain("--settings-accent: #648494");
		expect(styles).not.toContain("--settings-accent: #7669af");
		expect(styles).toMatch(/\.settings-dialog-nav-item\.active\s*\{[^}]*background:\s*var\(--settings-accent-soft\)/);
		expect(styles).toMatch(/\.settings-switch input:checked \+ i\s*\{[^}]*background:\s*var\(--settings-accent\)/);
	});

	it("keeps gradients only where they communicate data, choice, or clipping", () => {
		expect(rule('[data-purpose="channel-list"] .conversation-token-trail')).toContain("linear-gradient");
		expect(rule('.project-color-slider input[type="range"]')).toContain("linear-gradient");
		expect(styles).toContain("mask-image: linear-gradient");
		expect(styles).toContain("--btn-primary-bg: #363636;");
		expect(styles).toContain("--btn-primary-bg: #e3e3e0;");
		expect(styles).toContain("background: var(--canvas) !important;");
	});
});

