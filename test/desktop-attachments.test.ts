import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const attachments = require("../desktop/renderer/attachments.js") as {
	attachmentPrompt: (file: { kind: string; name: string; content?: string; path?: string }) => string;
	classifyAttachment: (file: { name: string; type?: string }) => "image" | "video" | "text" | "file";
	filesFromTransfer: (transfer: { files?: unknown[]; items?: unknown[] }) => unknown[];
	formatFileSize: (size: number) => string;
	imageMimeType: (file: { name: string; type?: string }) => string;
	insertTextAtSelection: (input: Record<string, unknown>, text: string) => string;
	transferHasFiles: (transfer: { files?: unknown[]; items?: unknown[]; types?: string[] }) => boolean;
};
const menu = require("../desktop/main-menu.cjs") as {
	createApplicationMenuTemplate: (platform: string, appName?: string) => Array<{ label?: string; role?: string; submenu?: Array<{ role?: string }> }>;
	createEditorContextMenuTemplate: (params: Record<string, unknown>) => Array<{ role?: string; enabled?: boolean; type?: string }>;
};

describe("desktop attachment helpers", () => {
	it("classifies image, video, text, and binary files even when Windows omits MIME types", () => {
		expect(attachments.classifyAttachment({ name: "shot.png", type: "image/png" })).toBe("image");
		expect(attachments.classifyAttachment({ name: "recording.MP4", type: "" })).toBe("video");
		expect(attachments.classifyAttachment({ name: "notes.md", type: "" })).toBe("text");
		expect(attachments.classifyAttachment({ name: "archive.zip", type: "application/zip" })).toBe("file");
		expect(attachments.imageMimeType({ name: "photo.JPG", type: "" })).toBe("image/jpeg");
	});

	it("extracts files from macOS and Windows DataTransfer variants", () => {
		const file = { name: "clip.mov" };
		expect(attachments.filesFromTransfer({ files: [file] })).toEqual([file]);
		expect(attachments.filesFromTransfer({ items: [{ kind: "file", getAsFile: () => file }] })).toEqual([file]);
		expect(attachments.transferHasFiles({ types: ["Files"] })).toBe(true);
	});

	it("inserts pasted text at selection without destroying surrounding input", () => {
		const dispatchEvent = vi.fn();
		const setSelectionRange = vi.fn();
		const input = { value: "hello world", selectionStart: 6, selectionEnd: 11, dispatchEvent, setSelectionRange };
		expect(attachments.insertTextAtSelection(input, "Metis")).toBe("hello Metis");
		expect(setSelectionRange).toHaveBeenCalledWith(11, 11);
		expect(dispatchEvent).toHaveBeenCalledOnce();
	});

	it("formats inline text and path-backed video prompts", () => {
		expect(attachments.attachmentPrompt({ kind: "text", name: "a.txt", content: "hello" })).toContain("hello");
		const videoPrompt = attachments.attachmentPrompt({ kind: "video", name: "demo.mp4", path: "C:\\Users\\me\\demo.mp4" });
		expect(videoPrompt).toContain("video 工具");
		expect(videoPrompt).toContain("C:\\Users\\me\\demo.mp4");
		expect(attachments.formatFileSize(1024 * 1024)).toBe("1.0 MB");
	});
});

describe("desktop edit menus", () => {
	it("keeps Windows edit accelerators active behind the auto-hidden menu", () => {
		const template = menu.createApplicationMenuTemplate("win32");
		expect(template).toHaveLength(1);
		expect(template[0].submenu?.map((item) => item.role).filter(Boolean)).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
	});

	it("keeps macOS application and edit menus", () => {
		const template = menu.createApplicationMenuTemplate("darwin", "Metis");
		expect(template[0].label).toBe("Metis");
		expect(template.some((item) => item.submenu?.some((entry) => entry.role === "paste"))).toBe(true);
		expect(template.some((item) => item.role === "windowMenu")).toBe(true);
	});

	it("offers right-click copy and paste for editable fields", () => {
		const template = menu.createEditorContextMenuTemplate({
			isEditable: true,
			selectionText: "selected",
			editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
		});
		expect(template.find((item) => item.role === "copy")?.enabled).toBe(true);
		expect(template.find((item) => item.role === "paste")?.enabled).toBe(true);
	});
});

describe("desktop attachment wiring", () => {
	it("loads helper before app and accepts every file type from plus picker", () => {
		const html = readFileSync(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
		expect(html.indexOf('src="attachments.js"')).toBeLessThan(html.indexOf('src="app.js"'));
		expect(html).toMatch(/<input type="file" id="attachInput" multiple(?![^>]*accept=)/);
	});

	it("wires paste and drag/drop to the unified attachment handler", () => {
		const app = readFileSync(new URL("../desktop/renderer/app.js", import.meta.url), "utf8");
		expect(app).toContain('addEventListener("paste"');
		expect(app).toContain('addEventListener("dragenter"');
		expect(app).toContain('addEventListener("drop"');
		expect(app).toContain('handleAttachments(files, "paste")');
		expect(app).toContain('handleAttachments(attachmentTools.filesFromTransfer(event.dataTransfer), "drop")');
	});
});
