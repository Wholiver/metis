const desktop = window.metisDesktop;
const desktopI18n = window.metisDesktopI18n;
const { analyzeAssistantTurn, shouldQueueDesktopMessage, getAssistantWorkLayout, shouldHideAssistantWorkHeader, getAssistantTurnDuration, extractProposedPlan, reconcileAssistantFinalDivider, isSubagentLaunchNotice, mergeStreamingMessage, classifyDesktopActivityEvent } = window.metisMessageTurns;
const { resolveCustomProviderModel } = window.metisModelSelection;
const attachmentTools = window.metisAttachments;
const skillComposer = window.metisSkillComposer;
const workStatsView = window.metisDesktopWorkStats;
const conversationTokenComet = window.metisConversationTokenComet;
const memoryStateView = window.metisMemoryState;
const MAX_INLINE_TEXT_BYTES = 1024 * 1024;
const MAX_BUFFERED_ATTACHMENT_BYTES = 128 * 1024 * 1024;
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
	serverInstanceId: undefined,
	lastServerSequence: 0,
	lastServerStateSequence: 0,
	uiLanguage: UI_LANGUAGES.includes(localStorage.getItem("metis.desktopUiLanguage.v2")) ? localStorage.getItem("metis.desktopUiLanguage.v2") : "auto",
	memoryState: { enabled: false, phase: "disabled", globalCount: 0, projectCount: 0, pendingJobs: 0 },
	isStreaming: false,
	session: undefined,
	models: [],
	defaults: undefined,
	security: undefined,
	messages: [],
	messageStartTimes: {},
	messageDurations: {},
	messageTimings: {},
	attachedImages: [],
	attachedFiles: [],
	toolCallTimes: {},
	thoughtSegmentTimings: {},
	hasSubmittedMessage: false,
	navigationHistory: [],
	navigationIndex: -1,
	projects: [],
	customProviders: [],
	workStats: undefined,
	workStatsLoadedAt: 0,
	workflowPlanCollapsed: false,
	workflowPlanAutoCollapsedKey: undefined,
	pendingUserInputId: undefined,
	skillCommands: [],
	skillCommandsLoadedFor: undefined,
	activeSkillIndex: 0,
	queueOperation: undefined,
	queueOperationFeedback: "",
};

let thinkingDrag;
let projectStateInitialized = false;
let projectSwitchInProgress = false;
let customizingProjectId;
let customizingProjectButton;
let sessionSyncGeneration = 0;
let serverDisconnectTimer;
let autoConnectServerRequest;
let workStatsRequest;
let scheduledServerMessageRenderFrame;
let memoryRunPending = false;
const renderedConversationTokenTrailWidths = new Map();

const elements = {
	get appShell() { return document.querySelector("#appShell"); },
	get projectList() { return document.querySelector("#projectList"); },
	get channelListPane() { return document.querySelector('[data-purpose="channel-list"]'); },
	get conversationList() { return document.querySelector("#conversationList"); },
	get conversationListLoading() { return document.querySelector("#conversationListLoading"); },
	get conversationListLoadingLabel() { return document.querySelector("#conversationListLoadingLabel"); },
	get conversationSidebarTitle() { return document.querySelector("#conversationSidebarTitle"); },
	get headingTitle() { return document.querySelector("#headingTitle"); },
	get fileRootName() { return document.querySelector("#fileRootName"); },
	get fileRootPath() { return document.querySelector("#fileRootPath"); },
	get fileTree() { return document.querySelector("#fileTree"); },
	get fileFilterInput() { return document.querySelector("#fileFilterInput"); },
	get diffTitle() { return document.querySelector("#diffTitle"); },
	get diffStats() { return document.querySelector("#diffStats"); },
	get diffView() { return document.querySelector("#diffView"); },
	get composerInput() { return document.querySelector("#composerInput"); },
	get composer() { return document.querySelector("#composer"); },
	get composerSkillMenu() { return document.querySelector("#composerSkillMenu"); },
	get composerAttachments() { return document.querySelector("#composerAttachments"); },
	get composerDropFeedback() { return document.querySelector("#composerDropFeedback"); },
	get attachmentFeedback() { return document.querySelector("#attachmentFeedback"); },
	get attachButton() { return document.querySelector("#attachButton"); },
	get attachInput() { return document.querySelector("#attachInput"); },
	get messageColumn() { return document.querySelector("#messageColumn"); },
	get messageScroll() { return document.querySelector("#messageScroll"); },
	get conversationViewLoading() { return document.querySelector("#conversationViewLoading"); },
	get conversationViewLoadingLabel() { return document.querySelector("#conversationViewLoadingLabel"); },
	get conversationPane() { return document.querySelector('[data-purpose="main-chat"]'); },
	get emptyState() { return document.querySelector("#emptyState"); },
	get messageQueue() { return document.querySelector("#messageQueue"); },
	get messageQueueToggle() { return document.querySelector("#messageQueueToggle"); },
	get messageQueueCount() { return document.querySelector("#messageQueueCount"); },
	get messageQueueList() { return document.querySelector("#messageQueueList"); },
	get messageQueueFeedback() { return document.querySelector("#messageQueueFeedback"); },
	get composerStatusRow() { return document.querySelector("#composerStatusRow"); },
	get projectSwitcher() { return document.querySelector("#projectSwitcher"); },
	get projectSwitchCapsule() { return document.querySelector("#projectSwitchCapsule"); },
	get projectSwitchLabel() { return document.querySelector("#projectSwitchLabel"); },
	get projectSwitchMenu() { return document.querySelector("#projectSwitchMenu"); },
	get projectSwitchOptions() { return document.querySelector("#projectSwitchOptions"); },
	get projectSwitchCount() { return document.querySelector("#projectSwitchCount"); },
	get projectSwitchAdd() { return document.querySelector("#projectSwitchAdd"); },
	get projectCustomizePopover() { return document.querySelector("#projectCustomizePopover"); },
	get projectCustomizeForm() { return document.querySelector("#projectCustomizeForm"); },
	get projectDisplayNameInput() { return document.querySelector("#projectDisplayNameInput"); },
	get projectColorInput() { return document.querySelector("#projectColorInput"); },
	get dreamTokenCard() { return document.querySelector("#dreamTokenCard"); },
	get dreamTokenTotal() { return document.querySelector("#dreamTokenTotal"); },
	get dreamTokenPeak() { return document.querySelector("#dreamTokenPeak"); },
	get dreamTokenActiveDays() { return document.querySelector("#dreamTokenActiveDays"); },
	get dreamTokenHeatmap() { return document.querySelector("#dreamTokenHeatmap"); },
	get dreamTokenMonths() { return document.querySelector("#dreamTokenMonths"); },
	get modelPicker() { return document.querySelector("#modelPicker"); },
	get modelTrigger() { return document.querySelector("#modelTrigger"); },
	get modelTriggerLabel() { return document.querySelector("#modelTriggerLabel"); },
	get modelMenu() { return document.querySelector("#modelMenu"); },
	get modelOptions() { return document.querySelector("#modelOptions"); },
	get workflowPicker() { return document.querySelector("#workflowPicker"); },
	get workflowTrigger() { return document.querySelector("#workflowTrigger"); },
	get workflowTriggerLabel() { return document.querySelector("#workflowTriggerLabel"); },
	get workflowMenu() { return document.querySelector("#workflowMenu"); },
	get workflowPlanCard() { return document.querySelector("#workflowPlanCard"); },
	get workflowPlanToggle() { return document.querySelector("#workflowPlanToggle"); },
	get workflowPlanProgress() { return document.querySelector("#workflowPlanProgress"); },
	get workflowPlanBody() { return document.querySelector("#workflowPlanBody"); },
	get advancedEntry() { return document.querySelector("#advancedEntry"); },
	get contextIndicator() { return document.querySelector("#contextIndicator"); },
	get contextPercentRing() { return document.querySelector("#contextPercentRing"); },
	get advancedValue() { return document.querySelector("#advancedValue"); },
	get thinkingScale() { return document.querySelector("#thinkingScale"); },
	get thinkingBack() { return document.querySelector("#thinkingBack"); },
	get sendButton() { return document.querySelector("#sendButton"); },
	get sendButtonIcon() { return document.querySelector("#sendButtonIcon"); },
	get historyBack() { return document.querySelector("#historyBack"); },
	get historyForward() { return document.querySelector("#historyForward"); },
	get serverDialog() { return document.querySelector("#serverDialog"); },
	get serverLoading() { return document.querySelector("#serverLoading"); },
	get serverLoadingText() { return document.querySelector("#serverLoadingText"); },
	get serverLoadingConnect() { return document.querySelector("#serverLoadingConnect"); },
	get fileContentDialog() { return document.querySelector("#fileContentDialog"); },
	get fileContentTitle() { return document.querySelector("#fileContentTitle"); },
	get fileContentBody() { return document.querySelector("#fileContentBody"); },
	get extensionUiDialog() { return document.querySelector("#extensionUiDialog"); },
	get extensionUiForm() { return document.querySelector("#extensionUiForm"); },
	get extensionUiEyebrow() { return document.querySelector("#extensionUiEyebrow"); },
	get extensionUiTitle() { return document.querySelector("#extensionUiTitle"); },
	get extensionUiMessage() { return document.querySelector("#extensionUiMessage"); },
	get extensionUiField() { return document.querySelector("#extensionUiField"); },
	get extensionUiFieldLabel() { return document.querySelector("#extensionUiFieldLabel"); },
	get extensionUiInput() { return document.querySelector("#extensionUiInput"); },
	get extensionUiSelect() { return document.querySelector("#extensionUiSelect"); },
	get extensionUiHint() { return document.querySelector("#extensionUiHint"); },
	get extensionUiCancelButton() { return document.querySelector("#extensionUiCancelButton"); },
	get extensionUiSubmitButton() { return document.querySelector("#extensionUiSubmitButton"); },
	get browserView() { return document.querySelector("#browserView"); },
	get settingsDialog() { return document.querySelector("#settingsDialog"); },
	get settingsLanguageSelect() { return document.querySelector("#settingsLanguageSelect"); },
	get settingsAutoCompactInput() { return document.querySelector("#settingsAutoCompactInput"); },
	get settingsAutoRetryInput() { return document.querySelector("#settingsAutoRetryInput"); },
	get settingsSteeringModeSelect() { return document.querySelector("#settingsSteeringModeSelect"); },
	get settingsFollowUpModeSelect() { return document.querySelector("#settingsFollowUpModeSelect"); },
	get settingsModelSelect() { return document.querySelector("#settingsModelSelect"); },
	get settingsThinkingSelect() { return document.querySelector("#settingsThinkingSelect"); },
	get settingsDefaultModelSelect() { return document.querySelector("#settingsDefaultModelSelect"); },
	get settingsDefaultThinkingSelect() { return document.querySelector("#settingsDefaultThinkingSelect"); },
	get settingsTrustSelect() { return document.querySelector("#settingsTrustSelect"); },
	get settingsOauthProvider() { return document.querySelector("#settingsOauthProvider"); },
	get settingsOauthLoginButton() { return document.querySelector("#settingsOauthLoginButton"); },
	get settingsApiKeyProvider() { return document.querySelector("#settingsApiKeyProvider"); },
	get settingsApiKeyInput() { return document.querySelector("#settingsApiKeyInput"); },
	get settingsApiKeySaveButton() { return document.querySelector("#settingsApiKeySaveButton"); },
	get settingsLogoutProvider() { return document.querySelector("#settingsLogoutProvider"); },
	get settingsLogoutButton() { return document.querySelector("#settingsLogoutButton"); },
	get settingsCustomProviderSelect() { return document.querySelector("#settingsCustomProviderSelect"); },
	get settingsCustomProviderName() { return document.querySelector("#settingsCustomProviderName"); },
	get settingsCustomBaseUrl() { return document.querySelector("#settingsCustomBaseUrl"); },
	get settingsCustomApiKey() { return document.querySelector("#settingsCustomApiKey"); },
	get settingsCustomModelIds() { return document.querySelector("#settingsCustomModelIds"); },
	get settingsCustomProviderReasoning() { return document.querySelector("#settingsCustomProviderReasoning"); },
	get settingsMemoryInput() { return document.querySelector("#settingsMemoryInput"); },
	get settingsMemoryDashboard() { return document.querySelector("#settingsMemoryDashboard"); },
	get settingsMemoryStateLabel() { return document.querySelector("#settingsMemoryStateLabel"); },
	get settingsMemorySummary() { return document.querySelector("#settingsMemorySummary"); },
	get settingsMemoryRecordCount() { return document.querySelector("#settingsMemoryRecordCount"); },
	get settingsMemoryRecordDetail() { return document.querySelector("#settingsMemoryRecordDetail"); },
	get settingsMemoryPendingCount() { return document.querySelector("#settingsMemoryPendingCount"); },
	get settingsMemoryPendingDetail() { return document.querySelector("#settingsMemoryPendingDetail"); },
	get settingsMemoryLastRunValue() { return document.querySelector("#settingsMemoryLastRunValue"); },
	get settingsMemoryLastRunDetail() { return document.querySelector("#settingsMemoryLastRunDetail"); },
	get settingsMemoryMethod() { return document.querySelector("#settingsMemoryMethod"); },
	get settingsMemoryNextRun() { return document.querySelector("#settingsMemoryNextRun"); },
	get settingsMemoryLastCompleted() { return document.querySelector("#settingsMemoryLastCompleted"); },
	get settingsMemoryError() { return document.querySelector("#settingsMemoryError"); },
	get settingsMemoryRun() { return document.querySelector("#settingsMemoryRun"); },
	get settingsMemoryRunHint() { return document.querySelector("#settingsMemoryRunHint"); },
	get settingsMemorySearch() { return document.querySelector("#settingsMemorySearch"); },
	get settingsMemoryReset() { return document.querySelector("#settingsMemoryReset"); },
	get settingsMemoryRecordBadge() { return document.querySelector("#settingsMemoryRecordBadge"); },
	get settingsMemoryGlobalBar() { return document.querySelector("#settingsMemoryGlobalBar"); },
	get settingsMemoryProjectBar() { return document.querySelector("#settingsMemoryProjectBar"); },
	get settingsMemoryPendingBadge() { return document.querySelector("#settingsMemoryPendingBadge"); },
	get settingsMemoryPendingBar() { return document.querySelector("#settingsMemoryPendingBar"); },
	get settingsMemoryLastRunRate() { return document.querySelector("#settingsMemoryLastRunRate"); },
	get settingsMemoryLastRunBar() { return document.querySelector("#settingsMemoryLastRunBar"); },
	get settingsMemorySkippedBar() { return document.querySelector("#settingsMemorySkippedBar"); },
	get settingsMemoryMethodIndicator() { return document.querySelector("#settingsMemoryMethodIndicator"); },
	get settingsMemoryMethodBadge() { return document.querySelector("#settingsMemoryMethodBadge"); },
	get settingsMemoryMethodBadgeText() { return document.querySelector("#settingsMemoryMethodBadgeText"); },
	get settingsMemoryMethodBar() { return document.querySelector("#settingsMemoryMethodBar"); },
	get settingsCollaborationModeSelect() { return document.querySelector("#settingsCollaborationModeSelect"); },
	get instructionSources() { return document.querySelector("#instructionSources"); },
	get settingsGeneralFeedback() { return document.querySelector("#settingsGeneralFeedback"); },
	get settingsModelFeedback() { return document.querySelector("#settingsModelFeedback"); },
	get settingsAgentFeedback() { return document.querySelector("#settingsAgentFeedback"); },
	get settingsSecurityFeedback() { return document.querySelector("#settingsSecurityFeedback"); },
	get settingsSessionFeedback() { return document.querySelector("#settingsSessionFeedback"); },
	get settingsSessionNameInput() { return document.querySelector("#settingsSessionNameInput"); },
	get settingsAboutFeedback() { return document.querySelector("#settingsAboutFeedback"); },
	get settingsServerStatus() { return document.querySelector("#settingsServerStatus"); },
	get settingsServerAddress() { return document.querySelector("#settingsServerAddress"); },
	get settingsWorkspaceName() { return document.querySelector("#settingsWorkspaceName"); },
	get settingsWorkspacePath() { return document.querySelector("#settingsWorkspacePath"); },
	get settingsAppVersion() { return document.querySelector("#settingsAppVersion"); },
	get settingsPlatform() { return document.querySelector("#settingsPlatform"); },
	revealFileButton: document.querySelector("#revealFileButton"),
};

skillComposer.installValueProperty(elements.composerInput, () => state.skillCommands);

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
	elements.serverLoadingConnect.onclick = (e) => {
		e.stopPropagation();
		finishServerLoading();
	};
	elements.serverLoading.onclick = () => {
		finishServerLoading();
	};
}

const SETTINGS_LANGUAGE_KEYS = {
	auto: "automatic",
	"zh-CN": "languageChineseSimplified",
	"zh-TW": "languageChineseTraditional",
	en: "languageEnglish",
	ja: "languageJapanese",
	ko: "languageKorean",
	es: "languageSpanish",
	fr: "languageFrench",
	de: "languageGerman",
	pt: "languagePortuguese",
	ru: "languageRussian",
	it: "languageItalian",
};

const NATIVE_LANGUAGE_NAMES = {
	auto: "automatic",
	"zh-CN": "\u7b80\u4f53\u4e2d\u6587",
	"zh-TW": "\u7e41\u9ad4\u4e2d\u6587",
	en: "English",
	ja: "\u65e5\u672c\u8a9e",
	ko: "\ud55c\uad6d\uc5b4",
	es: "Espa\u00f1ol",
	fr: "Fran\u00e7ais",
	de: "Deutsch",
	pt: "Portugu\u00eas",
	ru: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
	it: "Italiano",
};

function setPreferencesFeedback(element, message = "", isError = false) {
	if (!element) return;
	element.textContent = message;
	element.classList.toggle("error", isError);
}

function selectPreferencesPanel(panelName) {
	document.querySelectorAll("[data-settings-panel]").forEach((button) => {
		const active = button.dataset.settingsPanel === panelName;
		button.classList.toggle("active", active);
		if (active) button.setAttribute("aria-current", "page");
		else button.removeAttribute("aria-current");
	});
	document.querySelectorAll("[data-settings-content]").forEach((panel) => {
		const active = panel.dataset.settingsContent === panelName;
		panel.classList.toggle("active", active);
		panel.hidden = !active;
	});
}

function renderMemoryStatus() {
	if (!elements.settingsMemoryDashboard || !memoryStateView) return;
	const connected = Boolean(state.serverConnected && state.session);
	const busy = Boolean(state.session?.isStreaming || state.session?.isCompacting);
	const view = memoryStateView.createMemoryStatusView(state.memoryState, {
		formatDate: (value) => new Intl.DateTimeFormat(resolveUiLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)),
	});
	const setText = (element, value) => { if (element) element.textContent = value; };
	elements.settingsMemoryDashboard.dataset.tone = view.tone;
	setText(elements.settingsMemoryStateLabel, uiText(view.labelKey));
	setText(elements.settingsMemorySummary, uiText(view.summaryKey, view.summaryVariables));
	setText(elements.settingsMemoryRecordCount, String(view.records));
	setText(elements.settingsMemoryRecordDetail, uiText("settingsMemoryRecordScopes", view.recordsDetailVariables));
	setText(elements.settingsMemoryPendingCount, String(view.pendingJobs));
	setText(elements.settingsMemoryPendingDetail, uiText(view.pendingDetailKey, view.pendingDetailVariables));
	setText(elements.settingsMemoryLastRunValue, view.lastRunValue);
	setText(elements.settingsMemoryLastRunDetail, uiText(view.lastRunDetailKey, view.lastRunDetailVariables));
	setText(elements.settingsMemoryMethod, uiText(view.methodKey));
	setText(elements.settingsMemoryNextRun, view.nextEligibleAt || "—");
	setText(elements.settingsMemoryLastCompleted, view.lastCompletedAt || "—");

	// Micro-chart indicators
	if (elements.settingsMemoryRecordBadge) {
		elements.settingsMemoryRecordBadge.textContent = view.records > 0 ? `${view.projectPercent}%` : "0%";
	}
	if (elements.settingsMemoryGlobalBar) {
		elements.settingsMemoryGlobalBar.style.width = `${view.globalPercent}%`;
	}
	if (elements.settingsMemoryProjectBar) {
		elements.settingsMemoryProjectBar.style.width = `${view.projectPercent}%`;
	}
	if (elements.settingsMemoryPendingBadge) {
		elements.settingsMemoryPendingBadge.textContent = view.pendingJobs > 0 ? String(view.pendingJobs) : "0";
		elements.settingsMemoryPendingBadge.dataset.active = view.pendingJobs > 0 ? "true" : "false";
	}
	if (elements.settingsMemoryPendingBar) {
		elements.settingsMemoryPendingBar.style.width = `${view.pendingPercent}%`;
	}
	if (elements.settingsMemoryLastRunRate) {
		elements.settingsMemoryLastRunRate.textContent = view.lastRunValue !== "—" ? view.lastRunValue : "—";
	}
	if (elements.settingsMemoryLastRunBar) {
		elements.settingsMemoryLastRunBar.style.width = `${Math.min(100, view.addedPercent)}%`;
	}
	if (elements.settingsMemorySkippedBar) {
		elements.settingsMemorySkippedBar.style.width = `${Math.min(100, view.skippedPercent)}%`;
	}
	if (elements.settingsMemoryMethodIndicator) {
		elements.settingsMemoryMethodIndicator.dataset.method = view.method;
	}
	if (elements.settingsMemoryMethodBadgeText) {
		elements.settingsMemoryMethodBadgeText.textContent = view.method === "model" ? "AI" : view.method === "fallback" ? "Rule" : "—";
	}
	if (elements.settingsMemoryMethodBar) {
		elements.settingsMemoryMethodBar.style.width = view.method !== "none" ? "100%" : "0%";
		elements.settingsMemoryMethodBar.dataset.method = view.method;
	}

	if (elements.settingsMemoryError) {
		elements.settingsMemoryError.hidden = !view.failure;
		elements.settingsMemoryError.textContent = view.failure ? uiText("settingsMemoryFailure", { message: view.failure }) : "";
	}
	const runHintKey = !connected ? "settingsMemoryRunConnectHint" : busy ? "settingsMemoryRunBusyHint" : !view.enabled ? "settingsMemoryRunEnableHint" : view.pendingJobs ? "settingsMemoryRunPendingHint" : "settingsMemoryRunReadyHint";
	setText(elements.settingsMemoryRunHint, uiText(runHintKey, { pending: view.pendingJobs }));
	if (elements.settingsMemoryRun) elements.settingsMemoryRun.disabled = !connected || busy || !view.enabled || memoryRunPending;
}

