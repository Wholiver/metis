const desktop = window.metisDesktop;
const desktopI18n = window.metisDesktopI18n;
const { analyzeAssistantTurn, shouldQueueDesktopMessage, getAssistantWorkLayout, getSubagentToolCalls, shouldHideAssistantWorkHeader, getAssistantTurnDuration, reconcileAssistantFinalDivider, isSubagentLaunchNotice } = window.metisMessageTurns;
const { resolveCustomProviderModel } = window.metisModelSelection;
const THINKING_LEVEL_KEYS = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};
const THINKING_TAIL_CELL_COUNT = 90;
const UI_LANGUAGES = desktopI18n.languages;
const PROJECT_STATE_KEY = "metis.desktopProjects.v2";
const DEFAULT_VISIBLE_CONVERSATIONS = 5;
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "openai-codex", "github-copilot"]);

function resolveUiLanguage(language = state?.uiLanguage || "auto") {
	return desktopI18n.resolve(language);
}

function uiText(key, variables) {
	return desktopI18n.t(key, state?.uiLanguage || "auto", variables);
}

function platformDisplayName(platform) {
	if (platform === "darwin") return "macOS";
	if (platform === "win32") return "Windows";
	if (platform === "linux") return "Linux";
	return platform || "—";
}

function revealInFolderLabel() {
	return uiText(state.platform === "win32" ? "revealInExplorer" : "revealInFinder");
}

const state = {
	activeConversationId: undefined,
	activeProjectId: undefined,
	activeInspectorTab: "browser",
	activeFile: undefined,
	fileTree: [],
	platform: undefined,
	serverConnected: false,
	uiLanguage: UI_LANGUAGES.includes(localStorage.getItem("metis.desktopUiLanguage.v2")) ? localStorage.getItem("metis.desktopUiLanguage.v2") : "auto",
	dreamStatusText: undefined,
	isStreaming: false,
	session: undefined,
	models: [],
	messages: [],
	messageStartTimes: {},
	messageDurations: {},
	messageTimings: {},
	attachedImages: [],
	attachedFiles: [],
	toolCallTimes: {},
	subagentDockExpanded: false,
	subagentDockRunningIds: [],
	hasSubmittedMessage: false,
	navigationHistory: [],
	navigationIndex: -1,
	projects: [],
};

let thinkingDrag;
let visualSettingsLoadGeneration = 0;
let projectStateInitialized = false;
let projectSwitchInProgress = false;

const elements = {
	appShell: document.querySelector("#appShell"),
	conversationList: document.querySelector("#conversationList"),
	headingTitle: document.querySelector("#headingTitle"),
	fileRootName: document.querySelector("#fileRootName"),
	fileRootPath: document.querySelector("#fileRootPath"),
	fileTree: document.querySelector("#fileTree"),
	fileFilterInput: document.querySelector("#fileFilterInput"),
	diffTitle: document.querySelector("#diffTitle"),
	diffStats: document.querySelector("#diffStats"),
	diffView: document.querySelector("#diffView"),
	composerInput: document.querySelector("#composerInput"),
	composerAttachments: document.querySelector("#composerAttachments"),
	attachButton: document.querySelector("#attachButton"),
	attachInput: document.querySelector("#attachInput"),
	messageColumn: document.querySelector("#messageColumn"),
	messageScroll: document.querySelector("#messageScroll"),
	conversationPane: document.querySelector(".conversation-pane"),
	emptyState: document.querySelector("#emptyState"),
	runState: document.querySelector("#runState"),
	messageQueue: document.querySelector("#messageQueue"),
	messageQueueToggle: document.querySelector("#messageQueueToggle"),
	messageQueueCount: document.querySelector("#messageQueueCount"),
	messageQueueList: document.querySelector("#messageQueueList"),
	subagentDock: document.querySelector("#subagentDock"),
	subagentDockToggle: document.querySelector("#subagentDockToggle"),
	subagentDockStatus: document.querySelector("#subagentDockStatus"),
	subagentDockList: document.querySelector("#subagentDockList"),
	composerStatusRow: document.querySelector("#composerStatusRow"),
	projectSwitcher: document.querySelector("#projectSwitcher"),
	projectSwitchCapsule: document.querySelector("#projectSwitchCapsule"),
	projectSwitchLabel: document.querySelector("#projectSwitchLabel"),
	projectSwitchMenu: document.querySelector("#projectSwitchMenu"),
	projectSwitchOptions: document.querySelector("#projectSwitchOptions"),
	projectSwitchAdd: document.querySelector("#projectSwitchAdd"),
	dreamState: document.querySelector("#dreamState"),
	modelPicker: document.querySelector("#modelPicker"),
	modelTrigger: document.querySelector("#modelTrigger"),
	modelTriggerLabel: document.querySelector("#modelTriggerLabel"),
	modelMenu: document.querySelector("#modelMenu"),
	modelOptions: document.querySelector("#modelOptions"),
	advancedEntry: document.querySelector("#advancedEntry"),
	contextIndicator: document.querySelector("#contextIndicator"),
	contextPercentRing: document.querySelector("#contextPercentRing"),
	advancedValue: document.querySelector("#advancedValue"),
	thinkingScale: document.querySelector("#thinkingScale"),
	thinkingBack: document.querySelector("#thinkingBack"),
	sendButton: document.querySelector("#sendButton"),
	sendButtonIcon: document.querySelector("#sendButtonIcon"),
	historyBack: document.querySelector("#historyBack"),
	historyForward: document.querySelector("#historyForward"),
	serverDialog: document.querySelector("#serverDialog"),
	serverLoading: document.querySelector("#serverLoading"),
	serverLoadingText: document.querySelector("#serverLoadingText"),
	serverLoadingConnect: document.querySelector("#serverLoadingConnect"),
	fileContentDialog: document.querySelector("#fileContentDialog"),
	fileContentTitle: document.querySelector("#fileContentTitle"),
	fileContentBody: document.querySelector("#fileContentBody"),
	browserView: document.querySelector("#browserView"),
	browserAddress: document.querySelector("#browserAddress"),
	browserStatus: document.querySelector("#browserStatus"),
	settingsShell: document.querySelector("#settingsShell"),
	settingsSearchInput: document.querySelector("#settingsSearchInput"),
	settingsSearchEmpty: document.querySelector("#settingsSearchEmpty"),
	settingsServerStatus: document.querySelector("#settingsServerStatus"),
	settingsServerAddress: document.querySelector("#settingsServerAddress"),
	settingsWorkspaceName: document.querySelector("#settingsWorkspaceName"),
	settingsWorkspacePath: document.querySelector("#settingsWorkspacePath"),
	settingsAppVersion: document.querySelector("#settingsAppVersion"),
	settingsPlatform: document.querySelector("#settingsPlatform"),
	revealFileButton: document.querySelector("#revealFileButton"),
	settingsAgentFeedback: document.querySelector("#settingsAgentFeedback"),
	settingsBehaviorFeedback: document.querySelector("#settingsBehaviorFeedback"),
	settingsModelSelect: document.querySelector("#settingsModelSelect"),
	settingsThinkingSelect: document.querySelector("#settingsThinkingSelect"),
	settingsAutoCompactInput: document.querySelector("#settingsAutoCompactInput"),
	settingsSteeringModeSelect: document.querySelector("#settingsSteeringModeSelect"),
	settingsFollowUpModeSelect: document.querySelector("#settingsFollowUpModeSelect"),
	settingsLanguageSelect: document.querySelector("#settingsLanguageSelect"),
	settingsCompactInstructions: document.querySelector("#settingsCompactInstructions"),
	settingsSessionFeedback: document.querySelector("#settingsSessionFeedback"),
	settingsSecurityFeedback: document.querySelector("#settingsSecurityFeedback"),
	settingsSessionNameInput: document.querySelector("#settingsSessionNameInput"),
	settingsSessionSummary: document.querySelector("#settingsSessionSummary"),
	settingsResumeSelect: document.querySelector("#settingsResumeSelect"),
	settingsForkSelect: document.querySelector("#settingsForkSelect"),
	settingsTreeSelect: document.querySelector("#settingsTreeSelect"),
	settingsTrustSelect: document.querySelector("#settingsTrustSelect"),
	settingsOauthProvider: document.querySelector("#settingsOauthProvider"),
	settingsApiKeyProvider: document.querySelector("#settingsApiKeyProvider"),
	settingsApiKeyInput: document.querySelector("#settingsApiKeyInput"),
	settingsCustomProviderName: document.querySelector("#settingsCustomProviderName"),
	settingsCustomBaseUrl: document.querySelector("#settingsCustomBaseUrl"),
	settingsCustomApiKey: document.querySelector("#settingsCustomApiKey"),
	settingsCustomProviderReasoning: document.querySelector("#settingsCustomProviderReasoning"),
	settingsLogoutProvider: document.querySelector("#settingsLogoutProvider"),
};

function icon(name, className = "") {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	if (className) svg.classList.add(className);
	const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
	use.setAttribute("href", `#i-${name}`);
	svg.append(use);
	return svg;
}

function finishServerLoading() {
	if (!elements.serverLoading || elements.serverLoading.classList.contains("leaving")) return;
	elements.serverLoading.classList.remove("failed");
	elements.serverLoading.classList.add("leaving");
	setTimeout(() => elements.serverLoading.classList.add("hidden"), 240);
}

function showServerLoadingFailure() {
	if (!elements.serverLoading) return;
	elements.serverLoading.classList.add("failed");
	elements.serverLoadingText.textContent = uiText("serverConnectFailed");
	elements.serverLoadingConnect.classList.remove("hidden");
}

function setSettingsFeedback(element, message, isError = false) {
	if (!element) return;
	element.textContent = message;
	element.classList.toggle("error", isError);
}

function renderSettingsAgentControls() {
	const connected = Boolean(state.serverConnected && state.session);
	const agentControls = [
		elements.settingsModelSelect,
		elements.settingsThinkingSelect,
		elements.settingsAutoCompactInput,
		elements.settingsSteeringModeSelect,
		elements.settingsFollowUpModeSelect,
	];
	agentControls.forEach((control) => {
		if (control) control.disabled = !connected;
	});

	if (elements.settingsModelSelect) {
		elements.settingsModelSelect.replaceChildren();
		if (!connected || !state.models.length) {
			const option = document.createElement("option");
			option.textContent = connected ? uiText("noModels") : uiText("loadAfterConnect");
			elements.settingsModelSelect.append(option);
			elements.settingsModelSelect.disabled = true;
		} else {
			state.models.forEach((model, index) => {
				const option = document.createElement("option");
				option.value = String(index);
				option.textContent = `${modelLabel(model)} · ${model.provider}`;
				option.selected = model.provider === state.session?.model?.provider && model.id === state.session?.model?.id;
				elements.settingsModelSelect.append(option);
			});
		}
	}

	if (elements.settingsThinkingSelect) {
		elements.settingsThinkingSelect.replaceChildren();
		const levels = connected ? getAvailableThinkingLevels() : [];
		if (!levels.length) {
			const option = document.createElement("option");
			option.textContent = connected ? uiText("modelUnsupported") : uiText("loadAfterConnect");
			elements.settingsThinkingSelect.append(option);
			elements.settingsThinkingSelect.disabled = true;
		} else {
			levels.forEach((level) => {
				const option = document.createElement("option");
				option.value = level;
				option.textContent = thinkingLabel(level);
				option.selected = level === state.session?.thinkingLevel;
				elements.settingsThinkingSelect.append(option);
			});
		}
	}

	if (elements.settingsAutoCompactInput) {
		elements.settingsAutoCompactInput.checked = Boolean(state.session?.autoCompactionEnabled);
	}
	if (elements.settingsSteeringModeSelect && state.session?.steeringMode) {
		elements.settingsSteeringModeSelect.value = state.session.steeringMode;
	}
	if (elements.settingsFollowUpModeSelect && state.session?.followUpMode) {
		elements.settingsFollowUpModeSelect.value = state.session.followUpMode;
	}

	setSettingsFeedback(
		elements.settingsAgentFeedback,
		uiText(connected ? "agentFeedbackConnected" : "agentFeedbackDisconnected"),
	);
	setSettingsFeedback(
		elements.settingsBehaviorFeedback,
		uiText(connected ? "behaviorFeedbackConnected" : "behaviorFeedbackDisconnected"),
	);
	applySettingsBusyState();
}

async function updateAgentSessionSettings(patch, feedbackElement) {
	if (!state.serverConnected) return;
	setSettingsFeedback(feedbackElement, "正在保存…");
	try {
		state.session = await requestServer("/session/settings", "PUT", patch);
		renderSettingsAgentControls();
		setSettingsFeedback(feedbackElement, "已保存并应用到当前 Agent 会话。");
	} catch (error) {
		renderSettingsAgentControls();
		setSettingsFeedback(feedbackElement, `保存失败：${error.message}`, true);
	}
}

function replaceSelectOptions(select, items, getValue, getLabel, emptyLabel = "暂无可用项") {
	if (!select) return;
	select.replaceChildren();
	const seen = new Set();
	const uniqueItems = items.filter((item) => {
		const value = String(getValue(item));
		if (!value || seen.has(value)) return false;
		seen.add(value);
		return true;
	});
	if (!uniqueItems.length) {
		const option = document.createElement("option");
		option.textContent = emptyLabel;
		option.value = "";
		select.append(option);
		select.disabled = true;
		return;
	}
	uniqueItems.forEach((item) => {
		const option = document.createElement("option");
		option.value = getValue(item);
		option.textContent = getLabel(item);
		select.append(option);
	});
	select.disabled = false;
}

function flattenSessionTree(nodes, depth = 0, result = []) {
	const entryTypeLabels = {
		message: "消息",
		thinking_level_change: "思考等级变更",
		model_change: "模型变更",
		compaction: "上下文摘要",
		branch_summary: "分支摘要",
		custom: "自定义记录",
	};
	for (const node of nodes || []) {
		const entry = node.entry || {};
		const text = extractMessageText(entry.message || {}).replace(/\s+/g, " ").trim();
		const fallback = entryTypeLabels[entry.type] || entry.type || entry.id;
		result.push({ id: entry.id, label: `${"　".repeat(depth)}${text.slice(0, 48) || fallback}` });
		flattenSessionTree(node.children, depth + 1, result);
	}
	return result;
}

async function runVisualCommand(command, feedbackElement, { refresh = false } = {}) {
	if (!state.serverConnected) throw new Error("请先连接 Metis Server");
	setSettingsFeedback(feedbackElement, "正在应用…");
	const result = await requestServer("/session/command", "POST", { command });
	if (result.action === "copy" && result.text) await desktop.clipboard.writeText(result.text);
	if (result.action === "open-url" && result.url) await desktop.openExternal(result.url);
	if (result.action === "quit") {
		await desktop.quit();
		return result;
	}
	if (refresh || ["model", "import", "fork", "clone", "new", "resume"].includes(result.command)) {
		await syncServerSession();
		await loadVisualSettings();
	}
	setSettingsFeedback(feedbackElement, result.message || "已完成。");
	return result;
}

function performVisualAction(feedbackElement, action) {
	void Promise.resolve()
		.then(action)
		.catch((error) => setSettingsFeedback(feedbackElement, `操作失败：${error.message}`, true));
}

function applySettingsBusyState() {
	const connected = Boolean(state.serverConnected && state.session);
	const busy = Boolean(state.session?.isStreaming || state.session?.isCompacting);
	const busySensitiveIds = [
		"settingsModelSelect",
		"settingsThinkingSelect",
		"settingsCompactButton",
		"settingsCloneSession",
		"settingsNewSession",
		"settingsResumeButton",
		"settingsForkButton",
		"settingsTreeButton",
		"settingsExportHtml",
		"settingsExportJsonl",
		"settingsImportSession",
		"settingsShareSession",
		"settingsOauthLoginButton",
		"settingsApiKeySaveButton",
		"settingsCustomProviderSaveButton",
		"settingsLogoutButton",
		"settingsReloadResources",
	];
	busySensitiveIds.forEach((id) => {
		const control = document.querySelector(`#${id}`);
		if (!control) return;
		control.disabled = !connected || busy;
		control.title = busy ? "Agent 正在运行或压缩上下文，请等待本轮结束" : "";
	});
}

