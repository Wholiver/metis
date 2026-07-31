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
	enterProviderName: ["Enter a Provider name", "请输入 Provider 名称"],
	enterBaseUrl: ["Enter a Base URL", "请输入 Base URL"],
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
	for (let attempt = 1; attempt <= 4; attempt += 1) {
		try {
			const response = await fetch(url);
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
			await new Promise((resolve) => setTimeout(resolve, attempt * 800));
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

const catalogs = { en: canonical.en, "zh-CN": canonical["zh-CN"] };
for (const [locale, { source, target }] of Object.entries(localeTargets)) {
	const existing = existingCatalogs[locale] || {};
	const base = canonical[source];
	const translated = {};
	const pending = Object.entries(base).filter(([key]) => !(key in existing));
	const batches = [];
	for (let index = 0; index < pending.length; index += 20) batches.push(pending.slice(index, index + 20));
	const results = await Promise.all(batches.map((batch) => translateBatch(batch, source, target)));
	for (const result of results) Object.assign(translated, result);
	console.log(`${locale}: ${pending.length}/${pending.length}`);
	catalogs[locale] = Object.fromEntries(Object.keys(canonical.en).map((key) => [key, existing[key] || translated[key]]));
}

assertCatalogs(catalogs);
await writeFile(sourcePath, `// Canonical Desktop copy. Update both locales, then run npm run i18n:generate.\nmodule.exports = ${JSON.stringify(canonical, null, 2)};\n`);
await writeFile(outputPath, `// Generated by desktop/scripts/generate-i18n-catalogs.mjs. Do not edit by hand.\n(function (root, factory) {\n\tconst catalogs = factory();\n\tif (typeof module === "object" && module.exports) module.exports = catalogs;\n\tif (root) root.metisDesktopI18nCatalogs = catalogs;\n})(typeof window === "object" ? window : undefined, () => (${JSON.stringify(catalogs, null, 2)}));\n`);
console.log(`Generated ${Object.keys(catalogs).length} catalogs with ${Object.keys(catalogs.en).length} keys each.`);
