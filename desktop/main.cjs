const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, session, shell, utilityProcess } = require("electron");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { createApplicationMenuTemplate, createEditorContextMenuTemplate } = require("./main-menu.cjs");
const customProviderConfig = require("./provider-config.cjs");
const { readSessionTokenActivity, readSessionTokenTotals } = require("./session-token-totals.cjs");
const desktopI18n = require("./renderer/i18n.js");

app.commandLine.appendSwitch("log-level", "3");

const execFileAsync = promisify(execFile);
const MAX_TREE_ITEMS = 600;
const MAX_DIFF_BYTES = 300_000;
const MAX_BUFFERED_ATTACHMENT_BYTES = 128 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", ".codegraph", ".sessions", "node_modules", "dist", "coverage"]);

let mainWindow;
let desktopLanguage = "auto";
let isDefaultWorkspaceProjectRepo = false;
let workspaceRoot = findDefaultWorkspace();
let metisServer = { baseUrl: "http://127.0.0.1:4096", username: "metis", password: "" };
let metisEventController;

function nativeText(key, variables) {
	return desktopI18n.t(key, desktopLanguage, variables, [app.getLocale()]);
}

function rebuildApplicationMenu() {
	Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(process.platform, app.name, nativeText)));
}
let autoServerProcess;
let appIsQuitting = false;

if (process.platform === "win32") {
	const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
	const sessionDataDir = path.join(localAppData, "metis-desktop", "session-data");
	app.setPath("sessionData", sessionDataDir);
}

