import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const skillComposer = require("../desktop/renderer/skill-composer.js") as {
	filterSkills: (skills: Array<Record<string, string>>, query?: string) => Array<Record<string, string>>;
	findTrigger: (text: string, caret?: number) => { start: number; end: number; query: string } | null;
	humanizeSkillName: (name: string) => string;
	normalizeSkills: (commands: Array<Record<string, string>>) => Array<Record<string, string>>;
	serializeEditor: (editor: Record<string, unknown>) => string;
};

describe("Desktop skill composer helpers", () => {
	it("normalizes only skill commands and builds friendly labels", () => {
		const skills = skillComposer.normalizeSkills([
			{ name: "help", source: "builtin", description: "Help" },
			{ name: "skill:make-interfaces-feel-better", source: "skill", description: "UI polish" },
		]);
		expect(skills).toEqual([{
			name: "make-interfaces-feel-better",
			invocation: "/skill:make-interfaces-feel-better",
			label: "Make Interfaces Feel Better",
			description: "UI polish",
		}]);
		expect(skillComposer.humanizeSkillName("pdf-review")).toBe("Pdf Review");
	});

	it("finds slash queries at caret without hijacking paths or completed prose", () => {
		expect(skillComposer.findTrigger("/make")).toEqual({ start: 0, end: 5, query: "make" });
		expect(skillComposer.findTrigger("Please use /make")).toEqual({ start: 11, end: 16, query: "make" });
		expect(skillComposer.findTrigger("/skill:make")).toEqual({ start: 0, end: 11, query: "make" });
		expect(skillComposer.findTrigger("open /tmp/file")).toBeNull();
		expect(skillComposer.findTrigger("/make now")).toBeNull();
	});

	it("ranks name matches before description matches", () => {
		const skills = [
			{ name: "pdf", label: "Pdf", description: "Read documents" },
			{ name: "document-review", label: "Document Review", description: "Read PDF files" },
		];
		expect(skillComposer.filterSkills(skills, "pdf").map((skill) => skill.name)).toEqual(["pdf", "document-review"]);
	});

	it("serializes an inline visual token to the Core skill command format", () => {
		const token = { nodeType: 1, nodeName: "SPAN", dataset: { skillName: "make-interfaces-feel-better" }, matches: () => true };
		const editor = {
			nodeType: 1,
			nodeName: "DIV",
			childNodes: [
				{ nodeType: 3, nodeValue: "Polish this UI " },
				token,
				{ nodeType: 3, nodeValue: "\u00a0" },
			],
			querySelector: () => token,
		};
		expect(skillComposer.serializeEditor(editor)).toBe("/skill:make-interfaces-feel-better Polish this UI");
	});
});

describe("Desktop skill composer wiring", () => {
	it("loads helper before app and exposes accessible rich composer/listbox DOM", () => {
		const html = readFileSync(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
		expect(html.indexOf('src="skill-composer.js"')).toBeLessThan(html.indexOf('src="app.js"'));
		expect(html).toContain('id="composerInput"');
		expect(html).toContain('contenteditable="true"');
		expect(html).toContain('aria-controls="composerSkillMenu"');
		expect(html).toContain('id="composerSkillMenu" role="listbox"');
	});

	it("fetches existing command catalog and handles keyboard selection before submit", () => {
		const app = readFileSync(new URL("../desktop/renderer/app.js", import.meta.url), "utf8");
		expect(app).toContain('requestServer("/commands")');
		expect(app).toContain('skillComposer.normalizeSkills(result?.commands)');
		expect(app).toContain('event.key === "ArrowDown" || event.key === "ArrowUp"');
		expect(app).toContain('event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)');
		expect(app).toContain('skillComposer.removeAdjacentSkill');
		expect(app).toContain('option.addEventListener("pointerdown"');
	});
});

