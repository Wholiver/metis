import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.dirname(scriptDir);
const legacyPath = path.join(desktopDir, "renderer", "i18n.js");
const sourcePath = path.join(desktopDir, "i18n-source.cjs");
const outputPath = path.join(desktopDir, "renderer", "i18n-catalogs.js");
const require = createRequire(import.meta.url);
const localeTargets = {
	"zh-TW": { source: "zh-CN", target: "zh-TW" },
	ja: { source: "en", target: "ja" },
	ko: { source: "en", target: "ko" },
	es: { source: "en", target: "es" },
	fr: { source: "en", target: "fr" },
	de: { source: "en", target: "de" },
	pt: { source: "en", target: "pt" },
	ru: { source: "en", target: "ru" },
	it: { source: "en", target: "it" },
};

const localeOverrides = {
	fr: { conversations: "Discussions" },
	"zh-TW": { languageEnglish: "英語" },
	es: {
		proposedPlanRefine: "Revisar",
		proposedPlanRefinePlaceholder: "Solicitar un cambio de plan",
		proposedPlanRefinePrompt: "Llama primero a read_plan y luego revisa el plan propuesto más reciente con estos comentarios: {request}",
		askUserTitle: "Necesito tu respuesta",
		askUserHint: "Tu respuesta permitirá continuar esta tarea.",
		askUserRecommended: "Recomendado",
		askUserFreePlaceholder: "O escribe tu respuesta",
		askUserCancel: "Cancelar",
		askUserContinue: "Continuar",
		askUserPending: "Esperando tu respuesta",
		askUserSubmitting: "Enviando respuesta…",
		askUserAnswered: "Respuesta enviada",
		askUserCancelled: "Pregunta cancelada",
		askUserRequired: "Responde todas las preguntas antes de continuar.",
	},
};

// Re-translate workflow copy even when a generated catalog already has an older value.
const refreshKeys = new Set([
	"workflowBuildMode", "workflowPlanMode", "workflowBuildDescription", "workflowPlanDescription",
	"workflowBusy", "workflowApplied", "workflowChangeFailed", "workflowPlanProgress",
	"workflowPlanTitle", "workflowPlanEmpty", "workflowPlanLegacy", "workflowPlanInterrupted", "instructionSourcesEmpty", "instructionTruncated",
	"proposedPlanReady", "proposedPlanExpand", "proposedPlanCollapse", "proposedPlanProcess",
	"proposedPlanProcessDescription", "proposedPlanProcessPrompt",
	"workflowSettingsNav", "workflowSettingsTitle", "workflowSettingsDescription", "workflowModeSetting",
	"workflowModeSettingDescription", "instructionSourcesTitle",
]);