async function loadVisualSettings() {
	const generation = ++visualSettingsLoadGeneration;
	const controls = document.querySelectorAll("[data-settings-content='session'] button, [data-settings-content='security'] button, #settingsCompactButton");
	controls.forEach((control) => { control.disabled = !state.serverConnected; });
	applySettingsBusyState();
	if (!state.serverConnected) {
		setSettingsFeedback(elements.settingsSessionFeedback, "连接 Server 后载入会话信息。");
		setSettingsFeedback(elements.settingsSecurityFeedback, "连接 Server 后载入账户状态。");
		return;
	}
	try {
		const [language, sessionInfo, sessions, forks, tree, trust, login, logout] = await Promise.all([
			requestServer("/session/command", "POST", { command: "/language" }),
			requestServer("/session/command", "POST", { command: "/session" }),
			requestServer("/session/command", "POST", { command: "/resume" }),
			requestServer("/session/command", "POST", { command: "/fork" }),
			requestServer("/session/command", "POST", { command: "/tree" }),
			requestServer("/session/command", "POST", { command: "/trust" }),
			requestServer("/session/command", "POST", { command: "/login" }),
			requestServer("/session/command", "POST", { command: "/logout" }),
		]);
		if (generation !== visualSettingsLoadGeneration) return;

		replaceSelectOptions(elements.settingsLanguageSelect, language.options || [], (item) => item.code, (item) => item.nativeName);
		elements.settingsLanguageSelect.value = state.uiLanguage;

		elements.settingsSessionNameInput.value = state.session?.sessionName || "";
		const stats = sessionInfo.stats || {};
		const totalMessages = stats.totalMessages ?? stats.messageCount ?? state.session?.messageCount ?? 0;
		elements.settingsSessionSummary.textContent = `${totalMessages} 条消息 · ${state.session?.pendingMessageCount || 0} 条排队消息`;

		const otherSessions = window.metisDesktopConversations
			.visibleSessions(sessions.sessions)
			.filter((item) => item.path !== state.session?.sessionFile);
		replaceSelectOptions(elements.settingsResumeSelect, otherSessions, (item) => item.path, (item) => item.name || item.firstMessage || item.path, "没有其他会话");
		replaceSelectOptions(elements.settingsForkSelect, forks.entries || [], (item) => item.entryId || item.id, (item) => (item.text || item.message || item.entryId || item.id).toString().slice(0, 70), "没有可分叉消息");
		const treeItems = flattenSessionTree(tree.tree || []).filter((item) => item.id !== tree.leafId);
		replaceSelectOptions(elements.settingsTreeSelect, treeItems, (item) => item.id, (item) => item.label, "没有其他历史节点");

		elements.settingsTrustSelect.value = trust.decision === true ? "trusted" : trust.decision === false ? "untrusted" : "clear";
		const loginProviders = login.providers || [];
		replaceSelectOptions(elements.settingsOauthProvider, loginProviders.filter((provider) => OAUTH_PROVIDER_IDS.has(provider)), (item) => item, (item) => item, "没有可用 OAuth Provider");
		replaceSelectOptions(elements.settingsApiKeyProvider, loginProviders.filter((provider) => provider !== "other"), (item) => item, (item) => item, "没有可用 Provider");
		replaceSelectOptions(elements.settingsLogoutProvider, logout.providers || [], (item) => item, (item) => item, "没有已保存凭据");
		await fillCustomProviderForm();
		setSettingsFeedback(elements.settingsSessionFeedback, "会话信息已同步。会话切换类操作会先保留当前会话，再载入目标状态。");
		setSettingsFeedback(elements.settingsSecurityFeedback, "账户与项目权限状态已同步；项目可信状态需重启 Server 后生效。");
		applySettingsBusyState();
	} catch (error) {
		setSettingsFeedback(elements.settingsSessionFeedback, `载入失败：${error.message}。请完全重启 Desktop 和 Server。`, true);
		setSettingsFeedback(elements.settingsSecurityFeedback, `载入失败：${error.message}。请完全重启 Desktop 和 Server。`, true);
	}
}

async function fillCustomProviderForm() {
	if (!desktop.providerConfig?.getCustom) return;
	try {
		const custom = await desktop.providerConfig.getCustom();
		if (!custom) return;
		if (elements.settingsCustomProviderName && !elements.settingsCustomProviderName.value.trim() && custom.name) {
			elements.settingsCustomProviderName.value = custom.name;
		}
		if (elements.settingsCustomBaseUrl && !elements.settingsCustomBaseUrl.value.trim() && custom.baseUrl) {
			elements.settingsCustomBaseUrl.value = custom.baseUrl;
		}
		if (elements.settingsCustomProviderReasoning) {
			elements.settingsCustomProviderReasoning.checked = custom.reasoning !== false;
		}
	} catch {
		if (elements.settingsCustomProviderReasoning) elements.settingsCustomProviderReasoning.checked = true;
	}
}

function selectSettingsPanel(panelName) {
	document.querySelectorAll("[data-settings-panel]").forEach((button) => {
		button.classList.toggle("active", button.dataset.settingsPanel === panelName);
	});
	document.querySelectorAll("[data-settings-content]").forEach((panel) => {
		const active = panel.dataset.settingsContent === panelName;
		panel.classList.toggle("active", active);
		panel.hidden = !active;
	});
}

function updateSettingsConnectionDetails() {
	if (!elements.settingsServerStatus || !elements.settingsServerAddress) return;
	elements.settingsServerStatus.classList.toggle("connected", state.serverConnected);
	elements.settingsServerStatus.lastChild.textContent = uiText(state.serverConnected ? "connected" : "disconnected");
	elements.settingsServerAddress.textContent = document.querySelector("#serverUrlInput")?.value || "http://127.0.0.1:4096";
}

async function updateSettingsDetails() {
	updateSettingsConnectionDetails();
	renderSettingsAgentControls();
	void loadVisualSettings();
	try {
		const [appInfo, workspace] = await Promise.all([desktop.appInfo(), desktop.workspace.get()]);
		state.platform = appInfo.platform;
		document.body.classList.add(`platform-${appInfo.platform}`);
		elements.settingsAppVersion.textContent = uiText("version", { version: appInfo.version });
		elements.settingsPlatform.textContent = platformDisplayName(appInfo.platform);
		elements.settingsWorkspaceName.textContent = workspace.name || uiText("currentWorkspace");
		elements.settingsWorkspacePath.textContent = workspace.path || uiText("noWorkspace");
		if (elements.revealFileButton) elements.revealFileButton.textContent = revealInFolderLabel();
	} catch {
		elements.settingsWorkspacePath.textContent = uiText("workspaceReadFailed");
	}
}

function openSettings() {
	elements.settingsShell.hidden = false;
	elements.appShell.hidden = true;
	document.body.classList.add("settings-open");
	selectSettingsPanel("agent");
	elements.settingsSearchInput.value = "";
	document.querySelectorAll("[data-settings-panel]").forEach((button) => { button.hidden = false; });
	elements.settingsSearchEmpty.hidden = true;
	void updateSettingsDetails();
	window.MetisOnboarding?.notifyEvent("open_settings");
}

function closeSettings() {
	elements.settingsShell.hidden = true;
	elements.appShell.hidden = false;
	document.body.classList.remove("settings-open");
	document.querySelector("#sidebarSettingsButton")?.focus();
}

function filterSettingsNavigation(query) {
	const normalized = query.trim().toLocaleLowerCase("zh-CN");
	const visibleButtons = [];
	document.querySelectorAll("[data-settings-panel]").forEach((button) => {
		const visible = !normalized || button.textContent.toLocaleLowerCase("zh-CN").includes(normalized);
		button.hidden = !visible;
		if (visible) visibleButtons.push(button);
	});
	elements.settingsSearchEmpty.hidden = visibleButtons.length > 0;
	if (visibleButtons.length && !visibleButtons.some((button) => button.classList.contains("active"))) {
		selectSettingsPanel(visibleButtons[0].dataset.settingsPanel);
	}
}

function activeProject() {
	return state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0];
}

function projectForPath(projectPath) {
	const normalized = window.metisDesktopConversations.normalizeProjectPath(projectPath);
	return state.projects.find((project) => project.path === normalized);
}

async function setWorkspaceChecked(workspacePath) {
	const requested = window.metisDesktopConversations.normalizeProjectPath(workspacePath);
	const workspace = await desktop.workspace.set(workspacePath);
	const actual = window.metisDesktopConversations.normalizeProjectPath(workspace?.path);
	if (requested && actual !== requested) {
		throw new Error(`Workspace directory does not exist: ${requested}`);
	}
	return workspace;
}

function saveProjectState() {
	try {
		localStorage.setItem(
			PROJECT_STATE_KEY,
			window.metisDesktopConversations.serializeProjectState(state.projects, state.activeProjectId),
		);
	} catch {}
}

function initializeProjectState(workspace) {
	if (projectStateInitialized) return;
	const restored = window.metisDesktopConversations.restoreProjectState(
		localStorage.getItem(PROJECT_STATE_KEY),
		workspace,
	);
	state.projects = restored.projects;
	state.activeProjectId = restored.activeProjectId;
	projectStateInitialized = true;
	saveProjectState();
}

function ensureProject(workspace) {
	const projectPath = window.metisDesktopConversations.normalizeProjectPath(workspace?.path);
	let project = projectForPath(projectPath);
	if (project) return project;
	project = window.metisDesktopConversations.createProject(workspace);
	if (!project) return undefined;
	state.projects.push(project);
	saveProjectState();
	return project;
}

function applyProjectDetails(project) {
	if (!project) return;
	elements.fileRootName.textContent = project.name;
	elements.fileRootPath.textContent = project.path;
	renderComposerStatusRow();
	renderConversations();
}

function setProjectSwitchMenuOpen(open, { focusSelected = false } = {}) {
	const nextOpen = Boolean(open && !elements.projectSwitchCapsule.disabled);
	elements.projectSwitcher.classList.toggle("open", nextOpen);
	elements.projectSwitchCapsule.setAttribute("aria-expanded", String(nextOpen));
	elements.projectSwitchMenu.setAttribute("aria-hidden", String(!nextOpen));
	if (nextOpen) renderProjectSwitchOptions();
	if (nextOpen && focusSelected) {
		requestAnimationFrame(() => elements.projectSwitchOptions.querySelector('[aria-checked="true"]')?.focus());
	}
}

function renderProjectSwitchOptions() {
	elements.projectSwitchOptions.replaceChildren();
	for (const project of state.projects) {
		const selected = project.id === state.activeProjectId;
		const option = document.createElement("button");
		option.type = "button";
		option.className = "project-switch-option";
		option.setAttribute("role", "menuitemradio");
		option.setAttribute("aria-checked", String(selected));
		option.title = project.path;
		option.append(icon(selected ? "folder-open" : "folder"));
		const copy = document.createElement("span");
		const name = document.createElement("strong");
		name.textContent = project.name;
		const projectPath = document.createElement("small");
		projectPath.textContent = project.path;
		copy.append(name, projectPath);
		option.append(copy);
		if (selected) option.append(icon("check"));
		option.addEventListener("click", () => {
			setProjectSwitchMenuOpen(false);
			if (!selected) void activateProject(project);
		});
		elements.projectSwitchOptions.append(option);
	}
}

async function loadProjectConversations(project) {
	if (!state.serverConnected || !project?.path) return;
	const result = await requestServer(`/sessions?cwd=${encodeURIComponent(project.path)}`);
	project.conversations = window.metisDesktopConversations.fromSessions(result.sessions, uiText("untitledTask"));
	if (project.lastSessionPath && !project.conversations.some((item) => item.sessionPath === project.lastSessionPath)) {
		project.lastSessionPath = undefined;
	}
}

async function refreshAllProjectConversations() {
	await Promise.all(state.projects.map((project) => loadProjectConversations(project)));
	renderConversations();
}

function removeProject(projectToRemove) {
	if (!projectToRemove) return;
	state.projects = state.projects.filter((p) => p.id !== projectToRemove.id);
	if (state.activeProjectId === projectToRemove.id) {
		const nextProject = state.projects[0];
		state.activeProjectId = nextProject?.id;
		if (nextProject) {
			void activateProject(nextProject);
		} else {
			elements.fileRootName.textContent = uiText("noWorkspace");
			elements.fileRootPath.textContent = "";
		}
	}
	saveProjectState();
	renderConversations();
}

function renderConversations() {
	elements.conversationList.replaceChildren();
	if (!state.projects.length) {
		const empty = document.createElement("div");
		empty.className = "projects-empty-state";
		empty.title = uiText("addProject");
		empty.append(icon("folder"));
		const text = document.createElement("span");
		text.textContent = uiText("noProjects");
		empty.append(text);
		empty.addEventListener("click", () => {
			document.querySelector("#chooseWorkspaceButton")?.click();
		});
		elements.conversationList.append(empty);
		return;
	}
	for (const project of state.projects) {
		const group = document.createElement("section");
		group.className = `project-group${project.collapsed ? " collapsed" : ""}`;

		const header = document.createElement("div");
		const isActiveProject = project.id === state.activeProjectId;
		header.className = `project-header${isActiveProject ? " active" : ""}`;

		const headerMain = document.createElement("button");
		headerMain.type = "button";
		headerMain.className = "project-header-main";
		headerMain.setAttribute("aria-expanded", String(!project.collapsed));
		headerMain.append(icon(project.collapsed ? "folder" : "folder-open"));
		const title = document.createElement("span");
		title.className = "project-header-title";
		title.textContent = project.name;
		headerMain.append(title);
		headerMain.addEventListener("click", () => {
			if (!isActiveProject) {
				void activateProject(project);
				return;
			}
			project.collapsed = !project.collapsed;
			saveProjectState();
			renderConversations();
		});
		header.append(headerMain);

		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "project-remove-button";
		removeBtn.title = uiText("removeProject");
		removeBtn.setAttribute("aria-label", uiText("removeProject"));
		removeBtn.append(icon("x"));
		removeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			removeProject(project);
		});
		header.append(removeBtn);

		group.append(header);

		const list = document.createElement("div");
		list.className = "project-conversations";
		const visibleConversations = window.metisDesktopConversations.visibleProjectConversations(
			project.conversations,
			project.conversationsExpanded,
			DEFAULT_VISIBLE_CONVERSATIONS,
		);
		for (const conversation of visibleConversations) {
			const button = document.createElement("button");
			const isActive = conversation.id === state.activeConversationId;
			button.className = `conversation-item${isActive ? " active" : ""}`;
			const label = document.createElement("span");
			const isNaming = conversation.title === uiText("namingTitle") || (isActive && Boolean(state.session?.isGeneratingSessionName));
			label.className = `conversation-label${isNaming ? " working-shimmer" : ""}`;
			label.textContent = conversation.title;
			button.append(label);

			if (isActive && state.isStreaming) {
				const spinner = document.createElement("span");
				spinner.className = "conversation-spinner";
				button.append(spinner);
			} else if (conversation.branch) {
				button.append(icon("branch"));
			} else {
				button.append(document.createElement("i"));
			}

			button.addEventListener("click", () => selectConversation(project, conversation));
			list.append(button);
		}
		if (project.conversations.length > DEFAULT_VISIBLE_CONVERSATIONS) {
			const expandButton = document.createElement("button");
			expandButton.type = "button";
			expandButton.className = "conversation-expand-button";
			expandButton.textContent = uiText(project.conversationsExpanded ? "showLessConversations" : "showMoreConversations");
			expandButton.setAttribute("aria-expanded", String(Boolean(project.conversationsExpanded)));
			expandButton.addEventListener("click", () => {
				project.conversationsExpanded = !project.conversationsExpanded;
				renderConversations();
			});
			list.append(expandButton);
		}
		group.append(list);
		elements.conversationList.append(group);
	}
}

function updateHistoryButtons() {
	elements.historyBack.disabled = state.navigationIndex <= 0;
	elements.historyForward.disabled = state.navigationIndex < 0 || state.navigationIndex >= state.navigationHistory.length - 1;
}

function recordNavigation(conversationId) {
	if (!conversationId || state.navigationHistory[state.navigationIndex] === conversationId) {
		updateHistoryButtons();
		return;
	}
	state.navigationHistory = state.navigationHistory.slice(0, state.navigationIndex + 1);
	state.navigationHistory.push(conversationId);
	state.navigationIndex = state.navigationHistory.length - 1;
	updateHistoryButtons();
}

function findConversation(conversationId) {
	for (const project of state.projects) {
		const conversation = project.conversations.find((item) => item.id === conversationId);
		if (conversation) return { project, conversation };
	}
	return undefined;
}

async function navigateHistory(offset) {
	const nextIndex = state.navigationIndex + offset;
	if (nextIndex < 0 || nextIndex >= state.navigationHistory.length) return;
	const target = findConversation(state.navigationHistory[nextIndex]);
	if (!target) return;
	state.navigationIndex = nextIndex;
	updateHistoryButtons();
	await selectConversation(target.project, target.conversation, false);
}

async function selectConversation(project, conversation, record = true) {
	if (project.id !== state.activeProjectId) {
		await activateProject(project, { targetSessionPath: conversation.sessionPath, record });
		return;
	}
	state.activeConversationId = conversation.id;
	if (record) recordNavigation(conversation.id);
	updateHeadingTitle(conversation.title, conversation.title === uiText("namingTitle") || (conversation.id === state.session?.sessionId && Boolean(state.session?.isGeneratingSessionName)));
	renderConversations();
	if (state.serverConnected && conversation.sessionPath && conversation.sessionPath !== state.session?.sessionFile) {
		setStreamingState(true, "正在切换会话");
		try {
			await requestServer("/session/switch", "POST", { sessionPath: conversation.sessionPath });
			await syncServerSession({ loadModels: false });
			project.lastSessionPath = conversation.sessionPath;
			saveProjectState();
		} catch (error) {
			appendAssistantNotice(error.message, "切换失败");
		} finally {
			setStreamingState(false);
		}
	}
	elements.composerInput.focus();
}

async function createConversation() {
	if (!state.serverConnected) {
		elements.serverDialog.showModal();
		return;
	}
	setStreamingState(true, "正在创建任务");
	try {
		await requestServer("/session/new", "POST", { cwd: activeProject()?.path });
		await syncServerSession({ loadModels: false });
	} catch (error) {
		appendAssistantNotice(error.message, "创建失败");
	} finally {
		setStreamingState(false);
	}
	elements.composerInput.focus();
}

