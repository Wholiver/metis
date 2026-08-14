/* Metis Desktop first-run setup. Browser global + CommonJS-free by design. */
(function () {
	const STORAGE_KEY = "metis.desktopOnboardingCompleted.v2";
	const LANGUAGE_KEY = "metis.desktopUiLanguage.v2";
	const STEP_COUNT = 4;
	const unicode = (...codePoints) => String.fromCodePoint(...codePoints);
	const GREETINGS = [
		"Hello",
		unicode(0x4f60, 0x597d),
		"Bonjour",
		"Hola",
		unicode(0x3053, 0x3093, 0x306b, 0x3061, 0x306f),
		unicode(0xc548, 0xb155, 0xd558, 0xc138, 0xc694),
		"Ciao",
		`Ol${unicode(0x00e1)}`,
	];
	const PROVIDERS = ["openai", "anthropic", "deepseek", "gemini", "openrouter", "groq", "ollama"];
	let active = false;
	let step = 1;
	let selectedWorkspaces = new Map();
	let greetingTimer;

	const uiText = (key, variables) => window.metisDesktopI18n?.t(key, localStorage.getItem(LANGUAGE_KEY) || "auto", variables) || key;
	const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
	function overlay() { return document.querySelector("#onboardingOverlay"); }
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
	function getLanguages() {
		return [
			["auto", uiText("automatic")],
			["zh-CN", NATIVE_LANGUAGE_NAMES["zh-CN"]],
			["en", NATIVE_LANGUAGE_NAMES.en],
			["zh-TW", NATIVE_LANGUAGE_NAMES["zh-TW"]],
			["ja", NATIVE_LANGUAGE_NAMES.ja],
			["ko", NATIVE_LANGUAGE_NAMES.ko],
			["es", NATIVE_LANGUAGE_NAMES.es],
			["fr", NATIVE_LANGUAGE_NAMES.fr],
			["de", NATIVE_LANGUAGE_NAMES.de],
			["pt", NATIVE_LANGUAGE_NAMES.pt],
			["ru", NATIVE_LANGUAGE_NAMES.ru],
			["it", NATIVE_LANGUAGE_NAMES.it],
		];
	}
	function render() {
		const root = overlay();
		if (!root) return;
		clearInterval(greetingTimer);
		root.innerHTML = `<div class="onboarding-progress" aria-hidden="true">${Array.from({ length: STEP_COUNT }, (_, index) => `<i class="${index + 1 === step ? "active" : index + 1 < step ? "done" : ""}"></i>`).join("")}</div><main class="onboarding-stage" aria-live="polite">${scene()}</main>${navigation()}`;
		bindScene(root);
	}
	function updateLanguageSelection(root, language) {
		const autoButton = root.querySelector('[data-language="auto"]');
		if (autoButton) autoButton.textContent = uiText("automatic");
		root.querySelectorAll("[data-language]").forEach((button) => {
			const selected = button.dataset.language === language;
			button.classList.toggle("selected", selected);
			button.setAttribute("aria-pressed", String(selected));
		});
	}
	function scene() {
		if (step === 1) return `<section class="onboarding-screen onboarding-welcome" data-scene="1"><div class="onboarding-greeting" id="onboardingGreeting">${GREETINGS[0]}</div><p>${uiText("onboardingWelcomeSubtitle")}</p><button type="button" class="onboarding-primary onboarding-welcome-action" data-onboarding-next>${uiText("onboardingGetStarted")}</button></section>`;
		if (step === 2) {
			const selected = localStorage.getItem(LANGUAGE_KEY) || "auto";
			return `<section class="onboarding-screen onboarding-setup-screen" data-scene="2"><header class="onboarding-scene-heading"><h1>${uiText("onboardingLanguageTitle")}</h1><p>${uiText("onboardingLanguageSubtitle")}</p></header><div class="onboarding-language-grid" translate="no">${getLanguages().map(([code, label]) => `<button type="button" data-language="${code}" class="${code === selected ? "selected" : ""}" aria-pressed="${code === selected}" translate="no">${label}</button>`).join("")}</div></section>`;
		}
		if (step === 3) return `<section class="onboarding-screen onboarding-setup-screen" data-scene="3"><header class="onboarding-scene-heading"><h1>${uiText("onboardingProviderTitle")}</h1><p>${uiText("onboardingProviderDescription")}</p></header><div class="onboarding-provider-card"><div class="onboarding-provider-tabs" role="tablist" aria-label="${uiText("onboardingProviderTitle")}"><button type="button" role="tab" aria-selected="true" data-provider-tab="api">${uiText("onboardingProviderTabApiKey")}</button><button type="button" role="tab" aria-selected="false" data-provider-tab="oauth">${uiText("onboardingProviderTabOAuth")}</button><button type="button" role="tab" aria-selected="false" data-provider-tab="custom">${uiText("onboardingProviderTabCustom")}</button></div><div class="onboarding-provider-panel" id="onboardingProviderPanel">${providerPanel("api")}</div><p class="onboarding-feedback" id="onboardingFeedback" role="status"></p></div></section>`;
		const recent = (window.state?.projects || []).slice(0, 4);
		return `<section class="onboarding-screen onboarding-setup-screen" data-scene="4"><header class="onboarding-scene-heading"><h1>${uiText("onboardingWorkspaceTitle")}</h1><p>${uiText("onboardingWorkspaceSubtitle")}</p></header><div class="onboarding-workspace"><button type="button" class="onboarding-folder" data-onboarding-workspace><svg aria-hidden="true"><use href="#i-folder"/></svg>${uiText("onboardingChooseFolder")}</button><div class="onboarding-selected-list" id="onboardingSelectedList"></div>${recent.length ? `<div class="onboarding-recent"><span>${uiText("onboardingRecentProjects")}</span>${recent.map((project) => `<button type="button" data-workspace-path="${escapeHtml(project.path)}" data-workspace-name="${escapeHtml(project.displayName || project.name)}" aria-pressed="false"><span><strong>${escapeHtml(project.displayName || project.name)}</strong><small>${escapeHtml(project.path)}</small></span><span class="onboarding-project-check" aria-hidden="true"><svg><use href="#i-check"/></svg><span>${uiText("onboardingSelectedProject")}</span></span></button>`).join("")}</div>` : ""}</div></section>`;
	}
	function providerPanel(kind) {
		if (kind === "oauth") return `<div class="onboarding-provider-fields" data-provider-panel="oauth"><div class="onboarding-provider-inputs onboarding-provider-inputs-single"><label><span>${uiText("providerName")}</span><select id="onboardingOAuthProvider"><option value="anthropic">Anthropic</option><option value="openai-codex">OpenAI Codex</option><option value="github-copilot">GitHub Copilot</option></select></label></div><footer class="onboarding-provider-actions"><p>${uiText("oauthDescription")}</p><button class="onboarding-primary onboarding-provider-submit" type="button" data-onboarding-oauth>${uiText("oauthLogin")}</button></footer></div>`;
		if (kind === "custom") return `<div class="onboarding-provider-fields" data-provider-panel="custom"><div class="onboarding-provider-inputs onboarding-custom-fields"><label><span>${uiText("providerName")}</span><input id="onboardingCustomName" type="text" /></label><label><span>${uiText("customProviderBaseUrl")}</span><input id="onboardingCustomBaseUrl" type="url" placeholder="https://api.example.com/v1" /></label><label><span>${uiText("apiKey")}</span><input id="onboardingCustomApiKey" type="password" autocomplete="off" /></label><label><span>${uiText("additionalModelIds")}</span><input id="onboardingCustomModels" type="text" placeholder="${uiText("manualModelIdsPlaceholder")}" /></label></div><footer class="onboarding-provider-actions"><p>${uiText("customBaseUrlDescription")}</p><button class="onboarding-primary onboarding-provider-submit" type="button" data-onboarding-custom>${uiText("onboardingSaveAndConnect")}</button></footer></div>`;
		return `<div class="onboarding-provider-fields" data-provider-panel="api"><div class="onboarding-provider-inputs"><label><span>${uiText("providerName")}</span><select id="onboardingProvider">${PROVIDERS.map((provider) => `<option value="${provider}">${provider}</option>`).join("")}</select></label><label><span>${uiText("apiKey")}</span><input id="onboardingApiKey" type="password" autocomplete="off" placeholder="sk-…" /></label></div><footer class="onboarding-provider-actions"><p>${uiText("apiKeyDescription")}</p><button class="onboarding-primary onboarding-provider-submit" type="button" data-onboarding-save>${uiText("onboardingSaveAndConnect")}</button></footer></div>`;
	}
	function navigation() {
		const isFinalStep = step === STEP_COUNT;
		return `<nav class="onboarding-navigation ${step === 1 ? "onboarding-navigation-hidden" : ""}" aria-label="${uiText("onboardingStep", { step, total: STEP_COUNT })}"><button type="button" class="onboarding-back" data-onboarding-back ${step === 1 ? "disabled" : ""}>${uiText("onboardingPrevious")}</button><button type="button" class="onboarding-primary" data-onboarding-next ${isFinalStep && selectedWorkspaces.size === 0 ? "disabled" : ""}>${isFinalStep ? uiText("onboardingStartCoding") : uiText("onboardingNext")}</button></nav>`;
	}
	function bindScene(root) {
		root.querySelector("[data-onboarding-next]")?.addEventListener("click", next);
		root.querySelector("[data-onboarding-back]")?.addEventListener("click", () => { step = Math.max(1, step - 1); render(); });
		root.querySelectorAll("[data-language]").forEach((button) => button.addEventListener("click", () => {
			const language = button.dataset.language;
			localStorage.setItem(LANGUAGE_KEY, language);
			window.setUiLanguage?.(language);
			// Preserve this scene's DOM. Rebuilding it restarts its one-time entrance
			// animation for every language choice, which makes selection feel sluggish.
			updateLanguageSelection(root, language);
		}));
		root.querySelector("[data-onboarding-skip]")?.addEventListener("click", next);
		bindProviderControls(root);
		root.querySelector("[data-onboarding-workspace]")?.addEventListener("click", chooseWorkspace);
		root.querySelectorAll("[data-workspace-path]").forEach((button) => button.addEventListener("click", () => {
			const path = button.dataset.workspacePath;
			if (selectedWorkspaces.has(path)) selectedWorkspaces.delete(path);
			else selectedWorkspaces.set(path, { path, name: button.dataset.workspaceName });
			updateWorkspaceSelection(root);
		}));
		updateWorkspaceSelection(root);
		const greeting = root.querySelector("#onboardingGreeting");
		if (greeting) {
			let index = 0;
			greetingTimer = window.setInterval(() => {
				index = (index + 1) % GREETINGS.length;
				greeting.classList.add("changing");
				window.setTimeout(() => { greeting.textContent = GREETINGS[index]; greeting.classList.remove("changing"); }, 220);
			}, 2200);
		}
	}
	function bindProviderControls(root) {
		root.querySelectorAll("[data-provider-tab]").forEach((tab) => tab.addEventListener("click", () => {
			root.querySelectorAll("[data-provider-tab]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === tab)));
			const panel = root.querySelector("#onboardingProviderPanel");
			if (panel) panel.innerHTML = providerPanel(tab.dataset.providerTab);
			bindProviderActions(root);
		}));
		bindProviderActions(root);
	}
	function bindProviderActions(root) {
		root.querySelector("[data-onboarding-save]")?.addEventListener("click", saveProvider);
		root.querySelector("[data-onboarding-oauth]")?.addEventListener("click", saveOAuthProvider);
		root.querySelector("[data-onboarding-custom]")?.addEventListener("click", saveCustomProvider);
	}
	async function saveProvider() {
		const feedback = document.querySelector("#onboardingFeedback");
		const provider = document.querySelector("#onboardingProvider")?.value;
		const apiKey = document.querySelector("#onboardingApiKey")?.value.trim();
		if (!apiKey) { feedback.textContent = uiText("enterApiKey"); return; }
		try {
			feedback.textContent = uiText("saving");
			await window.runPreferencesCommand?.(`/login ${provider} ${apiKey}`, feedback, { sync: true });
			feedback.textContent = uiText("savedAndApplied");
			window.setTimeout(next, 450);
		} catch (error) { feedback.textContent = uiText("saveFailed", { message: error.message || String(error) }); }
	}
	async function saveOAuthProvider() {
		const feedback = document.querySelector("#onboardingFeedback");
		const provider = document.querySelector("#onboardingOAuthProvider")?.value;
		try {
			feedback.textContent = uiText("saving");
			await window.runPreferencesCommand?.(`/login ${provider}`, feedback, { sync: true });
			feedback.textContent = uiText("savedAndApplied");
			window.setTimeout(next, 450);
		} catch (error) { feedback.textContent = uiText("saveFailed", { message: error.message || String(error) }); }
	}
	async function saveCustomProvider() {
		const feedback = document.querySelector("#onboardingFeedback");
		const name = document.querySelector("#onboardingCustomName")?.value.trim();
		const baseUrl = document.querySelector("#onboardingCustomBaseUrl")?.value.trim();
		const apiKey = document.querySelector("#onboardingCustomApiKey")?.value.trim();
		const modelIds = String(document.querySelector("#onboardingCustomModels")?.value || "").split(",").map((value) => value.trim()).filter(Boolean);
		if (!name || !baseUrl) { feedback.textContent = uiText("enterProviderName"); return; }
		try {
			feedback.textContent = uiText("saving");
			const saved = await window.metisDesktop?.providerConfig?.saveCustom({ name, baseUrl, apiKey, modelIds, reasoning: true });
			await window.runPreferencesCommand?.("/reload", feedback, { sync: true });
			if (apiKey && saved?.provider) await window.runPreferencesCommand?.(`/login ${saved.provider} ${apiKey}`, feedback, { sync: true });
			feedback.textContent = uiText("savedAndApplied");
			window.setTimeout(next, 450);
		} catch (error) { feedback.textContent = uiText("saveFailed", { message: error.message || String(error) }); }
	}
	async function chooseWorkspace() {
		const picked = await window.metisDesktop?.workspace?.selectMany?.();
		for (const project of picked || []) selectedWorkspaces.set(project.path, project);
		updateWorkspaceSelection(overlay());
	}
	function updateWorkspaceSelection(root) {
		if (!root) return;
		root.querySelectorAll("[data-workspace-path]").forEach((button) => {
			const selected = selectedWorkspaces.has(button.dataset.workspacePath);
			button.classList.toggle("selected", selected);
			button.setAttribute("aria-pressed", String(selected));
		});
		const selectedList = root.querySelector("#onboardingSelectedList");
		if (selectedList) {
			selectedList.innerHTML = [...selectedWorkspaces.values()].map((project) => `<div class="onboarding-selected"><span><strong>${escapeHtml(project.name || project.path.split("/").pop())}</strong><small>${escapeHtml(project.path)}</small></span><span class="onboarding-project-check"><svg aria-hidden="true"><use href="#i-check"/></svg>${uiText("onboardingSelectedProject")}</span></div>`).join("");
			selectedList.classList.toggle("hidden", selectedWorkspaces.size === 0);
		}
		const finish = root.querySelector('.onboarding-navigation [data-onboarding-next]');
		if (step === STEP_COUNT && finish) finish.disabled = selectedWorkspaces.size === 0;
	}
	async function next() {
		if (step < STEP_COUNT) { step += 1; render(); return; }
		if (selectedWorkspaces.size === 0) return;
		localStorage.setItem(STORAGE_KEY, "true");
		stop();
		const projects = [...selectedWorkspaces.values()].map((workspace) => window.ensureProject?.(workspace)).filter(Boolean);
		const project = projects.at(-1);
		if (project) await window.activateProject?.(project, { forceNewConversation: true });
		window.focusComposer?.();
	}
	function start() {
		const root = overlay();
		if (!root) return;
		active = true;
		step = 1;
		selectedWorkspaces = new Map();
		root.hidden = false;
		document.body.classList.add("onboarding-open");
		render();
	}
	function stop() {
		active = false;
		clearInterval(greetingTimer);
		overlay()?.setAttribute("hidden", "");
		document.body.classList.remove("onboarding-open");
	}
	function isCompleted() { return localStorage.getItem(STORAGE_KEY) === "true"; }
	window.MetisOnboarding = { start, stop, isCompleted, reset: () => { localStorage.removeItem(STORAGE_KEY); start(); }, setStep: (nextStep) => { if (!active) start(); step = Math.min(STEP_COUNT, Math.max(1, Number(nextStep) || 1)); render(); }, get active() { return active; } };
})();
