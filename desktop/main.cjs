const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, session, shell, utilityProcess } = require("electron");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { createApplicationMenuTemplate, createEditorContextMenuTemplate } = require("./main-menu.cjs");
const customProviderConfig = require("./provider-config.cjs");
const { getMetisRuntimeIntegrityError } = require("./runtime-integrity.cjs");
const { readSessionTokenActivity, readSessionTokenTotals } = require("./session-token-totals.cjs");
const desktopI18n = require("./i18n.cjs");
const { WorkspaceCreateError, createWorkspaceDirectory } = require("./workspace-create.cjs");

app.commandLine.appendSwitch("log-level", "3");

const execFileAsync = promisify(execFile);
const MAX_TREE_ITEMS = 600;
const MAX_DIFF_BYTES = 300_000;
const MAX_BUFFERED_ATTACHMENT_BYTES = 128 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", ".codegraph", ".sessions", "node_modules", "dist", "coverage"]);

let mainWindow;
let desktopLanguage = "auto";
let desktopTheme = "system";
let isDefaultWorkspaceProjectRepo = false;
let workspaceRoot = findDefaultWorkspace();
let metisServer = { baseUrl: "http://127.0.0.1:4096", username: "metis", password: "" };
let metisEventController;

function nativeText(key, variables) {
	return desktopI18n.t(key, desktopLanguage, variables, [app.getLocale()]);
}

function desktopPreferencesPath() {
	return path.join(app.getPath("userData"), "desktop-preferences.json");
}

function loadDesktopPreferences() {
	try {
		const saved = JSON.parse(fs.readFileSync(desktopPreferencesPath(), "utf8"));
		desktopLanguage = desktopI18n.languages.includes(saved?.language) ? saved.language : "auto";
		desktopTheme = ["system", "light", "dark"].includes(saved?.theme) ? saved.theme : "system";
		nativeTheme.themeSource = desktopTheme;
	} catch {
		desktopLanguage = "auto";
		desktopTheme = "system";
		nativeTheme.themeSource = "system";
	}
}

function saveDesktopPreferences() {
	fs.mkdirSync(app.getPath("userData"), { recursive: true });
	fs.writeFileSync(desktopPreferencesPath(), JSON.stringify({ language: desktopLanguage, theme: desktopTheme }), "utf8");
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
	try {
		const candidates = [
			path.join(__dirname, "public", "assets", "metis-app-icon-centered.svg"),
			path.join(__dirname, "assets", "metis-app-icon-centered.svg"),
			path.join(__dirname, "renderer", "assets", "metis-app-icon-centered.svg"),
			path.join(__dirname, "public", "assets", "metis-pixel-mark.svg"),
			path.join(__dirname, "assets", "metis-pixel-mark.svg"),
			path.join(__dirname, "renderer", "assets", "metis-pixel-mark.svg"),
			path.resolve(__dirname, "../src/modes/interactive/assets/metis-pixel-mark.svg"),
		];
		const iconPath = candidates.find((c) => fs.existsSync(c));
		if (iconPath) {
			const svg = fs.readFileSync(iconPath, "utf8");
			return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
		}
	} catch (err) {
		console.warn("[desktop] Unable to load app icon SVG:", err);
	}
	return nativeImage.createEmpty();
}