function renderPreferencesControls() {
	if (!elements.settingsDialog) return;
	const connected = Boolean(state.serverConnected && state.session);
	const busy = Boolean(state.session?.isStreaming || state.session?.isCompacting);
	const disableAgentControl = !connected || busy;

	if (elements.settingsLanguageSelect) {
		for (const language of UI_LANGUAGES) {
			let option = elements.settingsLanguageSelect.querySelector(`option[value="${language}"]`);
			if (!option) {
				option = document.createElement("option");
				option.value = language;
				elements.settingsLanguageSelect.append(option);
			}
			option.textContent = language === "auto" ? uiText("automatic") : (NATIVE_LANGUAGE_NAMES[language] || language);
		}
		elements.settingsLanguageSelect.value = state.uiLanguage;
	}

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
			elements.settingsModelSelect.disabled = disableAgentControl;
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
			for (const level of levels) {
				const option = document.createElement("option");
				option.value = level;
				option.textContent = thinkingLabel(level);
				option.selected = level === state.session?.thinkingLevel;
				elements.settingsThinkingSelect.append(option);
			}
			elements.settingsThinkingSelect.disabled = disableAgentControl;
		}
	}

	if (elements.settingsDefaultModelSelect) {
		elements.settingsDefaultModelSelect.replaceChildren();
		const automatic = document.createElement("option");
		automatic.value = "";
		automatic.textContent = uiText("settingsNoDefault");
		elements.settingsDefaultModelSelect.append(automatic);
		for (const [index, model] of state.models.entries()) {
			const option = document.createElement("option");
			option.value = String(index);
			option.textContent = `${modelLabel(model)} · ${model.provider}`;
			option.selected = model.provider === state.defaults?.provider && model.id === state.defaults?.modelId;
			elements.settingsDefaultModelSelect.append(option);
		}
		elements.settingsDefaultModelSelect.disabled = !connected;
	}

	if (elements.settingsDefaultThinkingSelect) {
		elements.settingsDefaultThinkingSelect.replaceChildren();
		const automatic = document.createElement("option");
		automatic.value = "";
		automatic.textContent = uiText("settingsNoDefault");
		elements.settingsDefaultThinkingSelect.append(automatic);
		for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
			const option = document.createElement("option");
			option.value = level;
			option.textContent = thinkingLabel(level);
			option.selected = level === state.defaults?.thinkingLevel;
			elements.settingsDefaultThinkingSelect.append(option);
		}
		elements.settingsDefaultThinkingSelect.disabled = !connected;
	}

	if (elements.settingsAutoCompactInput) {
		elements.settingsAutoCompactInput.checked = Boolean(state.session?.autoCompactionEnabled);
		elements.settingsAutoCompactInput.disabled = disableAgentControl;
	}
	if (elements.settingsAutoRetryInput) {
		elements.settingsAutoRetryInput.checked = Boolean(state.session?.autoRetryEnabled);
		elements.settingsAutoRetryInput.disabled = disableAgentControl;
	}
	const security = state.security;
	const populateProviders = (select, providers) => {
		if (!select) return;
		select.replaceChildren();
		for (const provider of providers || []) {
			const option = document.createElement("option");
			option.value = provider;
			option.textContent = provider;
			select.append(option);
		}
		if (!select.options.length) select.append(new Option(uiText("noAvailableItems"), ""));
		select.disabled = disableAgentControl || !providers?.length;
	};
	if (elements.settingsTrustSelect) {
		elements.settingsTrustSelect.value = security?.trust?.decision === true ? "trusted" : security?.trust?.decision === false ? "untrusted" : "clear";
		elements.settingsTrustSelect.disabled = disableAgentControl;
	}
	populateProviders(elements.settingsOauthProvider, security?.login?.oauthProviders);
	populateProviders(elements.settingsApiKeyProvider, security?.login?.providers);
	populateProviders(elements.settingsLogoutProvider, security?.logout?.providers);
	if (elements.settingsOauthLoginButton) elements.settingsOauthLoginButton.disabled = elements.settingsOauthProvider?.disabled ?? true;
	if (elements.settingsApiKeySaveButton) elements.settingsApiKeySaveButton.disabled = disableAgentControl;
	if (elements.settingsApiKeyInput) elements.settingsApiKeyInput.disabled = disableAgentControl;
	if (elements.settingsLogoutButton) elements.settingsLogoutButton.disabled = elements.settingsLogoutProvider?.disabled ?? true;
	if (elements.settingsSessionNameInput) elements.settingsSessionNameInput.value = state.session?.sessionName || "";
	if (elements.settingsSteeringModeSelect) {
		elements.settingsSteeringModeSelect.value = state.session?.steeringMode || "one-at-a-time";
		elements.settingsSteeringModeSelect.disabled = disableAgentControl;
	}
	if (elements.settingsFollowUpModeSelect) {
		elements.settingsFollowUpModeSelect.value = state.session?.followUpMode || "one-at-a-time";
		elements.settingsFollowUpModeSelect.disabled = disableAgentControl;
	}
	if (elements.settingsMemoryInput) {
		elements.settingsMemoryInput.checked = Boolean(state.memoryState?.enabled);
		elements.settingsMemoryInput.disabled = disableAgentControl;
	}
	renderMemoryStatus();
	if (elements.settingsMemorySearch) elements.settingsMemorySearch.disabled = disableAgentControl || !state.memoryState?.enabled;
	if (elements.settingsMemoryReset) elements.settingsMemoryReset.disabled = disableAgentControl || !state.memoryState?.enabled;
	renderWorkflowControls();
	renderInstructionSources();

	if (elements.settingsServerStatus) {
		elements.settingsServerStatus.classList.toggle("connected", state.serverConnected);
		const label = elements.settingsServerStatus.querySelector("b");
		if (label) label.textContent = state.serverConnected ? uiText("connected") : uiText("disconnected");
	}
	if (elements.settingsServerAddress) {
		elements.settingsServerAddress.textContent = document.querySelector("#serverUrlInput")?.value || "http://127.0.0.1:4096";
	}
}

async function refreshPreferencesDetails() {
	renderPreferencesControls();
	try {
		const [appInfo, workspace, defaults, trust, login, logout] = await Promise.all([
			desktop.appInfo(), desktop.workspace.get(),
			state.serverConnected ? requestServer("/settings/defaults") : Promise.resolve(undefined),
			state.serverConnected ? requestServer("/session/command", "POST", { command: "/trust" }) : Promise.resolve(undefined),
			state.serverConnected ? requestServer("/session/command", "POST", { command: "/login" }) : Promise.resolve(undefined),
			state.serverConnected ? requestServer("/session/command", "POST", { command: "/logout" }) : Promise.resolve(undefined),
		]);
		state.defaults = defaults;
		state.security = { trust, login, logout };
		state.customProviders = await desktop.providerConfig.listCustom();
		refreshCustomProviderForm();
		renderPreferencesControls();
		state.platform = appInfo.platform;
		if (elements.settingsAppVersion) elements.settingsAppVersion.textContent = `v${appInfo.version}`;
		if (elements.settingsPlatform) elements.settingsPlatform.textContent = platformDisplayName(appInfo.platform);
		if (elements.settingsWorkspaceName) elements.settingsWorkspaceName.textContent = workspace.name || uiText("currentWorkspace");
		if (elements.settingsWorkspacePath) elements.settingsWorkspacePath.textContent = workspace.path || uiText("noWorkspace");
	} catch (error) {
		if (elements.settingsWorkspacePath) elements.settingsWorkspacePath.textContent = error.message;
	}
}

function refreshCustomProviderForm() {
	const select = elements.settingsCustomProviderSelect;
	if (!select) return;
	const previous = select.value;
	select.replaceChildren(new Option(uiText("newCustomProvider"), ""));
	for (const provider of state.customProviders) select.append(new Option(`${provider.name} (${provider.provider})`, provider.provider));
	select.value = state.customProviders.some((provider) => provider.provider === previous) ? previous : "";
	const provider = state.customProviders.find((item) => item.provider === select.value);
	if (elements.settingsCustomProviderName) elements.settingsCustomProviderName.value = provider?.name || "";
	if (elements.settingsCustomBaseUrl) elements.settingsCustomBaseUrl.value = provider?.baseUrl || "";
	if (elements.settingsCustomModelIds) elements.settingsCustomModelIds.value = (provider?.modelIds || []).join(", ");
	if (elements.settingsCustomProviderReasoning) elements.settingsCustomProviderReasoning.checked = provider?.reasoning !== false;
}

async function updatePreferencesSession(patch, feedbackElement) {
	if (!state.serverConnected) {
		setPreferencesFeedback(feedbackElement, uiText("connectServerFirst"), true);
		return;
	}
	setPreferencesFeedback(feedbackElement, uiText("saving"));
	try {
		state.session = await requestServer("/session/settings", "PUT", patch);
		renderPreferencesControls();
		setPreferencesFeedback(feedbackElement, uiText("savedAndApplied"));
	} catch (error) {
		renderPreferencesControls();
		setPreferencesFeedback(feedbackElement, error.message, true);
	}
}

async function runPreferencesCommand(command, feedbackElement, { sync = false } = {}) {
	if (!state.serverConnected) {
		setPreferencesFeedback(feedbackElement, uiText("connectServerFirst"), true);
		return;
	}
	setPreferencesFeedback(feedbackElement, uiText("applying"));
	try {
		const result = await requestServer("/session/command", "POST", { command });
		if (sync) {
			await syncServerSession({ loadModels: true, refreshConversations: false });
			await refreshPreferencesDetails();
		}
		renderPreferencesControls();
		setPreferencesFeedback(feedbackElement, result.message || uiText("completed"));
	} catch (error) {
		setPreferencesFeedback(feedbackElement, error.message, true);
	}
}

function showPreferencesDialog() {
	if (!elements.settingsDialog?.open) elements.settingsDialog.showModal();
	selectPreferencesPanel("general");
	void refreshPreferencesDetails();
	elements.settingsDialog.focus();
}

function hidePreferencesDialog() {
	if (elements.settingsDialog?.open) elements.settingsDialog.close();
}

function activeProject() {
	return state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0];
}

function projectDisplayName(project) {
	return String(project?.displayName || project?.name || "").trim();
}

function defaultProjectHue(project) {
	let hash = 0;
	const source = String(project?.id || project?.name || "");
	for (let index = 0; index < source.length; index += 1) {
		hash = (hash << 5) - hash + source.charCodeAt(index);
		hash |= 0;
	}
	return ((hash % 360) + 360) % 360;
}

function projectAccentInk(color) {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || "");
	if (!match) return "#26303a";
	const [, red, green, blue] = match.map((part, index) => index ? Number.parseInt(part, 16) : part);
	return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#26303a" : "#ffffff";
}

function projectAccentFromHue(value) {
	const hue = ((Number(value) % 360) + 360) % 360;
	const saturation = 0.68;
	const lightness = 0.68;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const segment = hue / 60;
	const offset = chroma * (1 - Math.abs((segment % 2) - 1));
	const [red, green, blue] = segment < 1 ? [chroma, offset, 0]
		: segment < 2 ? [offset, chroma, 0]
			: segment < 3 ? [0, chroma, offset]
				: segment < 4 ? [0, offset, chroma]
					: segment < 5 ? [offset, 0, chroma]
						: [chroma, 0, offset];
	const match = lightness - chroma / 2;
	return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function projectHueFromAccent(color, fallbackHue) {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || "");
	if (!match) return fallbackHue;
	const [red, green, blue] = match.slice(1).map((channel) => Number.parseInt(channel, 16) / 255);
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	if (!delta) return fallbackHue;
	const hue = max === red ? 60 * (((green - blue) / delta) % 6)
		: max === green ? 60 * ((blue - red) / delta + 2)
			: 60 * ((red - green) / delta + 4);
	return Math.round((hue + 360) % 360);
}

function updateProjectCustomizePreview(color, nameOverride) {
	const project = state.projects.find((candidate) => candidate.id === customizingProjectId);
	const projectButton = customizingProjectButton?.closest(".project-rail-entry")?.querySelector(".project-rail-item");
	if (!project || !projectButton) return;
	const customColor = /^#[0-9a-f]{6}$/i.test(color || "") ? color : undefined;
	const previewColor = customColor || `hsl(${defaultProjectHue(project)} 72% 72%)`;
	elements.projectColorInput?.style.setProperty("--project-slider-color", previewColor);
	projectButton.classList.toggle("has-custom-color", Boolean(customColor));
	if (customColor) {
		projectButton.style.setProperty("--project-custom-color", customColor);
		projectButton.style.setProperty("--project-custom-ink", projectAccentInk(customColor));
	} else {
		projectButton.style.removeProperty("--project-custom-color");
		projectButton.style.removeProperty("--project-custom-ink");
	}
	const draftName = String(nameOverride ?? (elements.projectDisplayNameInput?.value.trim() || projectDisplayName(project)));
	projectButton.title = draftName;
	projectButton.setAttribute("aria-label", draftName);
	const initial = projectButton.querySelector(".project-rail-initial");
	if (initial) initial.textContent = draftName.slice(0, 1).toLocaleUpperCase() || "•";
}

function isProjectCustomizationOpen() {
	return Boolean(elements.projectCustomizePopover?.matches(":popover-open"));
}

function positionProjectCustomization(anchor = customizingProjectButton) {
	const popover = elements.projectCustomizePopover;
	if (!anchor?.isConnected || !popover || !isProjectCustomizationOpen()) return;
	const anchorBounds = anchor.closest(".project-rail-entry")?.getBoundingClientRect() || anchor.getBoundingClientRect();
	const popoverBounds = popover.getBoundingClientRect();
	const gap = 6;
	const preferredLeft = anchorBounds.right + gap;
	const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - popoverBounds.width - 12));
	const top = Math.max(12, Math.min(anchorBounds.top - 12, window.innerHeight - popoverBounds.height - 12));
	popover.style.left = `${Math.round(left)}px`;
	popover.style.top = `${Math.round(top)}px`;
	popover.style.setProperty("--project-popover-arrow-y", `${Math.round(Math.max(20, Math.min(anchorBounds.top + anchorBounds.height / 2 - top, popoverBounds.height - 20)))}px`);
}

function openProjectCustomization(project, anchor) {
	if (!project || !elements.projectCustomizePopover) return;
	if (isProjectCustomizationOpen() && customizingProjectButton === anchor) {
		closeProjectCustomization();
		anchor.focus();
		return;
	}
	if (isProjectCustomizationOpen()) closeProjectCustomization();
	if (customizingProjectButton && customizingProjectButton !== anchor) customizingProjectButton.setAttribute("aria-expanded", "false");
	customizingProjectId = project.id;
	customizingProjectButton = anchor;
	customizingProjectButton?.setAttribute("aria-expanded", "true");
	elements.projectDisplayNameInput.value = projectDisplayName(project);
	elements.projectColorInput.value = String(projectHueFromAccent(project.accentColor, defaultProjectHue(project)));
	updateProjectCustomizePreview(project.accentColor);
	if (!isProjectCustomizationOpen()) elements.projectCustomizePopover.showPopover();
	positionProjectCustomization(anchor);
	requestAnimationFrame(() => {
		elements.projectDisplayNameInput.focus();
		elements.projectDisplayNameInput.select();
	});
}

function closeProjectCustomization() {
	const project = state.projects.find((candidate) => candidate.id === customizingProjectId);
	if (isProjectCustomizationOpen()) elements.projectCustomizePopover.hidePopover();
	customizingProjectButton?.setAttribute("aria-expanded", "false");
	customizingProjectId = undefined;
	customizingProjectButton = undefined;
	if (project) applyProjectDetails(project.id === state.activeProjectId ? project : activeProject());
}