async function activateProject(project, { targetSessionPath, record = true, loadModels = true, forceNewConversation = false } = {}) {
	if (!project || projectSwitchInProgress) return;
	projectSwitchInProgress = true;
	for (const candidate of state.projects) candidate.collapsed = candidate.id !== project.id;
	state.activeProjectId = project.id;
	state.activeConversationId = undefined;
	saveProjectState();
	applyProjectDetails(project);

	try {
		await setWorkspaceChecked(project.path);
		await refreshFileTree();
		if (!state.serverConnected) return;

		setStreamingState(true, "正在切换项目");
		await loadProjectConversations(project);
		const currentSession = await requestServer("/session");
		const currentCwd = window.metisDesktopConversations.normalizeProjectPath(currentSession.cwd);
		const destination = !forceNewConversation && (targetSessionPath
			|| project.lastSessionPath
			|| project.conversations[0]?.sessionPath);

		if (forceNewConversation) {
			await requestServer("/session/new", "POST", { cwd: project.path });
		} else if (destination && destination !== currentSession.sessionFile) {
			await requestServer("/session/switch", "POST", { sessionPath: destination });
		} else if (currentCwd !== project.path) {
			await requestServer("/session/new", "POST", { cwd: project.path });
		}
		await syncServerSession({ loadModels });
		if (record && state.activeConversationId) recordNavigation(state.activeConversationId);
	} catch (error) {
		appendAssistantNotice(error.message, "项目切换失败");
	} finally {
		projectSwitchInProgress = false;
		setStreamingState(Boolean(state.session?.isStreaming), uiText(state.session?.isCompacting ? "compactingContext" : "agentWorking"));
		renderConversations();
	}
}

async function loadWorkspace(select = false) {
	try {
		const workspace = select ? await desktop.workspace.select() : await desktop.workspace.get();
		if (!workspace) return;
		initializeProjectState(workspace);
		const isNewProject = !projectForPath(workspace.path);
		const project = ensureProject(workspace);
		if (!project) return;
		if (select) {
			window.MetisOnboarding?.notifyEvent("workspace_changed");
			await activateProject(project, { forceNewConversation: isNewProject });
			return;
		}
		const selectedProject = activeProject() || project;
		state.activeProjectId = selectedProject.id;
		try {
			await setWorkspaceChecked(selectedProject.path);
		} catch (error) {
			// Project paths restored from local state may point to removed folders.
			// Drop the stale project and fall back to the current workspace.
			if (!String(error?.message || "").includes("Workspace directory does not exist")) throw error;
			state.projects = state.projects.filter((item) => item.path !== selectedProject.path);
			const fallbackProject = ensureProject(workspace) || project;
			state.activeProjectId = fallbackProject.id;
			saveProjectState();
			await desktop.workspace.set(fallbackProject.path);
		}
		applyProjectDetails(activeProject() || project);
		await refreshFileTree();
	} catch (error) {
		elements.fileTree.textContent = `无法读取工作区：${error.message}`;
	}
}

async function requestServer(path, method = "GET", body) {
	const result = await desktop.metis.request({ path, method, body });
	if (!result.ok) {
		const message = result.data?.error?.message || result.error || `Server 请求失败（HTTP ${result.status || 0}）`;
		throw new Error(message);
	}
	return result.data;
}

function updateHeadingTitle(title, isGenerating) {
	if (!elements.headingTitle) return;
	elements.headingTitle.textContent = title;
	const isNaming = title === uiText("namingTitle") || Boolean(isGenerating);
	elements.headingTitle.classList.toggle("working-shimmer", isNaming);
}

function sessionTitle(session) {
	if (session.sessionName?.trim()) return session.sessionName.trim();
	return session.isGeneratingSessionName ? uiText("namingTitle") : uiText("untitledTask");
}

function replaceServerConversations(sessions) {
	const project = activeProject();
	if (!project) return;
	project.conversations = window.metisDesktopConversations.fromSessions(sessions, uiText("untitledTask"));
}

function upsertServerConversation(session) {
	const project = projectForPath(session.cwd) || activeProject();
	if (!project) return;
	const sessionId = session.sessionId;
	const sessionFile = session.sessionFile;
	if (!sessionId && !sessionFile) return;

	let conversation = project.conversations.find((item) =>
		(sessionId && item.id === sessionId) ||
		(sessionFile && (item.id === sessionFile || item.sessionPath === sessionFile))
	);

	if (!conversation) {
		const id = sessionFile || sessionId;
		conversation = { id, title: sessionTitle(session), branch: false, sessionPath: sessionFile };
		project.conversations.unshift(conversation);
	} else {
		conversation.title = sessionTitle(session);
		conversation.sessionPath = sessionFile;
		if (sessionFile) conversation.id = sessionFile;
		const currentIndex = project.conversations.indexOf(conversation);
		if (currentIndex > 0) {
			project.conversations.splice(currentIndex, 1);
			project.conversations.unshift(conversation);
		}
	}

	project.collapsed = false;
	project.lastSessionPath = sessionFile;
	state.activeProjectId = project.id;
	state.activeConversationId = conversation.id;
	saveProjectState();
	recordNavigation(conversation.id);
	updateHeadingTitle(conversation.title, session.isGeneratingSessionName);
	renderConversations();
}