const extra = {
	automatic: ["Automatic", "自动"],
	saving: ["Saving…", "正在保存…"],
	savedAndApplied: ["Saved and applied to the current Agent session.", "已保存并应用到当前 Agent 会话。"],
	saveFailed: ["Save failed: {message}", "保存失败：{message}"],
	noAvailableItems: ["No available items", "暂无可用项"],
	timelineMessage: ["Message", "消息"],
	timelineThinkingLevel: ["Thinking level change", "思考等级变更"],
	timelineModelChange: ["Model change", "模型变更"],
	timelineCompaction: ["Context summary", "上下文摘要"],
	timelineBranchSummary: ["Branch summary", "分支摘要"],
	timelineCustom: ["Custom entry", "自定义记录"],
	thinking: ["Thinking", "思考"],
	arguments: ["Arguments:", "参数："],
	output: ["Output:", "输出："],
	workingForSeconds: ["Working for {duration}s", "已运行 {duration} 秒"],
	working: ["Working…", "正在运行…"],
	tokenActivity: ["Token activity", "Token 活动"],
	workOverview: ["Work overview", "工作概览"],
	pastYearDaily: ["Past year · Daily", "过去一年 · 每日"],
	daily: ["Daily", "每日"],
	workStatsLoading: ["Calculating…", "正在统计…"],
	workStatsUnavailable: ["Statistics unavailable", "暂时无法读取统计"],
	otherWorkData: ["Other work data", "其他工作数据"],
	currentStreak: ["Current streak", "连续工作天数"],
	todayTokens: ["Tokens today", "今日 Token"],
	yearTokens: ["Tokens this year", "年度 Token"],
	activeDays: ["Active days", "活跃天数"],
	workRhythmLoading: ["Reading your work rhythm…", "正在感受工作节奏…"],
	workRhythmStreak: ["Day {streak} in a row — momentum locked", "连续第 {streak} 天，节奏拉满"],
	workRhythmPeak: ["High-energy day — a new 7-day peak", "今日高能，刷新近 7 日峰值"],
	workRhythmRising: ["Warming up — the last three days are climbing", "渐入佳境，最近三天持续升温"],
	workRhythmSteady: ["Steady progress at a comfortable pace", "稳定推进，保持舒服的工作节奏"],
	workRhythmWarming: ["Warming up — today's square is lit", "正在热身，今天这一格已经点亮"],
	workRhythmQuiet: ["A blank day is part of the rhythm too", "今天留白，也是一种节奏"],
	yearTasks: ["Tasks this year", "年度任务"],
	yearPrompts: ["User prompts", "用户 Prompt"],
	modelCalls: ["Model calls", "模型调用"],
	toolCalls: ["Tool calls", "工具调用"],
	memory: ["Memory", "记忆"],
	dreamMode: ["Dream mode", "Dream 模式"],
	dreamModeDescription: ["Consolidates work logs, long-term memory, and lessons in the background. Runs once when enabled, then on schedule.", "后台自动整理工作日志、长期记忆和经验；开启后立即运行一次，之后按计划运行。"],
	proposedPlanReady: ["Proposed plan", "方案已就绪"],
	proposedPlanExpand: ["Expand proposed plan", "展开方案"],
	proposedPlanCollapse: ["Collapse proposed plan", "收起方案"],
	proposedPlanProcess: ["Process", "Process"],
	proposedPlanProcessDescription: ["Switch to Build and start implementing this plan", "切换到构建模式并开始执行此方案"],
	proposedPlanProcessPrompt: ["Call read_plan first to load the latest proposal and execution progress. Then MUST call update_plan to create or refresh a concise implementation and verification checklist before any other tool. Keep the checklist current through completion, provide concise visible progress updates in my language, and continue until every step is verified.", "先调用 read_plan 读取最新版方案和执行进度；随后必须先调用 update_plan 创建或刷新精简的实施与验证清单，再使用任何其他工具。持续更新清单直到全部完成，用我的语言提供简短可见的进度说明，并继续工作直到每一步都完成验证。"],
	settingsModelMemory: ["Models & memory", "模型与记忆"],
	settingsMessageContext: ["Messages & context", "消息与上下文"],
	settingsSessionData: ["Sessions & data", "会话与数据"],
	settingsAppearanceLanguage: ["Appearance & language", "外观与语言"],
	settingsPermissionsCredentials: ["Permissions & credentials", "权限与凭据"],
	settingsConnectionWorkspace: ["Connection & workspace", "连接与工作区"],
	settingsAboutMaintenance: ["About & maintenance", "关于与维护"],
	modelMemoryDescription: ["Set the model, reasoning depth, and background memory for the current and future sessions.", "设置当前及后续会话使用的模型、推理深度和后台记忆。"],
	messageContextDescription: ["Control how messages are handled while busy and how context is compacted.", "控制忙碌时的消息处理方式，以及上下文压缩策略。"],
	autoCompactShort: ["Automatic compaction", "自动压缩"],
	autoCompactShortDescription: ["Automatically summarize context near the model limit for the current and future sessions.", "上下文接近模型上限时自动生成摘要，持续对当前及后续会话生效。"],
	compactNowShortDescription: ["Summarize the current session now without changing automatic compaction.", "马上生成一次当前会话摘要，不改变自动压缩开关。"],
	sessionDataDescription: ["Manage the current task, history branches, and session import, export, and sharing.", "管理当前任务、历史分支，以及会话数据的导入、导出与分享。"],
	appearanceLanguageDescription: ["Manage the Desktop display language and the language defaults used by Agent and TUI.", "管理 Desktop 显示语言，以及 Agent 和 TUI 使用的语言默认值。"],
	languageSection: ["Language", "语言"],
	interfaceLanguageShortDescription: ["Desktop updates immediately; Agent and TUI use the new language after reload.", "Desktop 状态立即更新；Agent 与 TUI 重载后使用新语言。"],
	permissionsCredentialsDescription: ["Manage project resource permissions and Provider credentials used by Agent.", "管理项目资源载入权限，以及 Agent 调用模型时使用的 Provider 凭据。"],
	connectionWorkspaceDescription: ["Manage the Desktop connection to Metis Server and the current workspace.", "管理 Desktop 与 Metis Server 的连接，以及当前工作区。"],
	aboutMaintenanceDescription: ["View application information, help, and maintenance actions.", "查看应用信息、帮助入口和维护操作。"],
	tokenDayDetail: ["{date}: {total} tokens · input {input} · output {output} · cache {cache}", "{date}：{total} Token · 输入 {input} · 输出 {output} · 缓存 {cache}"],
	connectServerFirst: ["Connect to Metis Server first", "请先连接 Metis Server"],
	applying: ["Applying…", "正在应用…"],
	completed: ["Completed.", "已完成。"],
	operationFailed: ["Operation failed: {message}", "操作失败：{message}"],
	agentBusyWait: ["Agent is running or compacting context. Wait for the current run to finish.", "Agent 正在运行或压缩上下文，请等待本轮结束"],
	sessionSummary: ["{total} messages · {pending} queued", "{total} 条消息 · {pending} 条排队消息"],
	noOtherSessions: ["No other sessions", "没有其他会话"],
	noForkMessages: ["No messages available to fork", "没有可分叉消息"],
	noHistoryNodes: ["No other history nodes", "没有其他历史节点"],
	noOauthProviders: ["No OAuth Providers available", "没有可用 OAuth Provider"],
	noProviders: ["No Providers available", "没有可用 Provider"],
	sessionSynced: ["Session information synced. Session-switching actions preserve the current session before loading the target.", "会话信息已同步。会话切换类操作会先保留当前会话，再载入目标状态。"],
	securitySynced: ["Account and project permissions synced. Restart Server to fully apply project trust changes.", "账户与项目权限状态已同步；项目可信状态需重启 Server 后生效。"],
	loadFailedRestart: ["Load failed: {message}. Fully restart Desktop and Server.", "载入失败：{message}。请完全重启 Desktop 和 Server。"],
	switchingSession: ["Switching session", "正在切换会话"],
	sessionSwitchFailed: ["Session switch failed", "切换失败"],
	creatingTask: ["Creating task", "正在创建任务"],
	createFailed: ["Creation failed", "创建失败"],
	switchingProject: ["Switching project", "正在切换项目"],
	projectSwitchFailed: ["Project switch failed", "项目切换失败"],
	workspaceReadError: ["Unable to read workspace: {message}", "无法读取工作区：{message}"],
	serverHttpError: ["Server request failed (HTTP {status})", "Server 请求失败（HTTP {status}）"],
	attachmentReadError: ["Unable to read {name}", "无法读取 {name}"],
	attachmentTooLarge: ["{name} exceeds 128 MB and cannot be buffered from the clipboard", "{name} 超过 128 MB，无法从剪贴板缓存"],
	attachmentsPasted: ["Pasted {count} attachments", "已粘贴 {count} 个附件"],
	attachmentsDropped: ["Dropped {count} attachments", "已拖入 {count} 个附件"],
	attachmentsAdded: ["Added {count} attachments", "已添加 {count} 个附件"],
	genericModel: ["Model", "模型"],
	queuePromote: ["Process first", "优先处理"],
	queueEdit: ["Move back to composer", "移回输入框编辑"],
	queueDelete: ["Delete queued message", "删除排队消息"],
	queueOperationFailed: ["Queue operation failed", "队列操作失败"],
	modelSwitchFailed: ["Model switch failed", "模型切换失败"],
	thinkingSwitchFailed: ["Thinking level switch failed", "思考等级切换失败"],
	fileReadFailed: ["Read failed: {message}", "读取失败：{message}"],
	noMatchingFiles: ["No matching files", "没有匹配文件"],
	readingGitDiff: ["Reading Git changes…", "正在读取 Git 变更…"],
	readFailed: ["Read failed", "读取失败"],
	cannotShowDiff: ["Unable to display Diff", "无法显示 Diff"],
	diffStats: ["{added} lines added · {removed} lines removed", "{added} 行新增 · {removed} 行删除"],
	closeTab: ["Close tab", "关闭标签页"],
	invalidAddress: ["Invalid address", "地址无效"],
	sendFailed: ["Send failed", "发送失败"],
	stopFailed: ["Stop failed", "停止失败"],
	connecting: ["Connecting…", "连接中…"],
	connect: ["Connect", "连接"],
	connectedSyncFailed: ["Connected; sync failed", "已连接，同步失败"],
	syncFailed: ["Sync failed", "同步失败"],
	connectFailedRetry: ["Connection failed. Retry", "连接失败，重试"],
	confirm: ["Confirm", "确认"],
	choose: ["Choose an option", "请选择"],
	enterValue: ["Enter a value", "请输入"],
	eventMessageStart: ["Starting response", "开始生成"],
	eventMessageUpdate: ["Generating", "正在生成"],
	eventMessageEnd: ["Completed", "处理完成"],
	eventToolStart: ["Calling tool", "正在调用工具"],
	eventToolEnd: ["Tool completed", "工具执行完成"],
	eventCompactionStart: ["Organizing context", "正在整理上下文"],
	eventCompactionEnd: ["Context organized", "上下文已整理"],
	desktopLanguageSavedOffline: ["Desktop language saved. Agent / TUI will sync after Server connects.", "Desktop 语言已保存；连接 Server 后将同步 Agent / TUI。"],
	enterSessionName: ["Enter a session name", "请输入会话名称"],
	confirmNewSession: ["Start a new session? The current session will remain in history.", "开始新会话？当前会话会保留在历史记录中。"],
	noResumableSession: ["No session is available to resume", "没有可恢复的会话"],
	noForkableMessage: ["No message is available to fork", "没有可分叉的消息"],
	forkCreated: ["Fork created. The selected user message is back in the composer for editing.", "已创建分叉；所选用户消息已放回主界面输入框，可修改后发送。"],
	noBranchNodes: ["The current session has no branch nodes", "当前会话没有分支节点"],
	confirmImportSession: ["Import and switch to the selected session now? The current session will remain in history.", "导入并立即切换到所选会话？当前会话会保留在历史记录中。"],
	confirmShareSession: ["Upload the current session HTML as a secret GitHub Gist? Anyone with the link can view it.", "将当前会话 HTML 上传为私密 GitHub Gist？持有链接的人可以查看内容。"],
	enterApiKey: ["Enter an API Key", "请输入 API Key"],
	enterApiKeyToDiscoverModels: ["Enter an API Key to discover models", "请输入 API Key 后获取模型"],
	enterProviderName: ["Enter a Provider name", "请输入 Provider 名称"],
	enterBaseUrl: ["Enter a Base URL", "请输入 Base URL"],
	newCustomProvider: ["Add custom Provider…", "添加新 Provider…"],
	newCustomProviderButton: ["New custom Provider", "新建自定义 Provider"],
	deleteCustomProviderButton: ["Delete", "删除"],
	customBaseUrlDescription: ["Add and manage multiple OpenAI-compatible Providers. Models can be discovered automatically, selected from the list, or entered manually.", "添加并管理多个 OpenAI-compatible Provider。模型可自动获取、从列表选择或手动输入。"],
	customApiKeyEditPlaceholder: ["API Key (leave blank while editing to keep saved value)", "API Key（编辑时留空则保留原值）"],
	customModelList: ["Models (multiple selection)", "模型列表（可多选）"],
	discoverModels: ["Discover models", "自动获取模型"],
	manualModelIdsPlaceholder: ["Enter model IDs manually; separate multiple IDs with commas", "手动输入模型 ID；多个用逗号分隔"],
	noModelsDiscovered: ["No models were returned. Enter model IDs manually.", "未获取到模型，请手动输入模型 ID。"],
	modelsDiscovered: ["Discovered {count} models.", "已获取 {count} 个模型。"],
	selectCustomProvider: ["Select a custom Provider", "请选择自定义 Provider"],
	customProviderDeleted: ["Custom Provider and saved API Key deleted.", "已删除自定义 Provider 及其保存的 API Key。"],
	customProviderNotFound: ["Custom Provider was not found", "未找到自定义 Provider"],
	customProviderDeleteFailed: ["Unable to delete custom Provider", "无法删除自定义 Provider"],
	reasoningRestartRequired: ["Reasoning was saved, but the current session still does not support thinking. Fully quit and restart Desktop so it starts a new Server.", "已写入 reasoning，但当前会话仍不支持思考。请完全退出并重启 Desktop（会自动带上新 Server）。"],
	customProviderReasoningEnabled: ["Custom Provider saved; thinking enabled ({levels}).", "自定义 Provider 已保存；思考已启用（{levels}）。"],
	customProviderNoReasoning: ["Custom Provider saved; thinking not enabled.", "自定义 Provider 已保存；未开启思考。"],
	available: ["Available", "可用"],
	confirmRemoveCredentials: ["Remove saved credentials for {provider}?", "移除 {provider} 的已保存凭据？"],
	changelogTitle: ["Metis Changelog", "Metis 更新记录"],
	noChangelog: ["No changelog entries", "没有更新记录"],
	hotkeysTitle: ["Desktop shortcuts", "Desktop 快捷键"],
	hotkeysIntro: ["These shortcuts apply only to Desktop. Terminal TUI shortcuts may differ.\n\n{hotkeys}", "以下仅适用于 Desktop；终端 TUI 的快捷键可能不同。\n\n{hotkeys}"],
	confirmQuitDesktop: ["Quit Metis Desktop?", "退出 Metis Desktop？"],
	loadingPage: ["Loading…", "正在载入…"],
	pageLoadFailed: ["Page failed to load", "页面载入失败"],
	localServerStopped: ["Local Server stopped ({code}){detail}", "本地 Server 已停止 ({code}){detail}"],
	attachmentTooLargeMain: ["Attachment is too large to copy from the clipboard", "附件太大，无法从剪贴板复制"],
	metisSessionFilter: ["Metis Session", "Metis 会话"],
	httpOnly: ["Only http and https URLs are allowed", "仅允许 http 和 https URL"],
	modelsJsonParseFailed: ["Unable to parse existing models.json: {message}", "无法解析现有 models.json：{message}"],
	providerNameRequired: ["Provider name is required", "必须填写 Provider 名称"],
	apiKeyRequired: ["API Key is required", "必须填写 API Key"],
	baseUrlInvalid: ["Base URL must be a valid http or https URL", "Base URL 必须是有效的 http 或 https URL"],
	baseUrlProtocol: ["Base URL must use http or https", "Base URL 必须使用 http 或 https"],
	invalidWorkspacePath: ["Invalid workspace path", "工作区路径无效"],
	workspaceMissing: ["Workspace directory does not exist: {path}", "工作区目录不存在：{path}"],
	diffTargetFile: ["Diff target must be a file", "Diff 目标必须是文件"],
	gitNotInstalled: ["Git is not installed", "未安装 Git"],
	pathEscapesWorkspace: ["Path escapes workspace", "路径超出工作区"],
	invalidApiPath: ["Invalid Metis API path", "Metis API 路径无效"],
	unsupportedApiMethod: ["Unsupported Metis API method", "不支持的 Metis API 方法"],
	sseFailed: ["SSE failed: HTTP {status}", "SSE 失败：HTTP {status}"],
	sseClosed: ["SSE connection closed", "SSE 连接已关闭"],
	serverUrlProtocol: ["Metis Server URL must use http or https", "Metis Server URL 必须使用 http 或 https"],
	menuEdit: ["Edit", "编辑"],
	menuUndo: ["Undo", "撤销"],
	menuRedo: ["Redo", "重做"],
	menuCut: ["Cut", "剪切"],
	menuCopy: ["Copy", "复制"],
	menuPaste: ["Paste", "粘贴"],
	menuSelectAll: ["Select All", "全选"],
	menuWindow: ["Window", "窗口"],
	menuAbout: ["About {appName}", "关于 {appName}"],
	menuServices: ["Services", "服务"],
	menuHide: ["Hide {appName}", "隐藏 {appName}"],
	menuHideOthers: ["Hide Others", "隐藏其他"],
	menuShowAll: ["Show All", "全部显示"],
	menuQuit: ["Quit {appName}", "退出 {appName}"],
	dialogOpen: ["Open", "打开"],
	dialogSave: ["Save", "保存"],
	dialogSelectFolder: ["Select folder", "选择文件夹"],
	onboardingCredentialsTitle: ["Configure AI credentials", "配置 AI 凭据"],
	onboardingCredentialsDescription: ["Configure a model API Key, OAuth authorization, or custom Base URL. Open Settings, then Account & security.", "请先配置模型 API Key、OAuth 授权或自定义 Base URL。点击【设置】进入账户与安全完成配置。"],
	onboardingProviderTitle: ["Configure API / OAuth / Base URL", "配置 API / OAuth / Base URL"],
	onboardingProviderDescription: ["Provider login supports API Key, OAuth, or a custom Base URL. Save any one option to enable Metis.", "在 Provider 登录中，支持 API Key、OAuth 或自定义 Base URL，任选一种配置保存即可开启 Metis 能力！"],
	onboardingProjectTitle: ["Add a project workspace", "添加项目工作区"],
	onboardingProjectDescription: ["Choose or create a local repository folder. Metis will provide project-wide Agent collaboration.", "点击【添加项目】选择或新建一个本地代码仓库文件夹，Metis 将为你提供全项目级别的 Agent 协作！"],
	onboardingMessageTitle: ["Send your first message", "发送第一条消息"],
	onboardingMessageDescription: ["Enter your first request below, then select Send to start collaborating with AI.", "在下方输入框填入你的第一个需求（例如：帮我分析项目结构），点击发送开启 AI 协作体验！"],
	onboardingStep: ["Step {step} / {total}", "步骤 {step} / {total}"],
	onboardingSkip: ["Skip onboarding", "跳过引导"],
	onboardingPrevious: ["Previous", "上一步"],
	onboardingNext: ["Next", "下一步"],
	onboardingFinish: ["Finish", "完成体验"],
	onboardingCompleteBadge: ["🎉 Setup complete", "🎉 初始化完成"],
	onboardingCompleteTitle: ["Start using Metis AI!", "开启 Metis AI 体验！"],
	onboardingCompleteDescription: ["Credentials, project setup, and the first-message guide are complete. Start collaborating intelligently.", "你已成功完成凭据配置、新建项目与首条消息提示，开启智能编程之旅！"],
	subagentStatusLabel: ["Subagent status", "Subagent 运行状态"],
	onboardingSetting: ["Onboarding", "新手引导"],
	onboardingSettingDescription: ["Reopen the welcome and setup spotlight shown on first launch.", "重新打开首次进入的欢迎与初始化高亮指引。"],
	apiKey: ["API Key", "API Key"],
};