function createAppIcon() {
	const svgPath = path.join(__dirname, "renderer", "assets", "metis-pixel-mark.svg");
	const svg = fs.readFileSync(svgPath, "utf8");
	return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function findMetisCli() {
	const candidates = [
		path.join(process.resourcesPath, "metis-runtime", "dist", "cli.js"),
		path.resolve(__dirname, "../dist/cli.js"),
		path.resolve(__dirname, "../../dist/cli.js"),
	];
	return candidates.find((candidate) => fs.existsSync(candidate));
}

async function isLocalServerHealthy() {
	try {
		const response = await net.fetch("http://127.0.0.1:4096/global/health", { signal: AbortSignal.timeout(500) });
		if (!response.ok) return false;
		const data = await response.json();
		return data?.healthy === true;
	} catch {
		return false;
	}
}

async function ensureLocalMetisServer() {
	if (process.env.METIS_DESKTOP_NO_AUTO_SERVER || (await isLocalServerHealthy())) return;
	const cliPath = findMetisCli();
	if (!cliPath) {
		console.error("[desktop] Metis CLI not found in app resources or repository build output.");
		return;
	}
	let lastStderr = "";
	let envPath = process.env.PATH || "";
	if (process.platform !== "win32") {
		const defaultPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
		envPath = envPath ? `${envPath}:${defaultPath}` : defaultPath;
	}
	autoServerProcess = utilityProcess.fork(cliPath, ["server", "--hostname", "127.0.0.1", "--port", "4096"], {
		cwd: workspaceRoot,
		env: { ...process.env, PATH: envPath },
		stdio: ["ignore", "pipe", "pipe"],
		serviceName: "Metis Server",
	});
	autoServerProcess.stdout?.on("data", (chunk) => {
		const str = chunk.toString();
		process.stdout.write("[server] " + str);
		if (str.includes("metis server listening")) {
			mainWindow?.webContents.send("metis:server-ready");
		}
	});
	autoServerProcess.stderr?.on("data", (chunk) => {
		const str = chunk.toString();
		if (str.trim()) lastStderr = str.trim();
		process.stderr.write("[server] " + str);
	});
	autoServerProcess.once("exit", (code) => {
		autoServerProcess = undefined;
		if (!appIsQuitting) {
			const detail = lastStderr ? `: ${lastStderr}` : "";
			console.error("[desktop] Auto-started Server exited (" + code + ")" + detail);
			mainWindow?.webContents.send("metis:disconnected", nativeText("localServerStopped", { code, detail }));
		}
	});
	for (let attempt = 0; attempt < 120; attempt += 1) {
		if (await isLocalServerHealthy()) {
			mainWindow?.webContents.send("metis:server-ready");
			return;
		}
		if (!autoServerProcess) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	console.error("[desktop] Timed out waiting for local Metis Server.");
}

function stopAutoServer() {
	if (!autoServerProcess) return;
	const serverProcess = autoServerProcess;
	autoServerProcess = undefined;
	const serverPid = serverProcess.pid;
	serverProcess.kill();
	if (serverPid) {
		try {
			process.kill(serverPid, "SIGTERM");
		} catch (error) {
			if (error?.code !== "ESRCH") console.error("[desktop] Failed to stop local Server:", error);
		}
	}
}

function createWindow() {
	const icon = createAppIcon();
	const isMac = process.platform === "darwin";
	const isWin = process.platform === "win32";
	mainWindow = new BrowserWindow({
		width: 1540,
		height: 960,
		minWidth: 1040,
		minHeight: 700,
		show: false,
		backgroundColor: "#00000000",
		transparent: isMac,
		roundedCorners: true,
		vibrancy: isMac ? "under-window" : undefined,
		visualEffectState: isMac ? "active" : undefined,
		title: "Metis",
		icon,
		autoHideMenuBar: true,
		titleBarStyle: isMac ? "hiddenInset" : "hidden",
		trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
		titleBarOverlay: isWin
			? {
					color: "#fbfbfa",
					symbolColor: "#202324",
					height: 52,
				}
			: undefined,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: true,
			sandbox: false,
		},
	});

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
	mainWindow.webContents.on("dom-ready", () => {
		void mainWindow.webContents.executeJavaScript(
			`document.body.classList.add(${JSON.stringify(`platform-${process.platform}`)})`,
		);
	});
	mainWindow.once("ready-to-show", () => {
		mainWindow.show();
		if (process.env.METIS_DESKTOP_CAPTURE) {
			setTimeout(async () => {
				const onboardingStep = Number(process.env.METIS_DESKTOP_CAPTURE_ONBOARDING_STEP);
				if (Number.isInteger(onboardingStep) && onboardingStep >= 1 && onboardingStep <= 4) {
					await mainWindow.webContents.executeJavaScript(`window.MetisOnboarding?.setStep(${onboardingStep})`);
					if (process.env.METIS_DESKTOP_CAPTURE_PROVIDER_TAB) {
						await mainWindow.webContents.executeJavaScript(
							`document.querySelector('[data-provider-tab="${String(process.env.METIS_DESKTOP_CAPTURE_PROVIDER_TAB).replace(/[^a-z]/g, "")}"]')?.click()`,
						);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_WORKSPACE_SELECTIONS) {
						await mainWindow.webContents.executeJavaScript(`(() => {
							window.__metisCaptureOnboardingScene = document.querySelector('[data-scene="4"]');
							[...document.querySelectorAll('[data-workspace-path]')].slice(0, ${Math.max(0, Number(process.env.METIS_DESKTOP_CAPTURE_WORKSPACE_SELECTIONS) || 0)}).forEach((button) => button.click());
						})()`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_ONBOARDING_SLOW_MOTION) {
						await mainWindow.webContents.executeJavaScript(
							"document.getAnimations().forEach((animation) => { animation.playbackRate = 0.1; })",
						);
					}
					await new Promise((resolve) => setTimeout(resolve, 500));
					const metrics = await mainWindow.webContents.executeJavaScript(`(() => {
						const overlay = document.querySelector('#onboardingOverlay');
						const scene = overlay?.querySelector('[data-scene]');
						const heading = overlay?.querySelector('.onboarding-scene-heading');
						const rect = heading?.getBoundingClientRect();
						const sceneStyle = scene ? getComputedStyle(scene) : null;
						const hello = overlay?.querySelector('.onboarding-greeting');
						const centralAction = overlay?.querySelector('.onboarding-primary');
						const centralActionRect = centralAction?.getBoundingClientRect();
						const navigation = overlay?.querySelector('.onboarding-navigation');
						const navigationRect = navigation?.getBoundingClientRect();
						const backRect = navigation?.querySelector('[data-onboarding-back]')?.getBoundingClientRect();
						const nextRect = navigation?.querySelector('[data-onboarding-next]')?.getBoundingClientRect();
						const providerCard = overlay?.querySelector('.onboarding-provider-card');
						const providerCardRect = providerCard?.getBoundingClientRect();
						const selectedProviderTab = overlay?.querySelector('[data-provider-tab][aria-selected="true"]');
						return {
							overlayVisible: Boolean(overlay && !overlay.hidden),
							scene: scene?.dataset.scene || null,
							helloFont: hello ? getComputedStyle(hello).fontFamily : null,
							helloText: hello?.textContent || null,
							centralAction: centralActionRect
								? {
									width: Math.round(centralActionRect.width),
									height: Math.round(centralActionRect.height),
								}
								: null,
							headingRect: rect ? { width: rect.width, height: rect.height, top: rect.top, centerX: rect.left + rect.width / 2 } : null,
							navigationRect: navigationRect ? { left: navigationRect.left, width: navigationRect.width, centerX: navigationRect.left + navigationRect.width / 2 } : null,
							backRect: backRect ? { left: backRect.left, width: backRect.width, centerX: backRect.left + backRect.width / 2 } : null,
							nextRect: nextRect ? { left: nextRect.left, width: nextRect.width, centerX: nextRect.left + nextRect.width / 2 } : null,
							viewportCenterX: window.innerWidth / 2,
							providerTabs: overlay?.querySelectorAll('[data-provider-tab]').length || 0,
							selectedProviderTab: selectedProviderTab?.dataset.providerTab || null,
							providerCardRect: providerCardRect ? { width: providerCardRect.width, height: providerCardRect.height, centerX: providerCardRect.left + providerCardRect.width / 2 } : null,
							selectedWorkspaceCount: overlay?.querySelectorAll('[data-workspace-path][aria-pressed="true"]').length || 0,
							workspaceScenePreserved: !window.__metisCaptureOnboardingScene || window.__metisCaptureOnboardingScene === scene,
							sceneOpacity: sceneStyle?.opacity || null,
							sceneTransform: sceneStyle?.transform || null,
							runningAnimations: document.getAnimations().filter((animation) => animation.playState === 'running').length,
						};
					})()`);
					console.error(`[capture:onboarding] ${JSON.stringify(metrics)}`);
				}
				if (process.env.METIS_DESKTOP_CAPTURE_SETTINGS) {
					await mainWindow.webContents.executeJavaScript(
						"typeof openSettings === 'function' ? openSettings() : document.querySelector('#sidebarSettingsButton')?.click()",
					);
					await new Promise((resolve) => setTimeout(resolve, 300));
					if (process.env.METIS_DESKTOP_CAPTURE_SETTINGS_PANEL) {
						await mainWindow.webContents.executeJavaScript(
							`(() => {
								const name = ${JSON.stringify(process.env.METIS_DESKTOP_CAPTURE_SETTINGS_PANEL)};
								document.querySelector('[data-settings-panel="' + name + '"]')?.click();
							})()`,
						);
						await new Promise((resolve) => setTimeout(resolve, 220));
					}
				}
				if (process.env.METIS_DESKTOP_CAPTURE_SIDEBAR_COLLAPSED) {
					await mainWindow.webContents.executeJavaScript("document.querySelector('#sidebarToggle').click()");
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
				const captureServer = process.env.METIS_DESKTOP_CAPTURE_SERVER;
				if (captureServer) {
					await mainWindow.webContents.executeJavaScript(`
						document.querySelector('#serverUrlInput').value = ${JSON.stringify(captureServer)};
						document.querySelector('#connectServerButton').click();
					`);
					await new Promise((resolve) => setTimeout(resolve, 1_200));
				}
				const captureTab = process.env.METIS_DESKTOP_CAPTURE_TAB;
				if (captureTab) {
					await mainWindow.webContents.executeJavaScript(
						`document.querySelector('[data-open-inspector="${captureTab}"]')?.click()`,
					);
					await new Promise((resolve) => setTimeout(resolve, 900));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_MODEL_MENU) {
					await mainWindow.webContents.executeJavaScript("document.querySelector('#modelTrigger')?.click()");
					await new Promise((resolve) => setTimeout(resolve, 220));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_ADVANCED_MENU) {
					await mainWindow.webContents.executeJavaScript(`
						state.session = { ...state.session, supportsThinking: true, thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"], thinkingLevel: "high" };
						updateModelSelect();
						document.querySelector('#modelTrigger')?.click();
						document.querySelector('#advancedEntry')?.click();
					`);
					await new Promise((resolve) => setTimeout(resolve, 220));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_MEMORY) {
					if (process.env.METIS_DESKTOP_CAPTURE_MEMORY_NARROW) {
						mainWindow.setMinimumSize(600, 600);
						mainWindow.setSize(620, 800);
						await new Promise((resolve) => setTimeout(resolve, 300));
					}
					const memoryMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						typeof openSettings === 'function' ? openSettings() : document.querySelector('#sidebarSettingsButton')?.click();
						selectPreferencesPanel('agent');
						state.serverConnected = true;
						state.session = { ...(state.session || {}), isStreaming: false, isCompacting: false };
						setMemoryState({ enabled: true, phase: 'idle', globalCount: 0, projectCount: 9, pendingJobs: 51, nextEligibleAt: '2026-08-14T20:49:42.000Z', lastRunProcessed: 3, lastRunAdded: 3, lastRunSkipped: 0, lastExtractionMethod: 'model', fallbackUsed: false, lastConsolidatedAt: '2026-08-13T15:00:00.000Z' });
						const panel = document.querySelector('#settingsMemoryDashboard');
						const card = panel?.closest('.settings-dialog-card');
						const metrics = panel?.querySelector('.memory-metrics');
						const button = document.querySelector('#settingsMemoryRun');
						const panelRect = panel?.getBoundingClientRect();
						const cardRect = card?.getBoundingClientRect();
						const panelStyle = panel ? getComputedStyle(panel) : null;
						const buttonRect = button?.getBoundingClientRect();
						state.session.isStreaming = true;
						renderMemoryStatus();
						const busyState = { disabled: button?.disabled || false, hint: document.querySelector('#settingsMemoryRunHint')?.textContent || '' };
						state.session.isStreaming = false;
						renderMemoryStatus();
						return {
							viewportWidth: window.innerWidth,
							visible: Boolean(panelRect && panelRect.width > 0 && panelRect.height > 0),
							insideCard: Boolean(panelRect && cardRect && panelRect.left >= cardRect.left && panelRect.right <= cardRect.right),
							width: Math.round(panelRect?.width || 0),
							height: Math.round(panelRect?.height || 0),
							gridColumns: metrics ? getComputedStyle(metrics).gridTemplateColumns.split(' ').length : 0,
							buttonHeight: Math.round(buttonRect?.height || 0),
							backgroundColor: panelStyle?.backgroundColor || null,
							borderRadius: panelStyle?.borderRadius || null,
							tone: panel?.dataset.tone || null,
							label: document.querySelector('#settingsMemoryStateLabel')?.textContent || '',
							summary: document.querySelector('#settingsMemorySummary')?.textContent || '',
							records: document.querySelector('#settingsMemoryRecordCount')?.textContent || '',
							pending: document.querySelector('#settingsMemoryPendingCount')?.textContent || '',
							lastAdded: document.querySelector('#settingsMemoryLastRunValue')?.textContent || '',
							method: document.querySelector('#settingsMemoryMethod')?.textContent || '',
							errorHidden: document.querySelector('#settingsMemoryError')?.hidden !== false,
							busyState,
						};
					})()`);
					console.error(`[capture:memory] ${JSON.stringify(memoryMetrics)}`);
					await new Promise((resolve) => setTimeout(resolve, 220));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_ASK) {
					const askMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						document.querySelector('[data-purpose="main-chat"]')?.classList.remove('is-empty-state');
						const toolCallId = "capture-ask-tool";
						const tool = document.createElement("div");
						tool.className = "tool-card collapsed running";
						tool.dataset.partKey = toolCallId;
						tool.innerHTML = '<div class="tool-header-bar" role="button" aria-expanded="false">Ask user</div><div class="tool-details-body"></div>';
						document.querySelector("#messageColumn").append(tool);
						state.serverConnected = true;
						state.session = { ...(state.session || {}), collaborationMode: "plan", pendingUserInput: { requestId: "capture-ask-request", toolCallId, questions: [{ id: "scope", header: "Scope", question: "Which scope should this change cover?", options: [{ label: "Focused", description: "Only the requested workflow", recommended: true }, { label: "Broad", description: "Related workflows too" }] }, { id: "audience", header: "Audience", question: "Who is this for?", options: [{ label: "Developers", description: "Optimize for contributors" }, { label: "Everyone", description: "Balance all readers" }] }] } };
						renderUserInputCard(state.session.pendingUserInput);
						const card = document.querySelector('[data-user-input-request-id="capture-ask-request"]');
						const rect = card?.getBoundingClientRect();
						const style = card ? getComputedStyle(card.querySelector(".user-input-card")) : null;
						const actionsRect = card?.querySelector('.user-input-actions')?.getBoundingClientRect();
						const wrapRect = card?.parentElement?.getBoundingClientRect();
						const composerRect = document.querySelector('#composer')?.getBoundingClientRect();
						const recordedComposerWidth = Number(card?.dataset.composerWidth || 0);
						return { replacesComposer: card?.parentElement === document.querySelector('#composer')?.parentElement && getComputedStyle(document.querySelector('#composer')).display === 'none', outsideToolCall: !card?.closest('[data-part-key]'), visibleQuestionCount: card?.querySelectorAll('fieldset').length || 0, progress: card?.querySelector('.user-input-heading span')?.textContent, composerDisabled: document.querySelector("#composerInput")?.disabled, minButtonHeight: card ? getComputedStyle(card.querySelector("button")).minHeight : null, borderColor: style?.borderColor, backgroundColor: style?.backgroundColor, width: rect?.width || 0, composerWidth: recordedComposerWidth, widthMatches: Math.abs((rect?.width || 0) - recordedComposerWidth) < 1, actionsVisible: Boolean(actionsRect && wrapRect && actionsRect.bottom <= wrapRect.bottom && actionsRect.top >= wrapRect.top) };
					})()`);
					console.error(`[capture:ask] ${JSON.stringify(askMetrics)}`);
					const askNextMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						const card = document.querySelector('[data-user-input-request-id="capture-ask-request"]');
						const firstOption = card?.querySelector('input[type="radio"]');
						if (firstOption) firstOption.checked = true;
						card?.querySelector('form')?.requestSubmit();
						return { visibleQuestionCount: card?.querySelectorAll('fieldset').length || 0, progress: card?.querySelector('.user-input-heading span')?.textContent, questionId: card?.querySelector('fieldset')?.dataset.questionId, finalAction: card?.querySelector('.user-input-confirm')?.getAttribute('aria-label') };
					})()`);
					console.error(`[capture:ask-next] ${JSON.stringify(askNextMetrics)}`);
					await new Promise((resolve) => setTimeout(resolve, 220));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_PROPOSAL) {
					const proposalMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						const plan = "# Summary\\n\\nImprove README onboarding and examples.";
						state.serverConnected = true;
						state.session = { ...(state.session || {}), collaborationMode: "plan", workflowProposal: { markdown: plan, revision: 1, updatedAt: new Date().toISOString() } };
						const article = document.createElement("article");
						article.className = "message assistant-message";
						const body = document.createElement("div");
						body.className = "assistant-body";
						article.append(body);
						document.querySelector("#messageColumn").append(article);
						renderAssistantText(body, "<proposed_plan>\\n" + plan + "\\n</proposed_plan>");
						return (() => { const actions = document.querySelector(".proposed-plan-actions"); const process = actions?.querySelector(".proposed-plan-process"); const refine = actions?.querySelector(".proposed-plan-refine"); const send = actions?.querySelector(".proposed-plan-refine-send"); const processStyle = process ? getComputedStyle(process) : null; const refineStyle = refine ? getComputedStyle(refine) : null; const sendStyle = send ? getComputedStyle(send) : null; refine?.focus(); const focusedRefineStyle = refine ? getComputedStyle(refine) : null; state.messages = [{ role: "user", content: "optimistic", timestamp: 1, _metisOptimistic: true }]; upsertStreamMessage({ role: "user", content: "authoritative", timestamp: 2 }); const optimisticReconciled = state.messages.length === 1 && state.messages[0].timestamp === 2 && !state.messages[0]._metisOptimistic; return { processFirst: actions?.firstElementChild === process, refineSecond: actions?.lastElementChild === refine?.parentElement, buttonCount: actions?.querySelectorAll("button").length || 0, processCompact: (process?.getBoundingClientRect().width || 0) < (refine?.getBoundingClientRect().width || 0), processWidth: process?.getBoundingClientRect().width || 0, refineWidth: refine?.getBoundingClientRect().width || 0, equalHeights: processStyle?.height === refineStyle?.height, equalRadii: processStyle?.borderRadius === refineStyle?.borderRadius, processHeight: processStyle?.height, refineHeight: refineStyle?.height, processRadius: processStyle?.borderRadius, refineRadius: refineStyle?.borderRadius, focusedBorder: focusedRefineStyle?.borderTopColor, focusedBoxShadow: focusedRefineStyle?.boxShadow, sendTransparent: sendStyle?.backgroundColor === "rgba(0, 0, 0, 0)", sendWidth: send?.getBoundingClientRect().width || 0, optimisticReconciled, refineHasSendIcon: Boolean(actions?.querySelector(".proposed-plan-refine-send use[href=\\\"#i-send\\\"]")) }; })();
					})()`);
					console.error(`[capture:proposal] ${JSON.stringify(proposalMetrics)}`);
					const executionPlanMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						state.session = { ...(state.session || {}), collaborationMode: "build", workflowProposal: { markdown: "# Summary\\n\\nApproved proposal remains readable during Build.", revision: 2, updatedAt: new Date().toISOString() }, workflowPlan: { taskId: "capture-task", proposalRevision: 2, phase: "active", explanation: "Implement and verify", plan: [{ step: "Inspect", status: "completed" }, { step: "Implement", status: "in_progress" }, { step: "Verify", status: "pending" }], updatedAt: new Date().toISOString() } };
						state.workflowPlanCollapsed = false;
						renderWorkflowPlanCard();
						const card = document.querySelector("#workflowPlanCard");
						const body = document.querySelector("#workflowPlanBody");
						const header = card?.querySelector(".workflow-plan-header");
						const cardRect = card?.getBoundingClientRect();
						const composerRect = document.querySelector("#composer")?.getBoundingClientRect();
						state.session.workflowPlan = { ...state.session.workflowPlan, phase: "active", plan: state.session.workflowPlan.plan.map((item) => ({ ...item, status: "completed" })), updatedAt: new Date(Date.now() + 1).toISOString() };
						renderWorkflowPlanCard();
						const autoCollapsed = card?.classList.contains("collapsed") && header?.getAttribute("aria-expanded") === "false";
						header?.click();
						return { visible: Boolean(card && !card.classList.contains("hidden")), proposalHidden: !card?.querySelector(".workflow-plan-proposal") && !card?.textContent.includes("Approved proposal remains readable"), stepCount: card?.querySelectorAll(".workflow-plan-steps li").length || 0, ariaExpanded: header?.getAttribute("aria-expanded"), headerMinHeight: header ? getComputedStyle(header).minHeight : null, width: Math.round(cardRect?.width || 0), composerWidth: Math.round(composerRect?.width || 0), widthMatches: Math.abs((cardRect?.width || 0) - (composerRect?.width || 0)) < 1, autoCollapsed, manualReopen: !card?.classList.contains("collapsed") && header?.getAttribute("aria-expanded") === "true", bodyConnected: Boolean(body?.isConnected) };
					})()`);
					console.error(`[capture:execution-plan] ${JSON.stringify(executionPlanMetrics)}`);
				}
				if (process.env.METIS_DESKTOP_CAPTURE_WORK_TRACE) {
					const workTraceMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						document.querySelector('#onboardingOverlay')?.setAttribute('hidden', '');
						document.querySelector('[data-purpose="main-chat"]')?.classList.remove('is-empty-state');
						state.isStreaming = true;
						state.messages = [{ role: "user", content: "Improve README", timestamp: 1 }, { role: "assistant", timestamp: 2, content: [
							{ type: "thinking", thinking: "Inspect the project structure and documentation entry points." },
							{ type: "text", text: "I will inspect the existing README, project entry points, and configuration before proposing focused improvements." },
							{ type: "toolCall", id: "capture-read", name: "read", arguments: { path: "README.md" } },
						] }];
						renderServerMessages(state.messages);
						const captureProject = state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0];
						if (captureProject) {
							captureProject.conversations = Array.from({ length: 7 }, (_, index) => ({ id: 'capture-' + index, title: 'Capture conversation ' + index, branch: false }));
							renderConversations();
						}
						const thoughts = document.querySelector('.cot-thoughts-group');
						const text = document.querySelector('.cot-text');
						const tool = document.querySelector('.cot-content-inner > .tool-card');
						const header = document.querySelector('.assistant-turn-work-start .cot-header-bar');
						const title = header?.querySelector('.cot-title');
						const chevron = header?.querySelector('.cot-chevron');
						const composerStack = document.querySelector('[data-purpose="composer-stack"]');
						const body = text?.closest('.assistant-body');
						const thoughtsRect = thoughts?.getBoundingClientRect();
						const textRect = text?.getBoundingClientRect();
						const toolRect = tool?.getBoundingClientRect();
						const textStyle = text ? getComputedStyle(text) : null;
						const bodyStyle = body ? getComputedStyle(body) : null;
						const headerStyle = header ? getComputedStyle(header) : null;
						const composerStackStyle = composerStack ? getComputedStyle(composerStack) : null;
						const titleRect = title?.getBoundingClientRect();
						const chevronRect = chevron?.getBoundingClientRect();
						const expandedBorder = headerStyle ? [headerStyle.borderBottomWidth, headerStyle.borderBottomStyle, headerStyle.borderBottomColor].join(' ') : null;
						header?.click();
						const collapsedHeaderStyle = header ? getComputedStyle(header) : null;
						return { fontMatchesBody: Boolean(textStyle && bodyStyle && textStyle.fontFamily === bodyStyle.fontFamily && textStyle.fontSize === bodyStyle.fontSize && textStyle.fontWeight === bodyStyle.fontWeight && textStyle.lineHeight === bodyStyle.lineHeight && textStyle.color === bodyStyle.color), thoughtsToText: thoughtsRect && textRect ? Math.round(textRect.top - thoughtsRect.bottom) : null, textToTool: textRect && toolRect ? Math.round(toolRect.top - textRect.bottom) : null, thoughtsHeight: thoughtsRect ? Math.round(thoughtsRect.height) : null, textColor: textStyle?.color || null, bodyColor: bodyStyle?.color || null, headerWidth: header ? Math.round(header.getBoundingClientRect().width) : null, expandedBorder, collapsedBorder: collapsedHeaderStyle ? [collapsedHeaderStyle.borderBottomWidth, collapsedHeaderStyle.borderBottomStyle, collapsedHeaderStyle.borderBottomColor].join(' ') : null, chevronWidth: chevronRect ? Math.round(chevronRect.width) : null, titleToChevron: titleRect && chevronRect ? Math.round(chevronRect.left - titleRect.right) : null, composerStackBackground: composerStackStyle?.backgroundColor || null, conversationCount: document.querySelectorAll('#conversationList .conversation-item').length, hasConversationCollapseControl: Boolean(document.querySelector('#conversationList .conversation-expand-button')) };
					})()`);
					console.error(`[capture:work-trace] ${JSON.stringify(workTraceMetrics)}`);
				}
				const image = await mainWindow.webContents.capturePage();
				await fsp.writeFile(process.env.METIS_DESKTOP_CAPTURE, image.toPNG());
				app.quit();
			}, 1800);
		}
	});
	if (process.env.METIS_DESKTOP_CAPTURE) {
		mainWindow.webContents.on("console-message", (event) => {
			console.error(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
		});
	}
	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith("file:")) event.preventDefault();
	});
	mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
		delete webPreferences.preload;
		webPreferences.nodeIntegration = false;
		webPreferences.contextIsolation = true;
		webPreferences.sandbox = true;
		if (!isHttpUrl(params.src)) event.preventDefault();
	});
	mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
		guest.setWindowOpenHandler(({ url }) => {
			if (isHttpUrl(url)) void shell.openExternal(url);
			return { action: "deny" };
		});
	});
	mainWindow.on("closed", () => {
		metisEventController?.abort();
		mainWindow = undefined;
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (isHttpUrl(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("context-menu", (_event, params) => {
		if (!params.isEditable && !params.selectionText) return;
		const template = createEditorContextMenuTemplate(params, nativeText);
		if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: mainWindow });
	});
}

app.whenReady().then(() => {
	if (process.platform === "darwin") app.dock?.setIcon(createAppIcon());
	rebuildApplicationMenu();
	const browserSession = session.fromPartition("persist:metis-browser");
	browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
	registerIpc();
	createWindow();
	void ensureLocalMetisServer();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	appIsQuitting = true;
	metisEventController?.abort();
	stopAutoServer();
});

function registerIpc() {
	ipcMain.handle("app:info", () => ({
		name: app.getName(),
		version: app.getVersion(),
		platform: process.platform,
	}));
	ipcMain.handle("app:set-language", (_event, language) => {
		desktopLanguage = desktopI18n.languages.includes(language) ? language : "auto";
		rebuildApplicationMenu();
		return desktopI18n.resolve(desktopLanguage, [app.getLocale()]);
	});
	ipcMain.handle("app:quit", () => app.quit());
	ipcMain.handle("clipboard:write-text", (_event, text) => clipboard.writeText(String(text ?? "")));
	ipcMain.handle("attachment:save", async (_event, input = {}) => {
		const encoded = String(input.data || "");
		if (encoded.length > Math.ceil(MAX_BUFFERED_ATTACHMENT_BYTES * 4 / 3) + 4) {
			throw new Error(nativeText("attachmentTooLargeMain"));
		}
		const buffer = Buffer.from(encoded, "base64");
		if (buffer.length > MAX_BUFFERED_ATTACHMENT_BYTES) throw new Error(nativeText("attachmentTooLargeMain"));
		const rawName = path.basename(String(input.name || "attachment"));
		const safeName = rawName.replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_").slice(-120) || "attachment";
		const directory = path.join(app.getPath("temp"), "metis-desktop-attachments");
		await fsp.mkdir(directory, { recursive: true });
		const target = path.join(directory, `${Date.now()}-${randomUUID()}-${safeName}`);
		await fsp.writeFile(target, buffer, { flag: "wx" });
		return target;
	});
	ipcMain.handle("session-file:open", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			buttonLabel: nativeText("dialogOpen"),
			properties: ["openFile"],
			filters: [{ name: nativeText("metisSessionFilter"), extensions: ["jsonl"] }],
		});
		return result.canceled ? undefined : result.filePaths[0];
	});
	ipcMain.handle("session-file:save", async (_event, format) => {
		const extension = format === "jsonl" ? "jsonl" : "html";
		const result = await dialog.showSaveDialog(mainWindow, {
			buttonLabel: nativeText("dialogSave"),
			defaultPath: `metis-session.${extension}`,
			filters: [{ name: format === "jsonl" ? nativeText("metisSessionFilter") : "HTML", extensions: [extension] }],
		});
		return result.canceled ? undefined : result.filePath;
	});
	ipcMain.handle("session-tokens:totals", (_event, sessionPaths) => readSessionTokenTotals(sessionPaths));
	ipcMain.handle("session-tokens:activity", (_event, sessionPaths) => readSessionTokenActivity(sessionPaths));

	ipcMain.handle("workspace:get", () => workspaceSummary());
	ipcMain.handle("workspace:set", (_event, workspacePath) => {
		try {
			return setWorkspaceRoot(workspacePath);
		} catch (error) {
			const message = String(error?.message || "");
			if (!message.includes("Workspace directory does not exist")) throw error;
			// Stale workspace paths can be restored from renderer local state.
			// Keep current workspace instead of surfacing a hard IPC failure.
			console.warn("[desktop] Ignored stale workspace path:", workspacePath);
			return workspaceSummary();
		}
	});
	ipcMain.handle("workspace:select", async () => {
		const result = await dialog.showOpenDialog(mainWindow, { buttonLabel: nativeText("dialogSelectFolder"), properties: ["openDirectory", "createDirectory"] });
		if (result.canceled || result.filePaths.length === 0) return undefined;
		return setWorkspaceRoot(result.filePaths[0]);
	});
	ipcMain.handle("workspace:select-many", async () => {
		const result = await dialog.showOpenDialog(mainWindow, { buttonLabel: nativeText("dialogSelectFolder"), properties: ["openDirectory", "multiSelections"] });
		if (result.canceled || result.filePaths.length === 0) return [];
		return result.filePaths.map((workspacePath) => {
			const resolved = path.resolve(workspacePath);
			if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error(nativeText("workspaceMissing", { path: resolved }));
			return { name: path.basename(resolved), path: resolved };
		});
	});
	ipcMain.handle("workspace:tree", () => readWorkspaceTree());
	ipcMain.handle("workspace:diff", (_event, relativePath) => readGitDiff(relativePath));
	ipcMain.handle("workspace:reveal", async (_event, relativePath) => {
		const absolutePath = resolveWorkspacePath(relativePath);
		shell.showItemInFolder(absolutePath);
	});
	ipcMain.handle("provider-config:get-custom", async () => (await getCustomProviderConfigs())[0] ?? { exists: false });
	ipcMain.handle("provider-config:list-custom", () => getCustomProviderConfigs());
	ipcMain.handle("provider-config:discover-models", (_event, config) => discoverCustomProviderModels(config));
	ipcMain.handle("provider-config:save-custom", (_event, config) => saveCustomProviderConfig(config));
	ipcMain.handle("provider-config:delete-custom", (_event, providerId) => deleteCustomProvider(providerId));

	ipcMain.handle("external:open", (_event, url) => {
		if (!isHttpUrl(url)) throw new Error(nativeText("httpOnly"));
		return shell.openExternal(url);
	});

	ipcMain.handle("metis:connect", async (_event, options = {}) => {
		const baseUrl = normalizeServerUrl(options.baseUrl || metisServer.baseUrl);
		metisServer = {
			baseUrl,
			username: String(options.username || "metis"),
			password: String(options.password || ""),
		};
		const health = await metisRequest("/global/health");
		// 幂等：已有活跃 SSE（streamMetisEvents 循环在跑，含断线重试等待期）时不重复 abort/重建，
		// 避免 renderer 的 interval 与 onServerReady/启动初始化并发触发时反复重建连接。
		if (health.ok && (!metisEventController || metisEventController.signal.aborted)) {
			void streamMetisEvents();
		}
		return health;
	});
	ipcMain.handle("metis:disconnect", () => {
		metisEventController?.abort();
		return true;
	});
	ipcMain.handle("metis:request", (_event, request) =>
		metisRequest(request.path, { method: request.method, body: request.body, timeoutMs: request.timeoutMs }),
	);
}

