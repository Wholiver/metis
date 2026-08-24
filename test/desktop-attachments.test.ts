import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
	attachmentPrompt,
	classifyAttachment,
	composeAttachmentPayload,
	extractImageAttachments,
	filesFromTransfer,
	formatFileSize,
	imageMimeType,
	parseAttachmentPayloadText,
	transferHasFiles,
} from "../desktop/src/lib/attachments.ts";

const require = createRequire(import.meta.url);
const menu = require("../desktop/main-menu.cjs") as {
	createApplicationMenuTemplate: (platform: string, appName?: string) => Array<{ label?: string; role?: string; submenu?: Array<{ role?: string }> }>;
	createEditorContextMenuTemplate: (params: Record<string, unknown>) => Array<{ role?: string; enabled?: boolean; type?: string }>;
};

describe("desktop attachment helpers", () => {
	it("classifies image, video, text, and binary files even when Windows omits MIME types", () => {
		expect(classifyAttachment({ name: "shot.png", type: "image/png" })).toBe("image");
		expect(classifyAttachment({ name: "recording.MP4", type: "" })).toBe("video");
		expect(classifyAttachment({ name: "notes.md", type: "" })).toBe("text");
		expect(classifyAttachment({ name: "archive.zip", type: "application/zip" })).toBe("file");
		expect(imageMimeType({ name: "photo.JPG", type: "" })).toBe("image/jpeg");
	});

	it("extracts files from macOS and Windows DataTransfer variants", () => {
		const file = { name: "clip.mov" };
		expect(filesFromTransfer({ files: [file] } as never)).toEqual([file]);
		expect(filesFromTransfer({ items: [{ kind: "file", getAsFile: () => file }] } as never)).toEqual([file]);
		expect(transferHasFiles({ types: ["Files"] } as never)).toBe(true);
	});

	it("round-trips attachment metadata while keeping model-readable context", () => {
		const textAttachment = { id: "text-1", kind: "text" as const, name: "a.txt", content: "hello", sizeText: "5 B" };
		expect(attachmentPrompt(textAttachment)).toContain("hello");
		const video = { id: "video-1", kind: "video" as const, name: "demo.mp4", path: "C:\\Users\\me\\demo.mp4", sizeText: "1.0 MB" };
		const videoPrompt = attachmentPrompt(video);
		expect(videoPrompt).toContain("video 工具");
		expect(videoPrompt).toContain("C:\\Users\\me\\demo.mp4");
		const parsed = parseAttachmentPayloadText(`Inspect this\n\n${videoPrompt}`);
		expect(parsed.text).toBe("Inspect this");
		expect(parsed.attachments).toEqual([video]);
		expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
	});

	it("builds Server ImageContent and restores image previews from message history", () => {
		const image = {
			id: "image-1",
			kind: "image" as const,
			name: "shot.png",
			sizeText: "1.0 KB",
			mimeType: "image/png",
			data: "iVBORw0KGgo=",
			previewUrl: "data:image/png;base64,iVBORw0KGgo=",
		};
		const payload = composeAttachmentPayload("inspect", [image]);
		expect(payload.images).toEqual([{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }]);
		expect(extractImageAttachments([{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }])).toMatchObject([
			{ kind: "image", previewUrl: "data:image/png;base64,iVBORw0KGgo=" },
		]);
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
	it("accepts every file type from the active React plus picker", () => {
		const composer = readFileSync(new URL("../desktop/src/components/chat/Composer.tsx", import.meta.url), "utf8");
		expect(composer).toContain('type="file"');
		expect(composer).toContain("multiple");
		expect(composer).not.toMatch(/type="file"[\s\S]{0,80}accept=/);
		expect(composer).toContain("onClick={() => fileInputRef.current?.click()}");
		expect(composer).toContain("data-composer-attachments");
	});

	it("wires picker, paste, drop, IPC fallback, and Server images", () => {
		const composer = readFileSync(new URL("../desktop/src/components/chat/Composer.tsx", import.meta.url), "utf8");
		const hook = readFileSync(new URL("../desktop/src/hooks/useMetisServer.ts", import.meta.url), "utf8");
		const preload = readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
		const main = readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");
		expect(composer).toContain("onPaste={(event)");
		expect(composer).toContain("onDragEnter={(event)");
		expect(composer).toContain("onDrop={(event)");
		expect(composer).toContain("filesFromTransfer(event.dataTransfer)");
		expect(composer).toContain("desktop?.attachments?.save?.(");
		expect(hook).toContain("...(options.images?.length ? { images: options.images } : {})");
		expect(preload).toContain('ipcRenderer.invoke("attachment:save", attachment)');
		expect(main).toContain('ipcMain.handle("attachment:save"');
	});
});