const obsoleteKeys = ["longestStreak", "last7DaysTokens"];

const protectedTerms = [
	/\n+\{[a-zA-Z][a-zA-Z0-9]*\}/g,
	/\n+/g,
	/\{[a-zA-Z][a-zA-Z0-9]*\}/g,
	/Metis/g, /Desktop/g, /Agent/g, /TUI/g, /Server/g, /Provider/g, /OAuth/g,
	/API Key/g, /Base URL/g, /JSONL/g, /HTML/g, /GitHub Gist/g, /GitHub/g,
	/Electron/g, /Finder/g, /Diff/g, /SSE/g, /HTTP/g, /URL/g, /Git/g,
	/models\.json/g, /\/login/g, /128 MB/g,
];

function extractLegacyCatalogs(source) {
	const marker = "window.metisDesktopI18n = { languages, resolve, t, translateDocument };";
	if (!source.includes(marker)) throw new Error("Legacy i18n marker not found");
	const context = { navigator: { languages: ["en"], language: "en" } };
	vm.runInNewContext(source.replace(marker, "globalThis.extracted = { catalogs: copy };"), context);
	return context.extracted.catalogs;
}

function protect(text) {
	const values = [];
	let protectedText = text;
	for (const pattern of protectedTerms) {
		protectedText = protectedText.replace(pattern, (value) => {
			const index = values.push(value) - 1;
			return `ZXQ${index}QXZ`;
		});
	}
	return { text: protectedText, values };
}