function resolveAgentDir() {
	const configuredAgentDir = process.env.METIS_CODING_AGENT_DIR;
	return configuredAgentDir?.startsWith("~/")
		? path.join(app.getPath("home"), configuredAgentDir.slice(2))
		: configuredAgentDir || path.join(app.getPath("home"), ".metis", "agent");
}

function customProviderOptions() {
	return { translate: nativeText };
}

async function getCustomProviderConfigs() {
	return customProviderConfig.listCustomProviderConfigs(resolveAgentDir(), customProviderOptions());
}

async function discoverCustomProviderModels(config = {}) {
	return customProviderConfig.discoverCustomProviderModels(config.baseUrl, config.apiKey, customProviderOptions());
}

async function saveCustomProviderConfig(config = {}) {
	if (!config.providerId && !String(config.apiKey || "").trim()) throw new Error(nativeText("apiKeyRequired"));
	return customProviderConfig.saveCustomProviderConfig(resolveAgentDir(), config, customProviderOptions());
}

async function deleteCustomProvider(providerId) {
	if (!customProviderConfig.isCustomProviderId(String(providerId || ""))) {
		throw new Error(nativeText("customProviderNotFound"));
	}
	const logout = await metisRequest("/session/command", {
		method: "POST",
		body: { command: `/logout ${providerId}` },
	});
	if (!logout.ok) throw new Error(logout.data?.error?.message || logout.error || nativeText("customProviderDeleteFailed"));
	const deleted = await customProviderConfig.deleteCustomProviderConfig(resolveAgentDir(), providerId, customProviderOptions());
	if (!deleted) throw new Error(nativeText("customProviderNotFound"));
	await metisRequest("/session/command", { method: "POST", body: { command: "/reload" } });
	return { provider: providerId, deleted: true };
}

