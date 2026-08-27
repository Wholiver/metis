import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Desktop frontend agent guide", () => {
	it("is mandatory from the project-root AGENTS instructions", () => {
		const agents = read("AGENTS.md");
		expect(agents).toContain("## Desktop Frontend Changes (Mandatory)");
		expect(agents).toContain("docs/desktop-frontend-development.md");
		expect(agents).toContain("Computer Use and screenshots may assist diagnosis but are not final proof");
	});

	it("documents the source, render, styling, i18n, and verification contracts", () => {
		const guide = read("docs/desktop-frontend-development.md");
		for (const contract of [
			"desktop/renderer/",
			"desktop/dist/",
			"renderServerMessages()",
			"metisRenderedMessage === message",
			"syncAssistantTurnPresentations()",
			"desktop/i18n-source.cjs",
			"getBoundingClientRect()",
			"npm --prefix desktop run build",
			"Computer Use",
		]) {
			expect(guide, contract).toContain(contract);
		}
	});
});

