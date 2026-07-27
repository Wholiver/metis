(function attachDesktopMarkdown(global) {
	const parser = global.marked;
	const purifier = global.DOMPurify;
	if (!parser?.parse || !purifier?.sanitize) {
		throw new Error("Desktop Markdown dependencies failed to load");
	}

	function safeWebUrl(value) {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	}

	purifier.addHook("afterSanitizeAttributes", (node) => {
		const tagName = node.tagName?.toLowerCase();
		if (tagName === "a") {
			const href = node.getAttribute("href") || "";
			if (href.startsWith("#")) {
				node.removeAttribute("target");
				node.removeAttribute("rel");
			} else if (safeWebUrl(href)) {
				node.setAttribute("target", "_blank");
				node.setAttribute("rel", "noopener noreferrer");
			} else {
				node.removeAttribute("href");
				node.removeAttribute("target");
				node.removeAttribute("rel");
			}
		}

		if (tagName === "img") {
			const src = node.getAttribute("src") || "";
			if (!safeWebUrl(src) && !src.startsWith("data:image/")) node.removeAttribute("src");
			node.setAttribute("loading", "lazy");
			node.setAttribute("decoding", "async");
		}

		if (tagName === "input") {
			if (node.getAttribute("type") === "checkbox") {
				node.setAttribute("disabled", "");
			} else {
				node.remove();
			}
		}
	});

	const sanitizeOptions = {
		USE_PROFILES: { html: true },
		ALLOW_DATA_ATTR: false,
		FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "button", "textarea", "select", "option"],
		FORBID_ATTR: ["style", "srcset", "autofocus", "formaction", "xlink:href"],
		ADD_ATTR: ["target", "rel", "loading", "decoding", "disabled", "checked"],
	};

	function render(markdown) {
		const source = String(markdown ?? "").replace(/\r\n?/g, "\n");
		const parsed = parser.parse(source, {
			async: false,
			gfm: true,
			breaks: false,
		});
		return purifier.sanitize(parsed, sanitizeOptions);
	}

	global.metisDesktopMarkdown = Object.freeze({ render });
})(window);