function persistProjectCustomization({ name = false, color = false } = {}) {
	const project = state.projects.find((candidate) => candidate.id === customizingProjectId);
	if (!project) return;
	if (name) {
		const nextName = elements.projectDisplayNameInput.value.trim().slice(0, 80);
		project.displayName = nextName && nextName !== project.name ? nextName : undefined;
	}
	if (color) project.accentColor = projectAccentFromHue(elements.projectColorInput.value);
	saveProjectState();
	updateProjectCustomizePreview(project.accentColor, projectDisplayName(project));
	if (project.id === state.activeProjectId) {
		elements.fileRootName.textContent = projectDisplayName(project);
		elements.conversationSidebarTitle.textContent = projectDisplayName(project);
		elements.projectSwitchLabel.textContent = projectDisplayName(project);
		const channelNameEl = document.querySelector("#currentProjectChannelName");
		if (channelNameEl) channelNameEl.textContent = projectDisplayName(project);
	}
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

function initializeProjectState(fallbackWorkspace) {
	if (projectStateInitialized) return;
	const restored = window.metisDesktopConversations.restoreProjectState(
		localStorage.getItem(PROJECT_STATE_KEY),
		fallbackWorkspace,
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
	elements.fileRootName.textContent = projectDisplayName(project);
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

function shortenProjectPath(rawPath) {
	const value = String(rawPath || "");
	const home = /^(\/Users\/[^/]+|\/home\/[^/]+)(?=\/|$)/.exec(value);
	return home ? `~${value.slice(home[1].length)}` : value;
}

function renderProjectSwitchOptions() {
	elements.projectSwitchOptions.replaceChildren();
	if (elements.projectSwitchCount) elements.projectSwitchCount.textContent = String(state.projects.length);
	for (const project of state.projects) {
		const selected = project.id === state.activeProjectId;
		const option = document.createElement("button");
		option.type = "button";
		option.className = "project-switch-option";
		option.setAttribute("role", "menuitemradio");
		option.setAttribute("aria-checked", String(selected));
		option.title = project.path;

		const displayName = projectDisplayName(project);
		const avatar = document.createElement("span");
		avatar.className = "project-switch-avatar";
		avatar.setAttribute("aria-hidden", "true");
		avatar.style.setProperty("--project-rainbow-hue", String(defaultProjectHue(project)));
		if (project.accentColor) {
			avatar.classList.add("has-custom-color");
			avatar.style.setProperty("--project-custom-color", project.accentColor);
			avatar.style.setProperty("--project-custom-ink", projectAccentInk(project.accentColor));
		}
		avatar.textContent = displayName.slice(0, 1).toLocaleUpperCase() || "•";
		option.append(avatar);

		const copy = document.createElement("span");
		const name = document.createElement("strong");
		name.textContent = displayName;
		const projectPath = document.createElement("small");
		projectPath.textContent = shortenProjectPath(project.path);
		projectPath.dir = "ltr";
		copy.append(name, projectPath);
		option.append(copy);

		const mark = document.createElement("span");
		mark.className = "project-switch-mark";
		mark.setAttribute("aria-hidden", "true");
		if (selected) mark.append(icon("check"));
		option.append(mark);

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
	if (!Array.isArray(result?.sessions)) throw new Error(uiText("syncFailed"));
	const sessions = result.sessions;
	const previousTokenTotals = new Map(project.conversations.map((conversation) => [conversation.sessionPath, conversation.tokenTotal]));
	project.conversations = window.metisDesktopConversations.fromSessions(sessions, uiText("untitledTask"));
	for (const conversation of project.conversations) {
		const tokenTotal = Number(previousTokenTotals.get(conversation.sessionPath));
		if (Number.isFinite(tokenTotal) && tokenTotal > 0) conversation.tokenTotal = tokenTotal;
	}
	project.conversationLoadError = undefined;
	if (state.session && (window.metisDesktopConversations.normalizeProjectPath(state.session.cwd) === window.metisDesktopConversations.normalizeProjectPath(project.path))) {
		upsertServerConversation(state.session);
	}
	if (project.lastSessionPath && !project.conversations.some((item) => item.sessionPath === project.lastSessionPath)) {
		project.lastSessionPath = undefined;
	}
	saveProjectState();
	void hydrateProjectConversationTokenTotals(project);
}

async function hydrateProjectConversationTokenTotals(project) {
	if ((!desktop.sessionTokens?.activity && !desktop.sessionTokens?.totals) || !project?.conversations?.length) return;
	const sessionPaths = project.conversations.map((conversation) => conversation.sessionPath).filter(Boolean);
	if (!sessionPaths.length) return;
	const generation = (project.tokenTotalsGeneration || 0) + 1;
	project.tokenTotalsGeneration = generation;
	try {
		const activity = desktop.sessionTokens.activity
			? await desktop.sessionTokens.activity(sessionPaths)
			: { totals: await desktop.sessionTokens.totals(sessionPaths), dailyTokens: {} };
		if (project.tokenTotalsGeneration !== generation) return;
		const totals = activity?.totals || {};
		let changed = false;
		for (const conversation of project.conversations) {
			const tokenTotal = Number(totals?.[conversation.sessionPath]);
			if (!Number.isFinite(tokenTotal) || tokenTotal < 0 || tokenTotal === conversation.tokenTotal) continue;
			conversation.tokenTotal = tokenTotal;
			changed = true;
		}
		project.tokenActivity = {
			tokenTotal: Number(activity?.tokenTotal) || Object.values(totals).reduce((total, value) => total + (Number(value) || 0), 0),
			dailyTokens: activity?.dailyTokens && typeof activity.dailyTokens === "object" ? activity.dailyTokens : {},
		};
		if (changed) saveProjectState();
		if (project.id === state.activeProjectId) renderConversations();
	} catch {
		// Token trails are decorative; conversation loading must not fail when a local file is unavailable.
	}
}

async function refreshAllProjectConversations() {
	await Promise.all(state.projects.map(async (project) => {
		try {
			await loadProjectConversations(project);
		} catch (error) {
			project.conversationLoadError = error.message;
		}
	}));
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

function updateProjectPanelConnector() {
	const sidebar = document.querySelector('[data-purpose="icon-sidebar"]');
	const activeEntry = elements.projectList?.querySelector(".project-rail-entry.active");
	if (!sidebar || !activeEntry) {
		sidebar?.classList.remove("has-project-connector");
		const connector = sidebar?.querySelector(":scope > .project-panel-connector");
		if (connector) connector.hidden = true;
		return;
	}
	let connector = sidebar.querySelector(":scope > .project-panel-connector");
	if (!connector) {
		connector = document.createElement("span");
		connector.className = "project-panel-connector";
		connector.setAttribute("aria-hidden", "true");
		sidebar.insertBefore(connector, sidebar.lastElementChild);
	}
	const sidebarBounds = sidebar.getBoundingClientRect();
	const activeBounds = activeEntry.getBoundingClientRect();
	const connectorY = Math.round(activeBounds.top + activeBounds.height / 2 - sidebarBounds.top);
	sidebar.style.setProperty("--project-connector-y", `${connectorY}px`);
	sidebar.classList.add("has-project-connector");
	connector.hidden = false;
}

function renderConversations() {
	const projectRailSignature = JSON.stringify([
		resolveUiLanguage(),
		state.activeProjectId,
		...state.projects.map((project) => [
			project.id,
			projectDisplayName(project),
			project.accentColor || "",
		]),
	]);
	const shouldRenderProjectRail = elements.projectList.dataset.renderSignature !== projectRailSignature;
	if (shouldRenderProjectRail) {
		elements.projectList.replaceChildren();
		elements.projectList.dataset.renderSignature = projectRailSignature;
	}
	elements.conversationList.replaceChildren();
	if (!state.projects.length) {
		if (shouldRenderProjectRail) {
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
			elements.projectList.append(empty);
		}
		elements.conversationSidebarTitle.textContent = uiText("conversations");
		renderDreamTokenActivity();
		updateProjectPanelConnector();
		return;
	}

	if (shouldRenderProjectRail) for (const project of state.projects) {
		const isActiveProject = project.id === state.activeProjectId;
		const entry = document.createElement("div");
		entry.className = `project-rail-entry${isActiveProject ? " active" : ""}`;

		const displayName = projectDisplayName(project);
		const rainbowHue = defaultProjectHue(project);

		const projectButton = document.createElement("button");
		projectButton.type = "button";
		projectButton.className = "project-rail-item";
		projectButton.title = displayName;
		projectButton.setAttribute("aria-label", displayName);
		projectButton.style.setProperty("--project-rainbow-hue", String(rainbowHue));
		if (project.accentColor) {
			projectButton.classList.add("has-custom-color");
			projectButton.style.setProperty("--project-custom-color", project.accentColor);
			projectButton.style.setProperty("--project-custom-ink", projectAccentInk(project.accentColor));
		}
		projectButton.append(icon(isActiveProject ? "folder-open" : "folder"));
		const projectInitial = document.createElement("span");
		projectInitial.className = "project-rail-initial";
		projectInitial.textContent = displayName.slice(0, 1).toLocaleUpperCase() || "•";
		projectButton.append(projectInitial);
		projectButton.addEventListener("click", () => {
			if (!isActiveProject) void activateProject(project);
		});
		entry.append(projectButton);

		const customizeButton = document.createElement("button");
		customizeButton.type = "button";
		customizeButton.className = "project-rail-customize";
		customizeButton.title = uiText("customizeProject");
		customizeButton.setAttribute("aria-label", uiText("customizeProject"));
		customizeButton.setAttribute("aria-haspopup", "dialog");
		customizeButton.setAttribute("aria-expanded", "false");
		customizeButton.setAttribute("aria-controls", "projectCustomizePopover");
		customizeButton.append(icon("more"));
		customizeButton.addEventListener("click", (e) => {
			e.stopPropagation();
			openProjectCustomization(project, customizeButton);
		});
		entry.append(customizeButton);
		elements.projectList.append(entry);
	}

	const activeProject = state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0];
	elements.conversationSidebarTitle.textContent = projectDisplayName(activeProject);
	const channelNameEl = document.querySelector("#currentProjectChannelName");
	if (channelNameEl) channelNameEl.textContent = projectDisplayName(activeProject);
	const visibleConversations = window.metisDesktopConversations.sortConversationsByCreatedAt(activeProject.conversations);
	if (activeProject.conversationLoadError && state.serverConnected) {
		const error = document.createElement("div");
		error.className = "conversations-load-error";
		error.textContent = activeProject.conversationLoadError;
		elements.conversationList.append(error);
	}
function formatRelativeTime(dateInput) {
	if (!dateInput) return "";
	const date = new Date(dateInput);
	if (isNaN(date.getTime())) return "";
	const now = new Date();
	const diffMs = Math.max(0, now.getTime() - date.getTime());
	const diffSec = Math.floor(diffMs / 1000);
	if (diffSec < 60) return "1m";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m`;
	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) return `${diffHour}h`;
	const diffDay = Math.floor(diffHour / 24);
	if (diffDay < 30) return `${diffDay}d`;
	const diffWeek = Math.floor(diffDay / 7);
	if (diffWeek < 52) return `${diffWeek}w`;
	const diffYear = Math.floor(diffDay / 365);
	return `${diffYear}y`;
}

	for (const conversation of visibleConversations) {
		const button = document.createElement("button");
		let tokenTrail;
		const isActive = conversation.id === state.activeConversationId;
		button.className = `conversation-item${isActive ? " active" : ""}`;

		const label = document.createElement("span");
		const isNaming = conversation.title === uiText("namingTitle") || (isActive && Boolean(state.session?.isGeneratingSessionName));
		const isUntitled = conversation.title === uiText("untitledTask") || isNaming;
		label.className = `conversation-label${isNaming ? " working-shimmer" : ""}`;
		label.textContent = conversation.title;
		button.append(label);

		if (conversationTokenComet && !isUntitled) {
			const activeTokenTotal = isActive ? conversationTokenComet.conversationTokenTotal(state.messages) : 0;
			if (activeTokenTotal > 0) conversation.tokenTotal = activeTokenTotal;
			button.classList.add("has-token-trail");
			tokenTrail = createConversationTokenTrail(conversation.tokenTotal, {
				conversationId: conversation.id,
			});
			button.append(tokenTrail);
		}

		const right = document.createElement("span");
		right.className = "conversation-time";
		if (isActive && state.isStreaming) {
			const spinner = document.createElement("span");
			spinner.className = "conversation-spinner";
			right.append(spinner);
		} else {
			const timeStr = formatRelativeTime(conversation.updatedAt);
			if (timeStr) {
				right.textContent = timeStr;
			} else if (conversation.branch) {
				right.append(icon("branch"));
			}
		}
		button.append(right);

		button.addEventListener("click", () => selectConversation(activeProject, conversation));
		elements.conversationList.append(button);
	}
	if (!activeProject.conversations.length && !activeProject.conversationLoadError) {
		const empty = document.createElement("div");
		empty.className = "conversations-empty-state";
		empty.append(icon("chat"));
		const text = document.createElement("span");
		text.textContent = uiText("noConversations");
		empty.append(text);
		elements.conversationList.append(empty);
	}
	renderDreamTokenActivity(activeProject);
	updateProjectPanelConnector();
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
		await activateProject(project, {
			targetSessionPath: conversation.sessionPath,
			record,
			forceNewConversation: false,
		});
		return;
	}
	state.activeConversationId = conversation.id;
	if (record) recordNavigation(conversation.id);
	updateHeadingTitle(conversation.title, conversation.title === uiText("namingTitle") || (conversation.id === state.session?.sessionId && Boolean(state.session?.isGeneratingSessionName)));
	renderConversations();
	if (state.serverConnected && conversation.sessionPath && conversation.sessionPath !== state.session?.sessionFile) {
		const finishConversationLoading = beginScopedLoading(
			elements.conversationViewLoading,
			elements.messageScroll,
			elements.conversationViewLoadingLabel,
			uiText("switchingSession"),
		);
		try {
			await requestServer("/session/switch", "POST", { sessionPath: conversation.sessionPath });
			await syncServerSession({ loadModels: false, refreshConversations: false });
			project.lastSessionPath = conversation.sessionPath;
			saveProjectState();
		} catch (error) {
			appendAssistantNotice(error.message, uiText("sessionSwitchFailed"));
		} finally {
			finishConversationLoading();
		}
	}
	elements.composerInput.focus();
}

async function createConversation() {
	if (!state.serverConnected) {
		elements.serverDialog.showModal();
		return;
	}
	// Paint the empty conversation before the round-trip, the way selectConversation() moves the
	// sidebar highlight before awaiting /session/switch. Without this the previous transcript and
	// its sidebar row stay on screen for the whole POST + sync, which is why creating a
	// conversation felt laggy while switching felt instant — the server work is the same 2-4 ms.
	state.activeConversationId = undefined;
	state.messages = [];
	state.messageTimings = {};
	state.hasSubmittedMessage = false;
	updateHeadingTitle(uiText("untitledTask"), false);
	renderServerMessages(state.messages);
	renderEmptyState(true);
	renderConversations();
	try {
		await requestServer("/session/new", "POST", { cwd: activeProject()?.path, collaborationMode: "plan" });
		await syncServerSession({ loadModels: false, refreshConversations: false });
	} catch (error) {
		appendAssistantNotice(error.message, uiText("createFailed"));
	}
	elements.composerInput.focus();
}

async function alignNewConversationWithActiveProject() {
	const project = activeProject();
	if (!project?.path) return;
	const projectPath = window.metisDesktopConversations.normalizeProjectPath(project.path);
	const sessionPath = window.metisDesktopConversations.normalizeProjectPath(state.session?.cwd);
	if (sessionPath === projectPath) return;

	// The localhost server owns one active session. If another Desktop client or a stale
	// connection changed it, never submit this project's first prompt into that foreign session:
	// the JSONL would be persisted, but under the wrong project and disappear from this list.
	await requestServer("/session/new", "POST", {
		cwd: project.path,
		collaborationMode: "plan",
	});
	await syncServerSession({ loadModels: false, refreshConversations: false });
}

async function activateProject(project, {
	targetSessionPath,
	record = true,
	loadModels = true,
	forceNewConversation = true,
	syncSession = true,
} = {}) {
	if (!project || projectSwitchInProgress) return;
	projectSwitchInProgress = true;
	const finishProjectLoading = beginScopedLoading(
		elements.conversationListLoading,
		elements.channelListPane,
		elements.conversationListLoadingLabel,
		uiText("switchingProject"),
	);
	for (const candidate of state.projects) candidate.collapsed = candidate.id !== project.id;
	state.activeProjectId = project.id;
	state.activeConversationId = undefined;
	saveProjectState();
	applyProjectDetails(project);

	try {
		await setWorkspaceChecked(project.path);
		await refreshFileTree();
		if (!state.serverConnected) return;

		await loadProjectConversations(project);
		renderConversations();
		if (!syncSession) return;
		if (forceNewConversation) {
			state.messages = [];
			state.messageTimings = {};
			state.hasSubmittedMessage = false;
			updateHeadingTitle(uiText("untitledTask"), false);
			renderServerMessages(state.messages);
			renderEmptyState(true);
			renderConversations();
		}
		const currentSession = await requestServer("/session");
		const currentCwd = window.metisDesktopConversations.normalizeProjectPath(currentSession.cwd);
		if (forceNewConversation) {
			await requestServer("/session/new", "POST", { cwd: project.path, collaborationMode: "plan" });
		} else {
			const destination = targetSessionPath
				|| project.lastSessionPath
				|| project.conversations[0]?.sessionPath;

			if (destination && destination !== currentSession.sessionFile) {
				await requestServer("/session/switch", "POST", { sessionPath: destination });
			} else if (!destination || currentCwd !== project.path) {
				await requestServer("/session/new", "POST", { cwd: project.path, collaborationMode: "plan" });
			}
		}
		// loadProjectConversations() above already fetched this project's listing.
		await syncServerSession({ loadModels, refreshConversations: false });
		if (record && state.activeConversationId) recordNavigation(state.activeConversationId);
	} catch (error) {
		appendAssistantNotice(error.message, uiText("projectSwitchFailed"));
	} finally {
		projectSwitchInProgress = false;
		setStreamingState(Boolean(state.session?.isStreaming));
		renderConversations();
		finishProjectLoading();
	}
}

async function loadWorkspace(select = false) {
	try {
		if (select) {
			const workspace = await desktop.workspace.select();
			if (!workspace) return;
			initializeProjectState();
			const project = ensureProject(workspace);
			if (!project) return;

			await activateProject(project);
			return;
		}

		const workspace = await desktop.workspace.get();
		initializeProjectState(workspace);
		if (!state.projects.length) {
			renderConversations();
			return;
		}

		const selectedProject = activeProject();
		if (!selectedProject) return;
		state.activeProjectId = selectedProject.id;
		try {
			await setWorkspaceChecked(selectedProject.path);
		} catch (error) {
			if (!String(error?.message || "").includes("Workspace directory does not exist")) throw error;
			state.projects = state.projects.filter((item) => item.path !== selectedProject.path);
			saveProjectState();
			if (state.projects.length) {
				void activateProject(state.projects[0]);
			} else {
				renderConversations();
			}
			return;
		}
		applyProjectDetails(selectedProject);
		await refreshFileTree();
	} catch (error) {
		elements.fileTree.textContent = uiText("workspaceReadError", { message: error.message });
	}
}

async function requestServer(path, method = "GET", body, options = {}) {
	const result = await desktop.metis.request({ path, method, body, timeoutMs: options.timeoutMs });
	if (!result.ok) {
		const message = result.data?.error?.message || result.error || uiText("serverHttpError", { status: result.status || 0 });
		throw new Error(message);
	}
	return result.data;
}

let skillCatalogRequest;

function skillCatalogKey() {
	return `${state.session?.sessionId || "session"}:${state.session?.cwd || activeProject()?.path || "workspace"}`;
}

function closeSkillMenu() {
	const menu = elements.composerSkillMenu;
	if (!menu) return;
	menu.hidden = true;
	menu.setAttribute("aria-hidden", "true");
	elements.composerInput.removeAttribute("aria-activedescendant");
}

function setActiveSkillIndex(index) {
	const options = [...(elements.composerSkillMenu?.querySelectorAll("[role=option]") || [])];
	if (options.length === 0) return;
	state.activeSkillIndex = (index + options.length) % options.length;
	options.forEach((option, optionIndex) => option.setAttribute("aria-selected", String(optionIndex === state.activeSkillIndex)));
	const active = options[state.activeSkillIndex];
	elements.composerInput.setAttribute("aria-activedescendant", active.id);
	active.scrollIntoView?.({ block: "nearest" });
}

function selectSkillOption(index = state.activeSkillIndex) {
	const option = elements.composerSkillMenu?.querySelectorAll("[role=option]")?.[index];
	const skill = state.skillCommands.find((item) => item.name === option?.dataset.skillName);
	const trigger = skillComposer.currentTrigger(elements.composerInput);
	if (!skill || !trigger || !skillComposer.insertSkill(elements.composerInput, skill, trigger)) return false;
	closeSkillMenu();
	elements.composerInput.focus();
	autoSizeComposer();
	return true;
}

function renderSkillMenu(skills) {
	const menu = elements.composerSkillMenu;
	if (!menu) return;
	menu.replaceChildren();
	if (skills.length === 0) {
		closeSkillMenu();
		return;
	}

	for (const [index, skill] of skills.entries()) {
		const option = document.createElement("button");
		option.type = "button";
		option.id = `composerSkillOption-${index}`;
		option.className = "composer-skill-option";
		option.dataset.skillName = skill.name;
		option.setAttribute("role", "option");
		option.setAttribute("aria-selected", "false");
		option.append(icon("skill", "composer-skill-option-icon"));
		const copy = document.createElement("span");
		copy.className = "composer-skill-option-copy";
		const label = document.createElement("strong");
		label.textContent = skill.label;
		const description = document.createElement("small");
		description.textContent = skill.description;
		copy.append(label, description);
		option.append(copy);
		option.addEventListener("pointerenter", () => setActiveSkillIndex(index));
		option.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			state.activeSkillIndex = index;
			selectSkillOption(index);
		});
		menu.append(option);
	}
	menu.hidden = false;
	menu.setAttribute("aria-hidden", "false");
	setActiveSkillIndex(Math.min(state.activeSkillIndex, skills.length - 1));
}

async function loadSkillCatalog() {
	if (!state.serverConnected) return [];
	const key = skillCatalogKey();
	if (state.skillCommandsLoadedFor === key) return state.skillCommands;
	if (skillCatalogRequest) return skillCatalogRequest;
	skillCatalogRequest = requestServer("/commands")
		.then((result) => {
			state.skillCommands = skillComposer.normalizeSkills(result?.commands);
			state.skillCommandsLoadedFor = key;
			return state.skillCommands;
		})
		.catch((error) => {
			console.warn("Unable to load Desktop skill commands", error);
			return [];
		})
		.finally(() => { skillCatalogRequest = undefined; });
	return skillCatalogRequest;
}

async function updateSkillMenu() {
	let trigger = skillComposer.currentTrigger(elements.composerInput);
	if (!trigger) {
		closeSkillMenu();
		return;
	}
	const skills = await loadSkillCatalog();
	trigger = skillComposer.currentTrigger(elements.composerInput);
	if (!trigger) {
		closeSkillMenu();
		return;
	}
	state.activeSkillIndex = 0;
	renderSkillMenu(skillComposer.filterSkills(skills, trigger.query));
}

function renderDesktopWorkStats() {
	workStatsView?.render(state.workStats, {
		locale: resolveUiLanguage(state.uiLanguage),
		text: uiText,
	});
}

async function refreshDesktopWorkStats({ force = false } = {}) {
	if (!state.serverConnected) return;
	if (!force && state.workStats && Date.now() - state.workStatsLoadedAt < 60_000) {
		renderDesktopWorkStats();
		return;
	}
	if (workStatsRequest) return workStatsRequest;
	renderDesktopWorkStats();
	workStatsRequest = requestServer("/desktop/work-stats")
		.then((stats) => {
			state.workStats = stats;
			state.workStatsLoadedAt = Date.now();
			renderDesktopWorkStats();
		})
		.catch(() => {
			const board = document.querySelector("#workInsights");
			const status = document.querySelector("#workInsightsStatus");
			board?.classList.remove("is-loading");
			if (status) status.textContent = uiText("workStatsUnavailable");
		})
		.finally(() => {
			workStatsRequest = undefined;
		});
	return workStatsRequest;
}

function updateHeadingTitle(title, isGenerating) {
	if (!elements.headingTitle) return;
	elements.headingTitle.textContent = title;
	const isNaming = title === uiText("namingTitle") || Boolean(isGenerating);
	elements.headingTitle.classList.toggle("working-shimmer", isNaming);
	updateComposerPlaceholder(title, isNaming);
}

function updateComposerPlaceholder(title, isGenerating = false) {
	const untitled = uiText("untitledTask");
	const naming = uiText("namingTitle");
	const hasConversationTitle = typeof title === "string"
		&& title.trim()
		&& title !== untitled
		&& title !== naming
		&& !isGenerating;
	const placeholder = hasConversationTitle
		? title.trim()
		: `${uiText("newTask")} · ${uiText("composerPlaceholder")}`;
	for (const input of document.querySelectorAll('[data-purpose="message-input"]')) {
		input.setAttribute("placeholder", placeholder);
	}
}

function beginScopedLoading(overlay, host, labelElement, label) {
	if (!overlay) return () => {};
	const depth = Number(overlay.dataset.loadingDepth || 0) + 1;
	overlay.dataset.loadingDepth = String(depth);
	if (labelElement && label) labelElement.textContent = label;
	overlay.setAttribute("aria-hidden", "false");
	host?.setAttribute("aria-busy", "true");
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const nextDepth = Math.max(0, Number(overlay.dataset.loadingDepth || 1) - 1);
		overlay.dataset.loadingDepth = String(nextDepth);
		if (nextDepth > 0) return;
		overlay.setAttribute("aria-hidden", "true");
		host?.removeAttribute("aria-busy");
	};
}

function conversationTokenTrailTarget(tokenTotal = 0) {
	if (!conversationTokenComet) return { band: "short", tokenTotal: 0, width: 24 };
	const total = Number.isFinite(Number(tokenTotal)) ? Math.max(0, Number(tokenTotal)) : 0;
	return { ...conversationTokenComet.tokenTrailMetrics(total), tokenTotal: total };
}

function applyConversationTokenTrailWidth(trail, targetWidth, conversationId) {
	const target = Math.round(targetWidth);
	const key = String(conversationId || "unknown");
	const previous = renderedConversationTokenTrailWidths.get(key);
	renderedConversationTokenTrailWidths.set(key, target);
	if (previous === undefined || previous === target) {
		trail.style.setProperty("--conversation-token-trail-width", `${target}px`);
		return;
	}
	trail.style.setProperty("--conversation-token-trail-width", `${previous}px`);
	requestAnimationFrame(() => {
		if (trail.isConnected) trail.style.setProperty("--conversation-token-trail-width", `${target}px`);
	});
}

function createConversationTokenTrail(tokenTotal = 0, { conversationId } = {}) {
	const metrics = conversationTokenTrailTarget(tokenTotal);
	const trail = document.createElement("span");
	trail.className = "conversation-token-trail";
	trail.setAttribute("aria-hidden", "true");
	trail.dataset.tokenBand = metrics.band;
	trail.dataset.tokenTotal = String(Math.round(metrics.tokenTotal));
	trail.dataset.renderer = "css-gradient";
	applyConversationTokenTrailWidth(trail, metrics.width, conversationId);
	return trail;
}

function refreshConversationTokenTrail(messages = state.messages) {
	const trail = elements.conversationList.querySelector(".conversation-item.active .conversation-token-trail");
	if (!trail) return;
	const project = activeProject();
	const conversation = project?.conversations.find((item) => item.id === state.activeConversationId);
	const tokenTotal = conversationTokenComet?.conversationTokenTotal(messages) || 0;
	if (conversation && tokenTotal > 0) conversation.tokenTotal = tokenTotal;
	const metrics = conversationTokenTrailTarget(conversation?.tokenTotal || tokenTotal);
	trail.dataset.tokenBand = metrics.band;
	trail.dataset.tokenTotal = String(Math.round(metrics.tokenTotal));
	applyConversationTokenTrailWidth(trail, metrics.width, conversation?.id);
}

function sessionTitle(session) {
	if (session.sessionName?.trim()) return session.sessionName.trim();
	return session.isGeneratingSessionName ? uiText("namingTitle") : uiText("untitledTask");
}

function replaceServerConversations(sessions) {
	const project = activeProject();
	if (!project) return;
	const previousTokenTotals = new Map(project.conversations.map((conversation) => [conversation.sessionPath, conversation.tokenTotal]));
	project.conversations = window.metisDesktopConversations.fromSessions(sessions, uiText("untitledTask"));
	for (const conversation of project.conversations) {
		const tokenTotal = Number(previousTokenTotals.get(conversation.sessionPath));
		if (Number.isFinite(tokenTotal) && tokenTotal > 0) conversation.tokenTotal = tokenTotal;
	}
	void hydrateProjectConversationTokenTotals(project);
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
		conversation = {
			id,
			title: sessionTitle(session),
			branch: false,
			sessionPath: sessionFile,
			createdAt: session.created || new Date().toISOString(),
		};
		project.conversations.push(conversation);
	} else {
		conversation.title = sessionTitle(session);
		conversation.sessionPath = sessionFile;
		if (sessionFile) conversation.id = sessionFile;
		if (!conversation.createdAt && session.created) conversation.createdAt = session.created;
	}
	project.conversations = window.metisDesktopConversations.sortConversationsByCreatedAt(project.conversations);

	project.collapsed = false;
	project.lastSessionPath = sessionFile;
	if (state.activeProjectId !== project.id) {
		saveProjectState();
		return;
	}
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
		files.push({ name: match[1], content: match[2], kind: "text" });
	}
	const pathRegex = /\n\n已添加(视频|文件) \`([^\`]+)\`，本地路径：\`([^\`]+)\`。[^\n]*/g;
	while ((match = pathRegex.exec(messageText)) !== null) {
		files.push({ name: match[2], path: match[3], kind: match[1] === "视频" ? "video" : "file" });
	}
	return files;
}

function cleanMessageTextOfFiles(messageText) {
	const fileRegex = /\n\n文件 \`([^\`]+)\` 的内容如下：\n\`\`\`(?:\w*\n)?([\s\S]*?)\n\`\`\`/g;
	const pathRegex = /\n\n已添加(视频|文件) \`([^\`]+)\`，本地路径：\`([^\`]+)\`。[^\n]*/g;
	return messageText.replace(fileRegex, "").replace(pathRegex, "").trim();
}

let attachmentFeedbackTimer;

function showAttachmentFeedback(message, tone = "success") {
	if (!elements.attachmentFeedback) return;
	window.clearTimeout(attachmentFeedbackTimer);
	elements.attachmentFeedback.textContent = message;
	elements.attachmentFeedback.dataset.tone = tone;
	elements.attachmentFeedback.classList.add("visible");
	attachmentFeedbackTimer = window.setTimeout(() => elements.attachmentFeedback.classList.remove("visible"), 2400);
}

function renderAttachmentPreviews() {
	if (!elements.composerAttachments) return;
	elements.composerAttachments.replaceChildren();
	
	state.attachedImages.forEach((img) => {
		const preview = document.createElement("div");
		preview.className = "attachment-preview attachment-enter";
		
		const thumb = document.createElement("img");
		thumb.src = img.src;
		thumb.alt = img.name || "Image attachment";
		
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
		preview.className = "file-preview attachment-enter";
		preview.dataset.kind = file.kind || "file";
		
		const fileIcon = icon(file.kind === "video" ? "video" : "file");
		
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

function readFile(file, method) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => resolve(reader.result), { once: true });
		reader.addEventListener("error", () => reject(reader.error || new Error(uiText("attachmentReadError", { name: file.name }))), { once: true });
		reader[method](file);
	});
}

async function resolveAttachmentPath(file) {
	try {
		const nativePath = desktop.attachments.pathForFile(file);
		if (nativePath) return nativePath;
	} catch {
		// Clipboard-created blobs may not expose a native path.
	}
	if (file.size > MAX_BUFFERED_ATTACHMENT_BYTES) throw new Error(uiText("attachmentTooLarge", { name: file.name }));
	const dataUrl = String(await readFile(file, "readAsDataURL"));
	return desktop.attachments.save({ name: file.name, mimeType: file.type, data: dataUrl.split(",")[1] || "" });
}

async function handleAttachments(files, source = "picker") {
	const pending = Array.from(files || []);
	if (pending.length === 0) return;
	elements.composer.classList.add("is-attaching");
	elements.composer.setAttribute("aria-busy", "true");
	let added = 0;
	const errors = [];
	for (const file of pending) {
		try {
			const kind = attachmentTools.classifyAttachment(file);
			if (kind === "image") {
				const src = String(await readFile(file, "readAsDataURL"));
				state.attachedImages.push({
					id: crypto.randomUUID(), name: file.name, mimeType: attachmentTools.imageMimeType(file),
					data: src.split(",")[1] || "", src,
				});
			} else if (kind === "text" && file.size <= MAX_INLINE_TEXT_BYTES) {
				state.attachedFiles.push({
					id: crypto.randomUUID(), kind, name: file.name,
					content: String(await readFile(file, "readAsText")),
					sizeStr: attachmentTools.formatFileSize(file.size),
				});
			} else {
				state.attachedFiles.push({
					id: crypto.randomUUID(), kind: kind === "text" ? "file" : kind, name: file.name,
					path: await resolveAttachmentPath(file),
					sizeStr: attachmentTools.formatFileSize(file.size),
				});
			}
			added += 1;
			renderAttachmentPreviews();
		} catch (error) {
			errors.push(`${file.name}: ${error.message}`);
		}
	}
	elements.attachInput.value = "";
	elements.composer.classList.remove("is-attaching");
	elements.composer.removeAttribute("aria-busy");
	if (added > 0) {
		elements.composer.classList.remove("attachment-added");
		requestAnimationFrame(() => elements.composer.classList.add("attachment-added"));
		window.setTimeout(() => elements.composer.classList.remove("attachment-added"), 500);
		const key = source === "paste" ? "attachmentsPasted" : source === "drop" ? "attachmentsDropped" : "attachmentsAdded";
		showAttachmentFeedback(uiText(key, { count: added }));
	}
	if (errors.length > 0) showAttachmentFeedback(errors.join("；"), "error");
}

function renderEmptyState(connected = state.serverConnected) {
	const empty = document.createElement("div");
	empty.className = "empty-state";
	empty.id = "emptyState";

	if (!connected) {
		const title = document.createElement("strong");
		title.textContent = uiText("startTask");
		const copy = document.createElement("span");
		copy.textContent = uiText("serverSyncDescription");
		const button = document.createElement("button");
		button.append(document.createElement("span"), uiText("connectServer"));
		button.firstElementChild.className = "server-dot";
		button.addEventListener("click", () => elements.serverDialog.showModal());
		empty.append(title, copy, button);
	}
	elements.emptyState = empty;
	elements.messageColumn.replaceChildren(empty);
	elements.conversationPane?.classList.add("is-empty-state");
	elements.conversationPane?.classList.remove("is-leaving-empty");
	renderDesktopWorkStats();
	if (connected) void refreshDesktopWorkStats();
}

function transitionFromEmptyState() {
	if (!elements.conversationPane?.classList.contains("is-empty-state")) {
		if (elements.emptyState?.isConnected) elements.emptyState.remove();
		return;
	}
	elements.conversationPane.classList.add("is-leaving-empty");
	elements.conversationPane.classList.remove("is-empty-state");
	const currentEmpty = elements.emptyState;
	currentEmpty?.classList.add("fade-out");
	setTimeout(() => {
		if (currentEmpty && currentEmpty.isConnected && !elements.conversationPane.classList.contains("is-empty-state")) {
			currentEmpty.remove();
		}
		if (state.hasSubmittedMessage) elements.dreamTokenCard?.classList.add("hidden");
		elements.conversationPane?.classList.remove("is-leaving-empty");
	}, 360);
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

function getThoughtSegmentTimerKey(message, partKey) {
	const sessionKey = state.session?.sessionId || "session";
	const messageKey = message?.id || message?.timestamp || "message";
	return `${sessionKey}:${messageKey}:${partKey}`;
}

function estimateThoughtSegmentDurationMs(part) {
	const explicitDuration = Number(part?.durationMs ?? part?.duration_ms ?? part?.metadata?.durationMs);
	if (Number.isFinite(explicitDuration) && explicitDuration >= 0) return explicitDuration;
	const characterCount = typeof part?.thinking === "string" ? part.thinking.length : 0;
	return Math.max(1200, Math.min(30000, (characterCount / 120) * 1000));
}

function formatThoughtSegmentDuration(durationMs) {
	const safeDuration = Math.max(0, Number(durationMs) || 0);
	if (safeDuration < 60000) {
		return `${Math.max(0.1, safeDuration / 1000).toFixed(1)}s`;
	}
	const minutes = Math.floor(safeDuration / 60000);
	const seconds = Math.floor((safeDuration % 60000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function resolveThoughtSegmentTiming(message, part, partKey, isActive) {
	if (!state.thoughtSegmentTimings) state.thoughtSegmentTimings = {};
	const timerKey = getThoughtSegmentTimerKey(message, partKey);
	const now = Date.now();
	let timing = state.thoughtSegmentTimings[timerKey];
	if (!timing) {
		timing = isActive
			? { startedAt: now }
			: { durationMs: estimateThoughtSegmentDurationMs(part) };
		state.thoughtSegmentTimings[timerKey] = timing;
	} else if (!isActive && timing.durationMs === undefined) {
		timing.durationMs = Math.max(100, now - timing.startedAt);
	}
	const durationMs = timing.durationMs ?? Math.max(0, now - timing.startedAt);
	return { timerKey, durationText: formatThoughtSegmentDuration(durationMs) };
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
			return "Running";
		}
	}
	
	return "Pending";
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

const ASSISTANT_TURN_LAYOUT_CLASSES = [
	"assistant-turn-segment",
	"assistant-turn-first",
	"assistant-turn-last",
	"assistant-turn-work",
	"assistant-turn-work-start",
	"assistant-turn-work-end",
	"assistant-turn-final",
	"assistant-turn-collapsed",
	"assistant-turn-expanded",
	"turn-intermediate-collapsed",
];

function getAssistantTurnArticles(article) {
	let firstArticle = article;
	while (firstArticle?.previousElementSibling
		&& !firstArticle.previousElementSibling.classList.contains("user-message")) {
		firstArticle = firstArticle.previousElementSibling;
	}

	const articles = [];
	let turnArticle = firstArticle;
	while (turnArticle && !turnArticle.classList.contains("user-message")) {
		if (turnArticle.classList.contains("assistant-message")) articles.push(turnArticle);
		turnArticle = turnArticle.nextElementSibling;
	}
	return articles;
}

function syncAssistantTurnPresentation(turnArticles) {
	if (!turnArticles.length) return;

	const workArticles = turnArticles.filter((candidate) =>
		candidate.querySelector(":scope > .assistant-body > .cot-container"));
	const primaryWorkArticle = workArticles.find((candidate) =>
		!candidate.querySelector(":scope > .assistant-body > .cot-container")?.classList.contains("cot-continuation"))
		?? workArticles[0];
	const finalArticle = [...turnArticles].reverse().find((candidate) =>
		candidate.querySelector(":scope > .assistant-body > .assistant-text-part"));
	const primaryContainer = primaryWorkArticle?.querySelector(":scope > .assistant-body > .cot-container");
	const hasWork = Boolean(primaryContainer);
	const isCollapsed = hasWork && primaryContainer.classList.contains("collapsed");
	const isActive = turnArticles.some((candidate) => candidate.classList.contains("assistant-turn-active"));

	turnArticles.forEach((candidate, index) => {
		candidate.classList.remove(...ASSISTANT_TURN_LAYOUT_CLASSES);
		candidate.classList.toggle("assistant-turn-active", isActive);
		if (!hasWork) return;

		const container = candidate.querySelector(":scope > .assistant-body > .cot-container");
		const isWorkArticle = Boolean(container);
		const isFinalArticle = candidate === finalArticle;
		const hidesWhenCollapsed = candidate !== primaryWorkArticle && !isFinalArticle;
		candidate.classList.add("assistant-turn-segment");
		candidate.classList.toggle("assistant-turn-first", index === 0);
		candidate.classList.toggle("assistant-turn-last", index === turnArticles.length - 1);
		candidate.classList.toggle("assistant-turn-work", isWorkArticle);
		candidate.classList.toggle("assistant-turn-work-start", candidate === primaryWorkArticle);
		candidate.classList.toggle("assistant-turn-work-end", candidate === workArticles.at(-1));
		candidate.classList.toggle("assistant-turn-final", isFinalArticle);
		candidate.classList.toggle("assistant-turn-collapsed", isCollapsed);
		candidate.classList.toggle("assistant-turn-expanded", !isCollapsed);
		candidate.classList.toggle("turn-intermediate-collapsed", isCollapsed && hidesWhenCollapsed);

		if (container) container.classList.toggle("collapsed", isCollapsed);
		const header = container?.querySelector(":scope > .cot-header-bar");
		header?.setAttribute("aria-expanded", String(!isCollapsed));
		for (const divider of candidate.querySelectorAll(":scope > .assistant-body > .turn-final-divider")) {
			divider.classList.remove("turn-terminal-divider");
		}
	});
}

function syncAssistantTurnPresentations() {
	let turnArticles = [];
	const finishTurn = () => {
		syncAssistantTurnPresentation(turnArticles);
		turnArticles = [];
	};

	for (const article of elements.messageColumn.children) {
		if (article.classList.contains("user-message")) {
			finishTurn();
			continue;
		}
		if (article.classList.contains("assistant-message")) turnArticles.push(article);
	}
	finishTurn();
}

function setAssistantTurnCollapsed(article, isCollapsed, isActive = false) {
	const turnArticles = getAssistantTurnArticles(article);
	const primaryContainer = turnArticles
		.map((candidate) => candidate.querySelector(":scope > .assistant-body > .cot-container"))
		.find((container) => container && !container.classList.contains("cot-continuation"))
		?? turnArticles[0]?.querySelector(":scope > .assistant-body > .cot-container");
	if (primaryContainer) primaryContainer.dataset.turnCollapsedManual = String(isCollapsed);

	for (const turnArticle of turnArticles) {
		turnArticle.classList.toggle("assistant-turn-active", isActive);
		const container = turnArticle.querySelector(":scope > .assistant-body > .cot-container");
		if (container) container.classList.toggle("collapsed", isCollapsed);
	}
	syncAssistantTurnPresentation(turnArticles);
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
	const turnIsStreaming = Boolean(state.isStreaming && turnContext.isCurrentTurn);
	let turnShouldCollapse = turnContext.shouldCollapse;
	article.classList.toggle("assistant-turn-active", turnIsActive);
	
	if (typeof message.content === "string" && !turnIsStreaming) {
		let textPart = body.querySelector(":scope > .assistant-text-part");
		if (body.querySelector(":scope > .cot-container") || !textPart) {
			body.replaceChildren();
			textPart = document.createElement("div");
			textPart.className = "assistant-text-part animate-entrance";
			body.append(textPart);
		}
		renderAssistantText(textPart, message.content);
		const hasFinalText = Boolean(message.content.trim()) && !isSubagentLaunchNotice(message.content);
		reconcileAssistantFinalDivider(
			body,
			turnContext.hasCoT && turnContext.isFinalAssistant && hasFinalText,
			textPart,
		);
		return;
	}
	
	if (!Array.isArray(message.content) && typeof message.content !== "string") {
		body.replaceChildren();
		return;
	}
	
	const { workItems, finalResponsePart } = getAssistantWorkLayout(
		message,
		messages,
		turnContext.isFinalAssistant,
		turnIsStreaming,
	);
	// update_plan is persisted and rendered by the dedicated Build checklist.
	// Keep it out of generic tool-card rendering so hidden calls cannot produce
	// an undefined DOM node during streaming or abort-time resynchronization.
	const visibleWorkItems = workItems
		.map((part, sourceIndex) => ({ part, sourceIndex }))
		.filter(({ part }) => !(part.type === "toolCall" && part.name === "update_plan"));
	const hasCoT = visibleWorkItems.length > 0;

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
				if (existingTextDiv && existingTextDiv.classList.contains("assistant-text-part")) {
					renderAssistantText(existingTextDiv, part.text);
				} else {
					const textDiv = document.createElement("div");
					textDiv.className = "assistant-text-part animate-entrance";
					renderAssistantText(textDiv, part.text);
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
			cotHeader.setAttribute("role", "button");
			cotHeader.setAttribute("tabindex", "0");
			cotHeader.setAttribute("aria-expanded", "true");

			const cotTitle = document.createElement("span");
			cotTitle.className = "cot-title";
			cotTitle.textContent = uiText("thinking");

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
			cotHeader.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				cotHeader.click();
			});
		}

		// One visible work header per user turn. Plain assistant/status messages and
		// hidden Subagent calls between reasoning chunks do not start a new group.
		const hideCotHeader = shouldHideAssistantWorkHeader(message, messages);

		const cotHeader = cotContainer.querySelector(".cot-header-bar");
		if (cotHeader) {
			cotHeader.style.display = hideCotHeader ? "none" : "";
			cotHeader.setAttribute("aria-expanded", String(!turnShouldCollapse));
		}
		const isWorking = isAssistantTurnActive(turnContext);
		const cotTitle = cotContainer.querySelector(".cot-title");
		if (cotTitle) {
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

		if (cotContainer.dataset.turnCollapsedManual === "true") turnShouldCollapse = true;
		if (cotContainer.dataset.turnCollapsedManual === "false") turnShouldCollapse = false;
		cotContainer.classList.toggle("collapsed", turnShouldCollapse);
		const cotBody = cotContainer.querySelector(".cot-content-inner");
		cotContainer.classList.toggle("cot-continuation", hideCotHeader);

		const existingKeyMap = new Map();
		for (const child of cotBody.children) {
			const key = child.dataset.partKey;
			if (key) existingKeyMap.set(key, child);
		}

		const currentKeys = new Set();

		for (let index = 0; index < visibleWorkItems.length; index += 1) {
			const { part, sourceIndex } = visibleWorkItems[index];
			const key = getWorkItemKey(part, sourceIndex);
			currentKeys.add(key);

			let itemEl = existingKeyMap.get(key);

			if (part.type === "thinking" && part.thinking) {
				const newHtml = renderMarkdown(part.thinking);
				// A hidden update_plan still ends preceding thoughts. Use the source
				// position, not filtered index, so Build plan updates do not leave
				// an already-finished thought segment expanded while the tool runs.
				const thoughtIsActive = isWorking && sourceIndex === workItems.length - 1;
				const thoughtTiming = resolveThoughtSegmentTiming(message, part, key, thoughtIsActive);
				if (!itemEl || !itemEl.classList.contains("cot-thoughts-group")) {
					const previousItem = itemEl;
					itemEl = document.createElement("div");
					itemEl.className = `cot-thoughts-group${thoughtIsActive ? "" : " collapsed"} animate-entrance`;
					itemEl.dataset.partKey = key;
					itemEl.dataset.thoughtTimerKey = thoughtTiming.timerKey;

					const thoughtsToggle = document.createElement("button");
					thoughtsToggle.type = "button";
					thoughtsToggle.className = "cot-thoughts-toggle";
					thoughtsToggle.setAttribute("aria-expanded", String(thoughtIsActive));
					thoughtsToggle.setAttribute("aria-label", uiText("thoughts"));
					const thoughtsLabel = document.createElement("span");
					thoughtsLabel.className = "cot-thoughts-label";
					thoughtsLabel.textContent = uiText("thoughts");
					const thoughtsDuration = document.createElement("span");
					thoughtsDuration.className = "cot-thoughts-duration";
					thoughtsDuration.textContent = thoughtTiming.durationText;
					const thoughtsChevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
					thoughtsChevron.innerHTML = '<use href="#i-chevron"/>';
					thoughtsChevron.setAttribute("class", "cot-thoughts-chevron");
					thoughtsToggle.append(thoughtsLabel, thoughtsDuration, thoughtsChevron);

					const thoughtsBody = document.createElement("div");
					thoughtsBody.className = "cot-thinking";
					thoughtsBody.innerHTML = newHtml;
					itemEl.append(thoughtsToggle, thoughtsBody);
					thoughtsToggle.addEventListener("click", () => {
						itemEl.dataset.thoughtsManual = "true";
						itemEl.classList.toggle("collapsed");
						thoughtsToggle.setAttribute("aria-expanded", String(!itemEl.classList.contains("collapsed")));
					});
					if (previousItem) previousItem.replaceWith(itemEl);
				} else {
					itemEl.dataset.thoughtTimerKey = thoughtTiming.timerKey;
					const thoughtsBody = itemEl.querySelector(":scope > .cot-thinking");
					if (thoughtsBody && thoughtsBody.innerHTML !== newHtml) {
						thoughtsBody.innerHTML = newHtml;
					}
					if (itemEl.dataset.thoughtsManual !== "true") {
						itemEl.classList.toggle("collapsed", !thoughtIsActive);
					}
					const thoughtsToggle = itemEl.querySelector(":scope > .cot-thoughts-toggle");
					thoughtsToggle?.setAttribute("aria-expanded", String(!itemEl.classList.contains("collapsed")));
					const thoughtsDuration = itemEl.querySelector(":scope > .cot-thoughts-toggle > .cot-thoughts-duration");
					if (thoughtsDuration && thoughtsDuration.textContent !== thoughtTiming.durationText) {
						thoughtsDuration.textContent = thoughtTiming.durationText;
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
								outTitle.textContent = uiText("output");
								
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
					if (!itemEl) continue;
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
				if (finalResponseEl && finalResponseEl.classList.contains("assistant-text-part")) {
					renderAssistantText(finalResponseEl, cleanText);
				} else {
					const textDiv = document.createElement("div");
					textDiv.className = "assistant-text-part animate-entrance";
					renderAssistantText(textDiv, cleanText);
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

function formatSubagentDuration(durationMs) {
	if (!Number.isFinite(durationMs) || durationMs < 0) return "";
	if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
	if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
	const totalSeconds = Math.round(durationMs / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${seconds}s`;
}

function renderSubagentCompletionCard(item) {
	const args = typeof item.part?.arguments === "object" && item.part.arguments !== null ? item.part.arguments : {};
	const running = item.progress.state === "running";
	const failed = item.progress.state === "failed";
	const card = document.createElement("div");
	card.className = `tool-card subagent-tool-card collapsed${running ? " running" : ""}${failed ? " failed" : ""}`;
	card.dataset.jobId = item.progress.jobId;
	card.dataset.state = item.progress.state;

	const header = document.createElement("div");
	header.className = "tool-header-bar subagent-tool-header";
	header.setAttribute("role", "button");
	header.setAttribute("tabindex", "0");
	header.setAttribute("aria-expanded", "false");
	header.setAttribute("aria-label", `${uiText("subagentTask")}: ${String(args.title || uiText("subagentTask"))}`);

	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.innerHTML = '<use href="#i-branch"/>';
	icon.setAttribute("class", "tool-icon");

	const title = document.createElement("span");
	title.className = "tool-name";
	title.textContent = String(args.title || uiText("subagentTask"));

	const duration = formatSubagentDuration(item.progress.durationMs);
	const durationEl = document.createElement("span");
	durationEl.className = "tool-duration";
	durationEl.textContent = duration;

	const status = document.createElement("span");
	status.className = "subagent-tool-status";
	status.setAttribute("aria-live", "polite");
	if (!running && !failed) {
		const statusIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		statusIcon.innerHTML = '<use href="#i-check"/>';
		status.append(statusIcon);
	}
	const statusText = document.createElement("span");
	statusText.textContent = uiText(running ? "subagentRunning" : failed ? "subagentFailed" : "subagentCompleted");
	status.append(statusText);

	const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	chevron.innerHTML = '<use href="#i-chevron"/>';
	chevron.setAttribute("class", "tool-chevron");
	header.append(icon, title, durationEl, status, chevron);

	const details = document.createElement("div");
	details.className = "tool-details-body subagent-tool-details";
	const taskTitle = document.createElement("div");
	taskTitle.className = "tool-section-title";
	taskTitle.textContent = uiText("subagentTaskDetail");

	const task = document.createElement("p");
	task.className = "subagent-tool-task";
	task.textContent = String(args.task || uiText("subagentTaskDetail"));
	task.title = String(args.task || "");

	const meta = document.createElement("div");
	meta.className = "subagent-tool-meta";
	const mode = document.createElement("span");
	mode.textContent = uiText("subagentBackground");
	const job = document.createElement("code");
	job.textContent = `ID #${item.progress.jobId}`;
	meta.append(mode, job);
	if (duration) {
		const elapsed = document.createElement("span");
		elapsed.className = "subagent-tool-duration";
		elapsed.textContent = uiText("subagentDuration", { duration });
		meta.append(elapsed);
	}
	details.append(taskTitle, task, meta);
	card.append(header, details);

	header.addEventListener("click", () => {
		card.classList.toggle("collapsed");
		header.setAttribute("aria-expanded", String(!card.classList.contains("collapsed")));
	});
	header.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		header.click();
	});
	return card;
}

function renderComposerStatusRow(messages = state.messages) {
	if (!elements.composerStatusRow || !elements.projectSwitchCapsule) return;
	const hasUserMessage = Array.isArray(messages) && messages.some((message) => message?.role === "user");
	if (hasUserMessage) state.hasSubmittedMessage = true;
	const showProjectSwitch = state.projects.length > 0;
	elements.composerStatusRow.classList.toggle("has-project-switch", showProjectSwitch);
	elements.composerStatusRow.classList.remove("new-conversation");
	elements.projectSwitcher.classList.toggle("hidden", !showProjectSwitch);
	elements.projectSwitchCapsule.disabled = !showProjectSwitch;
	elements.projectSwitchCapsule.tabIndex = showProjectSwitch ? 0 : -1;
	elements.projectSwitchCapsule.setAttribute("aria-hidden", String(!showProjectSwitch));
	elements.projectSwitchCapsule.setAttribute("aria-label", uiText("switchProject"));
	elements.projectSwitchCapsule.title = uiText("switchProject");
	elements.projectSwitchLabel.textContent = activeProject()?.name || uiText("projects");
	if (!showProjectSwitch) setProjectSwitchMenuOpen(false);
}

function renderToolCallBlock(part, message, messages) {
	// Plan state has a dedicated, persistent card near the composer.
	// Keep nullable return explicit: callers may receive filtered or unsupported tools
	// during streaming resync and must never dereference an absent DOM node.
	if (part.name === "update_plan") return null;
	const container = document.createElement("div");
	const status = getToolStatus(part, message, messages);
	const isRunning = status === "Running" || status === "Pending" || status === "Awaiting Approval";

	container.className = `tool-card collapsed ${isRunning ? "running" : ""}`;

	const header = document.createElement("div");
	header.className = "tool-header-bar";
	header.setAttribute("role", "button");
	header.setAttribute("tabindex", "0");
	header.setAttribute("aria-expanded", "false");

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
	argsTitle.textContent = uiText("arguments");
	
	const argsPre = document.createElement("pre");
	const argsCode = document.createElement("code");
	argsCode.textContent = typeof part.arguments === "object" ? JSON.stringify(part.arguments, null, 2) : String(part.arguments);
	argsPre.append(argsCode);
	
	details.append(argsTitle, argsPre);

	const resultMsg = messages.find((m) => m.role === "toolResult" && m.toolCallId === part.id);
	if (resultMsg) {
		const outTitle = document.createElement("div");
		outTitle.className = "tool-section-title";
		outTitle.textContent = uiText("output");
		
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
		header.setAttribute("aria-expanded", String(!container.classList.contains("collapsed")));
	});
	header.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		header.click();
	});

	return container;
}