function restore(text, values) {
	return text.replace(/ZXQ(\d+)QXZ/g, (_match, index) => values[Number(index)] ?? _match);
}

async function translateBatch(entries, sourceLanguage, targetLanguage) {
	const protectedEntries = entries.map(([key, value]) => [key, protect(value)]);
	const body = protectedEntries.map(([, value]) => value.text).join("\n");
	const url = new URL("https://translate.googleapis.com/translate_a/single");
	url.searchParams.set("client", "gtx");
	url.searchParams.set("sl", sourceLanguage);
	url.searchParams.set("tl", targetLanguage);
	url.searchParams.set("dt", "t");
	url.searchParams.set("q", body);
	let lastError;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const payload = await response.json();
			const translated = payload[0].map((part) => part[0]).join("").split("\n");
			if (translated.length !== entries.length) throw new Error(`line count ${translated.length}, expected ${entries.length}`);
			return Object.fromEntries(translated.map((value, index) => {
				const [key, protectedValue] = protectedEntries[index];
				return [key, restore(value, protectedValue.values)];
			}));
		} catch (error) {
			lastError = error;
			if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	throw lastError;
}

function assertCatalogs(catalogs) {
	const keys = Object.keys(catalogs.en).sort();
	for (const [locale, catalog] of Object.entries(catalogs)) {
		const actual = Object.keys(catalog).sort();
		if (JSON.stringify(actual) !== JSON.stringify(keys)) throw new Error(`${locale} catalog keys do not match English`);
		for (const [key, value] of Object.entries(catalog)) {
			const expectedVariables = [...catalogs.en[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
			const actualVariables = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
			if (JSON.stringify(actualVariables) !== JSON.stringify(expectedVariables)) throw new Error(`${locale}.${key} placeholder mismatch`);
		}
	}
}

let canonical;
let existingCatalogs;
try {
	canonical = require(sourcePath);
	existingCatalogs = require(outputPath);
} catch {
	const legacySource = await readFile(legacyPath, "utf8");
	existingCatalogs = extractLegacyCatalogs(legacySource);
	canonical = { en: { ...existingCatalogs.en }, "zh-CN": { ...existingCatalogs["zh-CN"] } };
}
for (const [key, [english, chinese]] of Object.entries(extra)) {
	canonical.en[key] = english;
	canonical["zh-CN"][key] = chinese;
}
for (const key of obsoleteKeys) {
	delete canonical.en[key];
	delete canonical["zh-CN"][key];
}

const staticTranslations = {
	"zh-TW": {
		theme: "外觀主題",
		themeDescription: "選擇 Desktop 的外觀主題。",
		themeAuto: "跟隨系統",
		themeLight: "淺色",
		themeDark: "深色",
		onboardingWelcomeTitle: "歡迎使用 Metis",
		onboardingWelcomeSubtitle: "你的全專案級智慧 AI 程式設計工作台",
		onboardingGetStarted: "開始使用",
		onboardingLanguageTitle: "選擇介面語言",
		onboardingLanguageSubtitle: "選擇你偏好的 Metis Desktop 顯示語言",
		onboardingProviderTabApiKey: "API Key",
		onboardingProviderTabOAuth: "OAuth 授權",
		onboardingProviderTabCustom: "自訂 Base URL",
		onboardingSaveAndConnect: "儲存並繼續",
		onboardingSkipForNow: "稍後在設定中配置",
		onboardingWorkspaceTitle: "選取專案工作區",
		onboardingWorkspaceSubtitle: "選擇本機程式碼資料夾或倉庫開啟 AI 協作",
		onboardingChooseFolder: "選擇本機專案資料夾",
		onboardingRecentProjects: "最近專案",
		onboardingSelectedProject: "已選專案",
		onboardingStartCoding: "完成並開始對話",
		onboardingNoWorkspaceSelected: "請選擇一個專案資料夾以開始。",
	},
	ja: {
		theme: "テーマ",
		themeDescription: "Desktop の外観テーマを選択します。",
		themeAuto: "システムに従う",
		themeLight: "ライト",
		themeDark: "ダーク",
		onboardingWelcomeTitle: "Metis へようこそ",
		onboardingWelcomeSubtitle: "インテリジェントな AI ペアプログラミング ワークスペース",
		onboardingGetStarted: "始める",
		onboardingLanguageTitle: "言語を選択",
		onboardingLanguageSubtitle: "Metis Desktop の表示言語を選択してください",
		onboardingProviderTabApiKey: "API キー",
		onboardingProviderTabOAuth: "OAuth 認証",
		onboardingProviderTabCustom: "カスタム Base URL",
		onboardingSaveAndConnect: "保存して続行",
		onboardingSkipForNow: "後で設定で構成する",
		onboardingWorkspaceTitle: "プロジェクトワークスペースを選択",
		onboardingWorkspaceSubtitle: "ローカルフォルダまたはリポジトリを選択してコラボレーションを開始",
		onboardingChooseFolder: "プロジェクトフォルダを選択",
		onboardingRecentProjects: "最近のプロジェクト",
		onboardingSelectedProject: "選択されたプロジェクト",
		onboardingStartCoding: "完了してコーディングを開始",
		onboardingNoWorkspaceSelected: "開始するにはプロジェクトフォルダを選択してください。",
	},
	ko: {
		theme: "테마",
		themeDescription: "Desktop의 모양 테마를 선택합니다.",
		themeAuto: "시스템 설정",
		themeLight: "라이트",
		themeDark: "다크",
		onboardingWelcomeTitle: "Metis에 오신 것을 환영합니다",
		onboardingWelcomeSubtitle: "지능형 AI 페어 프로그래밍 작업 공간",
		onboardingGetStarted: "시작하기",
		onboardingLanguageTitle: "언어 선택",
		onboardingLanguageSubtitle: "Metis Desktop에 표시할 언어를 선택하세요",
		onboardingProviderTabApiKey: "API 키",
		onboardingProviderTabOAuth: "OAuth 인증",
		onboardingProviderTabCustom: "사용자 지정 Base URL",
		onboardingSaveAndConnect: "저장 후 계속",
		onboardingSkipForNow: "나중에 설정에서 구성",
		onboardingWorkspaceTitle: "프로젝트 작업 공간 선택",
		onboardingWorkspaceSubtitle: "공동 작업을 시작할 로컬 폴더 또는 저장소 선택",
		onboardingChooseFolder: "프로젝트 폴더 선택",
		onboardingRecentProjects: "최근 프로젝트",
		onboardingSelectedProject: "선택된 프로젝트",
		onboardingStartCoding: "완료 및 코딩 시작",
		onboardingNoWorkspaceSelected: "시작하려면 프로젝트 폴더를 선택하세요.",
	},
	es: {
		theme: "Tema",
		themeDescription: "Elige el tema de apariencia para Desktop.",
		themeAuto: "Sistema (automático)",
		themeLight: "Claro",
		themeDark: "Oscuro",
		onboardingWelcomeTitle: "Bienvenido a Metis",
		onboardingWelcomeSubtitle: "Tu espacio de trabajo inteligente de programación en pareja con IA",
		onboardingGetStarted: "Comenzar",
		onboardingLanguageTitle: "Elige tu idioma",
		onboardingLanguageSubtitle: "Selecciona tu idioma preferido para Metis Desktop",
		onboardingProviderTabApiKey: "Clave API",
		onboardingProviderTabOAuth: "Autorización OAuth",
		onboardingProviderTabCustom: "Base URL personalizada",
		onboardingSaveAndConnect: "Guardar y continuar",
		onboardingSkipForNow: "Configurar más tarde en ajustes",
		onboardingWorkspaceTitle: "Seleccionar espacio de trabajo del proyecto",
		onboardingWorkspaceSubtitle: "Elige una carpeta o repositorio local para empezar a colaborar",
		onboardingChooseFolder: "Elegir carpeta del proyecto",
		onboardingRecentProjects: "Proyectos recientes",
		onboardingSelectedProject: "Proyecto seleccionado",
		onboardingStartCoding: "Finalizar y empezar a programar",
		onboardingNoWorkspaceSelected: "Por favor, selecciona una carpeta de proyecto para comenzar.",
	},
	fr: {
		theme: "Thème",
		themeDescription: "Choisissez le thème d'apparence pour Desktop.",
		themeAuto: "Système (auto)",
		themeLight: "Clair",
		themeDark: "Sombre",
		onboardingWelcomeTitle: "Bienvenue sur Metis",
		onboardingWelcomeSubtitle: "Votre espace de travail de programmation en binôme IA intelligent",
		onboardingGetStarted: "Commencer",
		onboardingLanguageTitle: "Choisissez votre langue",
		onboardingLanguageSubtitle: "Sélectionnez votre langue d'affichage préférée pour Metis Desktop",
		onboardingProviderTabApiKey: "Clé API",
		onboardingProviderTabOAuth: "Autorisation OAuth",
		onboardingProviderTabCustom: "Base URL personnalisée",
		onboardingSaveAndConnect: "Enregistrer et continuer",
		onboardingSkipForNow: "Configurer plus tard dans les paramètres",
		onboardingWorkspaceTitle: "Sélectionner un espace de travail de projet",
		onboardingWorkspaceSubtitle: "Choisissez un dossier ou un dépôt local pour commencer à collaborer",
		onboardingChooseFolder: "Choisir le dossier du projet",
		onboardingRecentProjects: "Projets récents",
		onboardingSelectedProject: "Projet sélectionné",
		onboardingStartCoding: "Terminer et commencer à coder",
		onboardingNoWorkspaceSelected: "Veuillez sélectionner un dossier de projet pour commencer.",
	},
	de: {
		theme: "Design",
		themeDescription: "Wählen Sie das Design für Desktop.",
		themeAuto: "System (Automatisch)",
		themeLight: "Hell",
		themeDark: "Dunkel",
		onboardingWelcomeTitle: "Willkommen bei Metis",
		onboardingWelcomeSubtitle: "Ihr intelligenter KI-Pair-Programming-Arbeitsbereich",
		onboardingGetStarted: "Loslegen",
		onboardingLanguageTitle: "Wählen Sie Ihre Sprache",
		onboardingLanguageSubtitle: "Wählen Sie Ihre bevorzugte Anzeigesprache für Metis Desktop",
		onboardingProviderTabApiKey: "API-Schlüssel",
		onboardingProviderTabOAuth: "OAuth-Autorisierung",
		onboardingProviderTabCustom: "Benutzerdefinierte Base-URL",
		onboardingSaveAndConnect: "Speichern & Weiter",
		onboardingSkipForNow: "Später in den Einstellungen konfigurieren",
		onboardingWorkspaceTitle: "Projektarbeitsbereich auswählen",
		onboardingWorkspaceSubtitle: "Wählen Sie einen lokalen Ordner oder ein Repository, um die Zusammenarbeit zu starten",
		onboardingChooseFolder: "Projektordner auswählen",
		onboardingRecentProjects: "Zuletzt verwendete Projekte",
		onboardingSelectedProject: "Ausgewähltes Projekt",
		onboardingStartCoding: "Fertigstellen & Coden starten",
		onboardingNoWorkspaceSelected: "Bitte wählen Sie einen Projektordner, um zu beginnen.",
	},
	pt: {
		theme: "Tema",
		themeDescription: "Escolha o tema de aparência para o Desktop.",
		themeAuto: "Sistema (automático)",
		themeLight: "Claro",
		themeDark: "Escuro",
		onboardingWelcomeTitle: "Bem-vindo ao Metis",
		onboardingWelcomeSubtitle: "Seu espaço de trabalho inteligente de programação em par com IA",
		onboardingGetStarted: "Começar",
		onboardingLanguageTitle: "Escolha seu idioma",
		onboardingLanguageSubtitle: "Selecione o idioma de exibição de sua preferência para o Metis Desktop",
		onboardingProviderTabApiKey: "Chave de API",
		onboardingProviderTabOAuth: "Autorização OAuth",
		onboardingProviderTabCustom: "Base URL personalizada",
		onboardingSaveAndConnect: "Salvar e continuar",
		onboardingSkipForNow: "Configurar mais tarde nas configurações",
		onboardingWorkspaceTitle: "Selecionar espaço de trabalho do projeto",
		onboardingWorkspaceSubtitle: "Escolha uma pasta ou repositório local para começar a colaborar",
		onboardingChooseFolder: "Escolher pasta do projeto",
		onboardingRecentProjects: "Projetos recentes",
		onboardingSelectedProject: "Projeto selecionado",
		onboardingStartCoding: "Concluir e começar a programar",
		onboardingNoWorkspaceSelected: "Selecione uma pasta de projeto para começar.",
	},
	ru: {
		theme: "Тема",
		themeDescription: "Выберите тему оформления для Desktop.",
		themeAuto: "Системная (авто)",
		themeLight: "Светлая",
		themeDark: "Темная",
		onboardingWelcomeTitle: "Добро пожаловать в Metis",
		onboardingWelcomeSubtitle: "Ваше интеллектуальное рабочее пространство для парного программирования с ИИ",
		onboardingGetStarted: "Начать",
		onboardingLanguageTitle: "Выберите язык",
		onboardingLanguageSubtitle: "Выберите язык интерфейса Metis Desktop",
		onboardingProviderTabApiKey: "API-ключ",
		onboardingProviderTabOAuth: "Авторизация OAuth",
		onboardingProviderTabCustom: "Пользовательский Base URL",
		onboardingSaveAndConnect: "Сохранить и продолжить",
		onboardingSkipForNow: "Настроить позже в параметрах",
		onboardingWorkspaceTitle: "Выбрать рабочее пространство проекта",
		onboardingWorkspaceSubtitle: "Выберите локальную папку или репозиторий для начала совместной работы",
		onboardingChooseFolder: "Выбрать папку проекта",
		onboardingRecentProjects: "Недавние проекты",
		onboardingSelectedProject: "Выбранный проект",
		onboardingStartCoding: "Завершить и начать кодить",
		onboardingNoWorkspaceSelected: "Пожалуйста, выберите папку проекта для начала.",
	},
	it: {
		theme: "Tema",
		themeDescription: "Scegli il tema dell'aspetto per Desktop.",
		themeAuto: "Sistema (automatico)",
		themeLight: "Chiaro",
		themeDark: "Scuro",
		onboardingWelcomeTitle: "Benvenuto in Metis",
		onboardingWelcomeSubtitle: "Il tuo spazio di lavoro intelligente per la programmazione in coppia con IA",
		onboardingGetStarted: "Inizia",
		onboardingLanguageTitle: "Scegli la tua lingua",
		onboardingLanguageSubtitle: "Seleziona la lingua di visualizzazione preferita per Metis Desktop",
		onboardingProviderTabApiKey: "Chiave API",
		onboardingProviderTabOAuth: "Autorizzazione OAuth",
		onboardingProviderTabCustom: "Base URL personalizzato",
		onboardingSaveAndConnect: "Salva e continua",
		onboardingSkipForNow: "Configura più tardi nelle impostazioni",
		onboardingWorkspaceTitle: "Seleziona uno spazio di lavoro del progetto",
		onboardingWorkspaceSubtitle: "Scegli una cartella o repository locale per iniziare a collaborare",
		onboardingChooseFolder: "Scegli cartella progetto",
		onboardingRecentProjects: "Progetti recenti",
		onboardingSelectedProject: "Progetto selezionato",
		onboardingStartCoding: "Completa e inizia a programmare",
		onboardingNoWorkspaceSelected: "Seleziona una cartella di progetto per iniziare.",
	},
};

const multiAgentTranslations = {
	"zh-TW": {
		subagentRole: "角色",
		subagentWorktree: "隔離工作區",
		subagentMode: "執行模式",
		subagentModeSync: "前景執行（同步）",
		subagentModeAsync: "背景執行（非同步）",
		toolSpawningAgent: "正在啟動 {agent}…",
		toolSpawnedAgent: "已啟動 {agent}",
		toolAgentFailed: "{agent} 執行失敗",
		toolListingAgents: "正在查詢 Agent 清單…",
		toolListedAgents: "已取得 Agent 清單",
		toolWaitingAgent: "正在等待 Agent…",
		toolWaitedAgent: "已完成 Agent 等待",
		toolKillingAgent: "正在終止 Agent…",
		toolKilledAgent: "已終止 Agent",
		toolMessagingAgent: "正在傳送訊息給 Agent…",
		toolMessagedAgent: "已傳送訊息給 Agent",
		toolReadingPlan: "正在讀取計畫…",
		toolReadPlan: "已讀取計畫",
		toolQueryingMemory: "正在檢索記憶庫…",
		toolQueriedMemory: "已檢索記憶庫",
	},
	ja: {
		subagentRole: "役割",
		subagentWorktree: "分離ワークツリー",
		subagentMode: "実行モード",
		subagentModeSync: "フォアグラウンド（同期）",
		subagentModeAsync: "バックグラウンド（非同期）",
		toolSpawningAgent: "{agent} を起動中…",
		toolSpawnedAgent: "{agent} を起動しました",
		toolAgentFailed: "{agent} が失敗しました",
		toolListingAgents: "エージェント一覧を取得中…",
		toolListedAgents: "エージェント一覧を取得しました",
		toolWaitingAgent: "エージェントを待機中…",
		toolWaitedAgent: "エージェント待機完了",
		toolKillingAgent: "エージェントを終了中…",
		toolKilledAgent: "エージェントを終了しました",
		toolMessagingAgent: "エージェントにメッセージ送信中…",
		toolMessagedAgent: "エージェントにメッセージを送信しました",
		toolReadingPlan: "計画を読み込み中…",
		toolReadPlan: "計画を読み込みました",
		toolQueryingMemory: "メモリを検索中…",
		toolQueriedMemory: "メモリを検索しました",
	},
	ko: {
		subagentRole: "역할",
		subagentWorktree: "격리된 워크트리",
		subagentMode: "실행 모드",
		subagentModeSync: "포그라운드(동기)",
		subagentModeAsync: "백그라운드(비동기)",
		toolSpawningAgent: "{agent} 시작 중…",
		toolSpawnedAgent: "{agent} 시작됨",
		toolAgentFailed: "{agent} 실패",
		toolListingAgents: "에이전트 목록 조회 중…",
		toolListedAgents: "에이전트 목록 조회됨",
		toolWaitingAgent: "에이전트 대기 중…",
		toolWaitedAgent: "에이전트 대기 완료",
		toolKillingAgent: "에이전트 종료 중…",
		toolKilledAgent: "에이전트 종료됨",
		toolMessagingAgent: "에이전트에 메시지 전송 중…",
		toolMessagedAgent: "에이전트에 메시지 전송됨",
		toolReadingPlan: "계획 읽는 중…",
		toolReadPlan: "계획 읽기 완료",
		toolQueryingMemory: "메모리 쿼리 중…",
		toolQueriedMemory: "메모리 쿼리 완료",
	},
	es: {
		subagentRole: "Rol",
		subagentWorktree: "Árbol de trabajo aislado",
		subagentMode: "Modo de ejecución",
		subagentModeSync: "Primer plano (sincrónico)",
		subagentModeAsync: "Segundo plano (asincrónico)",
		toolSpawningAgent: "Iniciando {agent}…",
		toolSpawnedAgent: "{agent} iniciado",
		toolAgentFailed: "Error en {agent}",
		toolListingAgents: "Listando agentes…",
		toolListedAgents: "Agentes listados",
		toolWaitingAgent: "Esperando al agente…",
		toolWaitedAgent: "Agente esperado",
		toolKillingAgent: "Finalizando agente…",
		toolKilledAgent: "Agente finalizado",
		toolMessagingAgent: "Enviando mensaje al agente…",
		toolMessagedAgent: "Mensaje enviado al agente",
		toolReadingPlan: "Leyendo plan…",
		toolReadPlan: "Plan leído",
		toolQueryingMemory: "Consultando memoria…",
		toolQueriedMemory: "Memoria consultada",
	},
	fr: {
		subagentRole: "Rôle",
		subagentWorktree: "Arbre de travail isolé",
		subagentMode: "Mode d'exécution",
		subagentModeSync: "Premier plan (synchrone)",
		subagentModeAsync: "Arrière-plan (asynchrone)",
		toolSpawningAgent: "Démarrage de {agent}…",
		toolSpawnedAgent: "{agent} démarré",
		toolAgentFailed: "Échec de {agent}",
		toolListingAgents: "Liste des agents…",
		toolListedAgents: "Agents répertoriés",
		toolWaitingAgent: "Attente de l'agent…",
		toolWaitedAgent: "Agent attendu",
		toolKillingAgent: "Arrêt de l'agent…",
		toolKilledAgent: "Agent arrêté",
		toolMessagingAgent: "Envoi du message à l'agent…",
		toolMessagedAgent: "Message envoyé à l'agent",
		toolReadingPlan: "Lecture du plan…",
		toolReadPlan: "Plan lu",
		toolQueryingMemory: "Interrogation de la mémoire…",
		toolQueriedMemory: "Mémoire interrogée",
	},
	de: {
		subagentRole: "Rolle",
		subagentWorktree: "Isolierter Arbeitsbaum",
		subagentMode: "Ausführungsmodus",
		subagentModeSync: "Vordergrund (synchron)",
		subagentModeAsync: "Hintergrund (asynchron)",
		toolSpawningAgent: "Starte {agent}…",
		toolSpawnedAgent: "{agent} gestartet",
		toolAgentFailed: "{agent} fehlgeschlagen",
		toolListingAgents: "Agenten auflisten…",
		toolListedAgents: "Agenten aufgelistet",
		toolWaitingAgent: "Warte auf Agent…",
		toolWaitedAgent: "Auf Agent gewartet",
		toolKillingAgent: "Beende Agent…",
		toolKilledAgent: "Agent beendet",
		toolMessagingAgent: "Sende Nachricht an Agent…",
		toolMessagedAgent: "Nachricht an Agent gesendet",
		toolReadingPlan: "Lese Plan…",
		toolReadPlan: "Plan gelesen",
		toolQueryingMemory: "Frage Speicher ab…",
		toolQueriedMemory: "Speicher abgefragt",
	},
	pt: {
		subagentRole: "Função",
		subagentWorktree: "Árvore de trabalho isolada",
		subagentMode: "Modo de execução",
		subagentModeSync: "Primeiro plano (síncrono)",
		subagentModeAsync: "Segundo plano (assíncrono)",
		toolSpawningAgent: "Iniciando {agent}…",
		toolSpawnedAgent: "{agent} iniciado",
		toolAgentFailed: "Falha em {agent}",
		toolListingAgents: "Listando agentes…",
		toolListedAgents: "Agentes listados",
		toolWaitingAgent: "Aguardando agente…",
		toolWaitedAgent: "Agente aguardado",
		toolKillingAgent: "Encerrando agente…",
		toolKilledAgent: "Agente encerrado",
		toolMessagingAgent: "Enviando mensagem ao agente…",
		toolMessagedAgent: "Mensagem enviada ao agente",
		toolReadingPlan: "Lendo plano…",
		toolReadPlan: "Plano lido",
		toolQueryingMemory: "Consultando memória…",
		toolQueriedMemory: "Memória consultada",
	},
	ru: {
		subagentRole: "Роль",
		subagentWorktree: "Изолированное рабочее дерево",
		subagentMode: "Режим выполнения",
		subagentModeSync: "Передний план (синхронно)",
		subagentModeAsync: "Фоновый режим (асинхронно)",
		toolSpawningAgent: "Запуск {agent}…",
		toolSpawnedAgent: "{agent} запущен",
		toolAgentFailed: "Ошибка {agent}",
		toolListingAgents: "Получение списка агентов…",
		toolListedAgents: "Список агентов получен",
		toolWaitingAgent: "Ожидание агента…",
		toolWaitedAgent: "Ожидание агента завершено",
		toolKillingAgent: "Остановка агента…",
		toolKilledAgent: "Агент остановлен",
		toolMessagingAgent: "Отправка сообщения агенту…",
		toolMessagedAgent: "Сообщение агенту отправлено",
		toolReadingPlan: "Чтение плана…",
		toolReadPlan: "План прочитан",
		toolQueryingMemory: "Запрос к памяти…",
		toolQueriedMemory: "Память запрошена",
	},
	it: {
		subagentRole: "Ruolo",
		subagentWorktree: "Albero di lavoro isolato",
		subagentMode: "Modalità di esecuzione",
		subagentModeSync: "Primo piano (sincrono)",
		subagentModeAsync: "Sfondo (asincrono)",
		toolSpawningAgent: "Avvio di {agent}…",
		toolSpawnedAgent: "{agent} avviato",
		toolAgentFailed: "Errore di {agent}",
		toolListingAgents: "Elenco agenti…",
		toolListedAgents: "Agenti elencati",
		toolWaitingAgent: "In attesa dell'agente…",
		toolWaitedAgent: "Agente atteso",
		toolKillingAgent: "Terminazione agente…",
		toolKilledAgent: "Agente terminato",
		toolMessagingAgent: "Invio messaggio all'agente…",
		toolMessagedAgent: "Messaggio inviato all'agente",
		toolReadingPlan: "Lettura del piano…",
		toolReadPlan: "Piano letto",
		toolQueryingMemory: "Interrogazione memoria…",
		toolQueriedMemory: "Memoria interrogata",
	},
};

const catalogs = { en: canonical.en, "zh-CN": canonical["zh-CN"] };
for (const [locale, { source, target }] of Object.entries(localeTargets)) {
	const existing = existingCatalogs[locale] || {};
	const base = canonical[source];
	const translated = { ...(staticTranslations[locale] || {}), ...(multiAgentTranslations[locale] || {}) };
	const pending = Object.entries(base).filter(([key]) => !(key in existing) && !(key in translated) || refreshKeys.has(key) || key.startsWith("settingsMemory"));
	if (pending.length > 0) {
		const batches = [];
		for (let index = 0; index < pending.length; index += 20) batches.push(pending.slice(index, index + 20));
		try {
			const results = await Promise.all(batches.map((batch) => translateBatch(batch, source, target)));
			for (const result of results) Object.assign(translated, result);
		} catch (error) {
			console.warn(`Online translation fallback for ${locale}:`, error.message);
		}
	}
	console.log(`${locale}: processed`);
	catalogs[locale] = Object.fromEntries(Object.keys(canonical.en).map((key) => [key, translated[key] || existing[key] || canonical.en[key]]));
	Object.assign(catalogs[locale], localeOverrides[locale]);
}

assertCatalogs(catalogs);
await writeFile(sourcePath, `// Canonical Desktop copy. Update both locales, then run npm run i18n:generate.\nmodule.exports = ${JSON.stringify(canonical, null, 2)};\n`);
await writeFile(outputPath, `// Generated by desktop/scripts/generate-i18n-catalogs.mjs. Do not edit by hand.\n(function (root, factory) {\n\tconst catalogs = factory();\n\tif (typeof module === "object" && module.exports) module.exports = catalogs;\n\tif (root) root.metisDesktopI18nCatalogs = catalogs;\n})(typeof window === "object" ? window : undefined, () => (${JSON.stringify(catalogs, null, 2)}));\n`);
console.log(`Generated ${Object.keys(catalogs).length} catalogs with ${Object.keys(catalogs.en).length} keys each.`);