function extractMessageText(message) {
	if (typeof message?.content === "string") return message.content;
	if (!Array.isArray(message?.content)) return "";
	return message.content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function extractMessageImages(message) {
	if (!Array.isArray(message?.content)) return [];
	return message.content
		.filter((part) => part?.type === "image" && part.image)
		.map((part) => part.image);
}

function extractMessageFiles(messageText) {
	const files = [];
	const fileRegex = /\n\n文件 \`([^\`]+)\` 的内容如下：\n\`\`\`(?:\w*\n)?([\s\S]*?)\n\`\`\`/g;
	let match;
	while ((match = fileRegex.exec(messageText)) !== null) {
		files.push({ name: match[1], content: match[2] });
	}
	return files;
}

function cleanMessageTextOfFiles(messageText) {
	const fileRegex = /\n\n文件 \`([^\`]+)\` 的内容如下：\n\`\`\`(?:\w*\n)?([\s\S]*?)\n\`\`\`/g;
	return messageText.replace(fileRegex, "").trim();
}

function renderAttachmentPreviews() {
	if (!elements.composerAttachments) return;
	elements.composerAttachments.replaceChildren();
	
	state.attachedImages.forEach((img) => {
		const preview = document.createElement("div");
		preview.className = "attachment-preview";
		
		const thumb = document.createElement("img");
		thumb.src = img.src;
		
		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "remove-btn";
		removeBtn.textContent = "×";
		removeBtn.addEventListener("click", () => {
			state.attachedImages = state.attachedImages.filter((x) => x.id !== img.id);
			renderAttachmentPreviews();
		});
		
		preview.append(thumb, removeBtn);
		elements.composerAttachments.append(preview);
	});

	state.attachedFiles.forEach((file) => {
		const preview = document.createElement("div");
		preview.className = "file-preview";
		
		const fileIcon = icon("file");
		
		const info = document.createElement("div");
		info.className = "file-preview-info";
		
		const name = document.createElement("span");
		name.className = "file-preview-name";
		name.textContent = file.name;
		
		const size = document.createElement("span");
		size.className = "file-preview-size";
		size.textContent = file.sizeStr || "";
		
		info.append(name, size);
		
		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "remove-btn";
		removeBtn.textContent = "×";
		removeBtn.addEventListener("click", () => {
			state.attachedFiles = state.attachedFiles.filter((x) => x.id !== file.id);
			renderAttachmentPreviews();
		});
		
		preview.append(fileIcon, info, removeBtn);
		elements.composerAttachments.append(preview);
	});
}

async function handleAttachments(files) {
	for (const file of files) {
		if (file.type.startsWith("image/")) {
			const reader = new FileReader();
			reader.onload = (e) => {
				const base64Data = e.target.result.split(",")[1];
				const mimeType = file.type;
				
				const attachment = {
					id: Math.random().toString(36).substring(7),
					mimeType,
					data: base64Data,
					src: e.target.result
				};
				state.attachedImages.push(attachment);
				renderAttachmentPreviews();
			};
			reader.readAsDataURL(file);
		} else {
			const reader = new FileReader();
			reader.onload = (e) => {
				const text = e.target.result;
				
				let sizeStr = `${file.size} B`;
				if (file.size > 1024 * 1024) {
					sizeStr = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
				} else if (file.size > 1024) {
					sizeStr = `${(file.size / 1024).toFixed(1)} KB`;
				}
				
				const attachment = {
					id: Math.random().toString(36).substring(7),
					name: file.name,
					content: text,
					sizeStr
				};
				state.attachedFiles.push(attachment);
				renderAttachmentPreviews();
			};
			reader.readAsText(file);
		}
	}
	elements.attachInput.value = "";
}

function renderEmptyState(connected = state.serverConnected) {
	const empty = document.createElement("div");
	empty.className = "empty-state";
	empty.id = "emptyState";
	const title = document.createElement("strong");
	title.textContent = connected ? uiText("newTaskReady") : uiText("startTask");
	const copy = document.createElement("span");
	copy.textContent = connected ? uiText("newTaskReadyDescription") : uiText("serverSyncDescription");
	empty.append(title, copy);
	if (!connected) {
		const button = document.createElement("button");
		button.append(document.createElement("span"), uiText("connectServer"));
		button.firstElementChild.className = "server-dot";
		button.addEventListener("click", () => elements.serverDialog.showModal());
		empty.append(button);
	}
	elements.emptyState = empty;
	elements.messageColumn.replaceChildren(empty);
}

function isAssistantTurnActive(turnContext) {
	const hasRunningSubagent = (Array.isArray(state.session?.runningSubagentIds)
		&& state.session.runningSubagentIds.length > 0) || Boolean(turnContext?.hasRunningSubagent);
	return Boolean(turnContext?.isCurrentTurn) && (state.isStreaming || hasRunningSubagent);
}

function getThinkingDuration(message, messages = state.messages) {
	const turnContext = analyzeAssistantTurn(message, messages, state.isStreaming);
	const persistedDuration = getAssistantTurnDuration(message, messages, state.messageTimings, {
		active: isAssistantTurnActive(turnContext),
		now: Date.now(),
	});
	if (persistedDuration !== undefined) return persistedDuration;

	const key = message.id || message.timestamp;
	if (state.messageDurations && state.messageDurations[key]) {
		return state.messageDurations[key];
	}
	// Estimate based on thinking content length (approx 120 chars per second)
	let thinkingLength = 0;
	if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (part.type === "thinking" && part.thinking) {
				thinkingLength += part.thinking.length;
			}
		}
	}
	if (thinkingLength > 0) {
		const est = Math.max(1.2, Math.min(30.0, thinkingLength / 120));
		return parseFloat(est.toFixed(1));
	}
	return null;
}

function getToolIconHref(toolName) {
	const name = (toolName || "").toLowerCase();
	if (name.includes("video") || name.includes("media") || name.includes("frame")) return "#i-video";
	if (name.includes("webfetch") || name.includes("url") || name.includes("page")) return "#i-globe";
	if (name.includes("search") || name === "find" || name === "grep") return "#i-search";
	if (name.includes("file") || name === "read" || name === "write" || name === "edit" || name.includes("replace")) return "#i-file";
	if (name.includes("command") || name === "bash" || name === "exec" || name.includes("shell")) return "#i-terminal";
	if (name.includes("log")) return "#i-list";
	if (name === "ls" || name.includes("list_dir") || name.includes("folder")) return "#i-folder";
	if (name.includes("subagent") || name.includes("intent") || name.includes("brain")) return "#i-brain";
	return "#i-wrench";
}

function formatToolDisplayName(toolName, status) {
	const name = (toolName || "").toLowerCase();
	const isRunning = status === "Running" || status === "Pending" || status === "Awaiting Approval";
	const isError = status === "Error" || status === "Denied";

	if (name.includes("websearch") || name.includes("search_web")) {
		if (isRunning) return "WebSearching...";
		if (isError) return "WebSearch Failed";
		return "WebSearched";
	}
	if (name.includes("webfetch")) {
		if (isRunning) return "Fetching Page...";
		if (isError) return "Fetch Failed";
		return "Fetched Page";
	}
	if (name === "read" || name.includes("read_file") || name.includes("view_file") || name.includes("read_resource")) {
		if (isRunning) return "Reading File...";
		if (isError) return "Failed Reading File";
		return "Read File";
	}
	if (name === "write" || name === "edit" || name.includes("write_to_file") || name.includes("replace_file") || name.includes("edit_file")) {
		if (isRunning) return "Editing File...";
		if (isError) return "Failed Editing File";
		return "Edited File";
	}
	if (name === "bash" || name.includes("run_command") || name === "exec") {
		if (isRunning) return "Running Command...";
		if (isError) return "Command Failed";
		return "Ran Command";
	}
	if (name === "ls" || name.includes("list_dir")) {
		if (isRunning) return "Listing Directory...";
		if (isError) return "Failed Listing Directory";
		return "Listed Directory";
	}
	if (name === "find" || name === "grep" || name.includes("search_code")) {
		if (isRunning) return "Searching Codebase...";
		if (isError) return "Search Failed";
		return "Searched Codebase";
	}
	if (name.includes("subagent") || name.includes("agent")) {
		if (isRunning) return "Starting Agent...";
		if (isError) return "Agent Failed";
		return "Agent Started";
	}
	if (name.includes("user_intent")) {
		if (isRunning) return "Saving Intent...";
		if (isError) return "Failed Saving Intent";
		return "Saved Intent";
	}

	const formatted = (toolName || "Tool")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
	if (isRunning) return `${formatted}...`;
	if (isError) return `${formatted} Failed`;
	return formatted;
}

function getToolStatus(toolCall, message, messages) {
	const resultMsg = messages.find((m) => m.role === "toolResult" && m.toolCallId === toolCall.id);
	
	if (resultMsg) {
		if (resultMsg.isError) {
			let outputText = "";
			if (typeof resultMsg.content === "string") {
				outputText = resultMsg.content;
			} else if (Array.isArray(resultMsg.content)) {
				outputText = resultMsg.content
					.filter((p) => p.type === "text")
					.map((p) => p.text)
					.join("\n");
			}
			outputText = outputText.toLowerCase();
			if (outputText.includes("denied") || outputText.includes("rejected") || outputText.includes("cancel")) {
				return "Denied";
			}
			return "Error";
		}
		return "Completed";
	}
	
	if (message.stopReason === "aborted") {
		return "Denied";
	}
	if (message.stopReason === "error") {
		return "Error";
	}
	
	if (state.isStreaming) {
		const isLastMessage = messages[messages.length - 1] === message;
		if (isLastMessage) {
			const runStateText = elements.runState.querySelector("span:last-child").textContent || "";
			if (runStateText.includes("确认") || runStateText.includes("审批") || runStateText.includes("Approval")) {
				return "Awaiting Approval";
			}
			return "Running";
		}
	}
	
	return "Pending";
}

function setAssistantTurnCollapsed(article, isCollapsed, isActive = false) {
	let firstArticle = article;
	while (firstArticle.previousElementSibling && !firstArticle.previousElementSibling.classList.contains("user-message")) {
		firstArticle = firstArticle.previousElementSibling;
	}

	const turnDividers = [];
	let turnArticle = firstArticle;
	while (turnArticle && !turnArticle.classList.contains("user-message")) {
		if (turnArticle.classList.contains("assistant-message")) {
			turnArticle.classList.toggle("assistant-turn-collapsed", isCollapsed);
			turnArticle.classList.toggle("assistant-turn-active", isActive);
			const cotContainer = turnArticle.querySelector(".cot-container");
			if (cotContainer) cotContainer.classList.toggle("collapsed", isCollapsed);
			turnDividers.push(...turnArticle.querySelectorAll(":scope > .assistant-body > .turn-final-divider"));

			const hidesWithTurn = turnArticle.classList.contains("turn-intermediate-assistant")
				&& (!cotContainer || cotContainer.classList.contains("cot-continuation"));
			turnArticle.classList.toggle("turn-intermediate-collapsed", isCollapsed && hidesWithTurn);
		}
		turnArticle = turnArticle.nextElementSibling;
	}

	turnDividers.forEach((divider, index) => {
		divider.classList.toggle("turn-terminal-divider", index === turnDividers.length - 1);
	});
}

function refreshAllTurnDividers() {
	const turnDividers = [];
	const finishTurn = () => {
		turnDividers.forEach((divider, index) => {
			divider.classList.toggle("turn-terminal-divider", index === turnDividers.length - 1);
		});
		turnDividers.length = 0;
	};
	for (const article of elements.messageColumn.children) {
		if (article.classList.contains("user-message")) {
			finishTurn();
			continue;
		}
		if (article.classList.contains("assistant-message")) {
			turnDividers.push(...article.querySelectorAll(":scope > .assistant-body > .turn-final-divider"));
		}
	}
	finishTurn();
}

function updateOrCreateAssistantMessage(existingArticle, message, messages, index) {
	let article;
	let body;
	
	if (existingArticle && existingArticle.classList.contains("assistant-message")) {
		article = existingArticle;
		body = article.querySelector(".assistant-body");
	} else {
		article = document.createElement("article");
		article.className = "message assistant-message animate-entrance";
		body = document.createElement("div");
		body.className = "assistant-body";
		article.append(body);
		
		if (existingArticle) {
			elements.messageColumn.replaceChild(article, existingArticle);
		} else {
			elements.messageColumn.append(article);
		}
	}

	const turnContext = analyzeAssistantTurn(message, messages, state.isStreaming);
	const turnIsActive = isAssistantTurnActive(turnContext);
	let turnShouldCollapse = turnContext.shouldCollapse;
	article.classList.toggle("turn-intermediate-assistant", turnContext.hasCoT && turnContext.isIntermediate);
	
	if (typeof message.content === "string") {
		let textPart = body.querySelector(":scope > .assistant-text-part");
		if (body.querySelector(":scope > .cot-container") || !textPart) {
			body.replaceChildren();
			textPart = document.createElement("div");
			textPart.className = "assistant-text-part animate-entrance";
			body.append(textPart);
		}
		const newHtml = renderMarkdown(message.content);
		if (textPart.innerHTML !== newHtml) {
			textPart.innerHTML = newHtml;
		}
		const hasFinalText = Boolean(message.content.trim()) && !isSubagentLaunchNotice(message.content);
		reconcileAssistantFinalDivider(
			body,
			turnContext.hasCoT && turnContext.isFinalAssistant && hasFinalText,
			textPart,
		);
		if (turnContext.hasCoT) setAssistantTurnCollapsed(article, turnShouldCollapse, turnIsActive);
		return;
	}
	
	if (!Array.isArray(message.content)) {
		body.replaceChildren();
		return;
	}
	
	const { workItems, finalResponsePart } = getAssistantWorkLayout(message, messages, turnContext.isFinalAssistant);
	const hasCoT = workItems.length > 0;

	if (!hasCoT) {
		if (body.querySelector(":scope > .cot-container")
			|| (!body.querySelector(":scope > .assistant-text-part") && body.children.length > 0)) {
			body.replaceChildren();
		}

		const textParts = message.content.filter((part) => part.type === "text"
			&& Boolean(String(part.text || "").trim())
			&& !isSubagentLaunchNotice(part.text));
		const needsTurnDivider = turnContext.hasCoT && turnContext.isFinalAssistant && textParts.length > 0;
		const existingTextParts = [...body.children].filter((child) => child.classList.contains("assistant-text-part"));
		textParts.forEach((part, partIndex) => {
				const existingTextDiv = existingTextParts[partIndex];
				const newHtml = renderMarkdown(part.text);
				if (existingTextDiv && existingTextDiv.classList.contains("assistant-text-part")) {
					if (existingTextDiv.innerHTML !== newHtml) {
						existingTextDiv.innerHTML = newHtml;
					}
				} else {
					const textDiv = document.createElement("div");
					textDiv.className = "assistant-text-part animate-entrance";
					textDiv.innerHTML = newHtml;
					replaceOrAppendPart(body, textDiv, existingTextDiv);
				}
		});
		existingTextParts.slice(textParts.length).forEach((element) => element.remove());
		reconcileAssistantFinalDivider(
			body,
			needsTurnDivider,
			body.querySelector(":scope > .assistant-text-part"),
		);
	} else {
		let cotContainer = body.querySelector(".cot-container");
		let isNewCot = false;
		if (!cotContainer) {
			body.replaceChildren();
			isNewCot = true;
			cotContainer = document.createElement("div");
			cotContainer.className = "cot-container animate-entrance";
			
			const cotHeader = document.createElement("div");
			cotHeader.className = "cot-header-bar";

			const cotTitle = document.createElement("span");
			cotTitle.className = "cot-title";
			cotTitle.textContent = "Thinking";

			const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			chevron.innerHTML = '<use href="#i-chevron"/>';
			chevron.setAttribute("class", "cot-chevron");

			cotHeader.append(cotTitle, chevron);

			const cotBody = document.createElement("div");
			cotBody.className = "cot-content-body";

			const cotWrapper = document.createElement("div");
			cotWrapper.className = "cot-collapse-wrapper";

			const cotInner = document.createElement("div");
			cotInner.className = "cot-content-inner";
			cotWrapper.append(cotInner);
			cotBody.append(cotWrapper);

			cotContainer.append(cotHeader, cotBody);
			
			if (body.firstChild) {
				body.insertBefore(cotContainer, body.firstChild);
			} else {
				body.append(cotContainer);
			}

			cotHeader.addEventListener("click", () => {
				setAssistantTurnCollapsed(
					article,
					!cotContainer.classList.contains("collapsed"),
					article.classList.contains("assistant-turn-active"),
				);
			});
		}

		// One visible work header per user turn. Plain assistant/status messages and
		// hidden Subagent calls between reasoning chunks do not start a new group.
		const hideCotHeader = shouldHideAssistantWorkHeader(message, messages);

		const cotHeader = cotContainer.querySelector(".cot-header-bar");
		if (cotHeader) {
			cotHeader.style.display = hideCotHeader ? "none" : "";
		}

function getWorkItemKey(part, index) {
	if (part.type === "subagentCard") {
		return part.part?.id || `subagent_${part.progress?.jobId || index}`;
	}
	if (part.type === "toolCall") {
		return part.id || `tool_${part.name}_${index}`;
	}
	if (part.type === "thinking") {
		return part.id || `thinking_${index}`;
	}
	if (part.type === "text") {
		return part.id || `text_${index}`;
	}
	return `work_${part.type}_${index}`;
}

		const cotTitle = cotContainer.querySelector(".cot-title");
		if (cotTitle) {
			const isWorking = isAssistantTurnActive(turnContext);
			const duration = getThinkingDuration(message, messages);
			const newTitleText = isWorking
				? (duration !== undefined ? `Working for ${duration}s` : "Working...")
				: (duration !== undefined && duration !== null ? `Worked for ${duration}s` : "Thinking");
			if (cotTitle.textContent !== newTitleText) {
				cotTitle.textContent = newTitleText;
			}
			if (isWorking) {
				if (!cotTitle.classList.contains("working-shimmer")) {
					cotTitle.classList.add("working-shimmer");
				}
			} else {
				if (cotTitle.classList.contains("working-shimmer")) {
					cotTitle.classList.remove("working-shimmer");
				}
			}
		}

		cotContainer.classList.toggle("collapsed", turnShouldCollapse);
		const cotBody = cotContainer.querySelector(".cot-content-inner");
		cotContainer.classList.toggle("cot-continuation", hideCotHeader);

		const existingKeyMap = new Map();
		for (const child of cotBody.children) {
			const key = child.dataset.partKey;
			if (key) existingKeyMap.set(key, child);
		}

		const currentKeys = new Set();

		for (let index = 0; index < workItems.length; index += 1) {
			const part = workItems[index];
			const key = getWorkItemKey(part, index);
			currentKeys.add(key);

			let itemEl = existingKeyMap.get(key);

			if (part.type === "thinking" && part.thinking) {
				const newHtml = renderMarkdown(part.thinking);
				if (!itemEl) {
					itemEl = document.createElement("div");
					itemEl.className = "cot-thinking animate-entrance";
					itemEl.dataset.partKey = key;
					itemEl.innerHTML = newHtml;
				} else {
					if (itemEl.innerHTML !== newHtml) {
						itemEl.innerHTML = newHtml;
					}
					itemEl.classList.remove("animate-entrance");
				}
			} else if (part.type === "text" && part.text) {
				const newHtml = renderMarkdown(part.text);
				if (!itemEl) {
					itemEl = document.createElement("div");
					itemEl.className = "cot-text animate-entrance";
					itemEl.dataset.partKey = key;
					itemEl.innerHTML = newHtml;
				} else {
					if (itemEl.innerHTML !== newHtml) {
						itemEl.innerHTML = newHtml;
					}
					itemEl.classList.remove("animate-entrance");
				}
			} else if (part.type === "subagentCard") {
				if (!itemEl || itemEl.dataset.state !== part.progress.state) {
					const newCard = renderSubagentCompletionCard(part);
					newCard.dataset.partKey = key;
					if (itemEl) {
						itemEl.replaceWith(newCard);
						itemEl = newCard;
					} else {
						itemEl = newCard;
						itemEl.classList.add("animate-entrance");
					}
				} else {
					itemEl.classList.remove("animate-entrance");
				}
			} else if (part.type === "toolCall") {
				const status = getToolStatus(part, message, messages);
				const isRunning = status === "Running" || status === "Pending" || status === "Awaiting Approval";

				if (!state.toolCallTimes) state.toolCallTimes = {};

				if (itemEl && itemEl.classList.contains("tool-card")) {
					itemEl.classList.toggle("running", isRunning);
					itemEl.classList.remove("animate-entrance");

					const nameEl = itemEl.querySelector(".tool-name");
					if (nameEl) {
						const nameClass = `tool-name ${isRunning ? "shimmering" : ""}`;
						if (nameEl.className !== nameClass) nameEl.className = nameClass;
						const displayName = formatToolDisplayName(part.name, status);
						if (nameEl.textContent !== displayName) nameEl.textContent = displayName;
					}

					const oldBadge = itemEl.querySelector(".tool-badge");
					if (oldBadge) oldBadge.remove();

					let durationEl = itemEl.querySelector(".tool-duration");
					const headerBar = itemEl.querySelector(".tool-header-bar");
					const chevron = itemEl.querySelector(".tool-chevron");

					if (!durationEl && headerBar) {
						durationEl = document.createElement("span");
						durationEl.className = "tool-duration";
						if (chevron) {
							headerBar.insertBefore(durationEl, chevron);
						} else {
							headerBar.append(durationEl);
						}
					}

					if (isRunning) {
						if (!state.toolCallTimes[part.id]) {
							state.toolCallTimes[part.id] = { startTime: Date.now() };
						}
						if (durationEl && durationEl.textContent !== "") durationEl.textContent = "";
					} else {
						if (!state.toolCallTimes[part.id]) {
							state.toolCallTimes[part.id] = { startTime: Date.now() - 350, duration: "350ms" };
						} else if (!state.toolCallTimes[part.id].duration) {
							const elapsed = Date.now() - state.toolCallTimes[part.id].startTime;
							state.toolCallTimes[part.id].duration = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
						}
						const durText = state.toolCallTimes[part.id].duration || "";
						if (durationEl && durationEl.textContent !== durText) durationEl.textContent = durText;
					}

					const detailsBody = itemEl.querySelector(".tool-details-body");
					if (detailsBody) {
						const resultMsg = messages.find((m) => m.role === "toolResult" && m.toolCallId === part.id);
						const outPre = detailsBody.querySelector(".tool-section-title:nth-of-type(2) + pre code");
						
						if (resultMsg) {
							let textOutput = "";
							if (typeof resultMsg.content === "string") {
								textOutput = resultMsg.content;
							} else if (Array.isArray(resultMsg.content)) {
								textOutput = resultMsg.content
									.filter((p) => p.type === "text")
									.map((p) => p.text)
									.join("\n");
							}
							
							if (outPre) {
								if (outPre.textContent !== textOutput) {
									outPre.textContent = textOutput;
								}
							} else {
								const outTitle = document.createElement("div");
								outTitle.className = "tool-section-title";
								outTitle.textContent = "Output:";
								
								const newOutPre = document.createElement("pre");
								const outCode = document.createElement("code");
								outCode.textContent = textOutput;
								newOutPre.append(outCode);
								
								detailsBody.append(outTitle, newOutPre);
							}
						}
					}
				} else {
					itemEl = renderToolCallBlock(part, message, messages);
					itemEl.dataset.partKey = key;
					itemEl.classList.add("animate-entrance");
				}
			}

			if (itemEl) {
				const expectedPos = cotBody.children[index];
				if (expectedPos !== itemEl) {
					if (expectedPos) {
						cotBody.insertBefore(itemEl, expectedPos);
					} else {
						cotBody.append(itemEl);
					}
				}
			}
		}

		for (const child of [...cotBody.children]) {
			if (child.dataset.partKey && !currentKeys.has(child.dataset.partKey)) {
				child.remove();
			}
		}

		let finalResponseEl = body.querySelector(":scope > .assistant-text-part");
		
		if (finalResponsePart) {
			if (finalResponsePart.text) {
				const cleanText = (finalResponsePart.text || "").trimStart();
				const newHtml = renderMarkdown(cleanText);
				if (finalResponseEl && finalResponseEl.classList.contains("assistant-text-part")) {
					if (finalResponseEl.innerHTML !== newHtml) {
						finalResponseEl.innerHTML = newHtml;
					}
				} else {
					const textDiv = document.createElement("div");
					textDiv.className = "assistant-text-part animate-entrance";
					textDiv.innerHTML = newHtml;
					if (finalResponseEl) {
						body.replaceChild(textDiv, finalResponseEl);
					} else {
						body.append(textDiv);
					}
					finalResponseEl = textDiv;
				}
			} else if (finalResponseEl) {
				finalResponseEl.remove();
				finalResponseEl = null;
			}
		} else if (finalResponseEl) {
			finalResponseEl.remove();
			finalResponseEl = null;
		}
		reconcileAssistantFinalDivider(
			body,
			turnContext.hasCoT
				&& turnContext.isFinalAssistant
				&& Boolean(String(finalResponsePart?.text || "").trim()),
			finalResponseEl,
		);
	}

	if (turnContext.hasCoT) setAssistantTurnCollapsed(article, turnShouldCollapse, turnIsActive);

	// Render error message if present
	let errorEl = body.querySelector(".assistant-error-message");
	if (message.errorMessage) {
		const newHtml = renderMarkdown(`**Error:** ${message.errorMessage}`);
		if (errorEl) {
			if (errorEl.innerHTML !== newHtml) {
				errorEl.innerHTML = newHtml;
			}
		} else {
			errorEl = document.createElement("div");
			errorEl.className = "assistant-error-message animate-entrance";
			errorEl.innerHTML = newHtml;
			body.append(errorEl);
		}
	} else if (errorEl) {
		errorEl.remove();
	}
}

function replaceOrAppendPart(parent, newChild, existingChild) {
	if (existingChild) {
		parent.replaceChild(newChild, existingChild);
	} else {
		parent.append(newChild);
	}
}

function renderSubagentCompletionCard(item) {
	const args = typeof item.part?.arguments === "object" && item.part.arguments !== null ? item.part.arguments : {};
	const running = item.progress.state === "running";
	const failed = item.progress.state === "failed";
	const card = document.createElement("div");
	card.className = `subagent-completion-card${running ? " running" : ""}${failed ? " failed" : ""}`;
	card.dataset.jobId = item.progress.jobId;
	card.dataset.state = item.progress.state;

	const iconBox = document.createElement("span");
	iconBox.className = "subagent-completion-icon";
	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.innerHTML = '<use href="#i-branch"/>';
	iconBox.append(icon);

	const copy = document.createElement("span");
	copy.className = "subagent-completion-copy";
	const title = document.createElement("strong");
	title.textContent = String(args.title || uiText("subagentTask"));
	const meta = document.createElement("small");
	meta.textContent = `Subagent · ${item.progress.jobId}`;
	copy.append(title, meta);

	const status = document.createElement("span");
	status.className = "subagent-completion-status";
	const statusText = document.createElement("span");
	statusText.textContent = uiText(running ? "subagentRunning" : failed ? "subagentFailed" : "subagentCompleted");
	if (running) {
		status.append(statusText);
	} else {
		const statusIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		statusIcon.innerHTML = `<use href="#${failed ? "i-more" : "i-check"}"/>`;
		status.append(statusIcon, statusText);
	}

	card.append(iconBox, copy, status);
	return card;
}

function renderComposerStatusRow(messages = state.messages) {
	if (!elements.composerStatusRow || !elements.projectSwitchCapsule) return;
	const hasUserMessage = Array.isArray(messages) && messages.some((message) => message?.role === "user");
	if (hasUserMessage) state.hasSubmittedMessage = true;
	const showProjectSwitch = !state.hasSubmittedMessage && !hasUserMessage;
	elements.composerStatusRow.classList.toggle("new-conversation", showProjectSwitch);
	elements.projectSwitchCapsule.disabled = !showProjectSwitch;
	elements.projectSwitchCapsule.tabIndex = showProjectSwitch ? 0 : -1;
	elements.projectSwitchCapsule.setAttribute("aria-hidden", String(!showProjectSwitch));
	elements.projectSwitchCapsule.setAttribute("aria-label", uiText("switchProject"));
	elements.projectSwitchCapsule.title = uiText("switchProject");
	elements.projectSwitchLabel.textContent = activeProject()?.name || uiText("projects");
	if (!showProjectSwitch) setProjectSwitchMenuOpen(false);
}

function renderSubagentDock(messages = state.messages) {
	if (!elements.subagentDock) return;
	const runningIds = [...new Set(Array.isArray(state.session?.runningSubagentIds) ? state.session.runningSubagentIds : [])];
	const previousIds = new Set(state.subagentDockRunningIds || []);
	const hasNewSubagent = runningIds.some((jobId) => !previousIds.has(jobId));
	if (hasNewSubagent) state.subagentDockExpanded = true;
	if (runningIds.length === 0) state.subagentDockExpanded = false;
	state.subagentDockRunningIds = runningIds;

	elements.subagentDock.classList.toggle("collapsed", !state.subagentDockExpanded);
	elements.subagentDock.classList.toggle("running", runningIds.length > 0);
	elements.subagentDockToggle.setAttribute("aria-expanded", String(state.subagentDockExpanded));
	elements.subagentDockStatus.textContent = runningIds.length > 0
		? uiText("subagentRunningCount", { count: runningIds.length })
		: uiText("subagentNone");

	const callsById = new Map(getSubagentToolCalls(messages).map((call) => [call.jobId, call.part]));
	elements.subagentDockList.replaceChildren();
	for (const jobId of runningIds) {
		const part = callsById.get(jobId);
		const args = typeof part?.arguments === "object" && part.arguments !== null ? part.arguments : {};
		const item = document.createElement("div");
		item.className = "subagent-dock-item";

		const itemIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		itemIcon.innerHTML = '<use href="#i-branch"/>';
		const copy = document.createElement("span");
		const title = document.createElement("strong");
		title.textContent = String(args.title || uiText("subagentTask"));
		const meta = document.createElement("small");
		meta.textContent = `Subagent · ${jobId}`;
		copy.append(title, meta);
		const status = document.createElement("em");
		status.textContent = uiText("subagentRunning");
		item.append(itemIcon, copy, status);
		elements.subagentDockList.append(item);
	}
}

function renderToolCallBlock(part, message, messages) {
	const container = document.createElement("div");
	const status = getToolStatus(part, message, messages);
	const isRunning = status === "Running" || status === "Pending" || status === "Awaiting Approval";

	container.className = `tool-card collapsed ${isRunning ? "running" : ""}`;

	const header = document.createElement("div");
	header.className = "tool-header-bar";

	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.innerHTML = `<use href="${getToolIconHref(part.name)}"/>`;
	icon.setAttribute("class", "tool-icon");

	const nameEl = document.createElement("span");
	nameEl.className = `tool-name ${isRunning ? "shimmering" : ""}`;
	nameEl.textContent = formatToolDisplayName(part.name, status);

	const durationEl = document.createElement("span");
	durationEl.className = "tool-duration";

	if (!state.toolCallTimes) state.toolCallTimes = {};

	if (isRunning) {
		if (!state.toolCallTimes[part.id]) {
			state.toolCallTimes[part.id] = { startTime: Date.now() };
		}
		durationEl.textContent = "";
	} else {
		if (!state.toolCallTimes[part.id]) {
			state.toolCallTimes[part.id] = { startTime: Date.now() - 350, duration: "350ms" };
		} else if (!state.toolCallTimes[part.id].duration) {
			const elapsed = Date.now() - state.toolCallTimes[part.id].startTime;
			state.toolCallTimes[part.id].duration = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
		}
		durationEl.textContent = state.toolCallTimes[part.id].duration || "";
	}

	const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	chevron.innerHTML = '<use href="#i-chevron"/>';
	chevron.setAttribute("class", "tool-chevron");

	header.append(icon, nameEl, durationEl, chevron);

	const details = document.createElement("div");
	details.className = "tool-details-body";

	const argsTitle = document.createElement("div");
	argsTitle.className = "tool-section-title";
	argsTitle.textContent = "Arguments:";
	
	const argsPre = document.createElement("pre");
	const argsCode = document.createElement("code");
	argsCode.textContent = typeof part.arguments === "object" ? JSON.stringify(part.arguments, null, 2) : String(part.arguments);
	argsPre.append(argsCode);
	
	details.append(argsTitle, argsPre);

	const resultMsg = messages.find((m) => m.role === "toolResult" && m.toolCallId === part.id);
	if (resultMsg) {
		const outTitle = document.createElement("div");
		outTitle.className = "tool-section-title";
		outTitle.textContent = "Output:";
		
		const outPre = document.createElement("pre");
		const outCode = document.createElement("code");
		
		let textOutput = "";
		if (typeof resultMsg.content === "string") {
			textOutput = resultMsg.content;
		} else if (Array.isArray(resultMsg.content)) {
			textOutput = resultMsg.content
				.filter((p) => p.type === "text")
				.map((p) => p.text)
				.join("\n");
		}
		
		outCode.textContent = textOutput;
		outPre.append(outCode);
		
		details.append(outTitle, outPre);
	}

	container.append(header, details);

	header.addEventListener("click", () => {
		container.classList.toggle("collapsed");
	});

	return container;
}

function appendAssistantMessage(message, messages, shouldScroll = true) {
	updateOrCreateAssistantMessage(null, message, messages, -1);
	if (shouldScroll) scrollMessagesToBottom();
}

function renderServerMessages(messages = []) {
	renderComposerStatusRow(messages);
	renderSubagentDock(messages);
	let visible = 0;
	const activeMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
	
	while (elements.messageColumn.children.length > activeMessages.length) {
		elements.messageColumn.lastElementChild.remove();
	}
	
	activeMessages.forEach((message, index) => {
		const existingArticle = elements.messageColumn.children[index];
		
		if (message.role === "user") {
			const rawText = extractMessageText(message);
			const images = extractMessageImages(message);
			const files = extractMessageFiles(rawText);
			const text = cleanMessageTextOfFiles(rawText);
			if (text || images.length > 0 || files.length > 0) {
				visible += 1;
				if (existingArticle && existingArticle.classList.contains("user-message")) {
					const bubble = existingArticle.querySelector(".user-bubble");
					if (bubble) {
						const textEl = bubble.querySelector(".user-bubble-text") || bubble;
						if (textEl && textEl.textContent !== text) {
							textEl.textContent = text;
						}
						let imgsContainer = bubble.querySelector(".user-bubble-images");
						if (images.length > 0) {
							if (!imgsContainer) {
								imgsContainer = document.createElement("div");
								imgsContainer.className = "user-bubble-images";
								bubble.append(imgsContainer);
							}
							if (imgsContainer.children.length !== images.length) {
								imgsContainer.replaceChildren();
								images.forEach((img) => {
									const el = document.createElement("img");
									el.src = `data:${img.mimeType};base64,${img.data}`;
									imgsContainer.append(el);
								});
							}
						} else if (imgsContainer) {
							imgsContainer.remove();
						}
					}
				} else {
					const article = document.createElement("article");
					article.className = "message user-message animate-entrance";
					const bubble = document.createElement("div");
					bubble.className = "user-bubble";
					
					if (text) {
						const textEl = document.createElement("div");
						textEl.className = "user-bubble-text";
						textEl.textContent = text;
						bubble.append(textEl);
					}
					
					if (images.length > 0) {
						const imgsContainer = document.createElement("div");
						imgsContainer.className = "user-bubble-images";
						images.forEach((img) => {
							const el = document.createElement("img");
							el.src = `data:${img.mimeType};base64,${img.data}`;
							imgsContainer.append(el);
						});
						bubble.append(imgsContainer);
					}
					
					if (files.length > 0) {
						const filesContainer = document.createElement("div");
						filesContainer.className = "user-bubble-files";
						files.forEach((file) => {
							const el = document.createElement("div");
							el.className = "user-bubble-file";
							el.append(icon("file"), document.createTextNode(file.name));
							el.addEventListener("click", () => showFileContentModal(file.name, file.content));
							filesContainer.append(el);
						});
						bubble.append(filesContainer);
					}
					
					article.append(bubble);
					if (existingArticle) {
						elements.messageColumn.replaceChild(article, existingArticle);
					} else {
						elements.messageColumn.append(article);
					}
				}
			}
		} else if (message.role === "assistant") {
			visible += 1;
			updateOrCreateAssistantMessage(existingArticle, message, messages, index);
		}
	});

	refreshAllTurnDividers();
	
	if (!visible) renderEmptyState(true);
	else scrollMessagesToBottom(false);
}

function refreshWorkTimerTitles() {
	const hasRunningSubagent = Array.isArray(state.session?.runningSubagentIds)
		&& state.session.runningSubagentIds.length > 0;
	if (!state.isStreaming && !hasRunningSubagent) return;
	const activeMessages = state.messages.filter((message) => message.role === "user" || message.role === "assistant");
	activeMessages.forEach((message, index) => {
		if (message.role !== "assistant") return;
		const article = elements.messageColumn.children[index];
		const title = article?.querySelector(".cot-title");
		if (!title) return;
		const turnContext = analyzeAssistantTurn(message, state.messages, state.isStreaming);
		if (!isAssistantTurnActive(turnContext)) return;
		const duration = getThinkingDuration(message, state.messages);
		title.textContent = duration !== undefined ? `Working for ${duration}s` : "Working...";
		title.classList.add("working-shimmer");
	});
}

function modelLabel(model) {
	return model?.name || model?.id || (model?.provider ? `${model.provider}/model` : "模型");
}

function thinkingLabel(level) {
	const key = THINKING_LEVEL_KEYS[level];
	return key ? uiText(key) : level || uiText("thinkingOff");
}

function getAvailableThinkingLevels() {
	const levels = state.session?.thinkingLevels;
	return state.session?.supportsThinking && Array.isArray(levels) ? levels : [];
}

function renderThinkingControl() {
	const levels = getAvailableThinkingLevels();
	const available = levels.length > 1;
	elements.advancedEntry.hidden = !available;
	if (!available) {
		elements.modelPicker.classList.remove("advanced-open");
		elements.thinkingScale.replaceChildren();
		return;
	}

	const currentLevel = levels.includes(state.session?.thinkingLevel) ? state.session.thinkingLevel : levels[0];
	const currentIndex = Math.max(0, levels.indexOf(currentLevel));
	elements.advancedValue.textContent = thinkingLabel(currentLevel);
	elements.thinkingScale.replaceChildren();
	for (let index = 0; index < THINKING_TAIL_CELL_COUNT; index += 1) {
		const cell = document.createElement("span");
		cell.className = "thinking-cell";
		cell.setAttribute("aria-hidden", "true");
		elements.thinkingScale.append(cell);
	}

	const particlesLayer = document.createElement("div");
	particlesLayer.className = "thinking-particles-layer";
	particlesLayer.id = "thinkingParticlesLayer";
	elements.thinkingScale.append(particlesLayer);

	// Append the thumb element
	const thumb = document.createElement("span");
	thumb.className = "thinking-thumb";
	thumb.setAttribute("aria-hidden", "true");
	elements.thinkingScale.append(thumb);

	elements.thinkingScale.setAttribute("aria-valuemin", "0");
	elements.thinkingScale.setAttribute("aria-valuemax", String(levels.length - 1));
	previewThinkingLevel(currentIndex);
}

function interpolateColor(color1, color2, factor) {
	const r1 = parseInt(color1.slice(1, 3), 16);
	const g1 = parseInt(color1.slice(3, 5), 16);
	const b1 = parseInt(color1.slice(5, 7), 16);

	const r2 = parseInt(color2.slice(1, 3), 16);
	const g2 = parseInt(color2.slice(3, 5), 16);
	const b2 = parseInt(color2.slice(5, 7), 16);

	const r = Math.round(r1 + factor * (r2 - r1));
	const g = Math.round(g1 + factor * (g2 - g1));
	const b = Math.round(b1 + factor * (b2 - b1));

	return `rgb(${r}, ${g}, ${b})`;
}

function pseudoRandom(seed) {
	const x = Math.sin(seed * 12.9898) * 43758.5453;
	return x - Math.floor(x);
}

function previewThinkingLevel(index) {
	const levels = getAvailableThinkingLevels();
	const cells = [...elements.thinkingScale.querySelectorAll(".thinking-cell")];
	if (!levels.length || !cells.length) return;
	const safeIndex = Math.max(0, Math.min(index, levels.length - 1));

	const colCount = 30;
	const rowCount = 3;
	const headColumn = levels.length === 1 ? 0 : Math.round((safeIndex / (levels.length - 1)) * (colCount - 1));
	const isOff = levels[safeIndex] === "off";
	const isHighest = !isOff && safeIndex === (levels.length - 1);

	cells.forEach((cell, cellIndex) => {
		cell.className = "thinking-cell";
		cell.style.backgroundColor = "";
		cell.style.animation = "none";
		const c = Math.floor(cellIndex / rowCount);

		if (!isOff && c <= headColumn) {
			const colorNoise = (pseudoRandom(cellIndex) - 0.5) * 0.22;
			const baseFactor = headColumn === 0 ? 1 : Math.min(1, c / headColumn);
			const factor = Math.max(0, Math.min(1, baseFactor + colorNoise));
			const bg = interpolateColor("#bbf7d0", "#166534", factor);
			cell.style.backgroundColor = bg;
			cell.classList.add("active");
		} else {
			cell.style.backgroundColor = "#dfe2e4";
		}
	});

	// Handle Truly Sliding Particles Layer - ONLY displayed at HIGHEST reasoning level!
	let particlesLayer = elements.thinkingScale.querySelector("#thinkingParticlesLayer");
	if (!particlesLayer) {
		particlesLayer = document.createElement("div");
		particlesLayer.className = "thinking-particles-layer";
		particlesLayer.id = "thinkingParticlesLayer";
		elements.thinkingScale.append(particlesLayer);
	}
	particlesLayer.replaceChildren();

	if (isHighest) {
		const trackWidth = elements.thinkingScale.clientWidth || 210;
		const leftPercent = levels.length === 1 ? 0 : safeIndex / (levels.length - 1);
		const startX = Math.max(20, Math.round(11 + leftPercent * (trackWidth - 22)));
		const endX = 4;
		const duration = 0.55;
		const particleCount = 27;

		const colors = ["#86efac", "#4ade80", "#22c55e", "#166534", "#15803d"];

		for (let i = 0; i < particleCount; i += 1) {
			const p = document.createElement("span");
			p.className = "thinking-particle";

			const r = i % 3;
			const y = 4 + r * 7;
			const w = 5 + (i % 3) * 2;
			const bg = colors[i % colors.length];
			const opacity = 0.75 + (pseudoRandom(i + 10) * 0.25);
			const delay = (i / particleCount) * duration;

			p.style.setProperty("--start-x", `${startX}px`);
			p.style.setProperty("--end-x", `${endX}px`);
			p.style.setProperty("--particle-duration", `${duration}s`);
			p.style.setProperty("--particle-delay", `${delay}s`);
			p.style.setProperty("--particle-y", `${y}px`);
			p.style.setProperty("--particle-w", `${w}px`);
			p.style.setProperty("--particle-bg", bg);
			p.style.setProperty("--particle-opacity", String(opacity));

			particlesLayer.append(p);
		}
	}

	// Position the thumb
	const thumb = elements.thinkingScale.querySelector(".thinking-thumb");
	if (thumb) {
		const leftPercent = levels.length === 1 ? 0 : safeIndex / (levels.length - 1);
		thumb.style.left = `calc(11px + ${leftPercent * 100}% - ${leftPercent * 22}px)`;
	}

	elements.thinkingScale.dataset.previewIndex = String(safeIndex);
	elements.thinkingScale.setAttribute("aria-valuenow", String(safeIndex));
	elements.thinkingScale.setAttribute("aria-valuetext", thinkingLabel(levels[safeIndex]));
	elements.advancedValue.textContent = thinkingLabel(levels[safeIndex]);
}

function nearestThinkingStepIndex(clientX) {
	const levels = getAvailableThinkingLevels();
	const rect = elements.thinkingScale.getBoundingClientRect();
	const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	return Math.round(ratio * Math.max(0, levels.length - 1));
}

function setModelMenuOpen(open, { focusSelected = false } = {}) {
	const nextOpen = Boolean(open && !elements.modelTrigger.disabled);
	elements.modelPicker.classList.toggle("open", nextOpen);
	elements.modelTrigger.setAttribute("aria-expanded", String(nextOpen));
	elements.modelMenu.setAttribute("aria-hidden", String(!nextOpen));
	if (!nextOpen) elements.modelPicker.classList.remove("advanced-open");
	if (nextOpen && focusSelected) {
		requestAnimationFrame(() => elements.modelOptions.querySelector('[aria-selected="true"]')?.focus());
	}
}

function updateModelSelect() {
	renderSettingsAgentControls();
	elements.modelOptions.replaceChildren();
	if (!state.models.length) {
		elements.modelTriggerLabel.textContent = state.serverConnected ? uiText("noModels") : uiText("loadModelsAfterConnect");
		elements.modelTrigger.disabled = true;
		setModelMenuOpen(false);
		renderThinkingControl();
		return;
	}
	const current = state.session?.model;
	let selectedIndex = -1;
	state.models.forEach((model, index) => {
		const selected = model.provider === current?.provider && model.id === current?.id;
		if (selected) selectedIndex = index;
		const option = document.createElement("button");
		option.type = "button";
		option.className = "model-option";
		option.dataset.index = String(index);
		option.setAttribute("role", "option");
		option.setAttribute("aria-selected", String(selected));
		const label = document.createElement("span");
		label.textContent = modelLabel(model);
		option.append(label);
		if (selected) option.append(icon("check"));
		option.addEventListener("click", () => void changeModel(index));
		elements.modelOptions.append(option);
	});
	const selectedModel = state.models[selectedIndex >= 0 ? selectedIndex : 0];
	const levelSuffix = getAvailableThinkingLevels().length > 1 ? ` ${thinkingLabel(state.session?.thinkingLevel)}` : "";
	elements.modelTriggerLabel.textContent = `${modelLabel(selectedModel)}${levelSuffix}`;
	elements.modelTrigger.disabled = false;
	renderThinkingControl();

	// Update context window usage indicator
	const contextUsage = state.session?.contextUsage;
	if (contextUsage && typeof contextUsage.percent === "number") {
		const percent = contextUsage.percent;
		
		const dashOffset = 38.33 * (1 - Math.min(100, percent) / 100);
		elements.contextPercentRing.style.strokeDashoffset = String(dashOffset);
		
		elements.contextIndicator.classList.remove("warning", "critical");
		if (percent >= 95) {
			elements.contextIndicator.classList.add("critical");
		} else if (percent >= 80) {
			elements.contextIndicator.classList.add("warning");
		}
		
		const tokensStr = contextUsage.tokens !== null ? contextUsage.tokens.toLocaleString() : "?";
		const limitStr = contextUsage.contextWindow.toLocaleString();
		const tooltipText = uiText("contextUsage", { tokens: tokensStr, limit: limitStr, percent: percent.toFixed(1) });
		elements.contextIndicator.setAttribute("title", tooltipText);
		elements.contextIndicator.setAttribute("data-tooltip", tooltipText);
		elements.contextIndicator.classList.remove("hidden");
	} else {
		elements.contextIndicator.classList.add("hidden");
	}
}

function updateLocalFollowUpQueue(messages) {
	if (!state.session) return;
	state.session.followUpMessages = [...messages];
	state.session.pendingMessageCount = (state.session.steeringMessages?.length || 0) + messages.length;
	renderMessageQueue();
}

async function removeFollowUpFromQueue(index, { restore = false } = {}) {
	const result = await requestServer("/session/queue", "DELETE", { queue: "followUp", index });
	const current = Array.isArray(state.session?.followUpMessages) ? [...state.session.followUpMessages] : [];
	current.splice(index, 1);
	updateLocalFollowUpQueue(current);

	if (!restore || !result?.message) return;
	const queued = result.message;
	const existing = elements.composerInput.value.trim();
	elements.composerInput.value = [queued.text, existing].filter(Boolean).join("\n");
	for (const content of queued.images || []) {
		const image = content.image || content;
		if (!image?.mimeType || !image?.data) continue;
		state.attachedImages.push({
			id: Math.random().toString(36).substring(7),
			mimeType: image.mimeType,
			data: image.data,
			src: `data:${image.mimeType};base64,${image.data}`,
		});
	}
	renderAttachmentPreviews();
	autoSizeComposer();
	elements.composerInput.focus();
}

async function promoteFollowUp(index) {
	await requestServer("/session/queue/promote", "POST", { index });
	const current = Array.isArray(state.session?.followUpMessages) ? [...state.session.followUpMessages] : [];
	current.splice(index, 1);
	updateLocalFollowUpQueue(current);
}

function renderMessageQueue() {
	if (!elements.messageQueue) return;
	const messages = Array.isArray(state.session?.followUpMessages) ? state.session.followUpMessages : [];
	elements.messageQueue.classList.toggle("hidden", messages.length === 0);
	elements.messageQueueCount.textContent = String(messages.length);
	elements.messageQueueList.replaceChildren();

	messages.forEach((message, index) => {
		const item = document.createElement("div");
		item.className = "message-queue-item";

		const text = document.createElement("div");
		text.className = "message-queue-text";
		text.textContent = message;
		text.title = message;

		const actions = document.createElement("div");
		actions.className = "message-queue-actions";
		const actionSpecs = [
			{ name: "arrow-up", label: "优先处理", run: () => promoteFollowUp(index) },
			{ name: "edit", label: "移回输入框编辑", run: () => removeFollowUpFromQueue(index, { restore: true }) },
			{ name: "trash", label: "删除排队消息", danger: true, run: () => removeFollowUpFromQueue(index) },
		];
		for (const spec of actionSpecs) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = `message-queue-action${spec.danger ? " danger" : ""}`;
			button.setAttribute("aria-label", spec.label);
			button.title = spec.label;
			button.append(icon(spec.name));
			button.addEventListener("click", () => {
				button.disabled = true;
				void spec.run().catch((error) => {
					button.disabled = false;
					appendAssistantNotice(error.message, "队列操作失败");
				});
			});
			actions.append(button);
		}

		item.append(text, actions);
		elements.messageQueueList.append(item);
	});
}

function setStreamingState(active, label = uiText("agentWorking")) {
	state.isStreaming = active;
	elements.runState.classList.toggle("hidden", !active);
	elements.runState.classList.toggle("active", active);
	elements.runState.querySelector("span:last-child").textContent = label;
	elements.sendButton.classList.toggle("stopping", active);
	elements.sendButton.setAttribute("aria-label", uiText(active ? "stopGeneration" : "send"));
	elements.sendButtonIcon.setAttribute("href", active ? "#i-stop" : "#i-send");
	renderConversations();
	renderMessageQueue();
	applySettingsBusyState();
	refreshAssistantTurnActivityState();
}

function refreshAssistantTurnActivityState() {
	const hasRunningSubagent = Array.isArray(state.session?.runningSubagentIds)
		&& state.session.runningSubagentIds.length > 0;
	if (state.isStreaming || hasRunningSubagent) return;
	elements.messageColumn.querySelectorAll(".assistant-turn-active").forEach((article) => {
		article.classList.remove("assistant-turn-active");
	});
}

function setDreamStatus(statusText) {
	const text = typeof statusText === "string" ? statusText.trim() : "";
	state.dreamStatusText = text || undefined;
	elements.dreamState.classList.toggle("hidden", !text);
	elements.dreamState.classList.toggle("dreaming", /dreaming/i.test(text));
	elements.dreamState.classList.toggle("failed", /failed|retry/i.test(text));
	if (!text) return;
	const key = /dreaming/i.test(text) ? "dreaming" : /retry/i.test(text) ? "dreamRetry" : /failed/i.test(text) ? "dreamFailed" : /done/i.test(text) ? "dreamDone" : /off/i.test(text) ? "dreamOff" : "dreamPending";
	elements.dreamState.querySelector("span:last-child").textContent = uiText(key);
	elements.dreamState.title = text;
}

function applyUiLanguage(language) {
	state.uiLanguage = UI_LANGUAGES.includes(language) ? language : "auto";
	localStorage.setItem("metis.desktopUiLanguage.v2", state.uiLanguage);
	document.documentElement.lang = resolveUiLanguage(state.uiLanguage);
	desktopI18n.translateDocument(state.uiLanguage);
	if (elements.settingsLanguageSelect) elements.settingsLanguageSelect.value = state.uiLanguage;
	if (elements.revealFileButton) elements.revealFileButton.textContent = revealInFolderLabel();
	setDreamStatus(state.dreamStatusText);
	renderSettingsAgentControls();
	updateSettingsConnectionDetails();
	updateModelSelect();
	if (!state.messages.length) renderEmptyState(state.serverConnected);
	setStreamingState(Boolean(state.isStreaming), uiText(state.session?.isCompacting ? "compactingContext" : "agentWorking"));
	renderComposerStatusRow();
	renderSubagentDock();
	if (state.session) upsertServerConversation(state.session);
}

async function syncServerSession({ loadModels = true } = {}) {
	const project = activeProject();
	const requests = [
		requestServer("/session"),
		requestServer("/session/messages"),
		requestServer(`/sessions${project?.path ? `?cwd=${encodeURIComponent(project.path)}` : ""}`),
	];
	if (loadModels) requests.push(requestServer("/config/providers"));
	const [session, messageData, sessionListData, modelData] = await Promise.all(requests);
	const currentSessionName = state.session?.sessionId === session.sessionId ? state.session.sessionName : undefined;
	if (!session.sessionName && currentSessionName) session.sessionName = currentSessionName;
	state.session = session;
	if (modelData) state.models = Array.isArray(modelData.models) ? modelData.models : [];
	state.messages = Array.isArray(messageData.messages) ? messageData.messages : [];
	state.messageTimings = Object.fromEntries((Array.isArray(messageData.messageTimings) ? messageData.messageTimings : [])
		.map((timing) => [String(timing.messageTimestamp), timing]));
	state.hasSubmittedMessage = state.messages.some((message) => message?.role === "user");
	replaceServerConversations(sessionListData.sessions);
	setDreamStatus(session.extensionStatuses?.dream);
	upsertServerConversation(session);
	setStreamingState(Boolean(session.isStreaming), uiText(session.isCompacting ? "compactingContext" : "agentWorking"));
	renderServerMessages(state.messages);
	updateModelSelect();
}

async function changeModel(index) {
	const model = state.models[index];
	if (!model || !state.serverConnected) return;
	setModelMenuOpen(false);
	elements.modelTrigger.disabled = true;
	try {
		await requestServer("/session/model", "PUT", { provider: model.provider, modelId: model.id });
		state.session = await requestServer("/session");
	} catch (error) {
		appendAssistantNotice(error.message, "模型切换失败");
	} finally {
		updateModelSelect();
	}
}

async function changeThinkingLevel(level) {
	if (!getAvailableThinkingLevels().includes(level) || !state.serverConnected) return;
	if (state.session?.thinkingLevel === level) {
		renderThinkingControl();
		return;
	}
	elements.thinkingScale.classList.add("busy");
	try {
		const result = await requestServer("/session/thinking", "PUT", { level });
		state.session.thinkingLevel = result.level || level;
		updateModelSelect();
		elements.modelPicker.classList.add("advanced-open");
	} catch (error) {
		appendAssistantNotice(error.message, "思考等级切换失败");
		renderThinkingControl();
	} finally {
		elements.thinkingScale.classList.remove("busy");
	}
}

async function refreshFileTree() {
	elements.fileTree.innerHTML = '<div class="tree-loading">正在读取工作区…</div>';
	try {
		const result = await desktop.workspace.tree();
		state.fileTree = result.nodes;
		renderFileTree(elements.fileFilterInput.value);
	} catch (error) {
		elements.fileTree.textContent = `读取失败：${error.message}`;
	}
}

function renderFileTree(filter = "") {
	elements.fileTree.replaceChildren();
	const normalizedFilter = filter.trim().toLowerCase();
	const nodes = normalizedFilter ? filterTree(state.fileTree, normalizedFilter) : state.fileTree;
	for (const node of nodes) elements.fileTree.append(createTreeNode(node, 0, Boolean(normalizedFilter)));
	if (nodes.length === 0) {
		const empty = document.createElement("div");
		empty.className = "tree-loading";
		empty.textContent = "没有匹配文件";
		elements.fileTree.append(empty);
	}
}

function filterTree(nodes, query) {
	const filtered = [];
	for (const node of nodes) {
		if (node.type === "directory") {
			const children = filterTree(node.children || [], query);
			if (node.name.toLowerCase().includes(query) || children.length) filtered.push({ ...node, children });
		} else if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
			filtered.push(node);
		}
	}
	return filtered;
}

function createTreeNode(node, depth, forceOpen) {
	const container = document.createElement("div");
	container.className = "tree-node";
	const row = document.createElement("div");
	row.className = `tree-row tree-depth-${Math.min(depth, 6)} ${node.type === "file" ? "file-row" : ""}${state.activeFile === node.path ? " selected" : ""}`;
	row.append(icon("chevron", "tree-chevron"), icon(node.type === "directory" ? "folder" : "file"));
	const label = document.createElement("span");
	label.textContent = node.name;
	label.title = node.path;
	row.append(label);
	container.append(row);

	if (node.type === "directory") {
		const children = document.createElement("div");
		children.className = "tree-children";
		for (const child of node.children || []) children.append(createTreeNode(child, depth + 1, forceOpen));
		container.append(children);
		if (!forceOpen && depth > 0 && (node.children || []).length > 8) {
			row.classList.add("collapsed");
			children.classList.add("hidden");
		}
		row.addEventListener("click", () => {
			row.classList.toggle("collapsed");
			children.classList.toggle("hidden");
		});
	} else {
		row.addEventListener("click", () => void showDiff(node.path));
	}
	return container;
}

async function showDiff(relativePath) {
	state.activeFile = relativePath;
	elements.diffTitle.textContent = relativePath;
	elements.diffStats.textContent = "正在读取 Git 变更…";
	elements.diffView.replaceChildren();
	selectInspectorTab("diff");
	renderFileTree(elements.fileFilterInput.value);
	try {
		const result = await desktop.workspace.diff(relativePath);
		renderDiff(result.diff);
	} catch (error) {
		elements.diffStats.textContent = "读取失败";
		const empty = document.createElement("div");
		empty.className = "diff-empty";
		empty.append(icon("diff"));
		const strong = document.createElement("strong");
		strong.textContent = "无法显示 Diff";
		const span = document.createElement("span");
		span.textContent = error.message;
		empty.append(strong, span);
		elements.diffView.append(empty);
	}
}

function renderDiff(diff) {
	elements.diffView.replaceChildren();
	const lines = diff.split(/\r?\n/);
	let added = 0;
	let removed = 0;
	let oldLine = 0;
	let newLine = 0;
	for (const source of lines) {
		if (source.startsWith("@@")) {
			const match = source.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
			if (match) {
				oldLine = Number(match[1]);
				newLine = Number(match[2]);
			}
		}
		const row = document.createElement("div");
		let type = "context";
		if (source.startsWith("+") && !source.startsWith("+++")) { type = "add"; added += 1; }
		else if (source.startsWith("-") && !source.startsWith("---")) { type = "remove"; removed += 1; }
		else if (source.startsWith("@@")) type = "hunk";
		else if (/^(diff |index |--- |\+\+\+)/.test(source)) type = "meta";
		row.className = `diff-line ${type}`;

		const number = document.createElement("span");
		number.className = "line-number";
		if (type === "add") number.textContent = String(newLine++);
		else if (type === "remove") number.textContent = String(oldLine++);
		else if (type === "context") { number.textContent = String(newLine || ""); oldLine += 1; newLine += 1; }

		const sign = document.createElement("span");
		sign.className = "line-sign";
		sign.textContent = type === "add" ? "+" : type === "remove" ? "−" : "";
		const code = document.createElement("code");
		code.textContent = type === "add" || type === "remove" ? source.slice(1) : source;
		row.append(number, sign, code);
		elements.diffView.append(row);
	}
	elements.diffStats.textContent = `${added} 行新增 · ${removed} 行删除`;
}

const INSPECTOR_TAB_CONFIG = {
	diff: { label: "审阅", icon: "#i-diff" },
	browser: { label: "新标签页", icon: "#i-globe" },
	files: { label: "文件", icon: "#i-folder" },
};

function renderInspectorTabs() {
	const tabsRow = document.querySelector("#inspectorTabsRow");
	const addContainer = document.querySelector("#inspectorAddContainer");
	const blankView = document.querySelector("#inspectorBlank");
	if (!tabsRow) return;

	tabsRow.innerHTML = "";
	const hasTabs = state.openInspectorTabs && state.openInspectorTabs.length > 0;

	if (!hasTabs) {
		if (addContainer) addContainer.style.display = "none";
		if (blankView) blankView.style.display = "flex";
		document.querySelectorAll(".inspector-panel").forEach((panel) => panel.classList.remove("active"));
		return;
	}

	if (addContainer) addContainer.style.display = "flex";
	if (blankView) blankView.style.display = "none";

	state.openInspectorTabs.forEach((tabId) => {
		const config = INSPECTOR_TAB_CONFIG[tabId] || { label: tabId, icon: "#i-file" };
		const isActive = state.activeInspectorTab === tabId;

		const pill = document.createElement("div");
		pill.className = `inspector-tab-pill ${isActive ? "active" : ""}`;
		pill.innerHTML = `
			<svg class="tab-icon"><use href="${config.icon}"/></svg>
			<span>${config.label}</span>
			<span class="inspector-tab-close" data-close="${tabId}" title="关闭标签页"><svg><use href="#i-plus"/></svg></span>
		`;

		pill.addEventListener("click", (e) => {
			const closeBtn = e.target.closest(".inspector-tab-close");
			if (closeBtn) {
				e.stopPropagation();
				closeInspectorTab(tabId);
			} else {
				selectInspectorTab(tabId);
			}
		});

		tabsRow.appendChild(pill);
	});

	document.querySelectorAll(".inspector-panel").forEach((panel) => {
		panel.classList.toggle("active", panel.dataset.panel === state.activeInspectorTab);
	});
}

function openInspectorTab(tab) {
	if (!state.openInspectorTabs) state.openInspectorTabs = [];
	if (!state.openInspectorTabs.includes(tab)) {
		state.openInspectorTabs.push(tab);
	}
	state.activeInspectorTab = tab;
	elements.appShell.classList.remove("inspector-collapsed");
	renderInspectorTabs();
}

function closeInspectorTab(tab) {
	if (!state.openInspectorTabs) return;
	state.openInspectorTabs = state.openInspectorTabs.filter((t) => t !== tab);
	if (state.activeInspectorTab === tab) {
		state.activeInspectorTab = state.openInspectorTabs[state.openInspectorTabs.length - 1] || null;
	}
	renderInspectorTabs();
}

function selectInspectorTab(tab) {
	openInspectorTab(tab);
}

function toggleInspectorTab(tab) {
	openInspectorTab(tab);
}

function navigateBrowser(rawAddress) {
	let address = rawAddress.trim();
	if (!/^https?:\/\//i.test(address)) address = `https://${address}`;
	try {
		const url = new URL(address);
		if (!["http:", "https:"].includes(url.protocol)) throw new Error();
		elements.browserView.loadURL(url.href);
		elements.browserAddress.value = url.href;
	} catch {
		elements.browserStatus.textContent = "地址无效";
	}
}

function showFileContentModal(name, content) {
	if (!elements.fileContentDialog) return;
	elements.fileContentTitle.textContent = name;
	elements.fileContentBody.textContent = content;
	elements.fileContentDialog.showModal();
}

function appendUserMessage(text, images = [], files = [], shouldScroll = true) {
	const article = document.createElement("article");
	article.className = "message user-message animate-entrance";
	const bubble = document.createElement("div");
	bubble.className = "user-bubble";
	
	if (text) {
		const textEl = document.createElement("div");
		textEl.className = "user-bubble-text";
		textEl.textContent = text;
		bubble.append(textEl);
	}
	
	if (images.length > 0) {
		const imgsContainer = document.createElement("div");
		imgsContainer.className = "user-bubble-images";
		images.forEach((img) => {
			const el = document.createElement("img");
			el.src = img.src || `data:${img.mimeType};base64,${img.data}`;
			imgsContainer.append(el);
		});
		bubble.append(imgsContainer);
	}
	
	if (files && files.length > 0) {
		const filesContainer = document.createElement("div");
		filesContainer.className = "user-bubble-files";
		files.forEach((file) => {
			const el = document.createElement("div");
			el.className = "user-bubble-file";
			el.append(icon("file"), document.createTextNode(file.name));
			el.addEventListener("click", () => showFileContentModal(file.name, file.content));
			filesContainer.append(el);
		});
		bubble.append(filesContainer);
	}
	
	article.append(bubble);
	elements.messageColumn.append(article);
	if (shouldScroll) scrollMessagesToBottom();
}

function renderMarkdown(md) {
	return window.metisDesktopMarkdown.render(md);
}

function appendAssistantNotice(text, label = "Metis", shouldScroll = true) {
	const article = document.createElement("article");
	article.className = "message assistant-message animate-entrance";
	const body = document.createElement("div");
	body.className = "assistant-body";
	
	const contentText = (label === "Metis" ? text : `**${label}**：\n\n${text}`) || "";
	body.innerHTML = renderMarkdown(contentText);
	
	article.append(body);
	elements.messageColumn.append(article);
	if (shouldScroll) scrollMessagesToBottom();
}

let userInterruptedScroll = false;

function scrollMessagesToBottom(smooth = false, force = false) {
	if (!force && userInterruptedScroll && state.isStreaming) {
		return;
	}
	requestAnimationFrame(() => {
		if (elements.messageScroll) {
			const el = elements.messageScroll;
			if (smooth) {
				el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
			} else {
				el.scrollTop = el.scrollHeight;
			}
		}
	});
}

async function sendMessage() {
	const message = elements.composerInput.value.trim();
	const hasImages = state.attachedImages && state.attachedImages.length > 0;
	const hasFiles = state.attachedFiles && state.attachedFiles.length > 0;
	if (!message && !hasImages && !hasFiles) return;
	window.MetisOnboarding?.notifyEvent("message_sent");
	if (!state.serverConnected) {
		elements.serverDialog.showModal();
		return;
	}

	const images = hasImages ? state.attachedImages.map((img) => ({
		type: "image",
		mimeType: img.mimeType,
		data: img.data
	})) : undefined;

	const messageImages = [...(state.attachedImages || [])];
	const messageFiles = [...(state.attachedFiles || [])];
	const wasStreaming = state.isStreaming;
	const wasNewConversation = !state.hasSubmittedMessage;
	const hasRunningSubagent = Array.isArray(state.session?.runningSubagentIds)
		&& state.session.runningSubagentIds.length > 0;
	const shouldQueue = hasRunningSubagent || shouldQueueDesktopMessage(state.messages, wasStreaming);

	let payloadMessage = message;
	if (hasFiles) {
		messageFiles.forEach((file) => {
			payloadMessage += `\n\n文件 \`${file.name}\` 的内容如下：\n\`\`\`\n${file.content}\n\`\`\``;
		});
	}

	elements.composerInput.value = "";
	state.hasSubmittedMessage = true;
	renderComposerStatusRow();
	state.attachedImages = [];
	state.attachedFiles = [];
	renderAttachmentPreviews();
	autoSizeComposer();

	userInterruptedScroll = false;
	if (elements.emptyState?.isConnected) elements.emptyState.remove();
	if (!shouldQueue) {
		appendUserMessage(message, messageImages, messageFiles);
		scrollMessagesToBottom(false, true);
	}

	if (!shouldQueue) setStreamingState(true, uiText("agentWorking"));
	else if (wasStreaming) setStreamingState(true, uiText("messageQueued"));
	try {
		if (shouldQueue) await requestServer("/session/follow-up", "POST", { message: payloadMessage, images });
		else await requestServer("/session/prompt", "POST", { message: payloadMessage, images });
	} catch (error) {
		if (wasNewConversation && !state.messages.some((item) => item?.role === "user")) {
			state.hasSubmittedMessage = false;
			renderComposerStatusRow();
		}
		elements.composerInput.value = message;
		state.attachedImages = messageImages;
		state.attachedFiles = messageFiles;
		renderAttachmentPreviews();
		autoSizeComposer();
		setStreamingState(wasStreaming, wasStreaming ? uiText("agentWorking") : "");
		appendAssistantNotice(error.message, "发送失败");
	}
}

async function abortGeneration() {
	if (!state.serverConnected || !state.isStreaming) return;
	elements.runState.querySelector("span:last-child").textContent = uiText("stopping");
	try {
		await requestServer("/session/abort", "POST", {});
	} catch (error) {
		appendAssistantNotice(error.message, "停止失败");
	} finally {
		setStreamingState(false);
	}
}

function autoSizeComposer() {
	// Chromium's field-sizing keeps textarea content-sized without inline styles,
	// preserving strict Content Security Policy.
}

async function connectServer() {
	const button = document.querySelector("#connectServerButton");
	button.disabled = true;
	button.textContent = "连接中…";
	const result = await desktop.metis.connect({
		baseUrl: document.querySelector("#serverUrlInput").value,
		username: document.querySelector("#serverUsernameInput").value,
		password: document.querySelector("#serverPasswordInput").value,
	});
	button.disabled = false;
	button.textContent = "连接";
	if (result.ok) {
		state.serverConnected = true;
		updateSettingsConnectionDetails();
		try {
			const project = activeProject();
			if (project) {
				await activateProject(project, { record: false, loadModels: true });
			} else {
				await syncServerSession({ loadModels: true });
			}
			await refreshAllProjectConversations();
			await loadVisualSettings();
			elements.serverDialog.close();
			finishServerLoading();
		} catch (error) {
			button.textContent = "已连接，同步失败";
			showServerLoadingFailure();
			appendAssistantNotice(error.message, "同步失败");
		}
	} else {
		button.textContent = "连接失败，重试";
	}
}

async function autoConnectServer() {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const result = await desktop.metis.connect({
			baseUrl: "http://127.0.0.1:4096",
			username: "metis",
			password: "",
		});
		if (result.ok) {
			state.serverConnected = true;
			updateSettingsConnectionDetails();
			try {
				const project = activeProject();
				if (project) {
					await activateProject(project, { record: false, loadModels: true });
				} else {
					await syncServerSession({ loadModels: true });
				}
				await refreshAllProjectConversations();
				await loadVisualSettings();
				finishServerLoading();
				return true;
			} catch (err) {
				console.error("[desktop] autoConnectServer sync error:", err);
				return false;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}

async function handleExtensionUiRequest(event) {
	if (event.method === "setStatus") {
		if (event.statusKey === "dream") setDreamStatus(event.statusText);
		else if (event.statusText) setSettingsFeedback(elements.settingsSecurityFeedback, event.statusText);
		return;
	}
	if (event.method === "notify") {
		const message = event.message;
		if (message) setSettingsFeedback(elements.settingsSecurityFeedback, message, event.notifyType === "error");
		return;
	}
	if (event.method === "open_url") {
		if (event.url) await desktop.openExternal(event.url);
		if (event.instructions) setSettingsFeedback(elements.settingsSecurityFeedback, event.instructions);
		return;
	}
	if (event.method === "set_editor_text") {
		elements.composerInput.value = event.text || "";
		autoSizeComposer();
		return;
	}

	let response;
	if (event.method === "confirm") {
		response = { id: event.id, confirmed: window.confirm(`${event.title || "确认"}\n\n${event.message || ""}`) };
	} else if (event.method === "select") {
		const options = Array.isArray(event.options) ? event.options : [];
		const answer = window.prompt(`${event.title || "请选择"}\n\n${options.map((option, index) => `${index + 1}. ${option}`).join("\n")}`);
		const index = Number(answer) - 1;
		response = Number.isInteger(index) && options[index] !== undefined
			? { id: event.id, value: options[index] }
			: { id: event.id, cancelled: true };
	} else if (event.method === "input" || event.method === "editor") {
		const value = window.prompt(event.title || event.placeholder || "请输入", event.prefill || "");
		response = value === null ? { id: event.id, cancelled: true } : { id: event.id, value };
	}
	if (response) await requestServer("/extension/ui-response", "POST", response);
}

function handleMetisEvent(event) {
	if (event.type === "extension_ui_request") {
		void handleExtensionUiRequest(event).catch((error) => setSettingsFeedback(elements.settingsSecurityFeedback, error.message, true));
		return;
	}
	if (!event?.type || event.type === "server.heartbeat") return;
	if (event.type === "server.connected") {
		state.serverConnected = true;
		updateSettingsConnectionDetails();
		if (state.session && !projectSwitchInProgress) {
			void syncServerSession({ loadModels: false }).catch((error) => appendAssistantNotice(error.message, "同步失败"));
		}
		return;
	}
	if (event.type === "server.session_changed") {
		if (!projectSwitchInProgress) {
			void syncServerSession({ loadModels: false }).catch((error) => appendAssistantNotice(error.message, "同步失败"));
		}
		return;
	}
	if (event.type === "thinking_level_changed" && state.session) {
		state.session.thinkingLevel = event.level;
		updateModelSelect();
		return;
	}
	if (event.type === "session_info_changed" && state.session) {
		state.session.sessionName = event.name;
		upsertServerConversation(state.session);
		return;
	}
	if (event.type === "session_name_generation" && state.session) {
		state.session.isGeneratingSessionName = event.status === "started";
		state.session.sessionTitleError = event.error;
		upsertServerConversation(state.session);
		return;
	}
	if (event.type === "queue_update" && state.session) {
		state.session.steeringMessages = Array.isArray(event.steering) ? [...event.steering] : [];
		state.session.followUpMessages = Array.isArray(event.followUp) ? [...event.followUp] : [];
		state.session.pendingMessageCount = state.session.steeringMessages.length + state.session.followUpMessages.length;
		renderMessageQueue();
		return;
	}
	if (event.type === "subagent_status" && state.session) {
		state.session.runningSubagentIds = Array.isArray(event.runningJobIds) ? [...event.runningJobIds] : [];
		renderSubagentDock();
		refreshWorkTimerTitles();
		refreshAssistantTurnActivityState();
		return;
	}
	const completed = ["message_end", "agent_end", "compaction_end"].includes(event.type);
	const active = ["agent_start", "message_start", "message_update", "tool_execution_start", "tool_execution_end", "compaction_start"].includes(event.type);
	if (completed) {
		setStreamingState(false);
		const lastAssistant = [...state.messages].reverse().find((m) => m.role === "assistant");
		if (lastAssistant) {
			const key = lastAssistant.id || lastAssistant.timestamp;
			if (state.messageStartTimes && state.messageStartTimes[key]) {
				const start = state.messageStartTimes[key];
				if (!state.messageDurations) state.messageDurations = {};
				state.messageDurations[key] = parseFloat(((Date.now() - start) / 1000).toFixed(1));
			}
		}
		void syncServerSession({ loadModels: false }).catch((error) => appendAssistantNotice(error.message, "同步失败"));
	} else if (active) {
		setStreamingState(true, humanizeEvent(event.type));
		
		if (event.type === "message_start") {
			if (event.message) {
				const key = event.message.id || event.message.timestamp;
				if (!state.messageStartTimes) state.messageStartTimes = {};
				state.messageStartTimes[key] = Date.now();

				const exists = state.messages.some((m) => m.id && event.message.id && m.id === event.message.id);
				if (!exists) {
					state.messages.push(event.message);
					renderServerMessages(state.messages);
				}
			}
		} else if (event.type === "message_update") {
			if (event.message) {
				const key = event.message.id || event.message.timestamp;
				if (!state.messageStartTimes) state.messageStartTimes = {};
				if (!state.messageStartTimes[key]) {
					state.messageStartTimes[key] = Date.now();
				}

				const index = state.messages.findIndex((m) => 
					(m.id && event.message.id && m.id === event.message.id) || 
					(m.role === event.message.role && m.timestamp === event.message.timestamp)
				);
				if (index !== -1) {
					state.messages[index] = event.message;
				} else {
					const lastIndex = state.messages.length - 1;
					if (lastIndex >= 0 && state.messages[lastIndex].role === "assistant" && event.message.role === "assistant") {
						state.messages[lastIndex] = event.message;
					} else {
						state.messages.push(event.message);
					}
				}
				renderServerMessages(state.messages);
			}
		} else if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
			void syncServerSession({ loadModels: false }).catch((error) => appendAssistantNotice(error.message, "同步失败"));
		}
	}
}

function humanizeEvent(type) {
	const labels = {
		agent_start: "Agent 正在处理",
		message_start: "开始生成",
		message_update: "正在生成",
		message_end: "处理完成",
		tool_execution_start: "正在调用工具",
		tool_execution_end: "工具执行完成",
		compaction_start: "正在整理上下文",
		compaction_end: "上下文已整理",
	};
	return labels[type] || type.replaceAll("_", " ");
}

document.querySelectorAll(".inspector-shortcut").forEach((button) => button.addEventListener("click", () => toggleInspectorTab(button.dataset.openInspector)));
document.querySelector("#sidebarToggle")?.addEventListener("click", (e) => {
	e.preventDefault();
	e.stopPropagation();
	const isCollapsed = elements.appShell.classList.toggle("sidebar-collapsed");
	const toggleBtn = document.querySelector("#sidebarToggle");
	if (toggleBtn) {
		toggleBtn.setAttribute("aria-label", isCollapsed ? "展开侧栏" : "收起侧栏");
		toggleBtn.setAttribute("title", isCollapsed ? "展开侧栏" : "收起侧栏");
	}
});
document.querySelector("#inspectorToggle")?.addEventListener("click", (e) => {
	e.preventDefault();
	e.stopPropagation();
	const isCollapsed = elements.appShell.classList.toggle("inspector-collapsed");
	const toggleBtn = document.querySelector("#inspectorToggle");
	if (toggleBtn) {
		toggleBtn.setAttribute("aria-label", isCollapsed ? "展开侧栏" : "收起侧栏");
		toggleBtn.setAttribute("title", isCollapsed ? "展开侧栏" : "收起侧栏");
	}
});
document.querySelector("#inspectorCollapseToggle")?.addEventListener("click", (e) => {
	e.preventDefault();
	e.stopPropagation();
	elements.appShell.classList.add("inspector-collapsed");
});
document.querySelector("#menuItemDiff")?.addEventListener("click", () => selectInspectorTab("diff"));
document.querySelector("#menuItemBrowser")?.addEventListener("click", () => selectInspectorTab("browser"));
document.querySelector("#menuItemFiles")?.addEventListener("click", () => selectInspectorTab("files"));

document.querySelector("#inspectorAddTabButton")?.addEventListener("click", (e) => {
	e.stopPropagation();
	const menu = document.querySelector("#inspectorTabMenu");
	if (menu) menu.classList.toggle("hidden");
});

document.querySelectorAll(".inspector-tab-menu-item").forEach((item) => {
	item.addEventListener("click", (e) => {
		e.stopPropagation();
		const tab = item.dataset.tab;
		if (tab) {
			openInspectorTab(tab);
			document.querySelector("#inspectorTabMenu")?.classList.add("hidden");
		}
	});
});

document.addEventListener("click", (e) => {
	const menu = document.querySelector("#inspectorTabMenu");
	if (menu && !menu.classList.contains("hidden") && !e.target.closest("#inspectorAddContainer")) {
		menu.classList.add("hidden");
	}
});
document.querySelector("#newChatButton").addEventListener("click", () => void createConversation());
document.querySelector("#collapsedNewChat").addEventListener("click", () => void createConversation());
document.querySelector("#sidebarSettingsButton")?.addEventListener("click", openSettings);
document.querySelector("#settingsBackButton")?.addEventListener("click", closeSettings);
document.querySelectorAll("[data-settings-panel]").forEach((button) => {
	button.addEventListener("click", () => selectSettingsPanel(button.dataset.settingsPanel));
});
elements.settingsSearchInput?.addEventListener("input", () => filterSettingsNavigation(elements.settingsSearchInput.value));
document.querySelector("#settingsOpenServerDialog")?.addEventListener("click", () => elements.serverDialog.showModal());
elements.settingsModelSelect?.addEventListener("change", () => void changeModel(Number(elements.settingsModelSelect.value)));
elements.settingsThinkingSelect?.addEventListener("change", () => void changeThinkingLevel(elements.settingsThinkingSelect.value));
elements.settingsAutoCompactInput?.addEventListener("change", () => void updateAgentSessionSettings(
	{ autoCompactionEnabled: elements.settingsAutoCompactInput.checked },
	elements.settingsAgentFeedback,
));
elements.settingsSteeringModeSelect?.addEventListener("change", () => void updateAgentSessionSettings(
	{ steeringMode: elements.settingsSteeringModeSelect.value },
	elements.settingsBehaviorFeedback,
));
elements.settingsFollowUpModeSelect?.addEventListener("change", () => void updateAgentSessionSettings(
	{ followUpMode: elements.settingsFollowUpModeSelect.value },
	elements.settingsBehaviorFeedback,
));
elements.settingsLanguageSelect?.addEventListener("change", () => {
	const language = elements.settingsLanguageSelect.value;
	applyUiLanguage(language);
	if (!state.serverConnected) {
		setSettingsFeedback(elements.settingsAgentFeedback, "Desktop 语言已保存；连接 Server 后将同步 Agent / TUI。", false);
		return;
	}
	performVisualAction(elements.settingsAgentFeedback, async () => {
		await runVisualCommand(`/language ${language}`, elements.settingsAgentFeedback);
		setSettingsFeedback(elements.settingsAgentFeedback, uiText("languageSaved", { language }));
	});
});
document.querySelector("#settingsCompactButton")?.addEventListener("click", () => performVisualAction(elements.settingsBehaviorFeedback, async () => {
	const instructions = elements.settingsCompactInstructions.value.trim();
	await runVisualCommand(`/compact${instructions ? ` ${instructions}` : ""}`, elements.settingsBehaviorFeedback, { refresh: true });
}));
document.querySelector("#settingsSaveSessionName")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, async () => {
	const name = elements.settingsSessionNameInput.value.trim();
	if (!name) throw new Error("请输入会话名称");
	await runVisualCommand(`/name ${name}`, elements.settingsSessionFeedback, { refresh: true });
}));
document.querySelector("#settingsCopyReply")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, () => runVisualCommand("/copy", elements.settingsSessionFeedback)));
document.querySelector("#settingsCloneSession")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, () => runVisualCommand("/clone", elements.settingsSessionFeedback, { refresh: true })));
document.querySelector("#settingsNewSession")?.addEventListener("click", () => {
	if (!window.confirm("开始新会话？当前会话会保留在历史记录中。")) return;
	performVisualAction(elements.settingsSessionFeedback, () => runVisualCommand("/new", elements.settingsSessionFeedback, { refresh: true }));
});
document.querySelector("#settingsResumeButton")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, async () => {
	if (!elements.settingsResumeSelect.value) throw new Error("没有可恢复的会话");
	await runVisualCommand(`/resume ${elements.settingsResumeSelect.value}`, elements.settingsSessionFeedback, { refresh: true });
}));
document.querySelector("#settingsForkButton")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, async () => {
	if (!elements.settingsForkSelect.value) throw new Error("没有可分叉的消息");
	const result = await runVisualCommand(`/fork ${elements.settingsForkSelect.value}`, elements.settingsSessionFeedback, { refresh: true });
	if (result.selectedText) {
		elements.composerInput.value = result.selectedText;
		autoSizeComposer();
		setSettingsFeedback(elements.settingsSessionFeedback, "已创建分叉；所选用户消息已放回主界面输入框，可修改后发送。");
	}
}));
document.querySelector("#settingsTreeButton")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, async () => {
	if (!elements.settingsTreeSelect.value) throw new Error("当前会话没有分支节点");
	await runVisualCommand(`/tree ${elements.settingsTreeSelect.value}`, elements.settingsSessionFeedback, { refresh: true });
}));
document.querySelector("#settingsExportHtml")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, async () => {
	const filePath = await desktop.sessionFile.save("html");
	if (filePath) await runVisualCommand(`/export ${filePath}`, elements.settingsSessionFeedback);
}));
document.querySelector("#settingsExportJsonl")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, async () => {
	const filePath = await desktop.sessionFile.save("jsonl");
	if (filePath) await runVisualCommand(`/export ${filePath}`, elements.settingsSessionFeedback);
}));
document.querySelector("#settingsImportSession")?.addEventListener("click", () => performVisualAction(elements.settingsSessionFeedback, async () => {
	const filePath = await desktop.sessionFile.open();
	if (filePath && window.confirm("导入并立即切换到所选会话？当前会话会保留在历史记录中。")) {
		await runVisualCommand(`/import ${filePath}`, elements.settingsSessionFeedback, { refresh: true });
	}
}));
document.querySelector("#settingsShareSession")?.addEventListener("click", () => {
	if (!window.confirm("将当前会话 HTML 上传为私密 GitHub Gist？持有链接的人可以查看内容。")) return;
	performVisualAction(elements.settingsSessionFeedback, () => runVisualCommand("/share", elements.settingsSessionFeedback));
});
elements.settingsTrustSelect?.addEventListener("change", () => performVisualAction(elements.settingsSecurityFeedback, () => runVisualCommand(`/trust ${elements.settingsTrustSelect.value}`, elements.settingsSecurityFeedback)));
document.querySelector("#settingsOauthLoginButton")?.addEventListener("click", () => performVisualAction(elements.settingsSecurityFeedback, async () => {
	const provider = elements.settingsOauthProvider.value;
	if (!provider) throw new Error("没有可用 OAuth Provider");
	await runVisualCommand(`/login ${provider}`, elements.settingsSecurityFeedback, { refresh: true });
	window.MetisOnboarding?.notifyEvent("provider_saved");
}));
document.querySelector("#settingsApiKeySaveButton")?.addEventListener("click", () => performVisualAction(elements.settingsSecurityFeedback, async () => {
	const provider = elements.settingsApiKeyProvider.value;
	if (!provider) throw new Error("没有可用 Provider");
	const apiKey = elements.settingsApiKeyInput.value.trim();
	if (!apiKey) throw new Error("请输入 API Key");
	await runVisualCommand(`/login ${provider} ${apiKey}`, elements.settingsSecurityFeedback, { refresh: true });
	elements.settingsApiKeyInput.value = "";
	window.MetisOnboarding?.notifyEvent("provider_saved");
}));
document.querySelector("#settingsCustomProviderSaveButton")?.addEventListener("click", () => performVisualAction(elements.settingsSecurityFeedback, async () => {
	const providerName = elements.settingsCustomProviderName.value.trim();
	const baseUrl = elements.settingsCustomBaseUrl.value.trim();
	const apiKey = elements.settingsCustomApiKey.value.trim();
	const reasoning = Boolean(elements.settingsCustomProviderReasoning?.checked);
	if (!providerName) throw new Error("请输入 Provider 名称");
	if (!baseUrl) throw new Error("请输入 Base URL");
	if (!apiKey) throw new Error("请输入 API Key");
	const previousModel = state.session?.model;
	await desktop.providerConfig.saveCustom({ name: providerName, baseUrl, apiKey, reasoning });
	await runVisualCommand("/reload", elements.settingsSecurityFeedback, { refresh: true });
	await runVisualCommand(`/login other ${apiKey}`, elements.settingsSecurityFeedback, { refresh: true });
	// Re-apply the active model so thinking capability updates without a manual switch.
	const model = resolveCustomProviderModel(previousModel, state.models);
	if (model) {
		await requestServer("/session/model", "PUT", { provider: model.provider, modelId: model.id });
	}
	await syncServerSession({ loadModels: true });
	await loadVisualSettings();
	if (reasoning && !state.session?.supportsThinking) {
		throw new Error("已写入 reasoning，但当前会话仍不支持思考。请完全退出并重启 Desktop（会自动带上新 Server）。");
	}
	elements.settingsCustomApiKey.value = "";
	setSettingsFeedback(
		elements.settingsSecurityFeedback,
		reasoning
			? `自定义 Provider 已保存；思考已启用（${state.session?.thinkingLevels?.join(" / ") || "可用"}）。`
			: "自定义 Provider 已保存；未开启思考。",
	);
	window.MetisOnboarding?.notifyEvent("provider_saved");
}));
document.querySelector("#settingsLogoutButton")?.addEventListener("click", () => performVisualAction(elements.settingsSecurityFeedback, async () => {
	const provider = elements.settingsLogoutProvider.value;
	if (!provider) throw new Error("没有已保存凭据");
	if (!window.confirm(`移除 ${provider} 的已保存凭据？`)) return;
	await runVisualCommand(`/logout ${provider}`, elements.settingsSecurityFeedback, { refresh: true });
}));
document.querySelector("#settingsShowOnboarding")?.addEventListener("click", () => {
	closeSettings();
	window.MetisOnboarding?.reset();
});
document.querySelector("#settingsShowChangelog")?.addEventListener("click", () => performVisualAction(elements.settingsAgentFeedback, async () => {
	const result = await runVisualCommand("/changelog", elements.settingsAgentFeedback);
	showFileContentModal("Metis 更新记录", result.changelog || "没有更新记录");
}));
document.querySelector("#settingsShowHotkeys")?.addEventListener("click", () => performVisualAction(elements.settingsAgentFeedback, async () => {
	const result = await runVisualCommand("/hotkeys", elements.settingsAgentFeedback);
	showFileContentModal("Desktop 快捷键", `以下仅适用于 Desktop；终端 TUI 的快捷键可能不同。\n\n${(result.hotkeys || []).join("\n")}`);
}));
document.querySelector("#settingsReloadResources")?.addEventListener("click", () => performVisualAction(elements.settingsAgentFeedback, () => runVisualCommand("/reload", elements.settingsAgentFeedback, { refresh: true })));
document.querySelector("#settingsQuitApp")?.addEventListener("click", () => {
	if (window.confirm("退出 Metis Desktop？")) performVisualAction(elements.settingsAgentFeedback, () => runVisualCommand("/quit", elements.settingsAgentFeedback));
});
document.querySelector("#settingsChooseWorkspaceButton")?.addEventListener("click", async () => {
	await loadWorkspace(true);
	await updateSettingsDetails();
});
elements.historyBack.addEventListener("click", () => void navigateHistory(-1));
elements.historyForward.addEventListener("click", () => void navigateHistory(1));
document.querySelector("#chooseWorkspaceButton").addEventListener("click", () => void loadWorkspace(true));
document.querySelector("#refreshFilesButton").addEventListener("click", () => void refreshFileTree());
elements.fileFilterInput.addEventListener("input", () => renderFileTree(elements.fileFilterInput.value));
document.querySelector("#revealFileButton")?.addEventListener("click", () => state.activeFile && desktop.workspace.reveal(state.activeFile));