function appendAssistantMessage(message, messages, shouldScroll = true) {
	updateOrCreateAssistantMessage(null, message, messages, -1);
	if (shouldScroll) scrollMessagesToBottom();
}

function scheduleServerMessageRender() {
	if (scheduledServerMessageRenderFrame) return;
	scheduledServerMessageRenderFrame = requestAnimationFrame(() => {
		scheduledServerMessageRenderFrame = undefined;
		renderServerMessages(state.messages);
	});
}

function flushServerMessageRender() {
	if (scheduledServerMessageRenderFrame) {
		cancelAnimationFrame(scheduledServerMessageRenderFrame);
		scheduledServerMessageRenderFrame = undefined;
	}
	renderServerMessages(state.messages);
}

function renderServerMessages(messages = []) {
	refreshConversationTokenTrail(messages);
	renderComposerStatusRow(messages);
	let visible = 0;
	const activeMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
	const currentTurnStart = activeMessages.findLastIndex((message) => message.role === "user");
	const hasActiveWork = state.isStreaming || (Array.isArray(state.session?.runningSubagentIds)
		&& state.session.runningSubagentIds.length > 0);
	const stableThroughIndex = hasActiveWork ? currentTurnStart : activeMessages.length - 1;
	const renderLanguage = resolveUiLanguage();
	
	while (elements.messageColumn.children.length > activeMessages.length) {
		elements.messageColumn.lastElementChild.remove();
	}
	
	activeMessages.forEach((message, index) => {
		const existingArticle = elements.messageColumn.children[index];
		const expectedClass = message.role === "user" ? "user-message" : "assistant-message";
		if (index <= stableThroughIndex
			&& existingArticle?.classList.contains(expectedClass)
			&& existingArticle.metisRenderedMessage === message
			&& existingArticle.metisRenderedLanguage === renderLanguage
			&& (index < currentTurnStart || existingArticle.metisRenderedStreaming === state.isStreaming)) {
			visible += 1;
			return;
		}
		
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
							el.append(icon(file.kind === "video" ? "video" : "file"), document.createTextNode(file.name));
							el.addEventListener("click", () => showFileContentModal(file.name, file.content || file.path || ""));
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

		const renderedArticle = elements.messageColumn.children[index];
		if (renderedArticle?.classList.contains(expectedClass)) {
			renderedArticle.metisRenderedMessage = message;
			renderedArticle.metisRenderedLanguage = renderLanguage;
			renderedArticle.metisRenderedStreaming = state.isStreaming;
		}
	});

	syncAssistantTurnPresentations();
	
	if (!visible) {
		renderEmptyState(true);
	} else {
		const isLeavingEmpty = elements.conversationPane?.classList.contains("is-leaving-empty");
		elements.conversationPane?.classList.remove("is-empty-state");
		if (!isLeavingEmpty) {
			elements.conversationPane?.classList.remove("is-leaving-empty");
		}
		if (elements.emptyState?.isConnected) elements.emptyState.remove();
		scrollMessagesToBottom(false);
	}
}

