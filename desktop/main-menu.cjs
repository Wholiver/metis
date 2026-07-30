function createApplicationMenuTemplate(platform, appName = "Metis") {
	const editMenu = {
		label: "Edit",
		submenu: [
			{ role: "undo" }, { role: "redo" }, { type: "separator" },
			{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
		],
	};
	if (platform !== "darwin") return [editMenu];
	return [
		{ label: appName, submenu: [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
		editMenu,
		{ role: "windowMenu" },
	];
}

function createEditorContextMenuTemplate(params = {}) {
	const template = [];
	if (params.isEditable) {
		template.push({ role: "undo", enabled: Boolean(params.editFlags?.canUndo) });
		template.push({ role: "redo", enabled: Boolean(params.editFlags?.canRedo) });
		template.push({ type: "separator" });
		template.push({ role: "cut", enabled: Boolean(params.editFlags?.canCut) });
	}
	template.push({ role: "copy", enabled: Boolean(params.editFlags?.canCopy || params.selectionText) });
	if (params.isEditable) {
		template.push({ role: "paste", enabled: Boolean(params.editFlags?.canPaste) });
		template.push({ type: "separator" });
		template.push({ role: "selectAll", enabled: Boolean(params.editFlags?.canSelectAll) });
	}
	return template;
}

module.exports = { createApplicationMenuTemplate, createEditorContextMenuTemplate };
