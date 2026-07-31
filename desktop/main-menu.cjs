const desktopI18n = require("./renderer/i18n.js");

function englishText(key, variables) {
	return desktopI18n.t(key, "en", variables);
}

function menuRole(role, key, text) {
	return { role, label: text(key) };
}

function createApplicationMenuTemplate(platform, appName = "Metis", text = englishText) {
	const editMenu = {
		label: text("menuEdit"),
		submenu: [
			menuRole("undo", "menuUndo", text), menuRole("redo", "menuRedo", text), { type: "separator" },
			menuRole("cut", "menuCut", text), menuRole("copy", "menuCopy", text), menuRole("paste", "menuPaste", text), menuRole("selectAll", "menuSelectAll", text),
		],
	};
	if (platform !== "darwin") return [editMenu];
	return [
		{ label: appName, submenu: [
			{ role: "about", label: text("menuAbout", { appName }) }, { type: "separator" },
			menuRole("services", "menuServices", text), { type: "separator" },
			{ role: "hide", label: text("menuHide", { appName }) }, menuRole("hideOthers", "menuHideOthers", text), menuRole("unhide", "menuShowAll", text),
			{ type: "separator" }, { role: "quit", label: text("menuQuit", { appName }) },
		] },
		editMenu,
		{ role: "windowMenu", label: text("menuWindow") },
	];
}

function createEditorContextMenuTemplate(params = {}, text = englishText) {
	const template = [];
	if (params.isEditable) {
		template.push({ ...menuRole("undo", "menuUndo", text), enabled: Boolean(params.editFlags?.canUndo) });
		template.push({ ...menuRole("redo", "menuRedo", text), enabled: Boolean(params.editFlags?.canRedo) });
		template.push({ type: "separator" });
		template.push({ ...menuRole("cut", "menuCut", text), enabled: Boolean(params.editFlags?.canCut) });
	}
	template.push({ ...menuRole("copy", "menuCopy", text), enabled: Boolean(params.editFlags?.canCopy || params.selectionText) });
	if (params.isEditable) {
		template.push({ ...menuRole("paste", "menuPaste", text), enabled: Boolean(params.editFlags?.canPaste) });
		template.push({ type: "separator" });
		template.push({ ...menuRole("selectAll", "menuSelectAll", text), enabled: Boolean(params.editFlags?.canSelectAll) });
	}
	return template;
}

module.exports = { createApplicationMenuTemplate, createEditorContextMenuTemplate };