document.querySelector("#browserBack")?.addEventListener("click", () => elements.browserView?.canGoBack() && elements.browserView?.goBack());
document.querySelector("#browserForward")?.addEventListener("click", () => elements.browserView?.canGoForward() && elements.browserView?.goForward());
document.querySelector("#browserReload")?.addEventListener("click", () => elements.browserView?.reload());
document.querySelector("#browserExternal")?.addEventListener("click", () => elements.browserView && desktop.openExternal(elements.browserView.getURL()));
elements.browserAddress?.addEventListener("keydown", (event) => {
	if (event.key === "Enter") navigateBrowser(elements.browserAddress.value);
});
elements.browserView?.addEventListener("did-start-loading", () => { if (elements.browserStatus) elements.browserStatus.textContent = "正在载入…"; });
elements.browserView?.addEventListener("did-stop-loading", () => {
	 if (elements.browserStatus) elements.browserStatus.textContent = "就绪";
	 if (elements.browserAddress && elements.browserView) elements.browserAddress.value = elements.browserView.getURL();
});
elements.browserView?.addEventListener("did-fail-load", () => { if (elements.browserStatus) elements.browserStatus.textContent = "页面载入失败"; });

elements.composerInput.addEventListener("input", autoSizeComposer);
elements.composerInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void sendMessage();
	}
});
elements.attachButton.addEventListener("click", () => elements.attachInput.click());
elements.attachInput.addEventListener("change", (event) => {
	if (event.target.files && event.target.files.length > 0) {
		void handleAttachments(event.target.files);
	}
});
elements.sendButton.addEventListener("click", () => void (state.isStreaming ? abortGeneration() : sendMessage()));
elements.messageQueueToggle?.addEventListener("click", () => {
	const collapsed = elements.messageQueue.classList.toggle("collapsed");
	elements.messageQueueToggle.setAttribute("aria-expanded", String(!collapsed));
});
elements.subagentDockToggle?.addEventListener("click", () => {
	state.subagentDockExpanded = !state.subagentDockExpanded;
	renderSubagentDock();
});
elements.projectSwitchCapsule?.addEventListener("click", (event) => {
	event.stopPropagation();
	setProjectSwitchMenuOpen(!elements.projectSwitcher.classList.contains("open"), { focusSelected: true });
});
elements.projectSwitchAdd?.addEventListener("click", (event) => {
	event.stopPropagation();
	setProjectSwitchMenuOpen(false);
	void loadWorkspace(true);
});
elements.projectSwitchMenu?.addEventListener("keydown", (event) => {
	const options = [...elements.projectSwitchOptions.querySelectorAll(".project-switch-option"), elements.projectSwitchAdd];
	const currentIndex = options.indexOf(document.activeElement);
	if (event.key === "Escape") {
		event.preventDefault();
		setProjectSwitchMenuOpen(false);
		elements.projectSwitchCapsule.focus();
	} else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
		event.preventDefault();
		const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (currentIndex + 1) % options.length : (currentIndex - 1 + options.length) % options.length;
		options[nextIndex]?.focus();
	}
});
elements.modelTrigger.addEventListener("click", (event) => {
	event.stopPropagation();
	setModelMenuOpen(!elements.modelPicker.classList.contains("open"), { focusSelected: true });
});
elements.modelTrigger.addEventListener("keydown", (event) => {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		setModelMenuOpen(true, { focusSelected: true });
	}
});
elements.modelMenu.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && elements.modelPicker.classList.contains("advanced-open")) {
		event.preventDefault();
		elements.modelPicker.classList.remove("advanced-open");
		elements.advancedEntry.focus();
		return;
	}
	const options = [...elements.modelOptions.querySelectorAll(".model-option")];
	if (!options.length) return;
	const currentIndex = options.indexOf(document.activeElement);
	if (event.key === "Escape") {
		event.preventDefault();
		setModelMenuOpen(false);
		elements.modelTrigger.focus();
	} else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
		event.preventDefault();
		const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (currentIndex + 1) % options.length : (currentIndex - 1 + options.length) % options.length;
		options[nextIndex].focus();
	}
});
elements.advancedEntry.addEventListener("click", (event) => {
	event.stopPropagation();
	elements.modelPicker.classList.add("advanced-open");
});
elements.thinkingBack.addEventListener("click", (event) => {
	event.stopPropagation();
	elements.modelPicker.classList.remove("advanced-open");
	elements.advancedEntry.focus();
});
elements.thinkingScale.addEventListener("keydown", (event) => {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	const levels = getAvailableThinkingLevels();
	if (!levels.length) return;
	event.preventDefault();
	const currentIndex = Number(elements.thinkingScale.dataset.previewIndex || 0);
	const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? levels.length - 1 : event.key === "ArrowRight" ? Math.min(levels.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
	previewThinkingLevel(nextIndex);
	void changeThinkingLevel(levels[nextIndex]);
});
elements.thinkingScale.addEventListener("pointerdown", (event) => {
	if (event.button !== 0) return;
	const index = nearestThinkingStepIndex(event.clientX);
	thinkingDrag = { pointerId: event.pointerId, index };
	elements.thinkingScale.setPointerCapture(event.pointerId);
	elements.thinkingScale.classList.add("dragging");
	previewThinkingLevel(index);
	event.preventDefault();
});
elements.thinkingScale.addEventListener("pointermove", (event) => {
	if (!thinkingDrag || event.pointerId !== thinkingDrag.pointerId) return;
	const index = nearestThinkingStepIndex(event.clientX);
	if (index !== thinkingDrag.index) {
		thinkingDrag.index = index;
		previewThinkingLevel(index);
	}
});
elements.thinkingScale.addEventListener("pointerup", (event) => {
	if (!thinkingDrag || event.pointerId !== thinkingDrag.pointerId) return;
	const levelIndex = thinkingDrag.index;
	const level = getAvailableThinkingLevels()[levelIndex];
	if (elements.thinkingScale.hasPointerCapture(event.pointerId)) elements.thinkingScale.releasePointerCapture(event.pointerId);
	elements.thinkingScale.classList.remove("dragging");
	thinkingDrag = undefined;
	previewThinkingLevel(levelIndex);
	if (level) void changeThinkingLevel(level);
});
elements.thinkingScale.addEventListener("pointercancel", (event) => {
	if (!thinkingDrag || event.pointerId !== thinkingDrag.pointerId) return;
	elements.thinkingScale.classList.remove("dragging");
	thinkingDrag = undefined;
	renderThinkingControl();
});
document.addEventListener("click", (event) => {
	if (!elements.projectSwitcher.contains(event.target)) setProjectSwitchMenuOpen(false);
	if (!elements.modelPicker.contains(event.target)) setModelMenuOpen(false);
});

document.querySelector("#emptyConnectButton").addEventListener("click", () => elements.serverDialog.showModal());
document.querySelector("#connectServerButton").addEventListener("click", () => void connectServer());
elements.serverLoadingConnect?.addEventListener("click", () => elements.serverDialog.showModal());
desktop.metis.onEvent(handleMetisEvent);
desktop.metis.onDisconnect(() => {
	state.serverConnected = false;
	state.isStreaming = false;
	state.models = [];
	setStreamingState(false);
	updateModelSelect();
	updateSettingsConnectionDetails();
	void loadVisualSettings();
	if (!elements.serverLoading?.classList.contains("hidden")) showServerLoadingFailure();
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !elements.settingsShell.hidden && !elements.serverDialog.open) {
		event.preventDefault();
		closeSettings();
		return;
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
		if (!elements.settingsShell.hidden) return;
		event.preventDefault();
		void createConversation();
	}
});