function workspaceSummary() {
	return {
		name: path.basename(workspaceRoot),
		path: workspaceRoot,
		isProjectRepo: isDefaultWorkspaceProjectRepo,
	};
}

function setWorkspaceRoot(workspacePath) {
	if (typeof workspacePath !== "string" || !workspacePath.trim()) throw new Error(nativeText("invalidWorkspacePath"));
	const resolved = path.resolve(workspacePath);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
		throw new Error(nativeText("workspaceMissing", { path: resolved }));
	}
	workspaceRoot = resolved;
	isDefaultWorkspaceProjectRepo = true;
	return workspaceSummary();
}

function findDefaultWorkspace() {
	for (const candidate of [path.resolve(__dirname, ".."), path.resolve(__dirname, "../.."), process.cwd()]) {
		if (fs.existsSync(path.join(candidate, "src", "modes")) && fs.existsSync(path.join(candidate, "package.json"))) {
			isDefaultWorkspaceProjectRepo = true;
			return candidate;
		}
	}
	isDefaultWorkspaceProjectRepo = false;
	const cwd = process.cwd();
	if (cwd && cwd !== "/" && fs.existsSync(cwd)) {
		return cwd;
	}
	try {
		return app.getPath("documents");
	} catch {
		try {
			return app.getPath("home");
		} catch {
			return require("node:os").homedir();
		}
	}
}

