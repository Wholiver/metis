(function initMetisSkillComposer(root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.metisSkillComposer = api;
})(typeof window === "undefined" ? globalThis : window, () => {
	const SKILL_PREFIX = "skill:";
	const BLOCK_ELEMENTS = new Set(["DIV", "P", "LI"]);

	function humanizeSkillName(name) {
		return String(name || "")
			.replace(/^skill:/, "")
			.split(/[-_]+/)
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}

	function normalizeSkills(commands) {
		return (Array.isArray(commands) ? commands : [])
			.filter((command) => command?.source === "skill" && String(command.name || "").startsWith(SKILL_PREFIX))
			.map((command) => {
				const name = String(command.name).slice(SKILL_PREFIX.length);
				return {
					name,
					invocation: `/${SKILL_PREFIX}${name}`,
					label: humanizeSkillName(name),
					description: String(command.description || "").trim(),
				};
			})
			.sort((left, right) => left.label.localeCompare(right.label));
	}

	function findTrigger(text, caret = String(text || "").length) {
		const value = String(text || "");
		const safeCaret = Math.max(0, Math.min(Number(caret) || 0, value.length));
		const beforeCaret = value.slice(0, safeCaret);
		const match = beforeCaret.match(/(?:^|\s)\/(?:skill:)?([\w-]*)$/i);
		if (!match) return null;
		const slashOffset = match[0].lastIndexOf("/");
		return {
			start: beforeCaret.length - match[0].length + slashOffset,
			end: safeCaret,
			query: (match[1] || "").toLowerCase(),
		};
	}

	function filterSkills(skills, query = "", limit = 8) {
		const needle = String(query || "").trim().toLowerCase();
		return (Array.isArray(skills) ? skills : [])
			.map((skill) => {
				const name = String(skill.name || "").toLowerCase();
				const label = String(skill.label || "").toLowerCase();
				const description = String(skill.description || "").toLowerCase();
				let rank = 4;
				if (!needle) rank = 0;
				else if (name.startsWith(needle)) rank = 0;
				else if (label.startsWith(needle)) rank = 1;
				else if (name.includes(needle) || label.includes(needle)) rank = 2;
				else if (description.includes(needle)) rank = 3;
				return { skill, rank };
			})
			.filter((entry) => entry.rank < 4)
			.sort((left, right) => left.rank - right.rank || left.skill.label.localeCompare(right.skill.label))
			.slice(0, limit)
			.map((entry) => entry.skill);
	}

	function isSkillToken(node) {
		return node?.nodeType === 1 && node.matches?.("[data-skill-name]");
	}

	function readNode(node) {
		if (!node) return "";
		if (node.nodeType === 3) return node.nodeValue || "";
		if (isSkillToken(node)) return "";
		if (node.nodeName === "BR") return "\n";
		let result = "";
		for (const child of node.childNodes || []) result += readNode(child);
		if (BLOCK_ELEMENTS.has(node.nodeName) && result && !result.endsWith("\n")) result += "\n";
		return result;
	}

	function editorText(editor) {
		return readNode(editor).replaceAll("\u00a0", " ").replace(/\n+$/, "");
	}

	function selectedSkillName(editor) {
		return editor?.querySelector?.("[data-skill-name]")?.dataset?.skillName || "";
	}

	function serializeEditor(editor) {
		const text = editorText(editor).trim();
		const skillName = selectedSkillName(editor);
		if (!skillName) return text;
		return [`/${SKILL_PREFIX}${skillName}`, text].filter(Boolean).join(" ");
	}

	function createSkillToken(doc, skill) {
		const token = doc.createElement("span");
		token.className = "composer-skill-token";
		token.dataset.skillName = skill.name;
		token.contentEditable = "false";
		token.setAttribute("aria-label", skill.label);

		const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("aria-hidden", "true");
		const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
		use.setAttribute("href", "#i-skill");
		svg.append(use);
		const label = doc.createElement("span");
		label.textContent = skill.label;
		token.append(svg, label);
		return token;
	}

	function placeCaretAfter(node) {
		const selection = node?.ownerDocument?.defaultView?.getSelection?.();
		if (!selection || !node?.parentNode) return;
		const range = node.ownerDocument.createRange();
		range.setStartAfter(node);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	function placeCaretInText(node, offset) {
		const selection = node?.ownerDocument?.defaultView?.getSelection?.();
		if (!selection || node?.nodeType !== 3) return;
		const range = node.ownerDocument.createRange();
		range.setStart(node, Math.max(0, Math.min(offset, (node.nodeValue || "").length)));
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	function setEditorValue(editor, value, skills = []) {
		const text = String(value || "");
		const match = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/);
		const skill = match && skills.find((item) => item.name === match[1]);
		if (!skill) {
			editor.textContent = text;
			return;
		}
		const token = createSkillToken(editor.ownerDocument, skill);
		editor.replaceChildren(token);
		if (match[2]) editor.append(editor.ownerDocument.createTextNode(`\u00a0${match[2]}`));
	}

	function installValueProperty(editor, getSkills = () => []) {
		Object.defineProperty(editor, "value", {
			configurable: true,
			get: () => serializeEditor(editor),
			set: (value) => setEditorValue(editor, value, getSkills()),
		});
		let disabled = false;
		Object.defineProperty(editor, "disabled", {
			configurable: true,
			get: () => disabled,
			set: (value) => {
				disabled = Boolean(value);
				editor.contentEditable = disabled ? "false" : "true";
				editor.setAttribute("aria-disabled", String(disabled));
			},
		});
		return editor;
	}

	function caretOffset(editor) {
		const selection = editor?.ownerDocument?.defaultView?.getSelection?.();
		if (!selection?.rangeCount || !editor.contains(selection.focusNode)) return editorText(editor).length;
		const range = selection.getRangeAt(0).cloneRange();
		range.selectNodeContents(editor);
		range.setEnd(selection.focusNode, selection.focusOffset);
		return range.toString().length;
	}

	function currentTrigger(editor) {
		if (selectedSkillName(editor)) return null;
		return findTrigger(editorText(editor), caretOffset(editor));
	}

	function insertSkill(editor, skill, trigger = currentTrigger(editor)) {
		if (!editor || !skill || !trigger) return false;
		const text = editorText(editor);
		const before = text.slice(0, trigger.start);
		const after = text.slice(trigger.end);
		const token = createSkillToken(editor.ownerDocument, skill);
		editor.replaceChildren();
		if (before) editor.append(editor.ownerDocument.createTextNode(before));
		editor.append(token);
		const suffix = after ? `${/^\s/.test(after) ? "" : "\u00a0"}${after}` : "\u00a0";
		const suffixNode = editor.ownerDocument.createTextNode(suffix);
		editor.append(suffixNode);
		placeCaretInText(suffixNode, suffix.startsWith("\u00a0") ? 1 : 0);
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	}

	function insertPlainText(editor, text) {
		const inserted = String(text || "");
		const selection = editor?.ownerDocument?.defaultView?.getSelection?.();
		if (!selection?.rangeCount || !editor.contains(selection.focusNode)) {
			editor.append(editor.ownerDocument.createTextNode(inserted));
		} else {
			const range = selection.getRangeAt(0);
			range.deleteContents();
			const node = editor.ownerDocument.createTextNode(inserted);
			range.insertNode(node);
			range.setStartAfter(node);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		}
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		return serializeEditor(editor);
	}

	function removeAdjacentSkill(editor, direction = "backward") {
		const selection = editor?.ownerDocument?.defaultView?.getSelection?.();
		if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.focusNode)) return false;
		const container = selection.focusNode;
		const offset = selection.focusOffset;
		let candidate;
		if (container === editor) {
			candidate = direction === "backward" ? editor.childNodes[offset - 1] : editor.childNodes[offset];
		} else if (container.nodeType === 3) {
			if (direction === "backward" && (offset === 0 || (offset === 1 && container.nodeValue?.startsWith("\u00a0")))) candidate = container.previousSibling;
			if (direction === "forward" && offset === (container.nodeValue || "").length) candidate = container.nextSibling;
		}
		if (!isSkillToken(candidate)) return false;
		if (direction === "backward" && container.nodeType === 3 && container.nodeValue?.startsWith("\u00a0")) {
			container.nodeValue = container.nodeValue.slice(1);
		}
		const nextFocus = direction === "backward" ? candidate.previousSibling : candidate.nextSibling;
		candidate.remove();
		if (nextFocus) placeCaretAfter(nextFocus);
		else editor.focus();
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	}

	return {
		caretOffset,
		currentTrigger,
		editorText,
		filterSkills,
		findTrigger,
		humanizeSkillName,
		insertPlainText,
		insertSkill,
		installValueProperty,
		normalizeSkills,
		removeAdjacentSkill,
		selectedSkillName,
		serializeEditor,
		setEditorValue,
	};
});