elements.messageScroll.addEventListener("wheel", (e) => {
	if (state.isStreaming) {
		const el = elements.messageScroll;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		if (e.deltaY < 0 || distanceFromBottom > 50) {
			userInterruptedScroll = true;
		}
	}
}, { passive: true });

elements.messageScroll.addEventListener("touchmove", () => {
	if (state.isStreaming) {
		const el = elements.messageScroll;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		if (distanceFromBottom > 50) {
			userInterruptedScroll = true;
		}
	}
}, { passive: true });

elements.messageScroll.addEventListener("scroll", () => {
	const el = elements.messageScroll;
	const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

	if (state.isStreaming) {
		if (distanceFromBottom <= 20) {
			userInterruptedScroll = false;
		}
	}
});

applyUiLanguage(state.uiLanguage);
renderConversations();
window.setInterval(refreshWorkTimerTitles, 100);
void (async () => {
	try {
		const appInfo = await desktop.appInfo();
		state.platform = appInfo.platform;
		document.body.classList.add(`platform-${appInfo.platform}`);
		if (elements.revealFileButton) elements.revealFileButton.textContent = revealInFolderLabel();
	} catch {}
	await loadWorkspace();
	const connected = await autoConnectServer();
	if (!connected) showServerLoadingFailure();
	if (window.MetisOnboarding && !window.MetisOnboarding.isCompleted()) {
		setTimeout(() => {
			window.MetisOnboarding.start();
		}, 800);
	}
})();