async function readWorkspaceTree() {
	let count = 0;

	async function walk(directory, depth) {
		if (depth > 4 || count >= MAX_TREE_ITEMS) return [];
		const entries = await fsp.readdir(directory, { withFileTypes: true });
		entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
		const nodes = [];
		for (const entry of entries) {
			if (count >= MAX_TREE_ITEMS || entry.name === ".DS_Store") break;
			if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
			if (entry.isSymbolicLink()) continue;
			const absolutePath = path.join(directory, entry.name);
			const relativePath = path.relative(workspaceRoot, absolutePath);
			count += 1;
			if (entry.isDirectory()) {
				nodes.push({ name: entry.name, path: relativePath, type: "directory", children: await walk(absolutePath, depth + 1) });
			} else {
				nodes.push({ name: entry.name, path: relativePath, type: "file" });
			}
		}
		return nodes;
	}

	return { root: workspaceSummary(), nodes: await walk(workspaceRoot, 0), truncated: count >= MAX_TREE_ITEMS };
}

async function readGitDiff(relativePath) {
	const absolutePath = resolveWorkspacePath(relativePath);
	const stat = await fsp.stat(absolutePath);
	if (!stat.isFile()) throw new Error(nativeText("diffTargetFile"));
	const normalized = path.relative(workspaceRoot, absolutePath);
	let diff = "";
	let isUntracked = false;
	try {
		const status = await execFileAsync("git", ["status", "--porcelain", "--", normalized], {
			cwd: workspaceRoot,
			maxBuffer: 16_384,
		});
		isUntracked = status.stdout.startsWith("??");
		const result = await execFileAsync("git", ["diff", "--no-ext-diff", "--unified=4", "--", normalized], {
			cwd: workspaceRoot,
			maxBuffer: MAX_DIFF_BYTES,
		});
		diff = result.stdout;
		if (!diff) {
			const staged = await execFileAsync("git", ["diff", "--cached", "--no-ext-diff", "--unified=4", "--", normalized], {
				cwd: workspaceRoot,
				maxBuffer: MAX_DIFF_BYTES,
			});
			diff = staged.stdout;
		}
	} catch (error) {
		if (error.code === "ENOENT") throw new Error(nativeText("gitNotInstalled"));
		diff = error.stdout || "";
	}
	if (!diff) {
		const source = await fsp.readFile(absolutePath, "utf8");
		const sourceLines = source.split(/\r?\n/).slice(0, 500);
		const body = sourceLines
			.map((line) => `${isUntracked ? "+" : " "}${line}`)
			.join("\n");
		diff = isUntracked
			? `diff --git a/${normalized} b/${normalized}\nnew file mode 100644\n--- /dev/null\n+++ b/${normalized}\n@@ -0,0 +1,${sourceLines.length} @@\n${body}`
			: body;
	}
	return { path: normalized, diff: diff.slice(0, MAX_DIFF_BYTES), truncated: diff.length > MAX_DIFF_BYTES };
}