function findMetisCli() {
	const candidates = [
		process.env.METIS_DESKTOP_CLI_PATH ? path.resolve(process.env.METIS_DESKTOP_CLI_PATH) : undefined,
		path.join(process.resourcesPath, "metis-runtime", "dist", "cli.js"),
		path.resolve(__dirname, "../dist/cli.js"),
		path.resolve(__dirname, "../../dist/cli.js"),
	].filter(Boolean);
	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) continue;
		const integrityError = getMetisRuntimeIntegrityError(candidate);
		if (!integrityError) return candidate;
		console.error(`[desktop] Ignoring incomplete Metis CLI runtime at ${candidate}: ${integrityError}`);
	}
	return undefined;
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
		console.error("[desktop] Complete Metis CLI runtime not found in app resources or repository build output.");
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
		backgroundColor: "#ffffff",
		transparent: false,
		roundedCorners: true,
		title: "Metis",
		icon,
		autoHideMenuBar: true,
		titleBarStyle: isMac ? "hiddenInset" : "hidden",
		trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
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

	const captureQuery = {};
	if (process.env.METIS_DESKTOP_CAPTURE_PLAN_PREVIEW || process.env.METIS_DESKTOP_CAPTURE_PROGRESS || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_DEFAULT || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_COMPLETED) {
		captureQuery["capture-plan-preview"] = "1";
	}
	if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_DEFAULT) captureQuery["capture-streaming-work"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_CONVERSATION_ICONS) captureQuery["capture-conversation-icons"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_MODEL_SWITCHER) captureQuery["capture-model-switcher"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_ATTACHMENTS) captureQuery["capture-attachments"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_ASK) captureQuery["capture-ask"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_TASK_RECEIVED) captureQuery["capture-local-send"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND_SETTLED) {
		captureQuery["capture-local-send"] = "1";
		captureQuery["capture-send-settled"] = "1";
	}
	if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_THINKING) captureQuery["capture-thinking-progress"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_PLAN_POINTS) captureQuery["capture-plan-points"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_PLAN_POINTS_EMPTY) captureQuery["capture-plan-points-empty"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_MESSAGE_WIDTH) captureQuery["capture-message-width"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_TOOLS) captureQuery["capture-tools"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_SKILLS) captureQuery["capture-skills"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_WORK_DURATION) captureQuery["capture-work-duration"] = "1";
	if (process.env.METIS_DESKTOP_CAPTURE_THINKING) captureQuery["capture-thinking-overflow"] = "1";
	const captureSearch = new URLSearchParams(captureQuery).toString();
	const devServerUrl = process.env.VITE_DEV_SERVER_URL;
	if (devServerUrl) {
		const loadDevUrl = async (attempt = 1) => {
			try {
					const captureUrl = captureSearch
						? `${devServerUrl}${devServerUrl.includes("?") ? "&" : "?"}${captureSearch}`
						: devServerUrl;
					await mainWindow.loadURL(captureUrl);
			} catch (err) {
				if (attempt <= 10 && mainWindow && !mainWindow.isDestroyed()) {
					console.log(`[desktop] Waiting for Vite dev server (attempt ${attempt}/10)...`);
					setTimeout(() => void loadDevUrl(attempt + 1), 300);
				} else if (mainWindow && !mainWindow.isDestroyed()) {
					console.warn("[desktop] Loading built renderer fallback.");
						void mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"), captureSearch
							? { query: captureQuery }
							: undefined);
				}
			}
		};
		void loadDevUrl();
	} else {
		void mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"), captureSearch
			? { query: captureQuery }
			: undefined);
	}
	mainWindow.webContents.on("dom-ready", () => {
		void mainWindow.webContents.executeJavaScript(
			`document.body.classList.add(${JSON.stringify(`platform-${process.platform}`)})`,
		);
	});
	mainWindow.webContents.on("did-finish-load", () => {
		if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
			mainWindow.show();
		}
	});
	mainWindow.once("ready-to-show", () => {
		if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
			mainWindow.show();
		}
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
					if (process.env.METIS_DESKTOP_CAPTURE_SETTINGS_LANGUAGE) {
						await mainWindow.webContents.executeJavaScript(`(() => {
							const select = document.querySelector('[role="dialog"] select');
							if (!select) return;
							select.value = ${JSON.stringify(process.env.METIS_DESKTOP_CAPTURE_SETTINGS_LANGUAGE)};
							select.dispatchEvent(new Event('change', { bubbles: true }));
						})()`);
						await new Promise((resolve) => setTimeout(resolve, 500));
					}
					if (process.env.METIS_DESKTOP_CAPTURE_SETTINGS_CONNECT) {
						await mainWindow.webContents.executeJavaScript("document.querySelector('#connectServerButton')?.click()");
						await new Promise((resolve) => setTimeout(resolve, 900));
					}
					if (process.env.METIS_DESKTOP_CAPTURE_SETTINGS_CLOSE) {
						await mainWindow.webContents.executeJavaScript("document.querySelector('[role=dialog] main > button')?.click()");
						await new Promise((resolve) => setTimeout(resolve, 300));
					}
					const settingsMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						const dialog = document.querySelector('[role="dialog"][aria-labelledby="settings-title"]');
						const activePanel = document.querySelector('[data-settings-panel][aria-current="page"]');
						const heading = dialog?.querySelector('main h2');
						const description = dialog?.querySelector('main header p');
						const rect = dialog?.getBoundingClientRect();
						const style = dialog ? getComputedStyle(dialog) : null;
						const serverAddress = dialog?.querySelector('#serverUrlInput');
						const connectButton = dialog?.querySelector('#connectServerButton');
						const currentSelects = [...(dialog?.querySelectorAll('main select') || [])];
						const catalogs = window.metisDesktopI18nCatalogs;
						const untranslatedSources = new Set(Object.entries(catalogs?.en || {})
							.filter(([key, value]) => key.startsWith('reactSettings') && catalogs?.['zh-CN']?.[key] !== value)
							.map(([, value]) => value));
						const visibleCopy = dialog ? [
							...[...dialog.querySelectorAll('*')].flatMap((element) => [element.getAttribute('aria-label'), element.getAttribute('placeholder')]),
							...(() => { const values = []; const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) values.push(node.nodeValue?.trim()); return values; })(),
						].filter(Boolean) : [];
						return {
							visible: Boolean(dialog),
							panel: activePanel?.dataset.settingsPanel || null,
							activeLabel: activePanel?.textContent?.trim() || null,
							heading: heading?.textContent?.trim() || null,
							description: description?.textContent?.trim() || null,
							hasAppearanceControl: currentSelects.some((select) => ['system', 'light', 'dark'].every((value) => [...select.options].some((option) => option.value === value))),
							languageDisabled: activePanel?.dataset.settingsPanel === 'general' ? Boolean(currentSelects[0]?.disabled) : null,
							serverAddress: serverAddress?.value || null,
							connectDisabled: connectButton ? connectButton.disabled : null,
							feedback: dialog?.querySelector('[role="status"], [role="alert"]')?.textContent?.trim() || null,
							untranslated: [...new Set(visibleCopy.filter((value) => untranslatedSources.has(value)))],
							navigationItems: dialog?.querySelectorAll('[data-settings-panel]').length || 0,
							rect: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
							position: style?.position || null,
						};
					})()`);
					console.error(`[capture:settings] ${JSON.stringify(settingsMetrics)}`);
				}
				if (process.env.METIS_DESKTOP_CAPTURE_SKILLS) {
					await mainWindow.webContents.executeJavaScript(`(() => {
						const input = document.querySelector('[data-composer-input]');
						if (!(input instanceof HTMLTextAreaElement)) return false;
						const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
						setter?.call(input, "/");
						input.dispatchEvent(new Event("input", { bubbles: true }));
						input.focus();
						return true;
					})()`);
					await new Promise((resolve) => setTimeout(resolve, 220));
					if (process.env.METIS_DESKTOP_CAPTURE_SKILLS_SELECT) {
						await mainWindow.webContents.executeJavaScript(`(() => {
							const input = document.querySelector('[data-composer-input]');
							input?.dispatchEvent(new KeyboardEvent('keydown', {
								key: 'Enter',
								bubbles: true,
								cancelable: true,
							}));
						})()`);
						await new Promise((resolve) => setTimeout(resolve, 80));
					}
					const skillMetrics = await mainWindow.webContents.executeJavaScript(`(() => ({
						visible: Boolean(document.querySelector('[data-skill-picker]')),
						options: document.querySelectorAll('[data-skill-option]').length,
						active: document.querySelector('[data-skill-option][aria-selected="true"]')?.getAttribute('data-skill-option') || null,
						value: document.querySelector('[data-composer-input]')?.value || '',
					}))()`);
					console.error(`[capture:skills] ${JSON.stringify(skillMetrics)}`);
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
						state.session = { ...state.session, supportsThinking: true, thinkingLevels: ["off", "low", "medium", "high", "xhigh"], thinkingOptions: [{ id: "off", label: "None", value: "none" }, { id: "low", label: "Low", value: "low" }, { id: "medium", label: "Medium", value: "medium" }, { id: "high", label: "High", value: "high" }, { id: "xhigh", label: "Xhigh", value: "xhigh" }], thinkingLevel: "high" };
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
						memoryRunPending = true;
						renderMemoryStatus();
						const runPendingState = { disabled: button?.disabled || false };
						memoryRunPending = false;
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
							runPendingState,
						};
					})()`);
					console.error(`[capture:memory] ${JSON.stringify(memoryMetrics)}`);
					await new Promise((resolve) => setTimeout(resolve, 220));
				}
				if (process.env.METIS_DESKTOP_CAPTURE_ASK) {
					const askMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						const card = document.querySelector('[data-user-input-request-id="capture-ask-request"]');
						const rect = card?.getBoundingClientRect();
						const style = card ? getComputedStyle(card) : null;
						const actionsRect = card?.querySelector('[data-user-input-confirm]')?.getBoundingClientRect();
						const wrapRect = card?.parentElement?.getBoundingClientRect();
						return { replacesComposer: !document.querySelector('[data-composer]'), outsideToolCall: !card?.closest('[data-part-key]'), visibleQuestionCount: card?.querySelectorAll('fieldset').length || 0, progress: card?.querySelector('[data-user-input-progress]')?.textContent?.trim(), minButtonHeight: card ? getComputedStyle(card.querySelector("button")).height : null, borderColor: style?.borderColor, backgroundColor: style?.backgroundColor, width: rect?.width || 0, widthMatches: Math.abs((rect?.width || 0) - 620) < 1, actionsVisible: Boolean(actionsRect && wrapRect && actionsRect.bottom <= wrapRect.bottom && actionsRect.top >= wrapRect.top), horizontalRuleCount: card?.querySelectorAll('hr').length || 0 };
					})()`);
					console.error(`[capture:ask] ${JSON.stringify(askMetrics)}`);
					const askNextMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						const card = document.querySelector('[data-user-input-request-id="capture-ask-request"]');
						const firstOption = card?.querySelector('input[type="radio"]');
						firstOption?.click();
						card?.requestSubmit();
						return new Promise((resolve) => requestAnimationFrame(() => resolve({ visibleQuestionCount: card?.querySelectorAll('fieldset').length || 0, progress: card?.querySelector('[data-user-input-progress]')?.textContent?.trim(), questionId: card?.dataset.questionId, finalAction: card?.querySelector('[data-user-input-confirm]')?.getAttribute('aria-label') })));
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
					if (process.env.METIS_DESKTOP_CAPTURE_SESSION_SIDEBAR) {
					const sidebarMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
						const projectGroup = document.querySelector('[aria-label="Projects"]');
						const projectButtons = [...document.querySelectorAll('[aria-label^="Open project "]')];
						const activeProject = document.querySelector('[aria-label^="Open project "][aria-pressed="true"]');
						const addProject = document.querySelector('[aria-label="Add project"]');
						const activeConversation = document.querySelector('[aria-current="page"]');
						const addRect = addProject?.getBoundingClientRect();
						const activeMarkRect = activeProject?.querySelector('span')?.getBoundingClientRect();
						return {
							hasProjectGroup: Boolean(projectGroup),
							projectCount: projectButtons.length,
							activeProjectCount: activeProject ? 1 : 0,
							hasAddProject: Boolean(addProject),
							hasActiveConversation: Boolean(activeConversation),
							addProjectHitArea: addRect ? [Math.round(addRect.width), Math.round(addRect.height)] : null,
							activeProjectMark: activeMarkRect ? [Math.round(activeMarkRect.width), Math.round(activeMarkRect.height)] : null,
						};
					})()`);
						console.error(`[capture:session-sidebar] ${JSON.stringify(sidebarMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_CONVERSATION_ICONS) {
						const iconMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
							const rows = [...document.querySelectorAll('[data-conversation-row]')];
							const icons = [...document.querySelectorAll('[data-conversation-icon]')];
							const iconSizes = icons.map((icon) => {
								const rect = icon.getBoundingClientRect();
								return [Math.round(rect.width), Math.round(rect.height)];
							});
							const visualOffsets = icons.map((icon) => {
								const graphic = icon.querySelector('use');
								const box = graphic?.getBBox();
								const matrix = graphic?.getScreenCTM();
								const iconRect = icon.getBoundingClientRect();
								if (!box || !matrix) return null;
								const topLeft = new DOMPoint(box.x, box.y).matrixTransform(matrix);
								const bottomRight = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
								return {
									box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
									centerOffset: [
										Math.round((topLeft.x + bottomRight.x - iconRect.left - iconRect.right) / 2),
										Math.round((topLeft.y + bottomRight.y - iconRect.top - iconRect.bottom) / 2),
									],
								};
							});
							const visualGaps = rows.map((row) => {
								const graphic = row.querySelector('[data-conversation-icon] use');
								const content = row.querySelector('[data-conversation-content]');
								const box = graphic?.getBBox();
								const matrix = graphic?.getScreenCTM();
								const contentRect = content?.getBoundingClientRect();
								if (!box || !matrix || !contentRect) return null;
								const graphicRight = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix).x;
								return Math.round(contentRect.left - graphicRight);
							});
							return {
								conversationCount: rows.length,
								iconCount: icons.length,
								allRowsHaveIcon: rows.every((row) => Boolean(row.querySelector('[data-conversation-icon]'))),
								activeHasIcon: Boolean(document.querySelector('[aria-current="page"] [data-conversation-icon]')),
								uniqueShapes: new Set(icons.map((icon) => icon.dataset.iconShape)).size,
								uniqueColors: new Set(icons.map((icon) => icon.dataset.iconColor)).size,
								allUseSprite: icons.every((icon) => icon.querySelector('use')?.getAttribute('href')?.includes('conversation-icons.svg#conversation-shape-')),
								iconSizes,
								visualOffsets,
								visualGaps,
								minimumVisualGap: Math.min(...visualGaps.filter((gap) => gap !== null)),
								minimumRowHeight: Math.min(...rows.map((row) => Math.round(row.getBoundingClientRect().height))),
							};
						})()`);
						console.error(`[capture:conversation-icons] ${JSON.stringify(iconMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_MULTILINE_COMPOSER) {
						const composerMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
							const input = document.querySelector('[data-composer-input]');
							const composer = document.querySelector('[data-composer]');
							const singleRect = composer?.getBoundingClientRect();
							const singleAddRect = composer?.querySelector('[aria-label="Add attachment"]')?.getBoundingClientRect();
							const singleActionRect = composer?.querySelector('[aria-label="Send message"]')?.getBoundingClientRect();
							const singleHasSendIcon = Boolean(composer?.querySelector('[aria-label="Send message"] [data-send-icon]'));
							const singleHeight = Math.round(singleRect?.height || 0);
							const singleCornerRadii = composer ? (() => {
								const style = getComputedStyle(composer);
								return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
							})() : null;
							const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
							setter?.call(input, 'First line\\nSecond line');
							input?.dispatchEvent(new Event('input', { bubbles: true }));
							await new Promise((resolve) => requestAnimationFrame(resolve));
							const animationStartHeight = Math.round(composer?.getBoundingClientRect().height || 0);
							await new Promise((resolve) => setTimeout(resolve, 100));
							const animationMidHeight = Math.round(composer?.getBoundingClientRect().height || 0);
							await new Promise((resolve) => setTimeout(resolve, 160));
							const add = composer?.querySelector('[aria-label="Add attachment"]');
							const send = composer?.querySelector('[aria-label="Send message"]');
							const expand = composer?.querySelector('[aria-label="Expand composer"]');
							const composerRect = composer?.getBoundingClientRect();
							const inputRect = input?.getBoundingClientRect();
							const addRect = add?.getBoundingClientRect();
							const sendRect = send?.getBoundingClientRect();
							const multilineHeight = Math.round(composerRect?.height || 0);
							const multilineCornerRadii = composer ? (() => {
								const style = getComputedStyle(composer);
								return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
							})() : null;
							expand?.click();
							await new Promise((resolve) => setTimeout(resolve, 240));
							const expandedHeight = Math.round(composer?.getBoundingClientRect().height || 0);
							document.querySelector('[aria-label="Collapse composer"]')?.click();
							await new Promise((resolve) => setTimeout(resolve, 240));
							return {
								tagName: input?.tagName || null,
								lineCount: input?.value.split('\\n').length || 0,
								multiline: composer?.dataset.composerMultiline || null,
								singleHeight,
								animationStartHeight,
								animationMidHeight,
								multilineHeight,
								expandedHeight,
								transitionProperty: composer ? getComputedStyle(composer).transitionProperty : null,
								transitionDuration: composer ? getComputedStyle(composer).transitionDuration : null,
								singleHasSendIcon,
								cornerRadii: { single: singleCornerRadii, multiline: multilineCornerRadii },
								bottomCornersStable: Boolean(singleCornerRadii && multilineCornerRadii
									&& singleCornerRadii[2] === multilineCornerRadii[2]
									&& singleCornerRadii[3] === multilineCornerRadii[3]),
								buttonInsets: {
									single: singleRect && singleAddRect && singleActionRect ? [
										Math.round(singleAddRect.left - singleRect.left),
										Math.round(singleRect.right - singleActionRect.right),
										Math.round(singleRect.bottom - singleActionRect.bottom),
									] : null,
									multiline: composerRect && addRect && sendRect ? [
										Math.round(addRect.left - composerRect.left),
										Math.round(composerRect.right - sendRect.right),
										Math.round(composerRect.bottom - sendRect.bottom),
									] : null,
								},
								buttonsStayAnchored: Boolean(singleRect && singleAddRect && singleActionRect && composerRect && addRect && sendRect
									&& Math.abs((singleAddRect.left - singleRect.left) - (addRect.left - composerRect.left)) < 1
									&& Math.abs((singleRect.right - singleActionRect.right) - (composerRect.right - sendRect.right)) < 1
									&& Math.abs((singleRect.bottom - singleActionRect.bottom) - (composerRect.bottom - sendRect.bottom)) < 1),
								borderRadius: composer ? getComputedStyle(composer).borderRadius : null,
								textAboveActions: Boolean(inputRect && addRect && sendRect && inputRect.top < addRect.top && inputRect.top < sendRect.top),
								actionsBottomAligned: Boolean(composerRect && addRect && sendRect && Math.abs(addRect.bottom - sendRect.bottom) < 1 && composerRect.bottom - sendRect.bottom <= 11),
								hasExpandControl: Boolean(expand),
								addHitArea: addRect ? [Math.round(addRect.width), Math.round(addRect.height)] : null,
								sendHitArea: sendRect ? [Math.round(sendRect.width), Math.round(sendRect.height)] : null,
							};
						})()`);
						console.error(`[capture:multiline-composer] ${JSON.stringify(composerMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_MODEL_SWITCHER) {
						const modelMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
							const trigger = document.querySelector('[data-model-switcher] button');
							const send = document.querySelector('[aria-label="Send message"]');
							const triggerRect = trigger?.getBoundingClientRect();
							const sendRect = send?.getBoundingClientRect();
							trigger?.click();
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							const menu = document.querySelector('[data-model-menu]');
							const reasoningTarget = menu?.querySelector('[data-model-reasoning]');
							reasoningTarget?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							const reasoning = document.querySelector('[data-reasoning-menu]');
							const menuRect = menu?.getBoundingClientRect();
							const reasoningTargetRect = reasoningTarget?.getBoundingClientRect();
							const reasoningRect = reasoning?.getBoundingClientRect();
							return {
								label: trigger?.querySelector('[data-model-trigger-label]')?.textContent || null,
								optionCount: menu?.querySelectorAll('[role="option"]').length || 0,
								selectedCount: menu?.querySelectorAll('[aria-selected="true"]').length || 0,
								triggerLeftOfSend: Boolean(triggerRect && sendRect && triggerRect.right <= sendRect.left),
								triggerToSendGap: triggerRect && sendRect ? Math.round(sendRect.left - triggerRect.right) : null,
								menuAboveTrigger: Boolean(menuRect && triggerRect && menuRect.bottom <= triggerRect.top),
								menuVisible: Boolean(menuRect && menuRect.width > 0 && menuRect.height > 0),
								ariaExpanded: trigger?.getAttribute('aria-expanded') || null,
								hasReasoningControl: Boolean(reasoning),
								reasoningOptionCount: reasoning?.querySelectorAll('[role="menuitemradio"]').length || 0,
								reasoningSelectedCount: reasoning?.querySelectorAll('[aria-checked="true"]').length || 0,
								reasoningModelCount: menu?.querySelectorAll('[data-model-reasoning]').length || 0,
								reasoningSubmenuBesideModel: Boolean(reasoningRect && reasoningTargetRect && (
									reasoningRect.left >= reasoningTargetRect.right + 4 || reasoningRect.right <= reasoningTargetRect.left - 4
								)),
							};
						})()`);
						console.error(`[capture:model-switcher] ${JSON.stringify(modelMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_MODE_SWITCHER) {
						const modeMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
							const group = document.querySelector('[data-mode-switcher]');
							const row = document.querySelector('[data-mode-switcher-row]');
							const composer = document.querySelector('[data-composer]');
							const composerShell = document.querySelector('[data-composer-shell]');
							const options = [...document.querySelectorAll('[data-mode-option]')];
							const selected = options.find((option) => option.getAttribute('aria-checked') === 'true');
							const groupRect = group?.getBoundingClientRect();
							const rowRect = row?.getBoundingClientRect();
							const composerRect = composer?.getBoundingClientRect();
							const groupStyle = group ? getComputedStyle(group) : null;
							const selectedStyle = selected ? getComputedStyle(selected) : null;
							const composerStyle = composer ? getComputedStyle(composer) : null;
							const composerShellStyle = composerShell ? getComputedStyle(composerShell) : null;
							return {
								optionCount: options.length,
								selectedMode: selected?.dataset.modeOption || null,
								selectedCount: options.filter((option) => option.getAttribute('aria-checked') === 'true').length,
								aboveComposer: Boolean(rowRect && composerRect && rowRect.bottom <= composerRect.top),
								verticalGap: rowRect && composerRect ? Math.round(composerRect.top - rowRect.bottom) : null,
								leftAlignedWithComposer: Boolean(groupRect && composerRect && Math.abs(groupRect.left - composerRect.left) < 1),
								size: groupRect ? [Math.round(groupRect.width), Math.round(groupRect.height)] : null,
								composerHeight: composerRect ? Math.round(composerRect.height) : null,
								smallerThanComposer: Boolean(groupRect && composerRect && groupRect.height < composerRect.height),
								borderRadius: groupStyle?.borderRadius || null,
								backgroundColor: groupStyle?.backgroundColor || null,
								boxShadow: groupStyle?.boxShadow || null,
								selectedBoxShadow: selectedStyle?.boxShadow || null,
								hitAreas: options.map((option) => { const rect = option.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height)]; }),
								effectiveHitHeights: options.map((option) => getComputedStyle(option, '::before').height),
								optionBackgroundColors: options.map((option) => getComputedStyle(option).backgroundColor),
								optionBorderColors: options.map((option) => getComputedStyle(option).borderColor),
								optionTextColors: options.map((option) => getComputedStyle(option).color),
								composerBackgroundColor: composerStyle?.backgroundColor || null,
								composerBoxShadow: composerStyle?.boxShadow || null,
								composerShellBackgroundColor: composerShellStyle?.backgroundColor || null,
								role: group?.getAttribute('role') || null,
								busy: group?.getAttribute('aria-busy') || null,
							};
						})()`);
						console.error(`[capture:mode-switcher] ${JSON.stringify(modeMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_PLAN_POINTS || process.env.METIS_DESKTOP_CAPTURE_PLAN_POINTS_EMPTY) {
						const planPointMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
							const inspector = document.querySelector('[data-plan-inspector]');
							const points = [...document.querySelectorAll('[data-plan-point]')];
							const changedFiles = [...document.querySelectorAll('[data-changed-file]')];
							const empty = document.querySelector('[data-plan-points-empty]');
							const inspectorRect = inspector?.getBoundingClientRect();
							const title = inspector?.querySelector('[data-plan-points-title]');
							const titleRange = title?.firstChild ? document.createRange() : null;
							titleRange?.selectNodeContents(title);
							const titleRect = titleRange?.getBoundingClientRect();
							const firstPointIconRect = inspector?.querySelector('[data-plan-point] svg')?.getBoundingClientRect();
							const firstPointTextRect = inspector?.querySelector('[data-plan-point-text]')?.getBoundingClientRect();
							return {
								visible: Boolean(inspectorRect && inspectorRect.width > 0 && inspectorRect.height > 0),
								title: title?.textContent?.trim() || null,
								pointCount: points.length,
								changedFileCount: changedFiles.length,
								changedFilePaths: changedFiles.map((file) => file.getAttribute('data-changed-file-path')),
								statuses: points.map((point) => point.dataset.planStatus),
								titleLeft: titleRect ? Math.round(titleRect.left) : null,
								firstPointIconLeft: firstPointIconRect ? Math.round(firstPointIconRect.left) : null,
								firstPointTextLeft: firstPointTextRect ? Math.round(firstPointTextRect.left) : null,
								titleAlignedWithIcon: Boolean(titleRect && firstPointIconRect && Math.abs(titleRect.left - firstPointIconRect.left) <= 1),
								emptyVisible: Boolean(empty?.getBoundingClientRect().height),
								hasLegacyPreview: Boolean(inspector?.querySelector('[data-screen-preview], [data-routines]')),
							};
						})()`);
						console.error(`[capture:plan-points] ${JSON.stringify(planPointMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_MESSAGE_WIDTH) {
						const messageWidthMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
							const lane = document.querySelector('[data-message-lane]');
							const assistant = document.querySelector('[data-message-role="assistant"]');
							const markdown = assistant?.querySelector('.markdown-content');
							const composer = document.querySelector('[data-composer]');
							const composerShell = document.querySelector('[data-composer-shell]');
							const messageScroll = document.querySelector('[data-message-scroll]');
							const composerClearance = document.querySelector('[data-composer-clearance]');
							let lastBlock = markdown?.lastElementChild;
							while (lastBlock?.lastElementChild) lastBlock = lastBlock.lastElementChild;
							const rect = (node) => { const value = node?.getBoundingClientRect(); return value ? { left: Math.round(value.left), right: Math.round(value.right), width: Math.round(value.width) } : null; };
							const laneRect = lane?.getBoundingClientRect();
							const markdownRect = markdown?.getBoundingClientRect();
							const composerRect = composer?.getBoundingClientRect();
							const composerShellRect = composerShell?.getBoundingClientRect();
							const messageScrollRect = messageScroll?.getBoundingClientRect();
							const lastBlockRect = lastBlock?.getBoundingClientRect();
							return {
								lane: rect(lane),
								assistant: rect(assistant),
								markdown: rect(markdown),
								composer: rect(composer),
								allMatch: Boolean(laneRect && markdownRect && composerRect
									&& Math.abs(laneRect.left - markdownRect.left) < 1
									&& Math.abs(laneRect.right - markdownRect.right) < 1
									&& Math.abs(laneRect.left - composerRect.left) < 1
									&& Math.abs(laneRect.right - composerRect.right) < 1),
								markdownOverflow: markdown ? markdown.scrollWidth > markdown.clientWidth : null,
								messageScrollOverflow: messageScroll ? messageScroll.scrollHeight > messageScroll.clientHeight : null,
								messageScrollMinHeight: messageScroll ? getComputedStyle(messageScroll).minHeight : null,
								lastBlockBottom: lastBlockRect ? Math.round(lastBlockRect.bottom) : null,
								messageViewportBottom: messageScrollRect ? Math.round(messageScrollRect.bottom) : null,
								composerShellTop: composerShellRect ? Math.round(composerShellRect.top) : null,
								composerShellPosition: composerShell ? getComputedStyle(composerShell).position : null,
								composerShellPointerEvents: composerShell ? getComputedStyle(composerShell).pointerEvents : null,
								composerPointerEvents: composer ? getComputedStyle(composer).pointerEvents : null,
								composerClearanceHeight: composerClearance ? Math.round(composerClearance.getBoundingClientRect().height) : null,
								scrollExtendsBehindComposer: Boolean(messageScrollRect && composerShellRect && messageScrollRect.bottom > composerShellRect.top),
								overlayDepth: messageScrollRect && composerShellRect ? Math.round(messageScrollRect.bottom - composerShellRect.top) : null,
								lastBlockVisible: Boolean(lastBlockRect && messageScrollRect && lastBlockRect.top >= messageScrollRect.top && lastBlockRect.bottom <= messageScrollRect.bottom),
								obscuredByComposer: Boolean(lastBlockRect && composerShellRect && lastBlockRect.bottom > composerShellRect.top),
							};
						})()`);
						console.error(`[capture:message-width] ${JSON.stringify(messageWidthMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_ATTACHMENTS) {
						const attachmentMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
							const input = document.querySelector('[data-attachment-input]');
							const transfer = new DataTransfer();
							transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#6366f1"/></svg>'], 'capture.svg', { type: 'image/svg+xml' }));
							transfer.items.add(new File(['Attachment capture text'], 'notes.txt', { type: 'text/plain' }));
							Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
							input?.dispatchEvent(new Event('change', { bubbles: true }));
							await new Promise((resolve) => setTimeout(resolve, 220));
							const previews = [...document.querySelectorAll('[data-attachment-preview]')];
							const send = document.querySelector('[aria-label="Send message"]');
							const composer = document.querySelector('[data-composer]');
							return {
								previewCount: previews.length,
								kinds: previews.map((preview) => preview.dataset.attachmentPreview),
								imageLoaded: Boolean(previews.find((preview) => preview.dataset.attachmentPreview === 'image')?.querySelector('img')),
								removeButtonCount: document.querySelectorAll('[aria-label^="Remove "]').length,
								sendEnabled: send?.disabled === false,
								pickerMultiple: input?.multiple === true,
								pickerAcceptsAll: !input?.hasAttribute('accept'),
								composerBusy: composer?.getAttribute('aria-busy') || null,
								historyAttachmentCount: document.querySelectorAll('[data-message-attachment]').length,
								historyImageVisible: Boolean(document.querySelector('[data-message-attachment="image"]')),
							};
						})()`);
						console.error(`[capture:attachments] ${JSON.stringify(attachmentMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_PLAN_PREVIEW) {
						const planMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
							const preview = document.querySelector('[data-plan-preview]');
							const heading = preview?.querySelector('h2');
							const body = preview?.querySelector('.plan-preview-body');
							const actions = preview?.querySelector('.plan-preview-actions');
							const processButton = preview?.querySelector('[data-plan-process]');
							const refineButton = preview?.querySelector('[data-plan-refine]');
							const previewRect = preview?.getBoundingClientRect();
							const processRect = processButton?.getBoundingClientRect();
							const actionsStyle = actions ? getComputedStyle(actions) : null;
							const processStyle = processButton ? getComputedStyle(processButton) : null;
							const refineStyle = refineButton ? getComputedStyle(refineButton) : null;
							const messageLane = document.querySelector('[data-message-lane]');
							const messageScroll = document.querySelector('[data-message-scroll]');
							const messageLaneRect = messageLane?.getBoundingClientRect();
							const composerRect = document.querySelector('[data-composer]')?.getBoundingClientRect();
							const previewStyle = preview ? getComputedStyle(preview) : null;
							const bodyStyle = body ? getComputedStyle(body) : null;
							const collapsedMaxHeight = bodyStyle?.maxHeight || null;
							const expandButton = preview?.querySelector('[aria-label="Expand plan"]');
							expandButton?.click();
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							const expandedBodyStyle = body ? getComputedStyle(body) : null;
							const overflowProbe = document.createElement('div');
							overflowProbe.style.height = '2000px';
							overflowProbe.style.flex = '0 0 auto';
							messageLane?.append(overflowProbe);
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							const overflowLaneRect = messageLane?.getBoundingClientRect();
							const overflowComposerRect = document.querySelector('[data-composer]')?.getBoundingClientRect();
							overflowProbe.remove();
							return {
								hasPreview: Boolean(preview),
								title: heading?.textContent?.trim() || null,
								isCurrent: preview?.getAttribute('data-plan-current') || null,
								width: previewRect ? Math.round(previewRect.width) : null,
								borderRadius: previewStyle?.borderRadius || null,
								borderWidth: previewStyle?.borderTopWidth || null,
								collapsedMaxHeight,
								expanded: expandButton?.getAttribute('aria-expanded') || null,
								expandedMaxHeight: expandedBodyStyle?.maxHeight || null,
								messageLane: messageLaneRect ? { left: Math.round(messageLaneRect.left), right: Math.round(messageLaneRect.right), width: Math.round(messageLaneRect.width) } : null,
								composer: composerRect ? { left: Math.round(composerRect.left), right: Math.round(composerRect.right), width: Math.round(composerRect.width) } : null,
								laneMatchesComposer: Boolean(messageLaneRect && composerRect && Math.abs(messageLaneRect.left - composerRect.left) < 1 && Math.abs(messageLaneRect.right - composerRect.right) < 1),
								scrollbarGutter: messageScroll ? getComputedStyle(messageScroll).scrollbarGutter : null,
								overflowLaneMatchesComposer: Boolean(overflowLaneRect && overflowComposerRect && Math.abs(overflowLaneRect.left - overflowComposerRect.left) < 1 && Math.abs(overflowLaneRect.right - overflowComposerRect.right) < 1),
								processHitArea: processRect ? [Math.round(processRect.width), Math.round(processRect.height)] : null,
								actionsBackgroundColor: actionsStyle?.backgroundColor || null,
								actionsBackgroundTransparent: actionsStyle?.backgroundColor === 'rgba(0, 0, 0, 0)',
								actionsBorderTopWidth: actionsStyle?.borderTopWidth || null,
								actionsDividerRemoved: actionsStyle?.borderTopWidth === '0px',
								processButtonStyle: processStyle ? {
									height: processStyle.height,
									borderRadius: processStyle.borderRadius,
									backgroundColor: processStyle.backgroundColor,
									boxShadow: processStyle.boxShadow,
								} : null,
								refineButtonStyle: refineStyle ? {
									height: refineStyle.height,
									borderRadius: refineStyle.borderRadius,
									backgroundColor: refineStyle.backgroundColor,
									boxShadow: refineStyle.boxShadow,
								} : null,
								buttonsUseInterfacePills: Boolean(processStyle && refineStyle
									&& processStyle.height === '32px'
									&& refineStyle.height === '32px'
									&& Number.parseFloat(processStyle.borderRadius) >= 16
									&& Number.parseFloat(refineStyle.borderRadius) >= 16),
								buttonsUseNeutralPalette: [processStyle, refineStyle].every((style) => {
									const channels = style?.backgroundColor.match(/[\\d.]+/g)?.slice(0, 3).map(Number);
									return channels?.length === 3 && Math.max(...channels) - Math.min(...channels) <= 1;
								}),
							};
						})()`);
						console.error(`[capture:plan-preview] ${JSON.stringify(planMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_THINKING) {
						const thinkingMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
							const work = document.querySelector('[data-assistant-work]');
							const workToggle = work?.querySelector(':scope > .cot-header-bar');
							const workRect = work?.getBoundingClientRect();
							const workTitleRect = work?.querySelector('.cot-title')?.getBoundingClientRect();
							const initialWorkExpanded = workToggle?.getAttribute('aria-expanded') || null;
							const initialFinalResponse = work?.parentElement?.querySelector(':scope > .turn-final-response');
							const initialFinalResponseGap = workRect && initialFinalResponse
								? Math.round((initialFinalResponse.getBoundingClientRect().top - workRect.bottom) * 10) / 10
								: null;
							if (initialWorkExpanded !== 'true') workToggle?.click();
							await new Promise((resolve) => setTimeout(resolve, 420));
							const block = document.querySelector('[data-thinking-block]');
							const thinkingToggle = block?.querySelector('.thinking-header');
							const initialThinkingExpanded = thinkingToggle?.getAttribute('aria-expanded') || null;
							if (initialThinkingExpanded !== 'true') thinkingToggle?.click();
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							const toolGroupToggle = work?.querySelector('[data-tool-group] .tool-group-header');
							if (toolGroupToggle?.getAttribute('aria-expanded') !== 'true') toolGroupToggle?.click();
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							const scroll = block?.querySelector('[data-thinking-scroll]');
							const body = block?.querySelector('.thinking-body');
							const summaryNode = block?.querySelector('.thinking-summary');
							const toolSummaryNode = work?.querySelector('[data-tool-group] .tool-group-summary');
							const toolRowNode = work?.querySelector('[data-tool-group] .tool-group-row-label');
							const markdownNode = block?.querySelector('.cot-thinking-markdown');
							const nestedHeading = markdownNode?.querySelector('h1, h2, h3, h4, h5, h6');
							const strongNode = markdownNode?.querySelector('strong, b');
							const blockRect = block?.getBoundingClientRect();
							const summaryRect = summaryNode?.getBoundingClientRect();
							const markdownRect = markdownNode?.getBoundingClientRect();
							const workTextRect = work?.querySelector('.cot-text > :first-child')?.getBoundingClientRect();
							const finalResponse = work?.parentElement?.querySelector(':scope > .turn-final-response');
							const workItemRects = [...(work?.querySelectorAll('.cot-content-inner > *') || [])]
								.map((item) => item.getBoundingClientRect());
							const workItemGaps = workItemRects.slice(1).map((rect, index) => (
								Math.round((rect.top - workItemRects[index].bottom) * 10) / 10
							));
							const workToggleStyle = workToggle ? getComputedStyle(workToggle) : null;
							const scrollStyle = scroll ? getComputedStyle(scroll) : null;
							const summaryStyle = summaryNode ? getComputedStyle(summaryNode) : null;
							const toolSummaryStyle = toolSummaryNode ? getComputedStyle(toolSummaryNode) : null;
							const toolRowStyle = toolRowNode ? getComputedStyle(toolRowNode) : null;
							const thinkingStyle = markdownNode ? getComputedStyle(markdownNode) : null;
							const bodyCopyNode = finalResponse?.querySelector('.markdown-content');
							const bodyCopyStyle = bodyCopyNode ? getComputedStyle(bodyCopyNode) : null;
							const markdownDivider = bodyCopyNode?.querySelector('hr');
							const markdownDividerStyle = markdownDivider ? getComputedStyle(markdownDivider) : null;
							const typographyMatches = (left, right) => Boolean(left && right
								&& left.fontFamily === right.fontFamily
								&& left.fontSize === right.fontSize
								&& left.fontWeight === right.fontWeight
								&& left.lineHeight === right.lineHeight);
							const fadeStyle = body ? getComputedStyle(body, '::after') : null;
							const topFadeStyle = body ? getComputedStyle(body, '::before') : null;
							const autoScrolledToBottom = scroll ? Math.abs(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop) <= 1 : null;
							const topFadeHeight = topFadeStyle?.height || null;
							const topFadeBackgroundImage = topFadeStyle?.backgroundImage || null;
							if (scroll) {
								scroll.scrollTop = 0;
								await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							}
							const topFadeHiddenAtTop = !block?.classList.contains('scrolled-from-top');
							if (scroll) {
								scroll.scrollTop = scroll.scrollHeight;
								await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							}
							const topFadeRestoredAfterScroll = block?.classList.contains('scrolled-from-top') || false;
							return {
								hasThinking: Boolean(block),
								initialWorkExpanded,
								initialFinalResponseGap,
								workExpanded: workToggle?.getAttribute('aria-expanded') || null,
								direct: block?.getAttribute('data-direct-thinking') || null,
								hasNestedToggle: Boolean(thinkingToggle),
								hasThinkingIcon: Boolean(block?.querySelector('.thinking-icon')),
								initialThinkingExpanded,
								thinkingExpanded: thinkingToggle?.getAttribute('aria-expanded') || null,
								summary: summaryNode?.textContent?.trim() || null,
								summaryFontWeight: summaryStyle?.fontWeight || null,
								toolSummaryFontWeight: toolSummaryStyle?.fontWeight || null,
								summaryFontSize: summaryStyle?.fontSize || null,
								toolSummaryFontSize: toolSummaryStyle?.fontSize || null,
								summaryLineHeight: summaryStyle?.lineHeight || null,
								toolSummaryLineHeight: toolSummaryStyle?.lineHeight || null,
								summaryTypographyMatchesTools: typographyMatches(summaryStyle, toolSummaryStyle),
								thinkingSummaryMatchesBody: typographyMatches(summaryStyle, bodyCopyStyle),
								thinkingBodyMatchesBody: typographyMatches(thinkingStyle, bodyCopyStyle),
								toolSummaryMatchesBody: typographyMatches(toolSummaryStyle, bodyCopyStyle),
								toolRowMatchesBody: typographyMatches(toolRowStyle, bodyCopyStyle),
								thinkingColorMatchesTools: Boolean(summaryStyle && thinkingStyle && toolSummaryStyle && toolRowStyle
									&& summaryStyle.color === thinkingStyle.color
									&& summaryStyle.color === toolSummaryStyle.color
									&& summaryStyle.color === toolRowStyle.color),
								workColorDiffersFromBody: Boolean(summaryStyle && thinkingStyle && toolSummaryStyle && toolRowStyle && bodyCopyStyle
									&& summaryStyle.color === thinkingStyle.color
									&& summaryStyle.color === toolSummaryStyle.color
									&& toolSummaryStyle.color === toolRowStyle.color
									&& toolSummaryStyle.color !== bodyCopyStyle.color),
								bodyCopyColor: bodyCopyStyle?.color || null,
								markdownDividerHidden: markdownDividerStyle?.display === 'none',
								thinkingFontWeight: markdownNode ? getComputedStyle(markdownNode).fontWeight : null,
								headingFontWeight: nestedHeading ? getComputedStyle(nestedHeading).fontWeight : null,
								strongFontWeight: strongNode ? getComputedStyle(strongNode).fontWeight : null,
								summaryInset: blockRect && summaryRect ? Math.round(summaryRect.left - blockRect.left) : null,
								bodyInset: blockRect && markdownRect ? Math.round(markdownRect.left - blockRect.left) : null,
								workTitleInset: workRect && workTitleRect ? Math.round(workTitleRect.left - workRect.left) : null,
								workTextInset: workRect && workTextRect ? Math.round(workTextRect.left - workRect.left) : null,
								workItemGaps,
								maxWorkItemGap: workItemGaps.length ? Math.max(...workItemGaps) : null,
								thinkingHeaderHeight: thinkingToggle ? Math.round(thinkingToggle.getBoundingClientRect().height) : null,
								toolGroupHeaderHeight: toolGroupToggle ? Math.round(toolGroupToggle.getBoundingClientRect().height) : null,
								workDividerWidth: workToggleStyle?.borderBottomWidth || null,
								workDividerStyle: workToggleStyle?.borderBottomStyle || null,
								workDividerSpansContainer: workRect && workToggle
									? Math.abs(workToggle.getBoundingClientRect().width - workRect.width) <= 1
									: null,
								hasFinalDivider: Boolean(work?.parentElement?.querySelector(':scope > .turn-final-response .turn-final-divider')),
								finalResponseGap: work && finalResponse
									? Math.round((finalResponse.getBoundingClientRect().top - work.getBoundingClientRect().bottom) * 10) / 10
									: null,
								hasToolGroupIcon: Boolean(work?.querySelector('.tool-group-icon')),
								hasToolRowIcon: Boolean(work?.querySelector('.tool-group-row .tool-icon')),
								maxHeight: scrollStyle?.maxHeight || null,
								overflowY: scrollStyle?.overflowY || null,
								clientHeight: scroll?.clientHeight || null,
								scrollHeight: scroll?.scrollHeight || null,
								hasInternalOverflow: scroll ? scroll.scrollHeight > scroll.clientHeight : null,
								hasOverflowClass: block?.classList.contains('has-overflow') || false,
								scrolledFromTop: block?.classList.contains('scrolled-from-top') || false,
								fadeHeight: fadeStyle?.height || null,
								fadeBackgroundImage: fadeStyle?.backgroundImage || null,
								fadeBackdropFilter: fadeStyle?.backdropFilter || null,
								topFadeHeight,
								topFadeBackgroundImage,
								topFadeHiddenAtTop,
								topFadeRestoredAfterScroll,
								autoScrolledToBottom,
							};
						})()`);
						console.error(`[capture:thinking] ${JSON.stringify(thinkingMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_DEFAULT || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_COMPLETED || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND_SETTLED || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_TASK_RECEIVED || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_THINKING) {
						if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_THINKING) {
							const sampleThinkingVisual = async () => mainWindow.webContents.executeJavaScript(`(() => {
								const indicator = document.querySelector('[data-work-progress]');
								const image = indicator?.querySelector('[data-progress-expression-active="true"], [data-progress-default-svg]');
								const imageRect = image?.getBoundingClientRect();
								return {
									phase: indicator?.getAttribute('data-progress-phase') || null,
									visualMode: indicator?.getAttribute('data-progress-visual-mode') || null,
									expression: indicator?.getAttribute('data-progress-expression') || null,
									minimumDisplayMs: Number(indicator?.getAttribute('data-progress-expression-min-display-ms') || 0) || null,
									settleMs: Number(indicator?.getAttribute('data-progress-expression-settle-ms') || 0) || null,
									morphMs: Number(indicator?.getAttribute('data-progress-expression-morph-ms') || 0) || null,
									morphing: image?.getAttribute('data-progress-expression-morphing') || null,
									source: image instanceof SVGElement ? 'inline-svg' : image?.getAttribute('src') || null,
									loaded: Boolean(image instanceof SVGElement || (image?.complete && image?.naturalWidth)),
									eyePath: image?.querySelector('[data-progress-expression-eye="left"]')?.getAttribute('d') || null,
									eyeTransform: image?.querySelector('[data-progress-expression-eye="left"]')?.getAttribute('transform') || null,
									renderedSize: imageRect ? [Math.round(imageRect.width), Math.round(imageRect.height)] : null,
								};
							})()`);
							const thinkingSequence = [];
							thinkingSequence.push({ step: "initial", ...(await sampleThinkingVisual()) });
							await new Promise((resolve) => setTimeout(resolve, 5700));
							await mainWindow.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('metis:capture-thinking-state', { detail: 'other' }))`);
							await new Promise((resolve) => setTimeout(resolve, 100));
							await mainWindow.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('metis:capture-thinking-state', { detail: 'thinking' }))`);
							await new Promise((resolve) => setTimeout(resolve, 100));
							thinkingSequence.push({ step: "rapid-return", ...(await sampleThinkingVisual()) });
							await new Promise((resolve) => setTimeout(resolve, 1300));
							thinkingSequence.push({ step: "after-rapid-return", ...(await sampleThinkingVisual()) });
							await mainWindow.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('metis:capture-thinking-state', { detail: 'other' }))`);
							await new Promise((resolve) => setTimeout(resolve, 100));
							thinkingSequence.push({ step: "pending-change", ...(await sampleThinkingVisual()) });
							const expressionDeadline = Date.now() + 5000;
							while (Date.now() < expressionDeadline) {
								const expression = await mainWindow.webContents.executeJavaScript(
									`document.querySelector('[data-progress-visual-mode="expression-morph"]')?.dataset.progressExpression ?? null`,
								);
								if (expression === "shy") break;
								await new Promise((resolve) => setTimeout(resolve, 50));
							}
							await new Promise((resolve) => setTimeout(resolve, 240));
							thinkingSequence.push({ step: "morphing-change", ...(await sampleThinkingVisual()) });
							await new Promise((resolve) => setTimeout(resolve, 500));
							thinkingSequence.push({ step: "settled-change", ...(await sampleThinkingVisual()) });
							console.error(`[capture:thinking-progress] ${JSON.stringify(thinkingSequence)}`);
						}
						if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_DEFAULT) {
							await new Promise((resolve) => setTimeout(resolve, 4000));
						}
						if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND_SETTLED || process.env.METIS_DESKTOP_CAPTURE_PROGRESS_TASK_RECEIVED) {
							await mainWindow.webContents.executeJavaScript(`(async () => {
								const input = document.querySelector('[data-composer-input]');
								const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
								setter?.call(input, 'Start now');
								input?.dispatchEvent(new Event('input', { bubbles: true }));
								await new Promise((resolve) => requestAnimationFrame(resolve));
								document.querySelector('[aria-label="Send message"]')?.click();
								await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							})()`);
						}
						if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND_SETTLED) {
							await new Promise((resolve) => setTimeout(resolve, 100));
							const settledComposerMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
								const input = document.querySelector('[data-composer-input]');
								return {
									disabled: Boolean(input?.disabled),
									stopVisible: Boolean(document.querySelector('[data-stop-button]')),
									sendVisible: Boolean(document.querySelector('[data-send-icon]')),
								};
							})()`);
							console.error(`[capture:composer-send-settled] ${JSON.stringify(settledComposerMetrics)}`);
						}
						if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_TASK_RECEIVED) {
							const sampleTaskReceivedVisual = async () => mainWindow.webContents.executeJavaScript(`(() => {
								const indicator = document.querySelector('[data-work-progress]');
								const image = indicator?.querySelector('[data-progress-task-received-gif], [data-progress-default-svg]');
								return {
									visualMode: indicator?.getAttribute('data-progress-visual-mode') || null,
									taskReceivedStage: indicator?.getAttribute('data-progress-task-received-stage') || null,
									source: image?.getAttribute('src') || null,
									loaded: Boolean(image?.complete && image?.naturalWidth),
								};
							})()`);
							const taskReceivedSequence = [];
							taskReceivedSequence.push({ step: 'enter', ...(await sampleTaskReceivedVisual()) });
							await new Promise((resolve) => setTimeout(resolve, 1300));
							taskReceivedSequence.push({ step: 'loop', ...(await sampleTaskReceivedVisual()) });
							await new Promise((resolve) => setTimeout(resolve, 3200));
							taskReceivedSequence.push({ step: 'exit', ...(await sampleTaskReceivedVisual()) });
							await new Promise((resolve) => setTimeout(resolve, 1300));
							taskReceivedSequence.push({ step: 'complete', ...(await sampleTaskReceivedVisual()) });
							console.error(`[capture:task-received-progress] ${JSON.stringify(taskReceivedSequence)}`);
						}
						let idleCaptureAdvanced = null;
						if (process.env.METIS_DESKTOP_CAPTURE_PROGRESS_COMPLETED) {
							const idleRect = await mainWindow.webContents.executeJavaScript(`(() => {
								const rect = document.querySelector('[data-progress-idle-gif]')?.getBoundingClientRect();
								return rect ? { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) } : null;
							})()`);
							if (idleRect) {
								const firstIdleFrame = await mainWindow.webContents.capturePage(idleRect);
								await new Promise((resolve) => setTimeout(resolve, 2500));
								const secondIdleFrame = await mainWindow.webContents.capturePage(idleRect);
								idleCaptureAdvanced = !firstIdleFrame.toPNG().equals(secondIdleFrame.toPNG());
							}
						}
						const progressSampleDelayMs = 650;
						const progressMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
							const indicator = document.querySelector('[data-work-progress]');
							const turn = indicator?.closest('[data-assistant-turn]');
							const finalResponse = turn?.querySelector('.turn-final-response');
							const lastUserMessage = [...document.querySelectorAll('[data-message-role="user"]')].at(-1);
							const video = indicator?.querySelector('[data-progress-video]');
							const defaultSvg = indicator?.querySelector('[data-progress-default-svg]');
							const taskReceivedGif = indicator?.querySelector('[data-progress-task-received-gif]');
							const idleGif = indicator?.querySelector('[data-progress-idle-gif]');
							const indicatorRect = indicator?.getBoundingClientRect();
							const indicatorStyle = indicator ? getComputedStyle(indicator) : null;
							const progressLabel = indicator?.querySelector('[data-work-progress-label]');
							const labelStyle = progressLabel ? getComputedStyle(progressLabel) : null;
							const labelRect = progressLabel?.getBoundingClientRect();
							const turnRect = turn?.getBoundingClientRect();
							const visualRect = indicator?.querySelector('.work-progress-visual')?.getBoundingClientRect();
							const activeVisualRect = indicator?.querySelector('[data-progress-idle-gif], [data-progress-task-received-gif], [data-progress-thinking-gif], [data-progress-default-svg]')?.getBoundingClientRect();
							const activeVisual = indicator?.querySelector('[data-progress-idle-gif], [data-progress-task-received-gif], [data-progress-thinking-gif], [data-progress-default-svg]');
							const sendRect = document.querySelector('[aria-label="Send message"]')?.getBoundingClientRect();
							const sampleImage = (image) => {
								if (!image?.complete || !image?.naturalWidth) return null;
								const canvas = document.createElement('canvas');
								canvas.width = 30;
								canvas.height = 30;
								const context = canvas.getContext('2d');
								context?.drawImage(image, 0, 0, 30, 30);
								return context ? [...context.getImageData(0, 0, 30, 30).data] : null;
							};
							const visibleImageBounds = (image) => {
								if (!image?.complete || !image?.naturalWidth || !image?.naturalHeight) return null;
								const canvas = document.createElement('canvas');
								canvas.width = image.naturalWidth;
								canvas.height = image.naturalHeight;
								const context = canvas.getContext('2d', { willReadFrequently: true });
								context?.drawImage(image, 0, 0);
								if (!context) return null;
								const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
								let left = canvas.width;
								let right = -1;
								for (let index = 0; index < pixels.length; index += 4) {
									if (pixels[index + 3] <= 16) continue;
									const x = (index / 4) % canvas.width;
									left = Math.min(left, x);
									right = Math.max(right, x);
								}
								return right >= left ? { left, right, width: canvas.width } : null;
							};
							const activeVisualContentBounds = visibleImageBounds(activeVisual);
							const initialTime = Number(video?.currentTime || 0);
							const initialDefaultPixels = sampleImage(defaultSvg);
							const inlineEyeMotion = defaultSvg?.querySelector('.work-progress-eye-motion-left');
							const initialInlineEyeTransform = inlineEyeMotion ? getComputedStyle(inlineEyeMotion).transform : null;
							await new Promise((resolve) => setTimeout(resolve, ${progressSampleDelayMs}));
							const finalDefaultPixels = sampleImage(defaultSvg);
							const finalInlineEyeTransform = inlineEyeMotion ? getComputedStyle(inlineEyeMotion).transform : null;
							return {
								hasProgress: Boolean(indicator),
								isTail: turn?.lastElementChild === indicator,
								afterFinalResponse: !indicator || !finalResponse || Boolean(finalResponse.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING),
								afterUserMessage: !indicator || !lastUserMessage || Boolean(lastUserMessage.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING),
								phase: indicator?.getAttribute('data-progress-phase') || null,
								status: indicator?.getAttribute('data-progress-status') || null,
								idle: indicator?.getAttribute('data-progress-idle') || null,
								visualMode: indicator?.getAttribute('data-progress-visual-mode') || null,
								expression: indicator?.getAttribute('data-progress-expression') || null,
								expressionMinDisplayMs: Number(indicator?.getAttribute('data-progress-expression-min-display-ms') || 0) || null,
								expressionSettleMs: Number(indicator?.getAttribute('data-progress-expression-settle-ms') || 0) || null,
								expressionMorphMs: Number(indicator?.getAttribute('data-progress-expression-morph-ms') || 0) || null,
								expressionMorphing: defaultSvg?.getAttribute('data-progress-expression-morphing') || null,
								actor: indicator?.getAttribute('data-progress-actor') || null,
								label: indicator?.querySelector('[data-work-progress-label]')?.textContent?.trim() || null,
								videoSource: video?.querySelector('source')?.getAttribute('src') || null,
								videoReadyState: video?.readyState ?? null,
								videoAdvanced: Number(video?.currentTime || 0) > initialTime,
								taskReceivedGifSource: taskReceivedGif?.getAttribute('src') || null,
								taskReceivedGifLoaded: Boolean(taskReceivedGif?.complete && taskReceivedGif?.naturalWidth),
								idleGifSource: idleGif?.getAttribute('src') || null,
								idleGifLoaded: Boolean(idleGif?.complete && idleGif?.naturalWidth),
								defaultSvgSource: defaultSvg instanceof SVGElement ? 'inline-svg' : defaultSvg?.getAttribute('src') || null,
								defaultSvgLoaded: Boolean(defaultSvg instanceof SVGElement || (defaultSvg?.complete && defaultSvg?.naturalWidth)),
								defaultSvgAdvanced: Boolean(initialDefaultPixels && finalDefaultPixels
									&& initialDefaultPixels.some((value, index) => value !== finalDefaultPixels[index]))
									|| Boolean(initialInlineEyeTransform && finalInlineEyeTransform && initialInlineEyeTransform !== finalInlineEyeTransform),
								indicatorSize: indicatorRect ? [Math.round(indicatorRect.width), Math.round(indicatorRect.height)] : null,
								indicatorGap: indicatorStyle?.columnGap || null,
								indicatorAlignItems: indicatorStyle?.alignItems || null,
								labelFontSize: labelStyle?.fontSize || null,
								labelFontWeight: labelStyle?.fontWeight || null,
								labelShimmering: progressLabel?.classList.contains('shimmering') || false,
								labelAnimationName: labelStyle?.animationName || null,
								visualSize: visualRect ? [Math.round(visualRect.width), Math.round(visualRect.height)] : null,
								visualLabelBottomDelta: visualRect && labelRect ? Math.round(labelRect.bottom - visualRect.bottom) : null,
								activeVisualSize: activeVisualRect ? [Math.round(activeVisualRect.width), Math.round(activeVisualRect.height)] : null,
								sendButtonSize: sendRect ? [Math.round(sendRect.width), Math.round(sendRect.height)] : null,
								activeVisualOffsetFromTurn: activeVisualRect && turnRect ? Math.round(activeVisualRect.x - turnRect.x) : null,
								activeVisualContentOffsetFromTurn: activeVisualRect && activeVisualContentBounds && turnRect
									? Math.round(activeVisualRect.x + activeVisualContentBounds.left / activeVisualContentBounds.width * activeVisualRect.width - turnRect.x)
									: null,
							};
						})()`);
						progressMetrics.idleCaptureAdvanced = idleCaptureAdvanced;
						console.error(`[capture:progress] ${JSON.stringify(progressMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_TOOLS) {
						const toolMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
							const work = document.querySelector('[data-assistant-work]');
							const workToggle = work?.querySelector(':scope > .cot-header-bar');
							if (workToggle?.getAttribute('aria-expanded') !== 'true') {
								workToggle?.click();
								await new Promise((resolve) => setTimeout(resolve, 420));
							}
							const group = document.querySelector('[data-tool-group]');
							const toggle = group?.querySelector('.tool-group-header');
							const initialExpanded = toggle?.getAttribute('aria-expanded') || null;
							toggle?.click();
							await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							const list = group?.querySelector('[data-tool-group-scroll]');
							const groupBody = group?.querySelector('.tool-group-body');
							const rows = [...(group?.querySelectorAll('.tool-group-row') || [])];
							const listRect = list?.getBoundingClientRect();
							const firstRowRect = rows[0]?.getBoundingClientRect();
							const secondRowRect = rows[1]?.getBoundingClientRect();
							const lastRowRect = rows.at(-1)?.getBoundingClientRect();
							const listStyle = list ? getComputedStyle(list) : null;
							const fadeStyle = groupBody ? getComputedStyle(groupBody, '::after') : null;
							const topFadeStyle = groupBody ? getComputedStyle(groupBody, '::before') : null;
							const autoScrolledToBottom = list ? Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 1 : null;
							const topFadeHeight = topFadeStyle?.height || null;
							const topFadeBackgroundImage = topFadeStyle?.backgroundImage || null;
							if (list) {
								list.scrollTop = 0;
								await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							}
							const topFadeHiddenAtTop = !group?.classList.contains('scrolled-from-top');
							if (list) {
								list.scrollTop = list.scrollHeight;
								await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
							}
							const topFadeRestoredAfterScroll = group?.classList.contains('scrolled-from-top') || false;
							return {
								hasToolGroup: Boolean(group),
								summary: group?.querySelector('.tool-group-summary')?.textContent?.trim() || null,
								toolCount: Number(group?.getAttribute('data-tool-count') || 0),
								rowCount: rows.length,
								initialExpanded,
								expanded: toggle?.getAttribute('aria-expanded') || null,
								maxHeight: listStyle?.maxHeight || null,
								overflowY: listStyle?.overflowY || null,
								clientHeight: list?.clientHeight || null,
								scrollHeight: list?.scrollHeight || null,
								hasInternalOverflow: list ? list.scrollHeight > list.clientHeight : null,
								hasOverflowClass: group?.classList.contains('has-overflow') || false,
								scrolledFromTop: group?.classList.contains('scrolled-from-top') || false,
								fadeHeight: fadeStyle?.height || null,
								fadeBackgroundImage: fadeStyle?.backgroundImage || null,
								fadeBackdropFilter: fadeStyle?.backdropFilter || null,
								topFadeHeight,
								topFadeBackgroundImage,
								topFadeHiddenAtTop,
								topFadeRestoredAfterScroll,
								autoScrolledToBottom,
								rowHeight: firstRowRect ? Math.round(firstRowRect.height) : null,
								rowStep: firstRowRect && secondRowRect ? Math.round(secondRowRect.top - firstRowRect.top) : null,
								rowGap: firstRowRect && secondRowRect ? Math.round(secondRowRect.top - firstRowRect.bottom) : null,
								lastRowVisible: Boolean(listRect && lastRowRect && lastRowRect.bottom <= listRect.bottom + 1),
								individualCardCount: document.querySelectorAll('.tool-card').length,
							};
						})()`);
						console.error(`[capture:tools] ${JSON.stringify(toolMetrics)}`);
					}
					if (process.env.METIS_DESKTOP_CAPTURE_WORK_DURATION) {
						const durationMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
							const work = document.querySelector('[data-assistant-work]');
							return {
								hasWork: Boolean(work),
								title: work?.querySelector('.cot-title')?.textContent?.trim() || null,
								hasThinking: Boolean(work?.querySelector('[data-thinking-block]')),
								toolCount: work?.querySelectorAll('.tool-card, [data-tool-group] .tool-group-row').length || 0,
							};
						})()`);
						console.error(`[capture:work-duration] ${JSON.stringify(durationMetrics)}`);
					}
				const i18nMetrics = await mainWindow.webContents.executeJavaScript(`(() => {
					const catalogs = window.metisDesktopI18nCatalogs;
					const untranslatedSources = new Set(Object.entries(catalogs?.en || {})
						.filter(([key, value]) => catalogs?.['zh-CN']?.[key] !== value)
						.map(([, value]) => value));
					const values = [];
					const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
					let node;
					while ((node = walker.nextNode())) {
						const parent = node.parentElement;
						if (!parent || parent.closest('[data-i18n-skip], .markdown-content, pre, code') || getComputedStyle(parent).display === 'none') continue;
						const value = node.nodeValue?.trim();
						if (value) values.push(value);
					}
					for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
						if (element.closest('[data-i18n-skip], .markdown-content, pre, code') || getComputedStyle(element).display === 'none') continue;
						for (const attribute of ['aria-label', 'placeholder', 'title']) {
							const value = element.getAttribute(attribute)?.trim();
							if (value) values.push(value);
						}
					}
					return { untranslated: [...new Set(values.filter((value) => untranslatedSources.has(value)))] };
				})()`);
				console.error(`[capture:i18n] ${JSON.stringify(i18nMetrics)}`);
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
	loadDesktopPreferences();
	if (process.platform === "darwin") app.dock?.setIcon(createAppIcon());
	rebuildApplicationMenu();
	const browserSession = session.fromPartition("persist:metis-browser");
	browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
	registerIpc();
	createWindow();
	process.stderr.write("[desktop] performence mode loaded\n");
	console.log("performence mode loaded");
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
		language: desktopLanguage,
		languages: desktopI18n.languages,
		theme: desktopTheme,
	}));
	ipcMain.handle("app:set-language", (_event, language) => {
		desktopLanguage = desktopI18n.languages.includes(language) ? language : "auto";
		saveDesktopPreferences();
		rebuildApplicationMenu();
		return { preference: desktopLanguage, resolved: desktopI18n.resolve(desktopLanguage, [app.getLocale()]) };
	});
	ipcMain.handle("app:set-theme", (_event, theme) => {
		const validThemes = ["system", "light", "dark"];
		const targetTheme = theme === "auto" ? "system" : theme;
		desktopTheme = validThemes.includes(targetTheme) ? targetTheme : "system";
		nativeTheme.themeSource = desktopTheme;
		saveDesktopPreferences();
		return { preference: desktopTheme, resolved: nativeTheme.shouldUseDarkColors ? "dark" : "light" };
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
	// Picking a parent must not change the active workspace. The renderer creates
	// a single child directory through the narrowly scoped workspace:create IPC.
	ipcMain.handle("workspace:select-parent", async () => {
		const result = await dialog.showOpenDialog(mainWindow, { buttonLabel: nativeText("dialogSelectFolder"), properties: ["openDirectory", "createDirectory"] });
		if (result.canceled || result.filePaths.length === 0) return undefined;
		return path.resolve(result.filePaths[0]);
	});
	ipcMain.handle("workspace:create", async (_event, input) => {
		try {
			const created = await createWorkspaceDirectory(input?.parentPath, input?.name);
			return setWorkspaceRoot(created.path);
		} catch (error) {
			if (!(error instanceof WorkspaceCreateError)) throw error;
			if (error.code === "parent_missing") throw new Error(nativeText("workspaceMissing", { path: error.message }));
			if (error.code === "invalid_project_name") throw new Error(nativeText("invalidWorkspacePath"));
			throw new Error(nativeText("createFailed"));
		}
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

	ipcMain.handle("metis:get-connection", () => ({
		baseUrl: metisServer.baseUrl,
		username: metisServer.username,
		hasPassword: Boolean(metisServer.password),
	}));
	ipcMain.handle("metis:connect", async (_event, options = {}) => {
		const candidate = {
			baseUrl: normalizeServerUrl(options.baseUrl || metisServer.baseUrl),
			username: Object.hasOwn(options, "username") ? String(options.username || "metis") : metisServer.username,
			password: Object.hasOwn(options, "password") ? String(options.password || "") : metisServer.password,
		};
		const health = await metisRequest("/global/health", {}, candidate);
		if (!health.ok) return health;
		const changed = candidate.baseUrl !== metisServer.baseUrl
			|| candidate.username !== metisServer.username
			|| candidate.password !== metisServer.password;
		metisServer = candidate;
		if (changed || !metisEventController || metisEventController.signal.aborted) {
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
	// The update manifest lookup lives in the CLI runtime (src/utils/version-check.ts),
	// so the desktop shell forwards to the local server instead of reimplementing it.
	ipcMain.handle("update:check", () => metisRequest("/global/update-check", { timeoutMs: 15_000 }));
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

async function metisRequest(requestPath, init = {}, server = metisServer) {
	if (typeof requestPath !== "string" || !requestPath.startsWith("/") || requestPath.startsWith("//")) {
		throw new Error(nativeText("invalidApiPath"));
	}
	const method = String(init.method || "GET").toUpperCase();
	if (!["GET", "POST", "PUT", "DELETE"].includes(method)) throw new Error(nativeText("unsupportedApiMethod"));
	const headers = { Accept: "application/json", "X-Metis-Desktop": "1" };
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	if (server.password) {
		headers.Authorization = `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`;
	}
	const requestedTimeout = Number(init.timeoutMs);
	const timeoutMs = Number.isFinite(requestedTimeout)
		? Math.max(1_000, Math.min(requestedTimeout, 10 * 60_000))
		: 60_000;
	try {
		// net.fetch 走 Chromium 网络栈：不读取 shell 的 HTTP(S)_PROXY 环境变量，
		// 仅受系统代理设置影响（macOS 系统代理默认绕过 localhost），保证 127.0.0.1 直连。
		const response = await net.fetch(`${server.baseUrl}${requestPath}`, {
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
	const headers = { Accept: "text/event-stream", "X-Metis-Desktop": "1" };
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