function refreshWorkTimerTitles() {
	const hasRunningSubagent = Array.isArray(state.session?.runningSubagentIds)
		&& state.session.runningSubagentIds.length > 0;
	const isAgentActive = state.isStreaming || hasRunningSubagent;
	for (const group of document.querySelectorAll(".cot-thoughts-group[data-thought-timer-key]")) {
		const timing = state.thoughtSegmentTimings?.[group.dataset.thoughtTimerKey];
		if (!timing || timing.durationMs !== undefined || !Number.isFinite(timing.startedAt)) continue;
		const elapsedMs = Math.max(0, Date.now() - timing.startedAt);
		if (!isAgentActive) timing.durationMs = Math.max(100, elapsedMs);
		const duration = group.querySelector(":scope > .cot-thoughts-toggle > .cot-thoughts-duration");
		if (!duration) continue;
		const nextDuration = formatThoughtSegmentDuration(timing.durationMs ?? elapsedMs);
		if (duration.textContent !== nextDuration) duration.textContent = nextDuration;
	}
	if (!isAgentActive) return;
	const activeMessages = state.messages.filter((message) => message.role === "user" || message.role === "assistant");
	const currentTurnStart = activeMessages.findLastIndex((message) => message.role === "user");
	for (let index = currentTurnStart + 1; index < activeMessages.length; index += 1) {
		const message = activeMessages[index];
		if (message.role !== "assistant") continue;
		const article = elements.messageColumn.children[index];
		const title = article?.querySelector(".cot-title");
		if (!title) continue;
		const turnContext = analyzeAssistantTurn(message, state.messages, state.isStreaming);
		if (!isAssistantTurnActive(turnContext)) continue;
		const duration = getThinkingDuration(message, state.messages);
		const nextTitle = duration !== undefined ? uiText("workingForSeconds", { duration }) : uiText("working");
		if (title.textContent !== nextTitle) title.textContent = nextTitle;
		title.classList.add("working-shimmer");
	}
}

function modelLabel(model) {
	return model?.name || model?.id || (model?.provider ? `${model.provider}/model` : uiText("genericModel"));
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
			const bg = interpolateColor("#d8d9d7", "#505456", factor);
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

		const colors = ["#d8d9d7", "#b7b9b7", "#949796", "#707476", "#505456"];

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

function positionModelMenu() {
	if (!elements.modelPicker?.classList.contains("open") || !elements.modelMenu) return;
	const triggerRect = elements.modelTrigger.getBoundingClientRect();
	const menuRect = elements.modelMenu.getBoundingClientRect();
	const viewportPadding = 12;
	const rightOverflow = Math.max(0, triggerRect.left + menuRect.width - (window.innerWidth - viewportPadding));
	const leftOverflow = Math.max(0, viewportPadding - (triggerRect.left - rightOverflow));
	const shiftX = leftOverflow - rightOverflow;
	elements.modelMenu.style.setProperty("--model-menu-shift-x", `${Math.round(shiftX)}px`);
}

function setModelMenuOpen(open, { focusSelected = false } = {}) {
	const nextOpen = Boolean(open && !elements.modelTrigger.disabled);
	elements.modelPicker.classList.toggle("open", nextOpen);
	elements.modelTrigger.setAttribute("aria-expanded", String(nextOpen));
	elements.modelMenu.setAttribute("aria-hidden", String(!nextOpen));
	if (!nextOpen) elements.modelPicker.classList.remove("advanced-open");
	if (nextOpen) {
		requestAnimationFrame(() => {
			positionModelMenu();
			if (focusSelected) elements.modelOptions.querySelector('[aria-selected="true"]')?.focus();
		});
	}
}

function workflowModeLabel(mode) {
	return mode === "plan" ? uiText("workflowPlanMode") : uiText("workflowBuildMode");
}

function setWorkflowMenuOpen(_open, { focusSelected = false } = {}) {
	if (!elements.workflowPicker || !elements.workflowTrigger) return;
	elements.workflowPicker.classList.add("open");
	elements.workflowTrigger.setAttribute("aria-expanded", "true");
	elements.workflowMenu?.setAttribute("aria-hidden", "false");
	if (focusSelected) {
		requestAnimationFrame(() => elements.workflowMenu?.querySelector('[aria-checked="true"]')?.focus());
	}
}

function renderWorkflowControls() {
	if (!elements.workflowTrigger || !elements.workflowTriggerLabel) return;
	const mode = state.session?.collaborationMode === "build" ? "build" : "plan";
	const busy = Boolean(state.session?.isStreaming || state.session?.isCompacting);
	const connected = Boolean(state.serverConnected && state.session);
	elements.workflowTriggerLabel.textContent = workflowModeLabel(mode);
	elements.workflowTrigger.disabled = !connected || busy;
	const modeDescription = mode === "plan" ? uiText("workflowPlanDescription") : uiText("workflowBuildDescription");
	const availability = busy ? uiText("workflowBusy") : modeDescription;
	elements.workflowTrigger.title = availability;
	elements.workflowTrigger.setAttribute("aria-label", `${workflowModeLabel(mode)}. ${availability}`);
	elements.workflowPicker.classList.toggle("plan", mode === "plan");
	elements.workflowMenu?.querySelectorAll("[data-workflow-mode]").forEach((option) => {
		const optionMode = option.dataset.workflowMode;
		const selected = optionMode === mode;
		option.setAttribute("aria-checked", String(selected));
		option.disabled = !connected || busy;
		const title = option.querySelector("strong");
		const description = option.querySelector("small");
		if (title) title.textContent = workflowModeLabel(optionMode);
		if (description) description.textContent = optionMode === "plan" ? uiText("workflowPlanDescription") : uiText("workflowBuildDescription");
	});
	if (elements.settingsCollaborationModeSelect) {
		elements.settingsCollaborationModeSelect.value = mode;
		elements.settingsCollaborationModeSelect.disabled = !connected || busy;
	}
	setWorkflowMenuOpen(true);
	updateProposedPlanControls();
}

function normalizeWorkflowPlan(raw) {
	if (!raw || typeof raw !== "object") return undefined;
	const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString();
	if (typeof raw.plan === "string") return { plan: [], legacyMarkdown: raw.plan, updatedAt };
	if (!Array.isArray(raw.plan)) return undefined;
	const plan = raw.plan.filter((item) => item && typeof item.step === "string" && ["pending", "in_progress", "completed"].includes(item.status));
	return {
		explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
		plan,
		updatedAt,
		legacyMarkdown: typeof raw.legacyMarkdown === "string" ? raw.legacyMarkdown : undefined,
		taskId: typeof raw.taskId === "string" ? raw.taskId : undefined,
		proposalRevision: typeof raw.proposalRevision === "number" ? raw.proposalRevision : undefined,
		phase: ["reading_proposal", "creating_checklist", "active"].includes(raw.phase) ? raw.phase : undefined,
	};
}

function renderWorkflowPlanCard() {
	if (!elements.workflowPlanCard || !elements.workflowPlanBody || !elements.workflowPlanProgress) return;
	const workflowPlan = normalizeWorkflowPlan(state.session?.workflowPlan);
	const isPlanMode = state.session?.collaborationMode === "plan";
	const lastAssistant = [...(state.messages || [])].reverse().find((message) => message?.role === "assistant");
	const interrupted = !state.isStreaming && lastAssistant?.stopReason === "aborted";
	const title = document.querySelector("#workflowPlanTitle");
	if (title) title.textContent = uiText("workflowPlanTitle");
	// The persistent checklist belongs to Build execution. Conversational Plan
	// mode ends with a proposed plan in the assistant response, never a TODO card.
	if (isPlanMode || !workflowPlan) {
		elements.workflowPlanCard.classList.add("hidden");
		elements.workflowPlanCard.classList.remove("empty", "completed", "collapsed", "interrupted");
		elements.workflowPlanBody.replaceChildren();
		return;
	}
	const completed = workflowPlan?.plan.filter((item) => item.status === "completed").length ?? 0;
	const done = Boolean(workflowPlan?.plan.length && completed === workflowPlan.plan.length);
	const completionKey = done ? (workflowPlan.taskId || workflowPlan.updatedAt) : undefined;
	if (completionKey && state.workflowPlanAutoCollapsedKey !== completionKey) {
		state.workflowPlanCollapsed = true;
		state.workflowPlanAutoCollapsedKey = completionKey;
	} else if (!done) {
		state.workflowPlanAutoCollapsedKey = undefined;
	}
	elements.workflowPlanCard.classList.remove("hidden");
	elements.workflowPlanCard.classList.toggle("empty", !workflowPlan?.plan.length);
	elements.workflowPlanCard.classList.toggle("completed", done);
	elements.workflowPlanCard.classList.toggle("interrupted", interrupted);
	elements.workflowPlanCard.classList.toggle("collapsed", Boolean(state.workflowPlanCollapsed));
	elements.workflowPlanToggle?.setAttribute("aria-expanded", String(!state.workflowPlanCollapsed));
	const progress = workflowPlan?.phase === "reading_proposal"
		? uiText("workflowPlanReadingProposal")
		: workflowPlan?.phase === "creating_checklist"
			? uiText("workflowPlanCreatingChecklist")
			: workflowPlan?.plan.length
		? uiText("workflowPlanProgress", { completed, total: workflowPlan.plan.length })
		: workflowPlan?.legacyMarkdown
			? uiText("workflowPlanLegacy")
			: uiText("workflowPlanEmpty");
	elements.workflowPlanProgress.textContent = interrupted
		? `${uiText("workflowPlanInterrupted")} · ${progress}`
		: progress;
	elements.workflowPlanBody.replaceChildren();
	if (workflowPlan?.explanation) {
		const explanation = document.createElement("p");
		explanation.className = "workflow-plan-explanation";
		explanation.textContent = workflowPlan.explanation;
		elements.workflowPlanBody.append(explanation);
	}
	if (workflowPlan?.legacyMarkdown) {
		const legacy = document.createElement("pre");
		legacy.className = "workflow-plan-legacy";
		legacy.textContent = workflowPlan.legacyMarkdown;
		elements.workflowPlanBody.append(legacy);
	} else if (workflowPlan?.plan.length) {
		const list = document.createElement("ol");
		list.className = "workflow-plan-steps";
		for (const item of workflowPlan.plan) {
			const row = document.createElement("li");
			row.dataset.status = item.status;
			const marker = document.createElement("span");
			marker.className = "workflow-plan-marker";
			marker.setAttribute("aria-hidden", "true");
			const label = document.createElement("span");
			label.textContent = item.step;
			row.append(marker, label);
			list.append(row);
		}
		elements.workflowPlanBody.append(list);
	} else {
		const empty = document.createElement("p");
		empty.className = "workflow-plan-empty";
		empty.textContent = progress;
		elements.workflowPlanBody.append(empty);
	}
}

function renderInstructionSources() {
	if (!elements.instructionSources) return;
	elements.instructionSources.replaceChildren();
	const sources = Array.isArray(state.session?.instructionSources) ? state.session.instructionSources : [];
	if (!sources.length) {
		const empty = document.createElement("p");
		empty.className = "instruction-sources-empty";
		empty.textContent = uiText("instructionSourcesEmpty");
		elements.instructionSources.append(empty);
	} else {
		for (const source of sources) {
			const row = document.createElement("div");
			row.className = "instruction-source-row";
			const details = document.createElement("span");
			const title = document.createElement("strong");
			title.textContent = `${source.channel}: ${source.source}`;
			const meta = document.createElement("small");
			meta.textContent = `${source.byteCount.toLocaleString()} B${source.truncated ? ` · ${uiText("instructionTruncated")}` : ""}`;
			details.append(title, meta);
			const trust = document.createElement("b");
			trust.className = "instruction-trust";
			trust.textContent = source.trust;
			row.append(details, trust);
			elements.instructionSources.append(row);
		}
	}
	for (const diagnostic of state.session?.instructionDiagnostics || []) {
		const warning = document.createElement("p");
		warning.className = "instruction-source-warning";
		warning.textContent = diagnostic;
		elements.instructionSources.append(warning);
	}
}

async function changeCollaborationMode(mode, feedbackElement) {
	if (!state.serverConnected || !state.session || (mode !== "build" && mode !== "plan")) return false;
	setWorkflowMenuOpen(false);
	try {
		state.session = await requestServer("/session/collaboration-mode", "PUT", { mode });
		state.workflowPlanCollapsed = false;
		renderWorkflowControls();
		renderWorkflowPlanCard();
		updateProposedPlanControls();
		renderInstructionSources();
		renderPreferencesControls();
		if (feedbackElement) setPreferencesFeedback(feedbackElement, uiText("workflowApplied"));
		return true;
	} catch (error) {
		renderWorkflowControls();
		if (feedbackElement) setPreferencesFeedback(feedbackElement, error.message, true);
		else appendAssistantNotice(error.message, uiText("workflowChangeFailed"));
		return false;
	}
}

function updateModelSelect() {
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
		option.append(icon("cpu", "model-option-icon"));
		const label = document.createElement("span");
		label.textContent = modelLabel(model);
		option.append(label);
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

function applyQueueSnapshot(snapshot) {
	if (!state.session) return;
	if (Array.isArray(snapshot?.steeringMessages)) state.session.steeringMessages = [...snapshot.steeringMessages];
	if (Array.isArray(snapshot?.followUpMessages)) state.session.followUpMessages = [...snapshot.followUpMessages];
	state.session.pendingMessageCount = Number.isInteger(snapshot?.pendingMessageCount)
		? snapshot.pendingMessageCount
		: (state.session.steeringMessages?.length || 0) + (state.session.followUpMessages?.length || 0);
	renderMessageQueue();
}

async function removeFollowUpFromQueue(index, { restore = false } = {}) {
	const result = await requestServer("/session/queue", "DELETE", { queue: "followUp", index });
	applyQueueSnapshot(result);

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
	const result = await requestServer("/session/queue/promote", "POST", { index });
	applyQueueSnapshot(result);
}

async function runQueueOperation(index, operation) {
	if (state.queueOperation) return;
	state.queueOperation = { index, operation };
	state.queueOperationFeedback = "";
	renderMessageQueue();
	try {
		await operation();
	} catch (error) {
		state.queueOperationFeedback = `${uiText("queueOperationFailed")}: ${error.message}`;
	} finally {
		state.queueOperation = undefined;
		renderMessageQueue();
	}
}

function renderMessageQueue() {
	if (!elements.messageQueue) return;
	const messages = Array.isArray(state.session?.followUpMessages) ? state.session.followUpMessages : [];
	elements.messageQueue.classList.toggle("hidden", messages.length === 0);
	elements.messageQueue.setAttribute("aria-busy", String(Boolean(state.queueOperation)));
	elements.messageQueueCount.textContent = String(messages.length);
	elements.messageQueueList.replaceChildren();
	if (elements.messageQueueFeedback) {
		elements.messageQueueFeedback.textContent = state.queueOperationFeedback;
		elements.messageQueueFeedback.classList.toggle("hidden", !state.queueOperationFeedback);
	}

	messages.forEach((message, index) => {
		const item = document.createElement("div");
		item.className = "message-queue-item";
		item.setAttribute("role", "listitem");
		item.classList.toggle("is-busy", state.queueOperation?.index === index);

		const position = document.createElement("span");
		position.className = "message-queue-position";
		position.textContent = String(index + 1).padStart(2, "0");
		position.setAttribute("aria-hidden", "true");

		const text = document.createElement("div");
		text.className = "message-queue-text";
		text.textContent = message;

		const actions = document.createElement("div");
		actions.className = "message-queue-actions";
		const actionSpecs = [
			{ name: "arrow-up", label: uiText("queuePromote"), promote: true, run: () => promoteFollowUp(index) },
			{ name: "edit", label: uiText("queueEdit"), run: () => removeFollowUpFromQueue(index, { restore: true }) },
			{ name: "trash", label: uiText("queueDelete"), destructive: true, run: () => removeFollowUpFromQueue(index) },
		];
		for (const spec of actionSpecs) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = `message-queue-action${spec.promote ? " promote" : ""}${spec.destructive ? " destructive" : ""}`;
			button.setAttribute("aria-label", spec.label);
			button.disabled = Boolean(state.queueOperation);
			button.append(icon(spec.name));
			if (spec.promote) {
				const label = document.createElement("span");
				label.textContent = spec.label;
				button.append(label);
			}
			button.addEventListener("click", () => void runQueueOperation(index, spec.run));
			actions.append(button);
		}

		item.append(position, text, actions);
		elements.messageQueueList.append(item);
	});
}

function setStreamingState(active) {
	const activeChanged = state.isStreaming !== active;
	state.isStreaming = active;
	if (activeChanged) {
		elements.sendButton.classList.toggle("stopping", active);
		elements.sendButton.setAttribute("aria-label", uiText(active ? "stopGeneration" : "send"));
		if (elements.sendButtonIcon) {
			elements.sendButtonIcon.setAttribute("href", active ? "#i-stop" : "#i-send");
		} else {
			const fontAwesomeIcon = elements.sendButton.querySelector("i");
			fontAwesomeIcon?.classList.toggle("fa-paper-plane", !active);
			fontAwesomeIcon?.classList.toggle("fa-stop", active);
		}
	}
	if (activeChanged) {
		renderConversations();
		renderMessageQueue();
		renderWorkflowControls();
		if (elements.settingsDialog?.open) renderPreferencesControls();
		refreshAssistantTurnActivityState();
	}
}

function refreshAssistantTurnActivityState() {
	const hasRunningSubagent = Array.isArray(state.session?.runningSubagentIds)
		&& state.session.runningSubagentIds.length > 0;
	if (state.isStreaming || hasRunningSubagent) return;
	elements.messageColumn.querySelectorAll(".assistant-turn-active").forEach((article) => {
		article.classList.remove("assistant-turn-active");
	});
}

function dreamTokenDateKey(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function dreamTokenCalendarDays(dailyTokens = {}, weekCount = 53, now = new Date()) {
	const today = new Date(now);
	today.setHours(12, 0, 0, 0);
	const start = new Date(today);
	start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weekCount - 1) * 7);
	const todayKey = dreamTokenDateKey(today);
	return Array.from({ length: weekCount * 7 }, (_value, index) => {
		const date = new Date(start);
		date.setDate(start.getDate() + index);
		const key = dreamTokenDateKey(date);
		return {
			date: key,
			totalTokens: Number(dailyTokens[key]) || 0,
			future: key > todayKey,
		};
	});
}