function resolveWorkspacePath(relativePath) {
	if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) throw new Error(nativeText("invalidWorkspacePath"));
	const absolutePath = path.resolve(workspaceRoot, relativePath);
	const relative = path.relative(workspaceRoot, absolutePath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(nativeText("pathEscapesWorkspace"));
	return absolutePath;
}

async function metisRequest(requestPath, init = {}) {
	if (typeof requestPath !== "string" || !requestPath.startsWith("/") || requestPath.startsWith("//")) {
		throw new Error(nativeText("invalidApiPath"));
	}
	const method = String(init.method || "GET").toUpperCase();
	if (!["GET", "POST", "PUT"].includes(method)) throw new Error(nativeText("unsupportedApiMethod"));
	const headers = { Accept: "application/json" };
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	if (metisServer.password) {
		headers.Authorization = `Basic ${Buffer.from(`${metisServer.username}:${metisServer.password}`).toString("base64")}`;
	}
	const requestedTimeout = Number(init.timeoutMs);
	const timeoutMs = Number.isFinite(requestedTimeout)
		? Math.max(1_000, Math.min(requestedTimeout, 10 * 60_000))
		: 15_000;
	try {
		// net.fetch 走 Chromium 网络栈：不读取 shell 的 HTTP(S)_PROXY 环境变量，
		// 仅受系统代理设置影响（macOS 系统代理默认绕过 localhost），保证 127.0.0.1 直连。
		const response = await net.fetch(`${metisServer.baseUrl}${requestPath}`, {
			method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const text = await response.text();
		let data;
		try {
			data = text ? JSON.parse(text) : undefined;
		} catch {
			data = text;
		}
		return { ok: response.ok, status: response.status, data };
	} catch (error) {
		return { ok: false, status: 0, error: error.message };
	}
}

async function streamMetisEvents() {
	metisEventController?.abort();
	const controller = new AbortController();
	metisEventController = controller;
	const headers = { Accept: "text/event-stream" };
	if (metisServer.password) {
		headers.Authorization = `Basic ${Buffer.from(`${metisServer.username}:${metisServer.password}`).toString("base64")}`;
	}
	let retryDelay = 250;
	while (!controller.signal.aborted) {
		try {
			const response = await net.fetch(`${metisServer.baseUrl}/event`, { headers, signal: controller.signal });
			if (!response.ok || !response.body) throw new Error(nativeText("sseFailed", { status: response.status }));
			retryDelay = 250;
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			while (!controller.signal.aborted) {
				const { done, value } = await reader.read();
				if (done) throw new Error(nativeText("sseClosed"));
				buffer += decoder.decode(value, { stream: true });
				let boundary;
				while ((boundary = buffer.indexOf("\n\n")) !== -1) {
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const cleanFrame = frame.replace(/\r/g, "");
					const data = cleanFrame
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n");
					if (!data) continue;
					try {
						mainWindow?.webContents.send("metis:event", JSON.parse(data));
					} catch {}
				}
			}
		} catch (error) {
			if (controller.signal.aborted) break;
			mainWindow?.webContents.send("metis:disconnected", error.message);
		}
		await waitForAbortableDelay(retryDelay, controller.signal);
		retryDelay = Math.min(retryDelay * 2, 5_000);
	}
}

function waitForAbortableDelay(delay, signal) {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, delay);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

function normalizeServerUrl(value) {
	const url = new URL(String(value));
	if (!isHttpUrl(url.href)) throw new Error(nativeText("serverUrlProtocol"));
	return url.href.replace(/\/$/, "");
}

function isHttpUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
