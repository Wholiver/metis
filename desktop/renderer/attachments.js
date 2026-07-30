(function initMetisAttachments(root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.metisAttachments = api;
})(typeof window === "undefined" ? globalThis : window, () => {
	const TEXT_EXTENSIONS = new Set([
		"c", "cc", "conf", "cpp", "css", "csv", "go", "h", "hpp", "html", "ini", "java", "js", "json", "jsx",
		"log", "md", "mjs", "py", "rb", "rs", "sh", "sql", "svg", "toml", "ts", "tsx", "txt", "xml", "yaml", "yml",
	]);
	const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "webp"]);
	const IMAGE_MIME_BY_EXTENSION = {
		avif: "image/avif", bmp: "image/bmp", gif: "image/gif", heic: "image/heic", heif: "image/heif",
		jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", webp: "image/webp",
	};
	const VIDEO_EXTENSIONS = new Set(["avi", "flv", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm", "wmv"]);
	const TEXT_MIME_TYPES = new Set([
		"application/javascript", "application/json", "application/ld+json", "application/sql", "application/toml",
		"application/x-httpd-php", "application/x-javascript", "application/x-sh", "application/xhtml+xml",
		"application/xml", "application/yaml", "image/svg+xml",
	]);

	function extensionOf(name = "") {
		const match = String(name).toLowerCase().match(/\.([^.]+)$/);
		return match?.[1] || "";
	}

	function classifyAttachment(file = {}) {
		const mimeType = String(file.type || "").toLowerCase();
		const extension = extensionOf(file.name);
		if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
		if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "video";
		if (mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(extension)) return "text";
		return "file";
	}

	function formatFileSize(size = 0) {
		const bytes = Number.isFinite(Number(size)) ? Number(size) : 0;
		if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${bytes} B`;
	}

	function imageMimeType(file = {}) {
		const mimeType = String(file.type || "").toLowerCase();
		if (mimeType.startsWith("image/")) return mimeType;
		return IMAGE_MIME_BY_EXTENSION[extensionOf(file.name)] || "image/png";
	}

	function filesFromTransfer(transfer) {
		if (!transfer) return [];
		const files = Array.from(transfer.files || []);
		if (files.length > 0) return files;
		return Array.from(transfer.items || [])
			.filter((item) => item?.kind === "file")
			.map((item) => item.getAsFile?.())
			.filter(Boolean);
	}

	function transferHasFiles(transfer) {
		if (!transfer) return false;
		if (filesFromTransfer(transfer).length > 0) return true;
		return Array.from(transfer.types || []).includes("Files");
	}

	function insertTextAtSelection(input, text) {
		const value = String(input?.value || "");
		const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : value.length;
		const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : start;
		const inserted = String(text || "");
		input.value = `${value.slice(0, start)}${inserted}${value.slice(end)}`;
		const cursor = start + inserted.length;
		input.setSelectionRange?.(cursor, cursor);
		input.dispatchEvent?.(new Event("input", { bubbles: true }));
		return input.value;
	}

	function attachmentPrompt(file) {
		const safeName = String(file?.name || "attachment").replaceAll("`", "'");
		if (file?.kind === "text") {
			return `文件 \`${safeName}\` 的内容如下：\n\`\`\`\n${file.content || ""}\n\`\`\``;
		}
		const safePath = String(file?.path || "").replaceAll("`", "'");
		const noun = file?.kind === "video" ? "视频" : "文件";
		const instruction = file?.kind === "video" ? "请按需使用 video 工具处理。" : "请按需读取或处理该文件。";
		return `已添加${noun} \`${safeName}\`，本地路径：\`${safePath}\`。${instruction}`;
	}

	return { attachmentPrompt, classifyAttachment, filesFromTransfer, formatFileSize, imageMimeType, insertTextAtSelection, transferHasFiles };
});