function dreamTokenActivityStats(dailyTokens = {}) {
	const activeEntries = Object.entries(dailyTokens)
		.map(([date, tokens]) => [date, Number(tokens) || 0])
		.filter(([, tokens]) => tokens > 0)
		.sort(([left], [right]) => left.localeCompare(right));
	return {
		activeDays: activeEntries.length,
		peakTokens: activeEntries.reduce((peak, [, tokens]) => Math.max(peak, tokens), 0),
	};
}

function renderDreamTokenMonths(days, locale) {
	const container = elements.dreamTokenMonths;
	if (!container) return;
	const signature = `${locale}|${days[0]?.date || "none"}|${days.at(-1)?.date || "none"}`;
	if (container.dataset.signature === signature) return;
	container.dataset.signature = signature;
	container.replaceChildren();
	let previousMonth = -1;
	for (let week = 0; week < Math.ceil(days.length / 7); week += 1) {
		const date = new Date(`${days[week * 7].date}T12:00:00`);
		const month = date.getMonth();
		if (month === previousMonth) continue;
		previousMonth = month;
		const label = document.createElement("span");
		label.style.gridColumn = String(week + 1);
		label.textContent = new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
		container.append(label);
	}
}

function attachHeatmapProximity(grid) {
	if (!grid || grid.dataset.hasProximity) return;
	grid.dataset.hasProximity = "true";

	let activeCells = new Set();
	let currentCenterIndex = -1;

	const clearScaling = () => {
		if (activeCells.size === 0) return;
		for (const cell of activeCells) {
			cell.style.transform = "";
			cell.style.zIndex = "";
			cell.style.boxShadow = "";
		}
		activeCells.clear();
		currentCenterIndex = -1;
	};

	const onPointerOver = (e) => {
		const target = e.target;
		if (!target || !target.classList.contains("dream-token-cell")) {
			clearScaling();
			return;
		}

		const children = grid.children;
		const total = children.length;
		if (total === 0) return;

		const centerIndex = Array.prototype.indexOf.call(children, target);
		if (centerIndex < 0 || centerIndex === currentCenterIndex) return;
		currentCenterIndex = centerIndex;

		const rows = 7;
		const cols = Math.ceil(total / rows);
		const centerCol = Math.floor(centerIndex / rows);
		const centerRow = centerIndex % rows;

		const nextActive = new Set();

		target.style.transform = "scale(1.22)";
		target.style.zIndex = "10";
		target.style.boxShadow = "0 0 0 1px #f6f7f9, 0 2px 5px rgba(15, 23, 42, 0.16)";
		nextActive.add(target);

		for (let dc = -1; dc <= 1; dc += 1) {
			for (let dr = -1; dr <= 1; dr += 1) {
				if (dc === 0 && dr === 0) continue;
				const c = centerCol + dc;
				const r = centerRow + dr;
				if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
				const idx = c * rows + r;
				if (idx < 0 || idx >= total) continue;
				const neighbor = children[idx];
				if (!neighbor) continue;

				neighbor.style.transform = "scale(1.06)";
				neighbor.style.zIndex = "5";
				neighbor.style.boxShadow = "0 0 0 0.8px #f6f7f9, 0 1px 3px rgba(15, 23, 42, 0.08)";
				nextActive.add(neighbor);
			}
		}

		for (const cell of activeCells) {
			if (!nextActive.has(cell)) {
				cell.style.transform = "";
				cell.style.zIndex = "";
				cell.style.boxShadow = "";
			}
		}

		activeCells = nextActive;
	};

	grid.addEventListener("mouseover", onPointerOver);
	grid.addEventListener("mouseleave", clearScaling);
}

function renderDreamTokenActivity(project = activeProject()) {
	const grid = elements.dreamTokenHeatmap;
	const totalElement = elements.dreamTokenTotal;
	if (!grid || !totalElement) return;
	attachHeatmapProximity(grid);
	if (state.hasSubmittedMessage) return;
	const dailyTokens = project?.tokenActivity?.dailyTokens || {};
	const fallbackTotal = (project?.conversations || []).reduce((total, conversation) => total + (Number(conversation.tokenTotal) || 0), 0);
	const tokenTotal = Number(project?.tokenActivity?.tokenTotal) || fallbackTotal;
	const locale = resolveUiLanguage();
	const formattedTotal = workStatsView?.formatTokens?.(tokenTotal, locale)
		|| new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(tokenTotal);
	totalElement.textContent = formattedTotal;
	totalElement.title = `${new Intl.NumberFormat(locale).format(tokenTotal)} Token`;

	const days = dreamTokenCalendarDays(dailyTokens);
	const stats = dreamTokenActivityStats(dailyTokens);
	const formatTokens = (value) => workStatsView?.formatTokens?.(value, locale)
		|| new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
	if (elements.dreamTokenPeak) elements.dreamTokenPeak.textContent = formatTokens(stats.peakTokens);
	if (elements.dreamTokenActiveDays) elements.dreamTokenActiveDays.textContent = String(stats.activeDays);
	const distribution = days.filter((day) => !day.future && day.totalTokens > 0).map((day) => day.totalTokens);
	const signature = `${locale}|daily|${project?.id || "none"}|${days.map((day) => day.totalTokens).join(",")}`;
	grid.setAttribute("aria-label", `${uiText("tokenActivity")} · ${formattedTotal}`);
	renderDreamTokenMonths(days, locale);
	if (grid.dataset.signature === signature) return;
	grid.dataset.signature = signature;
	grid.replaceChildren(...days.map((day) => {
		const cell = document.createElement("span");
		const level = day.future ? 0 : (workStatsView?.tokenLevel?.(day.totalTokens, distribution) || 0);
		const detail = `${day.date} · ${formatTokens(day.totalTokens)} Token`;
		cell.className = `dream-token-cell${day.future ? " future" : ""}`;
		cell.dataset.level = String(level);
		cell.title = detail;
		cell.setAttribute("role", "gridcell");
		cell.setAttribute("aria-label", detail);
		return cell;
	}));
}

function setMemoryState(memoryState) {
	state.memoryState = { enabled: false, phase: "disabled", globalCount: 0, projectCount: 0, pendingJobs: 0, ...(memoryState || {}) };
	if (elements.settingsMemoryInput) elements.settingsMemoryInput.checked = Boolean(state.memoryState.enabled);
	renderMemoryStatus();
	renderDreamTokenActivity();
}

function applyUiLanguage(language) {
	state.uiLanguage = UI_LANGUAGES.includes(language) ? language : "auto";
	localStorage.setItem("metis.desktopUiLanguage.v2", state.uiLanguage);
	document.documentElement.lang = resolveUiLanguage(state.uiLanguage);
	desktopI18n.translateDocument(state.uiLanguage);
	updateComposerPlaceholder(elements.headingTitle?.textContent, elements.headingTitle?.classList.contains("working-shimmer"));
	void desktop.setUiLanguage?.(resolveUiLanguage(state.uiLanguage));
	if (elements.settingsLanguageSelect) elements.settingsLanguageSelect.value = state.uiLanguage;
	if (elements.revealFileButton) elements.revealFileButton.textContent = revealInFolderLabel();
	setMemoryState(state.memoryState);
	updateModelSelect();
	renderWorkflowControls();
	renderWorkflowPlanCard();
	renderInstructionSources();
	if (!state.messages.length) renderEmptyState(state.serverConnected);
	renderDesktopWorkStats();
	setStreamingState(Boolean(state.isStreaming));
	renderComposerStatusRow();
	if (state.session) upsertServerConversation(state.session);
}

// refreshConversations=false skips the /sessions round-trip. Switching or creating a
// conversation inside the already-loaded project does not need the whole listing rebuilt —
// upsertServerConversation() below folds the new/updated session into the sidebar locally.
async function syncServerSession({ loadModels = true, refreshConversations = true } = {}) {
	const syncGeneration = ++sessionSyncGeneration;
	const project = activeProject();
	const requests = [
		requestServer("/session"),
		requestServer("/session/messages"),
		refreshConversations
			? requestServer(`/sessions${project?.path ? `?cwd=${encodeURIComponent(project.path)}` : ""}`)
			: Promise.resolve(undefined),
	];
	if (loadModels) requests.push(requestServer("/config/providers"));
	const [session, messageData, sessionListData, modelData] = await Promise.all(requests);
	if (syncGeneration !== sessionSyncGeneration) return false;
	const snapshotInstanceId = session.serverInstanceId || messageData.serverInstanceId;
	if (state.serverInstanceId && snapshotInstanceId && snapshotInstanceId !== state.serverInstanceId) return false;
	const snapshotSequences = [session.serverSequence, messageData.serverSequence]
		.filter((value) => Number.isSafeInteger(value));
	const snapshotSequence = snapshotSequences.length > 0 ? Math.min(...snapshotSequences) : undefined;
	if (snapshotSequence !== undefined && snapshotSequence < state.lastServerStateSequence) return false;
	const currentSessionName = state.session?.sessionId === session.sessionId ? state.session.sessionName : undefined;
	const previousSessionId = state.session?.sessionId;
	if (!session.sessionName && currentSessionName) session.sessionName = currentSessionName;
	state.session = session;
	if (state.skillCommandsLoadedFor && state.skillCommandsLoadedFor !== skillCatalogKey()) {
		state.skillCommands = [];
		state.skillCommandsLoadedFor = undefined;
		closeSkillMenu();
	}
	if (previousSessionId && previousSessionId !== session.sessionId) {
		state.workflowPlanCollapsed = false;
		state.workflowPlanAutoCollapsedKey = undefined;
	}
	if (snapshotInstanceId) state.serverInstanceId = snapshotInstanceId;
	if (snapshotSequence !== undefined) state.lastServerSequence = Math.max(state.lastServerSequence, snapshotSequence);
	if (snapshotSequence !== undefined) state.lastServerStateSequence = Math.max(state.lastServerStateSequence, snapshotSequence);
	if (modelData) state.models = Array.isArray(modelData.models) ? modelData.models : [];
	state.messages = Array.isArray(messageData.messages) ? messageData.messages : [];
	state.messageTimings = Object.fromEntries((Array.isArray(messageData.messageTimings) ? messageData.messageTimings : [])
		.map((timing) => [String(timing.messageTimestamp), timing]));
	state.hasSubmittedMessage = state.messages.some((message) => message?.role === "user");
	if (sessionListData) replaceServerConversations(sessionListData.sessions);
	setMemoryState(session.memoryState);
	upsertServerConversation(session);
	setStreamingState(Boolean(session.isStreaming));
	renderServerMessages(state.messages);
	if (session.pendingUserInput) renderUserInputCard(session.pendingUserInput);
	else clearUserInputComposer();
	updateModelSelect();
	renderWorkflowControls();
	renderWorkflowPlanCard();
	renderInstructionSources();
	renderConversations();
	if (elements.settingsDialog?.open) renderPreferencesControls();
	return true;
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
		appendAssistantNotice(error.message, uiText("modelSwitchFailed"));
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
		appendAssistantNotice(error.message, uiText("thinkingSwitchFailed"));
		renderThinkingControl();
	} finally {
		elements.thinkingScale.classList.remove("busy");
	}
}

async function refreshFileTree() {
	elements.fileTree.innerHTML = `<div class="tree-loading">${uiText("readingWorkspace")}</div>`;
	try {
		const result = await desktop.workspace.tree();
		state.fileTree = result.nodes;
		renderFileTree(elements.fileFilterInput.value);
	} catch (error) {
		elements.fileTree.textContent = uiText("fileReadFailed", { message: error.message });
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
		empty.textContent = uiText("noMatchingFiles");
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
	elements.diffStats.textContent = uiText("readingGitDiff");
	elements.diffView.replaceChildren();
	selectInspectorTab("diff");
	renderFileTree(elements.fileFilterInput.value);
	try {
		const result = await desktop.workspace.diff(relativePath);
		renderDiff(result.diff);
	} catch (error) {
		elements.diffStats.textContent = uiText("readFailed");
		const empty = document.createElement("div");
		empty.className = "diff-empty";
		empty.append(icon("diff"));
		const strong = document.createElement("strong");
		strong.textContent = uiText("cannotShowDiff");
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
	elements.diffStats.textContent = uiText("diffStats", { added, removed });
}

const INSPECTOR_TAB_CONFIG = {
	diff: { labelKey: "review", icon: "#i-diff" },
	browser: { labelKey: "newTab", icon: "#i-globe" },
	files: { labelKey: "files", icon: "#i-folder" },
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
		const label = config.labelKey ? uiText(config.labelKey) : config.label;
		const isActive = state.activeInspectorTab === tabId;

		const pill = document.createElement("div");
		pill.className = `inspector-tab-pill ${isActive ? "active" : ""}`;
		pill.innerHTML = `
			<svg class="tab-icon"><use href="${config.icon}"/></svg>
			<span>${label}</span>
			<span class="inspector-tab-close" data-close="${tabId}" title="${uiText("closeTab")}"><svg><use href="#i-plus"/></svg></span>
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
		elements.browserStatus.textContent = uiText("invalidAddress");
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
			el.append(icon(file.kind === "video" ? "video" : "file"), document.createTextNode(file.name));
			el.addEventListener("click", () => showFileContentModal(file.name, file.content || file.path || ""));
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

function appendRenderedMarkdown(parent, markdown, className) {
	if (!markdown) return;
	const block = document.createElement("div");
	block.className = className;
	block.innerHTML = renderMarkdown(markdown);
	parent.append(block);
}

function renderAssistantText(target, text) {
	const proposal = extractProposedPlan(text);
	if (!proposal) {
		target.classList.remove("has-proposed-plan");
		delete target.dataset.proposedPlanExpanded;
		const html = renderMarkdown(text);
		if (target.innerHTML !== html) target.innerHTML = html;
		return;
	}

	const isFirstPlanRender = !target.classList.contains("has-proposed-plan");
	const wasExpanded = target.dataset.proposedPlanExpanded === "true";
	target.classList.add("has-proposed-plan");
	target.replaceChildren();
	appendRenderedMarkdown(target, proposal.before, "proposed-plan-context");

	const card = document.createElement("section");
	card.className = `proposed-plan-card${wasExpanded ? " expanded" : ""}${isFirstPlanRender ? " is-reformatting" : ""}`;
	const currentProposal = Boolean(state.session?.workflowProposal?.markdown)
		&& proposal.plan.trim() === state.session.workflowProposal.markdown.trim();
	card.dataset.currentProposal = String(currentProposal);
	const header = document.createElement("div");
	header.className = "proposed-plan-header";
	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.className = "proposed-plan-toggle";
	toggle.setAttribute("aria-expanded", String(wasExpanded));
	toggle.setAttribute("aria-label", uiText(wasExpanded ? "proposedPlanCollapse" : "proposedPlanExpand"));
	const title = document.createElement("strong");
	title.textContent = uiText("proposedPlanReady");
	const label = document.createElement("span");
	label.className = "proposed-plan-label";
	const planIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	planIcon.setAttribute("aria-hidden", "true");
	planIcon.innerHTML = '<use href="#i-list"/>';
	const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	chevron.setAttribute("aria-hidden", "true");
	chevron.innerHTML = '<use href="#i-chevron"/>';
	label.append(planIcon, title);
	toggle.append(label, chevron);

	const processButton = document.createElement("button");
	processButton.type = "button";
	processButton.className = "proposed-plan-process";
	processButton.textContent = uiText("proposedPlanProcess");
	const processIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	processIcon.setAttribute("aria-hidden", "true");
	processIcon.innerHTML = '<use href="#i-chevron"/>';
	processButton.append(processIcon);
	processButton.title = uiText("proposedPlanProcessDescription");
	processButton.setAttribute("aria-label", uiText("proposedPlanProcessDescription"));
	processButton.hidden = !currentProposal || state.session?.collaborationMode !== "plan";
	processButton.disabled = processButton.hidden
		|| state.isStreaming
		|| Boolean(state.session?.isStreaming || state.session?.isCompacting)
		|| !state.serverConnected;
	const refineInput = document.createElement("input");
	refineInput.type = "text";
	refineInput.className = "proposed-plan-refine";
	refineInput.placeholder = uiText("proposedPlanRefinePlaceholder");
	refineInput.setAttribute("aria-label", uiText("proposedPlanRefinePlaceholder"));
	const refineButton = document.createElement("button");
	refineButton.type = "button";
	refineButton.className = "proposed-plan-refine-send";
	refineButton.setAttribute("aria-label", uiText("proposedPlanRefine"));
	refineButton.title = uiText("proposedPlanRefine");
	refineButton.innerHTML = '<svg aria-hidden="true"><use href="#i-send"/></svg>';
	const refineShell = document.createElement("div");
	refineShell.className = "proposed-plan-refine-shell";
	refineShell.append(refineInput, refineButton);

	const body = document.createElement("div");
	body.className = "proposed-plan-body";
	body.innerHTML = renderMarkdown(proposal.plan);
	const actions = document.createElement("div");
	actions.className = "proposed-plan-actions";
	toggle.addEventListener("click", () => {
		const expanded = card.classList.toggle("expanded");
		target.dataset.proposedPlanExpanded = String(expanded);
		toggle.setAttribute("aria-expanded", String(expanded));
		toggle.setAttribute("aria-label", uiText(expanded ? "proposedPlanCollapse" : "proposedPlanExpand"));
	});
	processButton.addEventListener("click", () => void processProposedPlan(processButton));
	const submitRefinement = async () => {
		const request = refineInput.value.trim();
		if (!currentProposal || !request || state.isStreaming || state.session?.isCompacting || state.session?.pendingUserInput || !state.serverConnected) return;
		refineInput.disabled = true; refineButton.disabled = true;
		elements.composerInput.value = uiText("proposedPlanRefinePrompt", { request });
		try { await sendMessage(); } finally { refineInput.disabled = false; refineButton.disabled = false; }
	};
	refineButton.addEventListener("click", () => void submitRefinement());
	refineInput.addEventListener("input", updateProposedPlanControls);
	refineInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void submitRefinement(); } });
	header.append(toggle);
	actions.append(processButton, refineShell);
	card.append(header, body, actions);
	target.append(card);
	appendRenderedMarkdown(target, proposal.after, "proposed-plan-context");
	if (isFirstPlanRender) {
		requestAnimationFrame(() => {
			if (!card.isConnected) return;
			card.classList.remove("is-reformatting");
		});
	}
	updateProposedPlanControls();
	queueMicrotask(updateProposedPlanControls);
}

function updateProposedPlanControls() {
	const buttons = [...elements.messageColumn.querySelectorAll(".proposed-plan-process")];
	const mode = state.session?.collaborationMode === "build" ? "build" : "plan";
	const busy = Boolean(state.isStreaming || state.session?.isStreaming || state.session?.isCompacting || state.session?.pendingUserInput);
	buttons.forEach((button) => {
		const card = button.closest(".proposed-plan-card");
		const current = card?.dataset.currentProposal === "true";
		const hasDraft = Boolean(card?.querySelector(".proposed-plan-refine")?.value.trim());
		button.hidden = !current || mode !== "plan";
		button.disabled = !current || mode !== "plan" || busy || hasDraft || !state.serverConnected;
		card?.querySelectorAll(".proposed-plan-refine, .proposed-plan-refine-send").forEach((control) => {
			control.disabled = !current || mode !== "plan" || busy || !state.serverConnected;
		});
	});
}

function clearUserInputComposer({ restoreFocus = false } = {}) {
	const composerHost = elements.composer?.parentElement;
	composerHost?.querySelector(":scope > .composer-user-input")?.remove();
	composerHost?.classList.remove("has-user-input");
	if (elements.composer) {
		elements.composer.hidden = false;
		elements.composer.style.removeProperty("display");
	}
	if (elements.composerInput) {
		elements.composerInput.disabled = false;
		if (restoreFocus) elements.composerInput.focus();
	}
	state.pendingUserInputId = undefined;
}

function renderUserInputCard(request) {
	if (!request?.requestId || !Array.isArray(request.questions) || request.questions.length === 0) return;
	const existing = document.querySelector(`[data-user-input-request-id="${CSS.escape(request.requestId)}"]`);
	if (existing) return;
	clearUserInputComposer();
	state.pendingUserInputId = request.requestId;
	const composerWidth = elements.composer.getBoundingClientRect().width;
	elements.composerInput.disabled = true;
	elements.composer.hidden = true;
	elements.composer.style.display = "none";
	const composerHost = elements.composer.parentElement;
	composerHost?.classList.add("has-user-input");
	const card = document.createElement("div");
	card.className = "user-input-request composer-user-input";
	card.dataset.userInputRequestId = request.requestId;
	card.dataset.toolCallId = request.toolCallId || "";
	card.dataset.composerWidth = String(composerWidth);
	if (composerWidth > 0) card.style.width = `${composerWidth}px`;
	const form = document.createElement("form");
	form.className = "user-input-card";
	form.setAttribute("aria-labelledby", `ask-title-${request.requestId}`);
	card.append(form);
	elements.composer.insertAdjacentElement("afterend", card);
	const answers = new Map();
	let questionIndex = 0;
	let submitting = false;

	const respond = async (cancelled) => {
		if (submitting) return;
		submitting = true;
		card.classList.remove("error");
		card.classList.add("submitting");
		form.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
		form.querySelector(".user-input-status").textContent = uiText("askUserSubmitting");
		try {
			await requestServer(`/session/user-input/${encodeURIComponent(request.requestId)}`, "POST", {
				cancelled,
				answers: cancelled ? [] : request.questions.map((question) => answers.get(question.id)),
			});
			if (state.session?.pendingUserInput?.requestId === request.requestId) state.session.pendingUserInput = undefined;
			clearUserInputComposer({ restoreFocus: true });
		} catch (error) {
			submitting = false;
			card.classList.remove("submitting");
			card.classList.add("error");
			form.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
			form.querySelector(".user-input-status").textContent = error.message;
		}
	};

	const renderQuestion = () => {
		const question = request.questions[questionIndex];
		const saved = answers.get(question.id);
		form.replaceChildren();
		const heading = document.createElement("div");
		heading.className = "user-input-heading";
		const title = document.createElement("strong");
		title.id = `ask-title-${request.requestId}`;
		title.textContent = uiText("askUserTitle");
		const progress = document.createElement("span");
		progress.textContent = `${questionIndex + 1}/${request.questions.length}`;
		heading.append(title, progress);
		const fieldset = document.createElement("fieldset");
		fieldset.dataset.questionId = question.id;
		const legend = document.createElement("legend");
		legend.textContent = question.header;
		const copy = document.createElement("p");
		copy.textContent = question.question;
		fieldset.append(legend, copy);
		for (const option of question.options || []) {
			const label = document.createElement("label");
			label.className = "user-input-option";
			const radio = document.createElement("input");
			radio.type = "radio";
			radio.name = question.id;
			radio.value = option.label;
			radio.checked = saved?.selectedLabel === option.label;
			const body = document.createElement("span");
			body.innerHTML = `<b></b><small></small>`;
			body.querySelector("b").textContent = option.recommended ? `${option.label} · ${uiText("askUserRecommended")}` : option.label;
			body.querySelector("small").textContent = option.description;
			label.append(radio, body);
			fieldset.append(label);
		}
		const free = document.createElement("input");
		free.type = "text";
		free.className = "user-input-free";
		free.placeholder = uiText("askUserFreePlaceholder");
		free.setAttribute("aria-label", uiText("askUserFreePlaceholder"));
		free.value = saved && !saved.selectedLabel ? saved.value : "";
		fieldset.append(free);
		const actions = document.createElement("div");
		actions.className = "user-input-actions";
		const status = document.createElement("span");
		status.className = "user-input-status";
		status.setAttribute("aria-live", "polite");
		status.textContent = uiText("askUserPending");
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "user-input-cancel";
		cancel.textContent = uiText("askUserCancel");
		const submit = document.createElement("button");
		submit.type = "submit";
		submit.className = "user-input-confirm";
		const finalQuestion = questionIndex === request.questions.length - 1;
		submit.setAttribute("aria-label", uiText(finalQuestion ? "askUserSubmit" : "askUserContinue"));
		submit.title = uiText(finalQuestion ? "askUserSubmit" : "askUserContinue");
		submit.innerHTML = `<svg aria-hidden="true"><use href="#${finalQuestion ? "i-check" : "i-chevron"}"/></svg>`;
		actions.append(status, cancel, submit);
		form.append(heading, fieldset, actions);
		cancel.addEventListener("click", () => void respond(true));
		form.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); void respond(true); } };
		form.onsubmit = (event) => {
			event.preventDefault();
			const selected = fieldset.querySelector(`input[name="${CSS.escape(question.id)}"]:checked`)?.value;
			const custom = free.value.trim();
			const value = custom || selected || "";
			if (!value) {
				card.classList.add("error");
				status.textContent = uiText("askUserRequired");
				(question.options?.length ? fieldset.querySelector("input") : free)?.focus();
				return;
			}
			answers.set(question.id, { id: question.id, value, ...(selected && !custom ? { selectedLabel: selected } : {}) });
			if (!finalQuestion) {
				questionIndex += 1;
				card.classList.remove("error");
				renderQuestion();
				return;
			}
			void respond(false);
		};
		free.addEventListener("input", () => {
			if (free.value.trim()) fieldset.querySelectorAll('input[type="radio"]').forEach((radio) => { radio.checked = false; });
		});
		fieldset.querySelectorAll('input[type="radio"]').forEach((radio) => radio.addEventListener("change", () => { free.value = ""; }));
		requestAnimationFrame(() => (saved?.selectedLabel ? fieldset.querySelector('input[type="radio"]:checked') : free)?.focus({ preventScroll: true }));
	};

	renderQuestion();
}

async function processProposedPlan(button) {
	if (button.disabled || state.isStreaming || state.session?.isCompacting) return;
	button.disabled = true;
	const changed = await changeCollaborationMode("build");
	if (!changed) {
		updateProposedPlanControls();
		return;
	}
	elements.composerInput.value = uiText("proposedPlanProcessPrompt");
	await sendMessage({ workflowAction: "process_proposal" });
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

async function sendMessage({ workflowAction } = {}) {
	const message = elements.composerInput.value.trim();
	const hasImages = state.attachedImages && state.attachedImages.length > 0;
	const hasFiles = state.attachedFiles && state.attachedFiles.length > 0;
	if (!message && !hasImages && !hasFiles) return;

	if (!state.serverConnected) {
		elements.serverDialog.showModal();
		return;
	}
	if (!state.hasSubmittedMessage) {
		try {
			await alignNewConversationWithActiveProject();
		} catch (error) {
			appendAssistantNotice(error.message, uiText("syncFailed"));
			return;
		}
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
	let optimisticUserMessage;

	let payloadMessage = message;
	if (hasFiles) {
		messageFiles.forEach((file) => {
			payloadMessage += `\n\n${attachmentTools.attachmentPrompt(file)}`;
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
	if (elements.conversationPane?.classList.contains("is-empty-state")) {
		transitionFromEmptyState();
	}
	if (!shouldQueue) {
		const optimisticContent = messageImages.length > 0
			? [
				{ type: "text", text: payloadMessage },
				...messageImages.map((image) => ({
					type: "image",
					image: { data: image.data, mimeType: image.mimeType },
				})),
			]
			: payloadMessage;
		optimisticUserMessage = {
			role: "user",
			content: optimisticContent,
			timestamp: Date.now(),
			// The server emits its authoritative user entry separately. Keep this
			// marker local so that event can replace, rather than duplicate, it.
			_metisOptimistic: true,
		};
		state.messages.push(optimisticUserMessage);
		renderServerMessages(state.messages);
		scrollMessagesToBottom(false, true);
	}

	if (!shouldQueue) setStreamingState(true);
	else if (wasStreaming) setStreamingState(true);
	try {
		if (shouldQueue) await requestServer("/session/follow-up", "POST", { message: payloadMessage, images });
		else await requestServer("/session/prompt", "POST", { message: payloadMessage, images, ...(workflowAction ? { workflowAction } : {}) });
		if (wasNewConversation && !shouldQueue) {
			// Persisted sessions exist as soon as preflight accepts the first prompt. Fold that
			// session into the sidebar immediately instead of waiting for the final Agent event.
			void syncServerSession({ loadModels: false, refreshConversations: false })
				.catch((error) => appendAssistantNotice(error.message, uiText("syncFailed")));
		}
	} catch (error) {
		if (optimisticUserMessage) {
			const optimisticIndex = state.messages.indexOf(optimisticUserMessage);
			if (optimisticIndex !== -1) state.messages.splice(optimisticIndex, 1);
		}
		if (wasNewConversation && !state.messages.some((item) => item?.role === "user")) {
			state.hasSubmittedMessage = false;
			renderComposerStatusRow();
		}
		elements.composerInput.value = message;
		state.attachedImages = messageImages;
		state.attachedFiles = messageFiles;
		renderAttachmentPreviews();
		autoSizeComposer();
		setStreamingState(wasStreaming);
		if (optimisticUserMessage) renderServerMessages(state.messages);
		appendAssistantNotice(error.message, uiText("sendFailed"));
	}
}

async function abortGeneration() {
	if (!state.serverConnected || !state.isStreaming) return;
	let abortAccepted = false;
	try {
		await requestServer("/session/abort", "POST", {});
		abortAccepted = true;
	} catch (error) {
		appendAssistantNotice(error.message, uiText("stopFailed"));
	} finally {
		setStreamingState(false);
	}
	if (abortAccepted) {
		// The abort endpoint persists the aborted assistant/checkpoint before it
		// returns. Reconcile from that snapshot so Working/thoughts/plan state end
		// together even when the activity event was lost during disconnect.
		try {
			await syncServerSession({ loadModels: false, refreshConversations: false });
		} catch (error) {
			// Keep the successful abort visible; a transient refresh must not create a
			// misleading "sync failed" assistant card or resurrect Working state.
			console.warn("Abort snapshot refresh failed", error);
		}
	}
}

function autoSizeComposer() {
	const input = elements.composerInput;
	if (!input || (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))) return;
	const computed = getComputedStyle(input);
	const minimum = Number.parseFloat(computed.minHeight) || 48;
	const maximum = Number.parseFloat(computed.maxHeight) || 200;
	input.style.height = "auto";
	const height = Math.min(Math.max(input.scrollHeight, minimum), maximum);
	input.style.height = `${height}px`;
	input.style.overflowY = input.scrollHeight > maximum ? "auto" : "hidden";
}

async function connectServer() {
	const button = document.querySelector("#connectServerButton");
	button.disabled = true;
	button.textContent = uiText("connecting");
	const result = await desktop.metis.connect({
		baseUrl: document.querySelector("#serverUrlInput").value,
		username: document.querySelector("#serverUsernameInput").value,
		password: document.querySelector("#serverPasswordInput").value,
	});
	button.disabled = false;
	button.textContent = uiText("connect");
	if (result.ok) {
		state.serverConnected = true;
		try {
			const project = activeProject();
			if (project) {
				await activateProject(project, { record: false, loadModels: true, syncSession: true });
			} else {
				await requestServer("/session/new", "POST", { collaborationMode: "plan" });
				await syncServerSession({ loadModels: true });
			}
			await refreshAllProjectConversations();
			elements.serverDialog.close();
			finishServerLoading();
		} catch (error) {
			button.textContent = uiText("connectedSyncFailed");
			showServerLoadingFailure();
			appendAssistantNotice(error.message, uiText("syncFailed"));
		}
	} else {
		button.textContent = uiText("connectFailedRetry");
	}
}

async function autoConnectServer() {
	if (state.serverConnected) return true;
	if (autoConnectServerRequest) return autoConnectServerRequest;
	autoConnectServerRequest = performAutoConnectServer();
	try {
		return await autoConnectServerRequest;
	} finally {
		autoConnectServerRequest = undefined;
	}
}

async function performAutoConnectServer() {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		if (state.serverConnected) return true;
		let result;
		try {
			result = await desktop.metis.connect({
				baseUrl: "http://127.0.0.1:4096",
				username: "metis",
				password: "",
			});
		} catch (error) {
			// IPC 异常不应中断重试循环；记录后按 250ms 节奏继续。
			console.error("[desktop] autoConnectServer connect error:", error);
			await new Promise((resolve) => setTimeout(resolve, 250));
			continue;
		}
		if (result.ok) {
			state.serverConnected = true;
			try {
				const project = activeProject();
				if (project) {
					await activateProject(project, { record: false, loadModels: true, syncSession: true });
				} else {
					await requestServer("/session/new", "POST", { collaborationMode: "plan" });
					await syncServerSession({ loadModels: true });
				}
				await refreshAllProjectConversations();
				finishServerLoading();
			} catch (err) {
				console.error("[desktop] autoConnectServer sync error:", err);
				showServerLoadingFailure();
			}
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}

let extensionUiDialogQueue = Promise.resolve();

function showExtensionUiDialog(event) {
	const dialog = elements.extensionUiDialog;
	if (!dialog || !elements.extensionUiForm) throw new Error("Desktop interaction dialog is unavailable");

	const method = event.method;
	const isConfirm = method === "confirm";
	const isSelect = method === "select";
	const options = isSelect && Array.isArray(event.options) ? event.options : [];
	elements.extensionUiEyebrow.textContent = uiText("providerAuthorization");
	elements.extensionUiTitle.textContent = isConfirm
		? event.title || uiText("confirm")
		: isSelect
			? uiText("choose")
			: uiText("continueOperation");
	elements.extensionUiMessage.textContent = isConfirm
		? event.message || ""
		: event.title || event.message || uiText("enterValue");
	elements.extensionUiField.hidden = isConfirm;
	elements.extensionUiFieldLabel.textContent = isSelect ? uiText("choose") : uiText("enterValue");
	elements.extensionUiInput.hidden = isSelect;
	elements.extensionUiSelect.hidden = !isSelect;
	elements.extensionUiInput.value = event.prefill || "";
	elements.extensionUiInput.placeholder = event.placeholder || "";
	elements.extensionUiSelect.replaceChildren(...options.map((option) => new Option(option, option)));
	elements.extensionUiSubmitButton.disabled = isSelect && options.length === 0;
	elements.extensionUiSubmitButton.textContent = uiText("confirm");
	elements.extensionUiCancelButton.textContent = uiText("cancel");
	elements.extensionUiHint.textContent = uiText("completeToContinue");

	return new Promise((resolve) => {
		let settled = false;
		const cleanup = () => {
			elements.extensionUiForm.removeEventListener("submit", submit);
			elements.extensionUiCancelButton.removeEventListener("click", cancel);
			dialog.removeEventListener("cancel", cancel);
			dialog.removeEventListener("close", cancel);
		};
		const finish = (response) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (dialog.open) dialog.close();
			resolve(response);
		};
		const cancel = (domEvent) => {
			domEvent?.preventDefault?.();
			finish(isConfirm ? { id: event.id, confirmed: false } : { id: event.id, cancelled: true });
		};
		const submit = (domEvent) => {
			domEvent.preventDefault();
			if (isConfirm) finish({ id: event.id, confirmed: true });
			else finish({ id: event.id, value: isSelect ? elements.extensionUiSelect.value : elements.extensionUiInput.value });
		};

		elements.extensionUiForm.addEventListener("submit", submit);
		elements.extensionUiCancelButton.addEventListener("click", cancel);
		dialog.addEventListener("cancel", cancel);
		dialog.addEventListener("close", cancel);
		dialog.showModal();
		requestAnimationFrame(() => (isSelect ? elements.extensionUiSelect : elements.extensionUiInput).focus());
	});
}

function queueExtensionUiDialog(event) {
	const queued = extensionUiDialogQueue.then(() => showExtensionUiDialog(event));
	extensionUiDialogQueue = queued.catch(() => undefined);
	return queued;
}

async function handleExtensionUiRequest(event) {
	if (event.method === "setStatus") {
		if (event.statusKey === "dream") console.warn("Legacy Dream extension status ignored; use MemoryState.");
		else if (event.statusText) console.info("[desktop extension]", event.statusText);
		return;
	}
	if (event.method === "notify") {
		const message = event.message;
		if (message) console[event.notifyType === "error" ? "error" : "info"]("[desktop extension]", message);
		return;
	}
	if (event.method === "open_url") {
		if (event.url) await desktop.openExternal(event.url);
		if (event.instructions) console.info("[desktop extension]", event.instructions);
		return;
	}
	if (event.method === "set_editor_text") {
		elements.composerInput.value = event.text || "";
		autoSizeComposer();
		return;
	}

	const interactiveMethods = new Set(["confirm", "select", "input", "editor"]);
	const response = interactiveMethods.has(event.method) ? await queueExtensionUiDialog(event) : undefined;
	if (response) await requestServer("/extension/ui-response", "POST", response);
}

function acceptServerEvent(event) {
	const instanceId = event?.serverInstanceId;
	const sequence = event?.serverSequence;
	if (!instanceId || !Number.isSafeInteger(sequence)) return true;

	if (event.type === "server.connected") {
		if (state.serverInstanceId !== instanceId) {
			state.serverInstanceId = instanceId;
			state.lastServerSequence = 0;
			state.lastServerStateSequence = 0;
		}
		// server.connected 是连接建立信号，不受 sequence 去重约束：
		// SSE 重连发生在两次 heartbeat 之间时 sequence 可能未前进，若被拒收会导致
		// state.serverConnected 卡死在 false（模型列表永远显示"连接 Server 后载入模型"）。
		// 放行并顺带推进 lastServerSequence（若更新），后续事件仍按单调序列过滤。
		if (sequence > state.lastServerSequence) state.lastServerSequence = sequence;
		return true;
	} else {
		if (state.serverInstanceId && state.serverInstanceId !== instanceId) return false;
		if (!state.serverInstanceId) state.serverInstanceId = instanceId;
		if (event.type !== "server.session_changed"
			&& event.serverSessionId
			&& state.session?.sessionId
			&& event.serverSessionId !== state.session.sessionId) {
			return false;
		}
	}

	if (sequence <= state.lastServerSequence) return false;
	state.lastServerSequence = sequence;
	if (!["server.connected", "server.heartbeat", "extension_ui_request", "user_input_request", "extension_error"].includes(event.type)) {
		state.lastServerStateSequence = sequence;
	}
	return true;
}

function upsertStreamMessage(message, mergeStreaming = false) {
	if (!message) return;
	const exactIndex = state.messages.findIndex((candidate) =>
		(candidate.id && message.id && candidate.id === message.id)
		|| (candidate.role === message.role && candidate.timestamp === message.timestamp));
	// Only one non-queued prompt can be optimistic at a time. Its timestamp is
	// client-generated, so it cannot reliably match the server-side timestamp.
	const optimisticIndex = exactIndex === -1 && message.role === "user"
		? state.messages.findIndex((candidate) => candidate?.role === "user" && candidate?._metisOptimistic === true)
		: -1;
	const index = exactIndex === -1 ? optimisticIndex : exactIndex;
	if (index === -1) {
		state.messages.push(message);
		return;
	}
	state.messages[index] = mergeStreaming ? mergeStreamingMessage(state.messages[index], message) : message;
}

function handleMetisEvent(event) {
	if (!acceptServerEvent(event)) return;
	if (event.type === "extension_ui_request") {
		void handleExtensionUiRequest(event).catch((error) => console.error("[desktop extension]", error));
		return;
	}
	if (event.type === "user_input_request") {
		renderUserInputCard(event.request);
		return;
	}
	if (!event?.type || event.type === "server.heartbeat") return;
	if (event.type === "server.connected") {
		if (serverDisconnectTimer) {
			clearTimeout(serverDisconnectTimer);
			serverDisconnectTimer = undefined;
		}
		state.serverConnected = true;
		if (state.session && !projectSwitchInProgress) {
			void syncServerSession({ loadModels: false }).catch((error) => appendAssistantNotice(error.message, uiText("syncFailed")));
		}
		return;
	}
	if (event.type === "server.session_changed") {
		if (!projectSwitchInProgress) {
			// A session change cannot alter any *other* session's listing entry, and
			// upsertServerConversation() inside the sync folds the current one into the sidebar.
			// Leaving refreshConversations at its default put the /sessions round-trip (822 KB at
			// ~380 sessions) straight back onto every switch and every new conversation.
			void syncServerSession({ loadModels: false, refreshConversations: false }).catch((error) => appendAssistantNotice(error.message, uiText("syncFailed")));
		}
		return;
	}
	if (event.type === "thinking_level_changed" && state.session) {
		state.session.thinkingLevel = event.level;
		updateModelSelect();
		return;
	}
	if (event.type === "collaboration_mode_changed" && state.session) {
		state.session.collaborationMode = event.mode;
		renderWorkflowControls();
		renderWorkflowPlanCard();
		updateProposedPlanControls();
		if (elements.settingsDialog?.open) renderPreferencesControls();
		return;
	}
	if (event.type === "memory_state_changed") {
		setMemoryState(event.state);
		if (state.session) state.session.memoryState = state.memoryState;
		if (elements.settingsDialog?.open) renderPreferencesControls();
		return;
	}
	if (event.type === "memory_records_changed") {
		void syncServerSession({ loadModels: false, refreshConversations: false });
		return;
	}
	if (event.type === "entry_appended" && event.entry?.type === "custom" && ["workflow_plan", "workflow_plan_reset"].includes(event.entry.customType) && state.session) {
		state.session.workflowPlan = event.entry.customType === "workflow_plan" ? normalizeWorkflowPlan(event.entry.data) : undefined;
		state.workflowPlanCollapsed = false;
		renderWorkflowPlanCard();
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
		if (event.status === "completed" && typeof event.name === "string" && event.name.trim()) {
			state.session.sessionName = event.name.trim();
		}
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
		refreshWorkTimerTitles();
		refreshAssistantTurnActivityState();
		return;
	}
	if (event.type === "message_end") {
		if (event.message) {
			upsertStreamMessage(event.message);
			flushServerMessageRender();
		}
		return;
	}
	const activity = classifyDesktopActivityEvent(event);
	if (activity === "complete") {
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
		// Same reasoning as server.session_changed: a finished turn only changes the current
		// session, and session_info_changed already pushes its new name through the upsert.
		void syncServerSession({ loadModels: false, refreshConversations: false }).catch((error) => appendAssistantNotice(error.message, uiText("syncFailed")));
	} else if (activity === "active") {
		setStreamingState(true);
		
		if (event.type === "message_start") {
			if (event.message) {
				const key = event.message.id || event.message.timestamp;
				if (!state.messageStartTimes) state.messageStartTimes = {};
				state.messageStartTimes[key] = Date.now();

				upsertStreamMessage(event.message);
				scheduleServerMessageRender();
			}
		} else if (event.type === "message_update") {
			if (event.message) {
				const key = event.message.id || event.message.timestamp;
				if (!state.messageStartTimes) state.messageStartTimes = {};
				if (!state.messageStartTimes[key]) {
					state.messageStartTimes[key] = Date.now();
				}

				upsertStreamMessage(event.message, true);
				scheduleServerMessageRender();
			}
		}
	}
}

document.querySelectorAll(".inspector-shortcut").forEach((button) => button.addEventListener("click", () => toggleInspectorTab(button.dataset.openInspector)));
document.querySelector("#sidebarToggle")?.addEventListener("click", (e) => {
	e.preventDefault();
	e.stopPropagation();
	const isCollapsed = elements.appShell.classList.toggle("sidebar-collapsed");
	const toggleBtn = document.querySelector("#sidebarToggle");
	if (toggleBtn) {
		toggleBtn.setAttribute("aria-label", uiText(isCollapsed ? "expandSidebar" : "collapseSidebar"));
		toggleBtn.setAttribute("title", uiText(isCollapsed ? "expandSidebar" : "collapseSidebar"));
	}
});
document.querySelector("#inspectorToggle")?.addEventListener("click", (e) => {
	e.preventDefault();
	e.stopPropagation();
	const isCollapsed = elements.appShell.classList.toggle("inspector-collapsed");
	const toggleBtn = document.querySelector("#inspectorToggle");
	if (toggleBtn) {
		toggleBtn.setAttribute("aria-label", uiText(isCollapsed ? "expandSidebar" : "collapseSidebar"));
		toggleBtn.setAttribute("title", uiText(isCollapsed ? "expandSidebar" : "collapseSidebar"));
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
document.querySelector("#newChatButton")?.addEventListener("click", () => void createConversation());
document.querySelector("#collapsedNewChat")?.addEventListener("click", () => void createConversation());
document.querySelector("#sidebarSettingsButton")?.addEventListener("click", showPreferencesDialog);
document.querySelector("#settingsCloseButton")?.addEventListener("click", hidePreferencesDialog);
document.querySelector("#settingsShowOnboarding")?.addEventListener("click", () => {
	hidePreferencesDialog();
	window.MetisOnboarding?.reset();
});
elements.settingsDialog?.addEventListener("click", (event) => {
	if (event.target === elements.settingsDialog) hidePreferencesDialog();
});
document.querySelectorAll("[data-settings-panel]").forEach((button) => {
	button.addEventListener("click", () => selectPreferencesPanel(button.dataset.settingsPanel));
});
elements.settingsLanguageSelect?.addEventListener("change", () => {
	const language = elements.settingsLanguageSelect.value;
	applyUiLanguage(language);
	if (state.serverConnected) void runPreferencesCommand(`/language ${language}`, elements.settingsGeneralFeedback);
});
elements.settingsAutoCompactInput?.addEventListener("change", () => void updatePreferencesSession(
	{ autoCompactionEnabled: elements.settingsAutoCompactInput.checked },
	elements.settingsGeneralFeedback,
));
elements.settingsAutoRetryInput?.addEventListener("change", () => void updatePreferencesSession(
	{ autoRetryEnabled: elements.settingsAutoRetryInput.checked },
	elements.settingsGeneralFeedback,
));
elements.settingsSteeringModeSelect?.addEventListener("change", () => void updatePreferencesSession(
	{ steeringMode: elements.settingsSteeringModeSelect.value },
	elements.settingsGeneralFeedback,
));
elements.settingsFollowUpModeSelect?.addEventListener("change", () => void updatePreferencesSession(
	{ followUpMode: elements.settingsFollowUpModeSelect.value },
	elements.settingsGeneralFeedback,
));
elements.settingsCollaborationModeSelect?.addEventListener("change", () => void changeCollaborationMode(
	elements.settingsCollaborationModeSelect.value,
	elements.settingsAgentFeedback,
));
elements.settingsModelSelect?.addEventListener("change", async () => {
	setPreferencesFeedback(elements.settingsModelFeedback, uiText("applying"));
	await changeModel(Number(elements.settingsModelSelect.value));
	renderPreferencesControls();
	setPreferencesFeedback(elements.settingsModelFeedback, uiText("settingsModelSwitched"));
});
elements.settingsThinkingSelect?.addEventListener("change", async () => {
	setPreferencesFeedback(elements.settingsModelFeedback, uiText("applying"));
	await changeThinkingLevel(elements.settingsThinkingSelect.value);
	renderPreferencesControls();
	setPreferencesFeedback(elements.settingsModelFeedback, uiText("settingsThinkingSwitched"));
});
elements.settingsDefaultModelSelect?.addEventListener("change", async () => {
	const value = elements.settingsDefaultModelSelect.value;
	const model = value === "" ? undefined : state.models[Number(value)];
	try {
		state.defaults = await requestServer("/settings/defaults", "PUT", model
			? { provider: model.provider, modelId: model.id }
			: { provider: null, modelId: null });
		renderPreferencesControls();
		setPreferencesFeedback(elements.settingsModelFeedback, uiText("settingsDefaultModelSaved"));
	} catch (error) { setPreferencesFeedback(elements.settingsModelFeedback, error.message || String(error), true); }
});
elements.settingsDefaultThinkingSelect?.addEventListener("change", async () => {
	try {
		state.defaults = await requestServer("/settings/defaults", "PUT", {
			thinkingLevel: elements.settingsDefaultThinkingSelect.value || null,
		});
		renderPreferencesControls();
		setPreferencesFeedback(elements.settingsModelFeedback, uiText("settingsDefaultThinkingSaved"));
	} catch (error) { setPreferencesFeedback(elements.settingsModelFeedback, error.message || String(error), true); }
});
elements.settingsTrustSelect?.addEventListener("change", () => void runPreferencesCommand(`/trust ${elements.settingsTrustSelect.value}`, elements.settingsSecurityFeedback, { sync: true }));
elements.settingsOauthLoginButton?.addEventListener("click", () => {
	const provider = elements.settingsOauthProvider?.value;
	if (provider) void runPreferencesCommand(`/login ${provider}`, elements.settingsSecurityFeedback, { sync: true });
});
elements.settingsApiKeySaveButton?.addEventListener("click", () => {
	const provider = elements.settingsApiKeyProvider?.value;
	const key = elements.settingsApiKeyInput?.value.trim();
	if (!provider || !key) return setPreferencesFeedback(elements.settingsSecurityFeedback, uiText("enterApiKey"), true);
	void runPreferencesCommand(`/login ${provider} ${key}`, elements.settingsSecurityFeedback, { sync: true });
	elements.settingsApiKeyInput.value = "";
});
elements.settingsLogoutButton?.addEventListener("click", () => {
	const provider = elements.settingsLogoutProvider?.value;
	if (provider && window.confirm(uiText("confirmRemoveCredentials", { provider }))) void runPreferencesCommand(`/logout ${provider}`, elements.settingsSecurityFeedback, { sync: true });
});
elements.settingsCustomProviderSelect?.addEventListener("change", refreshCustomProviderForm);
document.querySelector("#settingsCustomProviderSave")?.addEventListener("click", async () => {
	const name = elements.settingsCustomProviderName?.value.trim(); const baseUrl = elements.settingsCustomBaseUrl?.value.trim(); const apiKey = elements.settingsCustomApiKey?.value.trim();
	const providerId = elements.settingsCustomProviderSelect?.value || undefined;
	if (!name || !baseUrl || (!providerId && !apiKey)) return setPreferencesFeedback(elements.settingsSecurityFeedback, uiText("enterApiKey"), true);
	try { const saved = await desktop.providerConfig.saveCustom({ providerId, name, baseUrl, apiKey, modelIds: (elements.settingsCustomModelIds?.value || "").split(",").map((value) => value.trim()).filter(Boolean), reasoning: Boolean(elements.settingsCustomProviderReasoning?.checked) }); await runPreferencesCommand("/reload", elements.settingsSecurityFeedback, { sync: true }); if (apiKey) await runPreferencesCommand(`/login ${saved.provider} ${apiKey}`, elements.settingsSecurityFeedback, { sync: true }); elements.settingsCustomApiKey.value = ""; await refreshPreferencesDetails(); }
	catch (error) { setPreferencesFeedback(elements.settingsSecurityFeedback, error.message || String(error), true); }
});
document.querySelector("#settingsCustomProviderDelete")?.addEventListener("click", async () => { const provider = elements.settingsCustomProviderSelect?.value; if (!provider) return; try { await desktop.providerConfig.deleteCustom(provider); await refreshPreferencesDetails(); } catch (error) { setPreferencesFeedback(elements.settingsSecurityFeedback, error.message || String(error), true); } });
document.querySelector("#settingsSaveSessionName")?.addEventListener("click", async () => {
	const name = elements.settingsSessionNameInput?.value.trim();
	if (!name) return setPreferencesFeedback(elements.settingsSessionFeedback, uiText("enterSessionName"), true);
	try { await requestServer("/session/name", "PUT", { name }); await syncServerSession({ loadModels: false, refreshConversations: true }); setPreferencesFeedback(elements.settingsSessionFeedback, uiText("completed")); }
	catch (error) { setPreferencesFeedback(elements.settingsSessionFeedback, error.message || String(error), true); }
});
document.querySelector("#settingsCompactButton")?.addEventListener("click", () => void runPreferencesCommand("/compact", elements.settingsSessionFeedback, { sync: true }));
document.querySelector("#settingsNewSessionButton")?.addEventListener("click", () => {
	if (window.confirm(uiText("confirmNewSession"))) void requestServer("/session/new", "POST", { cwd: activeProject()?.path, collaborationMode: "plan" }).then(() => syncServerSession({ loadModels: true, refreshConversations: true })).catch((error) => setPreferencesFeedback(elements.settingsSessionFeedback, error.message || String(error), true));
});
document.querySelector("#settingsExportHtml")?.addEventListener("click", async () => { const path = await desktop.sessionFile.save("html"); if (path) void runPreferencesCommand(`/export ${path}`, elements.settingsSessionFeedback); });
document.querySelector("#settingsExportJsonl")?.addEventListener("click", async () => { const path = await desktop.sessionFile.save("jsonl"); if (path) void runPreferencesCommand(`/export ${path}`, elements.settingsSessionFeedback); });
document.querySelector("#settingsImportSession")?.addEventListener("click", async () => { const path = await desktop.sessionFile.open(); if (path && window.confirm(uiText("confirmImportSession"))) void runPreferencesCommand(`/import ${path}`, elements.settingsSessionFeedback, { sync: true }); });
document.querySelector("#settingsShareSession")?.addEventListener("click", () => { if (window.confirm(uiText("confirmShareSession"))) void runPreferencesCommand("/share", elements.settingsSessionFeedback); });
elements.settingsMemoryInput?.addEventListener("change", async () => {
	try {
		const result = await requestServer("/memory/settings", "PUT", { enabled: elements.settingsMemoryInput.checked });
		setMemoryState(result);
		setPreferencesFeedback(elements.settingsAgentFeedback, uiText("settingsMemorySaved"));
	} catch (error) { setPreferencesFeedback(elements.settingsAgentFeedback, error.message || String(error)); }
});
elements.settingsMemoryRun?.addEventListener("click", async () => {
	if (memoryRunPending) return;
	memoryRunPending = true;
	renderMemoryStatus();
	try {
		setPreferencesFeedback(elements.settingsAgentFeedback, uiText("settingsMemoryRunStarted"));
		const memory = await requestServer("/memory/run", "POST");
		setMemoryState(memory);
		setPreferencesFeedback(elements.settingsAgentFeedback, uiText("settingsMemoryRunCompleted", { processed: memory.lastRunProcessed || 0, added: memory.lastRunAdded || 0, skipped: memory.lastRunSkipped || 0, fallback: memory.fallbackUsed ? uiText("settingsMemoryFallbackSuffix") : "" }));
	}
	catch (error) { setPreferencesFeedback(elements.settingsAgentFeedback, uiText("settingsMemoryFailure", { message: error.message || String(error) }), true); }
	finally {
		memoryRunPending = false;
		renderMemoryStatus();
	}
});
elements.settingsMemorySearch?.addEventListener("click", async () => {
	const query = globalThis.prompt?.(uiText("settingsMemorySearchPrompt"));
	if (!query?.trim()) return;
	try {
		const records = await requestServer(`/memory/search?q=${encodeURIComponent(query)}`);
		const record = Array.isArray(records) ? records[0] : undefined;
		if (!record) return setPreferencesFeedback(elements.settingsAgentFeedback, uiText("settingsMemoryNoMatch"));
		const forget = window.confirm(`${record.content}\n\n${uiText("settingsMemoryForgetPrompt")}`);
		if (forget) await requestServer(`/memory/${encodeURIComponent(record.id)}`, "DELETE");
		setPreferencesFeedback(elements.settingsAgentFeedback, forget ? uiText("settingsMemoryForgotten") : record.content);
	} catch (error) { setPreferencesFeedback(elements.settingsAgentFeedback, error.message || String(error)); }
});
elements.settingsMemoryReset?.addEventListener("click", async () => {
	if (!window.confirm(uiText("settingsMemoryResetPrompt"))) return;
	try { await requestServer("/memory/reset", "POST", { confirm: "RESET_MEMORY" }); setPreferencesFeedback(elements.settingsAgentFeedback, uiText("settingsMemoryResetDone")); }
	catch (error) { setPreferencesFeedback(elements.settingsAgentFeedback, error.message || String(error)); }
});
document.querySelector("#settingsOpenServerDialog")?.addEventListener("click", () => {
	hidePreferencesDialog();
	elements.serverDialog.showModal();
});
document.querySelector("#settingsChooseWorkspaceButton")?.addEventListener("click", async () => {
	await loadWorkspace(true);
	await refreshPreferencesDetails();
});

document.querySelector("#settingsReloadResources")?.addEventListener("click", () => void runPreferencesCommand(
	"/reload",
	elements.settingsAboutFeedback,
	{ sync: true },
));
elements.historyBack?.addEventListener("click", () => void navigateHistory(-1));
elements.historyForward?.addEventListener("click", () => void navigateHistory(1));
document.querySelector("#chooseWorkspaceButton")?.addEventListener("click", () => void loadWorkspace(true));
document.querySelector("#refreshFilesButton")?.addEventListener("click", () => void refreshFileTree());
elements.fileFilterInput?.addEventListener("input", () => renderFileTree(elements.fileFilterInput.value));
document.querySelector("#revealFileButton")?.addEventListener("click", () => state.activeFile && desktop.workspace.reveal(state.activeFile));

document.querySelector("#browserBack")?.addEventListener("click", () => elements.browserView?.canGoBack() && elements.browserView?.goBack());
document.querySelector("#browserForward")?.addEventListener("click", () => elements.browserView?.canGoForward() && elements.browserView?.goForward());
document.querySelector("#browserReload")?.addEventListener("click", () => elements.browserView?.reload());
document.querySelector("#browserExternal")?.addEventListener("click", () => elements.browserView && desktop.openExternal(elements.browserView.getURL()));
elements.browserAddress?.addEventListener("keydown", (event) => {
	if (event.key === "Enter") navigateBrowser(elements.browserAddress.value);
});
elements.browserView?.addEventListener("did-start-loading", () => { if (elements.browserStatus) elements.browserStatus.textContent = uiText("loadingPage"); });
elements.browserView?.addEventListener("did-stop-loading", () => {
	 if (elements.browserStatus) elements.browserStatus.textContent = uiText("ready");
	 if (elements.browserAddress && elements.browserView) elements.browserAddress.value = elements.browserView.getURL();
});
elements.browserView?.addEventListener("did-fail-load", () => { if (elements.browserStatus) elements.browserStatus.textContent = uiText("pageLoadFailed"); });

elements.composerInput.addEventListener("input", () => {
	autoSizeComposer();
	void updateSkillMenu();
});
elements.composerInput.addEventListener("keydown", (event) => {
	const skillMenuOpen = !elements.composerSkillMenu?.hidden;
	if (skillMenuOpen && !event.isComposing && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
		event.preventDefault();
		setActiveSkillIndex(state.activeSkillIndex + (event.key === "ArrowDown" ? 1 : -1));
		return;
	}
	if (skillMenuOpen && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && !event.isComposing) {
		event.preventDefault();
		selectSkillOption();
		return;
	}
	if (skillMenuOpen && event.key === "Escape") {
		event.preventDefault();
		closeSkillMenu();
		return;
	}
	if ((event.key === "Backspace" || event.key === "Delete") && skillComposer.removeAdjacentSkill(elements.composerInput, event.key === "Backspace" ? "backward" : "forward")) {
		event.preventDefault();
		return;
	}
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void sendMessage();
	}
});
elements.composerInput.addEventListener("focus", () => void updateSkillMenu());
elements.composer.addEventListener("focusout", () => {
	requestAnimationFrame(() => {
		if (!elements.composer.contains(document.activeElement)) closeSkillMenu();
	});
});
elements.composerInput.addEventListener("paste", (event) => {
	const files = attachmentTools.filesFromTransfer(event.clipboardData);
	const text = event.clipboardData?.getData("text/plain");
	if (files.length === 0) {
		if (!text) return;
		event.preventDefault();
		skillComposer.insertPlainText(elements.composerInput, text);
		return;
	}
	event.preventDefault();
	if (text) skillComposer.insertPlainText(elements.composerInput, text);
	void handleAttachments(files, "paste");
});
elements.attachButton.addEventListener("click", () => elements.attachInput.click());
elements.attachInput.addEventListener("change", (event) => {
	if (event.target.files && event.target.files.length > 0) {
		void handleAttachments(event.target.files, "picker");
	}
});
let attachmentDragDepth = 0;
document.addEventListener("dragenter", (event) => {
	if (!attachmentTools.transferHasFiles(event.dataTransfer)) return;
	event.preventDefault();
	attachmentDragDepth += 1;
	elements.composer.classList.add("is-dragging-attachments");
});
document.addEventListener("dragover", (event) => {
	if (!attachmentTools.transferHasFiles(event.dataTransfer)) return;
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (event) => {
	if (attachmentDragDepth === 0) return;
	attachmentDragDepth = Math.max(0, attachmentDragDepth - 1);
	if (attachmentDragDepth === 0 || !event.relatedTarget) elements.composer.classList.remove("is-dragging-attachments");
});
document.addEventListener("drop", (event) => {
	if (!attachmentTools.transferHasFiles(event.dataTransfer)) return;
	event.preventDefault();
	attachmentDragDepth = 0;
	elements.composer.classList.remove("is-dragging-attachments");
	void handleAttachments(attachmentTools.filesFromTransfer(event.dataTransfer), "drop");
});
elements.sendButton?.addEventListener("click", () => void (state.isStreaming ? abortGeneration() : sendMessage()));
elements.messageQueueToggle?.addEventListener("click", () => {
	const collapsed = elements.messageQueue.classList.toggle("collapsed");
	elements.messageQueueToggle.setAttribute("aria-expanded", String(!collapsed));
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
document.querySelector("#iconSidebarAddProject")?.addEventListener("click", (event) => {
	event.stopPropagation();
	void loadWorkspace(true);
});
elements.projectCustomizeForm?.addEventListener("submit", (event) => {
	event.preventDefault();
});
elements.projectDisplayNameInput?.addEventListener("input", () => persistProjectCustomization({ name: true }));
elements.projectColorInput?.addEventListener("input", () => {
	persistProjectCustomization({ color: true });
});
elements.projectCustomizePopover?.addEventListener("keydown", (event) => {
	if (event.key !== "Escape") return;
	event.preventDefault();
	const returnFocus = customizingProjectButton;
	closeProjectCustomization();
	returnFocus?.focus();
});
elements.projectSwitchMenu?.addEventListener("keydown", (event) => {
	const options = [...elements.projectSwitchOptions.querySelectorAll(".project-switch-option"), elements.projectSwitchAdd].filter(Boolean);
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
elements.workflowPicker?.addEventListener("mousedown", (event) => {
	event.preventDefault();
});
elements.workflowTrigger?.addEventListener("click", (event) => {
	event.stopPropagation();
	setWorkflowMenuOpen(!elements.workflowPicker.classList.contains("open"), { focusSelected: true });
});
elements.workflowTrigger?.addEventListener("keydown", (event) => {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		setWorkflowMenuOpen(true, { focusSelected: true });
	}
});
elements.workflowMenu?.addEventListener("click", (event) => {
	const option = event.target.closest("[data-workflow-mode]");
	if (option) {
		void changeCollaborationMode(option.dataset.workflowMode);
		if (document.activeElement && typeof document.activeElement.blur === "function") {
			document.activeElement.blur();
		}
	}
});
elements.workflowMenu?.addEventListener("keydown", (event) => {
	const options = [...elements.workflowMenu.querySelectorAll("[data-workflow-mode]")];
	const currentIndex = options.indexOf(document.activeElement);
	if (event.key === "Escape") {
		event.preventDefault();
		elements.composerInput.focus();
	} else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && options.length) {
		event.preventDefault();
		const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (currentIndex + 1) % options.length : (currentIndex - 1 + options.length) % options.length;
		options[nextIndex]?.focus();
	}
});
elements.workflowPlanToggle?.addEventListener("click", () => {
	state.workflowPlanCollapsed = !state.workflowPlanCollapsed;
	renderWorkflowPlanCard();
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
	requestAnimationFrame(positionModelMenu);
});
elements.thinkingBack.addEventListener("click", (event) => {
	event.stopPropagation();
	elements.modelPicker.classList.remove("advanced-open");
	elements.advancedEntry.focus();
	requestAnimationFrame(positionModelMenu);
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
	if (isProjectCustomizationOpen()
		&& !elements.projectCustomizePopover.contains(event.target)
		&& !event.target.closest(".project-rail-customize")) closeProjectCustomization();
	if (!elements.projectSwitcher.contains(event.target)) setProjectSwitchMenuOpen(false);
	if (!elements.modelPicker.contains(event.target)) setModelMenuOpen(false);
	if (elements.workflowPicker) setWorkflowMenuOpen(true);
});

document.querySelector("#emptyConnectButton")?.addEventListener("click", () => elements.serverDialog.showModal());
document.querySelector("#connectServerButton").addEventListener("click", () => void connectServer());
elements.serverLoadingConnect?.addEventListener("click", () => elements.serverDialog.showModal());
desktop.metis.onEvent(handleMetisEvent);
desktop.metis.onDisconnect(() => {
	if (serverDisconnectTimer) clearTimeout(serverDisconnectTimer);
	serverDisconnectTimer = setTimeout(() => {
		serverDisconnectTimer = undefined;
		state.serverConnected = false;
		state.isStreaming = false;
		state.models = [];
		setStreamingState(false);
		updateModelSelect();
		if (elements.settingsDialog?.open) renderPreferencesControls();
		if (!elements.serverLoading?.classList.contains("hidden")) showServerLoadingFailure();
	}, 1_500);
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && isProjectCustomizationOpen()) {
		event.preventDefault();
		const returnFocus = customizingProjectButton;
		closeProjectCustomization();
		returnFocus?.focus();
		return;
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
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

elements.projectList?.addEventListener("scroll", updateProjectPanelConnector, { passive: true });
window.addEventListener("resize", updateProjectPanelConnector);
window.addEventListener("resize", () => positionProjectCustomization());
window.addEventListener("resize", positionModelMenu);

desktopI18n.observeDocument();
applyUiLanguage(state.uiLanguage);
renderConversations();
window.setInterval(refreshWorkTimerTitles, 100);
desktop.metis?.onServerReady?.(() => {
	if (!state.serverConnected) {
		void autoConnectServer();
	}
});
window.setInterval(() => {
	if (!state.serverConnected) {
		void autoConnectServer();
	}
}, 3000);

window.state = state;
window.ensureProject = (pathOrObj) => ensureProject(typeof pathOrObj === "string" ? { path: pathOrObj } : pathOrObj);
window.activateProject = activateProject;
window.loadWorkspace = loadWorkspace;
window.runPreferencesCommand = runPreferencesCommand;
window.setUiLanguage = applyUiLanguage;
window.focusComposer = () => elements.composerInput?.focus();



void (async () => {
	try {
		const appInfo = await desktop.appInfo();
		state.platform = appInfo.platform;
		document.body.classList.add(`platform-${appInfo.platform}`);
		if (elements.revealFileButton) elements.revealFileButton.textContent = revealInFolderLabel();
	} catch {}
	await loadWorkspace();
	const connected = await autoConnectServer();
	if (!connected) {
		showServerLoadingFailure();
		setTimeout(() => finishServerLoading(), 1500);
	}
})();

if (!window.MetisOnboarding?.isCompleted()) {
	window.requestAnimationFrame(() => window.MetisOnboarding.start());
}
