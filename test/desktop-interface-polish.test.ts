import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "desktop/renderer/styles.css"), "utf8");
const html = readFileSync(resolve(process.cwd(), "desktop/renderer/index.html"), "utf8");
const app = readFileSync(resolve(process.cwd(), "desktop/renderer/app.js"), "utf8");
const desktopMain = readFileSync(resolve(process.cwd(), "desktop/main.cjs"), "utf8");

describe("desktop interface polish contracts", () => {
	it("keeps transitions explicit and honors reduced motion", () => {
		expect(styles).not.toMatch(/transition(?:-property)?\s*:\s*all\b/);
		expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
		expect(styles).toMatch(/transition-property:\s*background-color, color, box-shadow, opacity, scale/);
		expect(styles).toMatch(/#sendButton:active:not\(:disabled\)[\s\S]*?scale:\s*0\.96/);
		expect(styles).toMatch(/\.onboarding-primary:active:not\(:disabled\)[\s\S]*?scale:\s*\.96/);
		expect(styles).toMatch(/\.primary-button:active:not\(:disabled\)[\s\S]*?scale:\s*0\.96/);
		expect(styles).toMatch(/#sendButton:active:not\(:disabled\),[\s\S]*?\.primary-button:active:not\(:disabled\)[\s\S]*?scale:\s*1 !important/);
		expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workflow-plan-header svg,[\s\S]*?transition-duration:\s*0s/);

		for (const selector of [
			".icon-button:active",
			".attach-button:active",
			".remove-btn:active",
			".onboarding-back:active",
			".onboarding-skip-btn:active",
			".secondary-button:active",
			".model-trigger:active",
			".model-option:active",
			".workflow-trigger:active",
			".workflow-plan-header:active",
			".project-switch-capsule:active",
			".tool-header-bar:active",
			".cot-thoughts-toggle:active",
			".settings-dialog-nav-item:active",
			".settings-dialog-close:active",
			".settings-secondary-button:active",
		]) {
			expect(styles).not.toContain(selector);
		}
	});

	it("covers typography, media, focus, and compact hit targets", () => {
		expect(styles).toContain("-webkit-font-smoothing: antialiased");
		expect(styles).toContain("-moz-osx-font-smoothing: grayscale");
		expect(styles).toMatch(/text-wrap:\s*balance/);
		expect(styles).toMatch(/text-wrap:\s*pretty/);
		expect(styles).toMatch(/font-variant-numeric:\s*tabular-nums/);
		expect(styles).toMatch(/outline:\s*1px solid var\(--image-outline\)/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\][\s\S]*?outline-color:\s*oklch\(0 0 0 \/ 0\.1\)/);
		expect(styles).toMatch(/select:focus-visible,[\s\S]*?outline:\s*none !important;[\s\S]*?box-shadow:\s*none !important/);
		expect(styles).toMatch(/--focus:\s*transparent;[\s\S]*?--focus-ring:\s*none/);
		expect(styles).toMatch(/::after\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px/);
		expect(styles).not.toMatch(/will-change:\s*left/);
	});

	it("keeps shell panels flat while elevating focused controls", () => {
		expect(styles).toMatch(/\[data-purpose="channel-list"\],[\s\S]*?border:\s*0\s*!important;[\s\S]*?box-shadow:\s*none\s*!important/);
		expect(styles).toMatch(/#composer:focus-within[\s\S]*?var\(--shell-focus-ring\)/);
		expect(html).toMatch(/<aside[^>]*data-purpose="icon-sidebar"/);
		expect(html).toMatch(/<section[^>]*data-purpose="channel-list"/);
		expect(html).toMatch(/<main[^>]*data-purpose="main-chat"/);
	});

	it("gives each project a stable translucent rainbow tile", () => {
		expect(app).toContain('style.setProperty("--project-rainbow-hue", String(rainbowHue))');
		expect(app).toContain("((hash % 360) + 360) % 360");
		expect(styles).toMatch(/\.project-rail-item\s*\{[\s\S]*?background:\s*hsl\(var\(--project-rainbow-hue, 270\) 72% 78% \/ 0\.28\)\s*!important/);
		expect(styles).toMatch(/\.project-rail-entry\.active \.project-rail-item\s*\{[\s\S]*?box-shadow:\s*none\s*!important/);
		expect(styles).not.toContain("--project-neon-color");
	});

	it("customizes project presentation without mutating Agent workspace identity", () => {
		expect(html).toContain('id="projectCustomizePopover" role="dialog" aria-modal="false" aria-labelledby="projectCustomizeTitle" popover="manual"');
		expect(html).not.toContain('class="project-customize-dialog"');
		expect(html).toContain('id="projectDisplayNameInput"');
		expect(html).toContain('id="projectColorInput"');
		expect(html).toContain('id="projectColorInput" type="range" min="0" max="360" step="1"');
		expect(html).not.toContain('id="projectColorPresets"');
		expect(html).toContain('class="project-customize-heading"');
		expect(html).not.toContain('id="projectCustomizePreview"');
		expect(html).not.toContain('data-i18n="desktopOnly"');
		expect(html).toContain('class="project-customize-row project-color-row"');
		expect(html).not.toContain('class="project-customize-footer"');
		expect(html).not.toContain('id="projectColorReset"');
		expect(html).not.toContain('id="projectCustomizeCancel"');
		expect(html).not.toContain('data-i18n="projectDisplayNameHint"');
		expect(app).toContain('project.displayName = nextName && nextName !== project.name ? nextName : undefined');
		expect(app).toContain('projectButton.className = "project-rail-item"');
		expect(app).toContain('customizeButton.className = "project-rail-customize"');
		expect(app).toContain("elements.projectList.dataset.renderSignature !== projectRailSignature");
		expect(app).toMatch(/if \(shouldRenderProjectRail\) \{\s*elements\.projectList\.replaceChildren\(\);/);
		expect(app).toContain("if (shouldRenderProjectRail) for (const project of state.projects)");
		expect(app).toContain('const anchorBounds = anchor.closest(".project-rail-entry")?.getBoundingClientRect()');
		expect(app).toContain('elements.projectCustomizePopover.showPopover()');
		expect(app).toContain('elements.projectCustomizePopover.hidePopover()');
		expect(app).toContain('querySelector(".project-rail-item")');
		expect(app).toContain('projectButton.classList.toggle("has-custom-color", Boolean(customColor))');
		expect(app).toContain('updateProjectCustomizePreview(project.accentColor, projectDisplayName(project))');
		expect(app).toContain('project.accentColor = projectAccentFromHue(elements.projectColorInput.value)');
		expect(app).toContain('persistProjectCustomization({ name: true })');
		expect(app).toContain('persistProjectCustomization({ color: true })');
		expect(app).toContain('if (event.key !== "Escape") return;');
		expect(styles).toMatch(/\.project-rail-entry:hover \.project-rail-customize,[\s\S]*?opacity:\s*1/);
		expect(styles).toMatch(/\.project-rail-customize\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden/);
		expect(styles).toMatch(/\.project-rail-entry:hover \.project-rail-customize,[\s\S]*?visibility:\s*visible/);
		expect(styles).toMatch(/\.project-rail-customize\s*\{[\s\S]*?top:\s*0;[\s\S]*?right:\s*0;[\s\S]*?width:\s*16px;[\s\S]*?height:\s*16px/);
		expect(styles).toMatch(/\.project-customize-popover\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*auto;[\s\S]*?margin:\s*0/);
		expect(styles).toMatch(/\.project-customize-popover\s*\{[\s\S]*?width:\s*min\(252px, calc\(100vw - 24px\)\);[\s\S]*?border-radius:\s*14px;[\s\S]*?box-shadow:[\s\S]*?0 12px 30px/);
		expect(styles).toMatch(/\.project-customize-row\s*\{[\s\S]*?display:\s*block/);
		expect(styles).toMatch(/\.project-customize-row > input\s*\{[\s\S]*?height:\s*40px;[\s\S]*?border-radius:\s*10px/);
		expect(styles).toMatch(/\.project-customize-popover::before\s*\{[\s\S]*?left:\s*-10px;[\s\S]*?width:\s*11px;[\s\S]*?height:\s*16px;[\s\S]*?clip-path:\s*polygon/);
		expect(styles).not.toContain(".project-customize-popover .secondary-button");
		expect(styles).not.toContain(".project-customize-popover .primary-button");
		expect(styles).toMatch(/\.project-color-slider input\[type="range"\]\s*\{[\s\S]*?linear-gradient\(90deg/);
		expect(styles).toMatch(/::-webkit-slider-thumb\s*\{[\s\S]*?width:\s*18px;[\s\S]*?background:\s*var\(--project-slider-color/);
		expect(styles).toMatch(/\.project-rail-item\.has-custom-color\s*\{[\s\S]*?var\(--project-custom-color\)/);
	});

	it("connects the conversation panel to the active project icon", () => {
		expect(app).toContain("function updateProjectPanelConnector()");
		expect(app).toContain('querySelector(".project-rail-entry.active")');
		expect(app).toContain('connector.className = "project-panel-connector"');
		expect(app).toContain("sidebar.insertBefore(connector, sidebar.lastElementChild)");
		expect(app).toContain('style.setProperty("--project-connector-y", `${connectorY}px`)');
		expect(app).toContain('projectList?.addEventListener("scroll", updateProjectPanelConnector');
		expect(app).toContain('window.addEventListener("resize", updateProjectPanelConnector)');
		expect(styles).toMatch(/\.project-panel-connector\s*\{[\s\S]*?top:\s*calc\(var\(--project-connector-y, 88px\) - 8px\);[\s\S]*?right:\s*-8px;[\s\S]*?width:\s*16px;[\s\S]*?border-radius:\s*5px;[\s\S]*?transform:\s*rotate\(45deg\) scale\(0\.92\)/);
		expect(styles).toMatch(/\.project-panel-connector\s*\{[\s\S]*?pointer-events:\s*none/);
	});

	it("opens Desktop settings as a modal from the original sidebar entry", () => {
		expect(html).toContain('id="sidebarSettingsButton"');
		expect(html).toContain('<dialog class="settings-dialog" id="settingsDialog"');
		expect(html).toContain('data-settings-content="general"');
		expect(html).toContain('data-settings-content="shortcuts"');
		expect(html).toContain('data-settings-content="server"');
		expect(html).toContain('data-settings-content="model"');
		expect(html).toContain('data-settings-content="about"');
		expect(html).not.toContain('href="preferences.css"');
		expect(html).toContain('id="serverDialog"');
		expect(app).toContain('elements.settingsDialog.showModal()');
		expect(app).toContain('event.target === elements.settingsDialog');
		expect(styles).toMatch(/\.settings-dialog::backdrop\s*\{[\s\S]*?background:\s*var\(--overlay\)/);
		expect(styles).toMatch(/\.settings-dialog-layout\s*\{[\s\S]*?grid-template-columns:\s*220px minmax\(0, 1fr\)/);
		expect(styles).not.toMatch(/transition(?:-property)?\s*:\s*all\b/);
	});

	it("keeps settings navigation focused without repeating the product name", () => {
		expect(html).toContain('<div class="settings-dialog-brand">\n\t\t\t\t\t<strong id="settingsDialogTitle">设置</strong>');
		expect(html).not.toContain('<div class="settings-dialog-brand">\n\t\t\t\t\t<span>Metis Desktop</span>');
		expect(styles).toMatch(/\.settings-dialog-nav-item\s*\{[\s\S]*?min-height:\s*38px;[\s\S]*?height:\s*38px;[\s\S]*?padding:\s*0 10px;[\s\S]*?border-radius:\s*var\(--control-radius\)/);
		expect(styles).toMatch(/\.settings-dialog-nav-item svg\s*\{[\s\S]*?width:\s*15px;[\s\S]*?height:\s*15px/);
		expect(html).toContain('data-settings-panel="shortcuts"');
		expect(html).toContain('<use href="#i-keyboard"/>');
		expect(html).toContain('<use href="#i-server"/>');
		expect(html).toContain('<use href="#i-cpu"/>');
		expect(styles).toMatch(/\.settings-dialog-card\s*\{[\s\S]*?background:\s*var\(--surface-soft\);[\s\S]*?border:\s*1px solid var\(--line\);[\s\S]*?box-shadow:\s*var\(--shadow-card\)/);
		expect(styles).toMatch(/\.settings-dialog-main\s*\{[\s\S]*?background:\s*var\(--surface\)/);
		expect(styles).toMatch(/button:focus-visible,[\s\S]*?outline:\s*none !important;[\s\S]*?box-shadow:\s*none !important/);
	});

	it("keeps every settings control in bounds at desktop and compact widths", () => {
		for (const panel of ["general", "shortcuts", "server", "model", "agent", "security", "session", "about"]) {
			expect(html).toContain(`data-settings-content="${panel}"`);
		}
		expect(styles).toMatch(/\.settings-dialog-sidebar\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden/);
		expect(styles).toMatch(/\.settings-dialog-nav\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-y:\s*auto/);
		expect(styles).toMatch(/\.settings-api-key-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(104px, \.8fr\) minmax\(128px, 1\.2fr\) auto/);
		expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.settings-dialog-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
		expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.settings-dialog-nav\s*\{[\s\S]*?flex-direction:\s*row;[\s\S]*?overflow-x:\s*auto/);
		expect(styles).toMatch(/\.settings-secondary-button\s*\{[\s\S]*?min-height:\s*40px/);
	});

	it("removes deprecated Dream status presentation", () => {
		expect(html).not.toContain('id="dreamCardWrap"');
		expect(app).not.toContain("renderDreamCardPresentation");
		expect(app).not.toContain('has-dream-status');
		expect(html).not.toContain("dreamCardMenuBtn");
		expect(app).not.toContain("dreamCardMenuBtn");
	});

	it("replaces the composer with one ask_user question at a time", () => {
		expect(app).toContain('elements.composer.insertAdjacentElement("afterend", card)');
		expect(app).toContain('elements.composer.hidden = true');
		expect(app).toContain('const question = request.questions[questionIndex]');
		expect(app).toContain('questionIndex += 1');
		expect(app).toContain('form.replaceChildren()');
		expect(app).toContain('card.dataset.userInputRequestId = request.requestId');
		expect(app).toContain('card.dataset.toolCallId = request.toolCallId || ""');
		expect(app).toContain('status.setAttribute("aria-live", "polite")');
		expect(app).toContain('request.questions.map((question) => answers.get(question.id))');
		expect(app).toContain('clearUserInputComposer({ restoreFocus: true })');
		expect(styles).toMatch(/\.user-input-actions button\s*\{[\s\S]*?min-width:\s*40px;[\s\S]*?min-height:\s*40px/);
		expect(app).toContain('elements.composer.style.display = "none"');
		expect(app).toContain('card.style.width = `${composerWidth}px`');
		expect(app).toContain('card.dataset.composerWidth = String(composerWidth)');
		expect(styles).toMatch(/\.has-user-input > #composer\[hidden\]\s*\{\s*display:\s*none !important/);
		expect(styles).toMatch(/\.user-input-card\s*\{[\s\S]*?var\(--line\)[\s\S]*?var\(--surface\)/);
		expect(styles).toMatch(/\.user-input-confirm\s*\{[\s\S]*?width:\s*40px;[\s\S]*?background:\s*var\(--ink\)/);
		expect(styles).not.toMatch(/#(?:756d80|8b8293)/i);
	});

	it("uses persisted workflowProposal as latest proposal authority", () => {
		expect(app).toContain('state.session?.workflowProposal?.markdown');
		expect(app).toContain('card.dataset.currentProposal = String(currentProposal)');
		expect(app).toContain('uiText("proposedPlanRefinePrompt", { request })');
		expect(app).toContain('uiText("proposedPlanProcessPrompt")');
		expect(app).toContain('const hasDraft = Boolean(card?.querySelector(".proposed-plan-refine")?.value.trim())');
		expect(app).toContain('refineShell.className = "proposed-plan-refine-shell"');
		expect(app).toContain('actions.append(processButton, refineShell)');
		expect(app).toContain('refineButton.innerHTML = \'<svg aria-hidden="true"><use href="#i-send"/></svg>\'');
		expect(styles).toMatch(/\.proposed-plan-actions\s*\{[\s\S]*?gap:\s*8px/);
		expect(styles).toMatch(/\.proposed-plan-refine-shell\s*\{[\s\S]*?flex:\s*1 1 auto/);
		expect(styles).toMatch(/\.proposed-plan-process\s*\{[\s\S]*?flex:\s*0 0 112px/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.proposed-plan-process\s*\{[^}]*height:\s*32px;[^}]*min-height:\s*32px/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.proposed-plan-refine-shell,[\s\S]*?\.proposed-plan-refine-send\s*\{[^}]*height:\s*32px;[^}]*min-height:\s*32px/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.proposed-plan-refine-send\s*\{[^}]*width:\s*32px;[^}]*min-width:\s*32px/);
		expect(styles).toMatch(/\.proposed-plan-refine-send\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?background:\s*transparent/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.proposed-plan-refine:focus,[\s\S]*?border-color:\s*var\(--line-strong\);[\s\S]*?box-shadow:\s*0 0 0 1px var\(--line-strong\)/);
	});

	it("reconciles optimistic user prompts with the server user message", () => {
		expect(app).toContain("_metisOptimistic: true");
		expect(app).toContain("candidate?._metisOptimistic === true");
	});

	it("polishes work traces with a compact final-response boundary", () => {
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.cot-title\s*\{[\s\S]*?color:\s*var\(--ink-soft\);[\s\S]*?font-weight:\s*560/);
		expect(styles).toMatch(/\.cot-content-inner > \.tool-card\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
		expect(styles).toMatch(/\.tool-duration\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;[\s\S]*?text-align:\s*right/);
		expect(styles).toMatch(/\.tool-header-bar\s*\{[\s\S]*?min-height:\s*26px;[\s\S]*?transition-property:\s*color/);
		expect(styles).toMatch(/\.tool-name\.shimmering\s*\{[\s\S]*?animation:\s*none/);
		expect(app).toContain('header.setAttribute("aria-expanded", "false")');
		expect(app).toContain('cotHeader.setAttribute("tabindex", "0")');
		expect(styles).toContain(".turn-final-divider");
		expect(styles).toContain("margin: 16px 0;");
		expect(styles).toContain("--work-final-gap: 8px;");
		expect(styles).toContain("--work-item-gap: 8px;");
		expect(styles).toMatch(/\.assistant-message\.assistant-turn-expanded:not\(\.assistant-turn-active\) \.turn-final-divider\s*\{\s*display:\s*block/);
		expect(styles).toMatch(/\.assistant-message\.assistant-turn-collapsed \.turn-final-divider,[\s\S]*?display:\s*none/);
		expect(styles).toMatch(/\.assistant-message\.assistant-turn-collapsed\.assistant-turn-final:not\(\.assistant-turn-work\)\s*\{[\s\S]*?margin-top:\s*var\(--work-final-gap\)/);
		expect(styles).not.toContain("margin-top: -27px");
		expect(styles).not.toMatch(/assistant-turn-(?:work-end|final)[^}]*!important/);
		expect(app).toContain("function syncAssistantTurnPresentation(turnArticles)");
		expect(app).toContain("syncAssistantTurnPresentations();");
		expect(app).toContain('candidate.classList.toggle("assistant-turn-work-end", candidate === workArticles.at(-1))');
		expect(app).toContain('candidate.classList.toggle("assistant-turn-final", isFinalArticle)');
		expect(app).not.toContain("refreshAllTurnDividers");
	});

	it("renders Subagent with the same collapsed Tool grammar", () => {
		expect(app).toContain('card.className = `tool-card subagent-tool-card collapsed');
		expect(app).toContain('header.className = "tool-header-bar subagent-tool-header"');
		expect(app).toContain('icon.setAttribute("class", "tool-icon")');
		expect(app).toContain('title.className = "tool-name"');
		expect(app).toContain('durationEl.className = "tool-duration"');
		expect(app).toContain('details.className = "tool-details-body subagent-tool-details"');
		expect(app).toContain('task.className = "subagent-tool-task"');
		expect(app).toContain('mode.textContent = uiText("subagentBackground")');
		expect(app).toContain('job.textContent = `ID #${item.progress.jobId}`');
		expect(app).toContain('uiText("subagentDuration", { duration })');
		expect(app).toContain('header.setAttribute("aria-expanded", "false")');
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.subagent-tool-card \.subagent-tool-header\s*\{[\s\S]*?grid-template-columns:\s*20px minmax\(84px, max-content\) auto auto 12px/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.tool-icon\s*\{[\s\S]*?width:\s*16px;[\s\S]*?padding:\s*0;[\s\S]*?background-color:\s*transparent;[\s\S]*?stroke-width:\s*2/);
		expect(styles).toMatch(/\.subagent-tool-duration\s*\{\s*font-variant-numeric:\s*tabular-nums/);
		expect(styles).not.toContain(".subagent-completion-card");
		expect(styles).not.toMatch(/\.subagent-tool-card\.running[^}]*animation:/);
	});

	it("folds Thinking text behind an accessible Thoughts control inside Worked", () => {
		expect(app).toContain('thoughtsToggle.className = "cot-thoughts-toggle"');
		expect(app).toContain('thoughtsLabel.className = "cot-thoughts-label"');
		expect(app).toContain('thoughtsLabel.textContent = uiText("thoughts")');
		expect(app).not.toContain('thoughtsIcon.setAttribute("class", "cot-thoughts-icon")');
		expect(app).toContain('thoughtsDuration.className = "cot-thoughts-duration"');
		expect(app).toContain("resolveThoughtSegmentTiming(message, part, key, thoughtIsActive)");
		expect(app).toContain('group.dataset.thoughtTimerKey');
		expect(app).toContain("cot-thoughts-group");
		expect(app).toContain('itemEl.dataset.thoughtsManual = "true"');
		expect(app).toContain('const thoughtIsActive = isWorking && sourceIndex === workItems.length - 1');
		expect(app).toContain('itemEl.classList.toggle("collapsed", !thoughtIsActive)');
		expect(app).toContain('thoughtsToggle.setAttribute("aria-expanded"');
		expect(styles).toMatch(/\.cot-thoughts-toggle\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, max-content\) auto 14px;[\s\S]*?min-height:\s*24px;[\s\S]*?padding:\s*0;[\s\S]*?background-color:\s*transparent;[\s\S]*?color:\s*var\(--ink-soft\);[\s\S]*?font-size:\s*13\.5px;[\s\S]*?transition-property:\s*color/);
		expect(styles).toMatch(/\.cot-thoughts-duration\s*\{[\s\S]*?color:\s*var\(--ink-faint\)/);
		expect(styles).toMatch(/\.cot-thoughts-toggle::before\s*\{[\s\S]*?height:\s*40px/);
		expect(styles).toMatch(/\.cot-text\s*\{[\s\S]*?color:\s*var\(--ink\);[\s\S]*?font-family:\s*inherit;[\s\S]*?font-size:\s*inherit;[\s\S]*?line-height:\s*inherit;[\s\S]*?text-wrap:\s*pretty/);
		expect(styles).toMatch(/\.cot-thoughts-group\.collapsed \.cot-thinking\s*\{\s*display:\s*none/);
		expect(styles).toMatch(/\.cot-thoughts-duration\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/);
		expect(styles).toMatch(/\.cot-thinking\s*\{[\s\S]*?max-height:\s*240px;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.assistant-turn-work-start \.cot-header-bar\s*\{[\s\S]*?width:\s*100%;[\s\S]*?border-bottom:\s*1px solid var\(--line\)/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.assistant-turn-work-start \.cot-title\s*\{[\s\S]*?flex:\s*0 1 auto/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \.assistant-turn-work-start \.cot-container\.collapsed \.cot-header-bar\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--line\)/);
		expect(styles).not.toMatch(/\.cot-thoughts-toggle\s*\{[^}]*transition:\s*all/);
		expect(desktopMain).toContain("[capture:work-trace]");
	});

	it("keeps Token activity independent from removed Dream status", () => {
		expect(html).not.toContain('id="dreamCardWrap"');
		expect(html).toContain('id="dreamTokenCard"');
		expect(styles).toMatch(/#dreamTokenCard\s*\{[\s\S]*?height:\s*176px;[\s\S]*?border-radius:\s*var\(--composer-surface-radius\)/);
		expect(styles).toMatch(/#dreamTokenCard\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*calc\(100% - 8px\)/);
		expect(styles).toMatch(/\[data-purpose="composer-stack"\]\s*\{[\s\S]*?background:\s*transparent\s*!important;[\s\S]*?border:\s*0\s*!important;[\s\S]*?box-shadow:\s*none\s*!important/);
	});

	it("hides Token activity after its compositor-only exit", () => {
		expect(app).toContain("if (state.hasSubmittedMessage) return;");
		expect(app).toContain('elements.dreamTokenCard?.classList.add("hidden")');
		expect(styles).toMatch(/#dreamTokenCard\.hidden\s*\{[\s\S]*?display:\s*none\s*!important/);
		expect(styles).toMatch(/\.is-leaving-empty #dreamTokenCard\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?translate3d\(-50%, 12px, 0\);[\s\S]*?transition-property:\s*opacity, transform/);
	});

	it("uses one surface radius for Token, project switcher, and composer", () => {
		expect(styles).toContain("--composer-surface-radius: 14px");
		expect(styles).toMatch(/#dreamTokenCard\s*\{[\s\S]*?border-radius:\s*var\(--composer-surface-radius\)/);
		expect(styles).toMatch(/\.project-switch-capsule,[\s\S]*?border-radius:\s*var\(--composer-surface-radius\)\s*!important/);
		expect(styles).toMatch(/#composer\s*\{[\s\S]*?border-radius:\s*var\(--composer-surface-radius\)\s*!important/);
	});

	it("lifts the new-task composer under the README Metis mark and returns it smoothly", () => {
		expect(html).toMatch(/id="emptyHeroLogo"[^>]*>[\s\S]*?<img src="assets\/metis-pixel-mark\.svg"/);
		expect(styles).toMatch(/#emptyHeroLogo\s*\{[\s\S]*?width:\s*104px;[\s\S]*?height:\s*104px/);
		expect(styles).toMatch(/#emptyHeroLogo img\s*\{[\s\S]*?width:\s*96px;[\s\S]*?height:\s*96px/);
		expect(styles).toMatch(/\.is-empty-state \[data-purpose="composer-stack"\]\s*\{[\s\S]*?transform:\s*translate3d\(0, clamp\(-882px, calc\(-42vh \+ 18px\), -302px\), 0\)/);
		expect(styles).toMatch(/\.is-leaving-empty \[data-purpose="composer-stack"\]\s*\{[\s\S]*?transition-property:\s*transform[\s\S]*?360ms/);
		expect(styles).toMatch(/\.is-leaving-empty #emptyHeroLogo\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?scale\(0\.25\);[\s\S]*?filter:\s*blur\(4px\)/);
		expect(styles).toMatch(/\.is-leaving-empty #emptyHeroLogo\s*\{[\s\S]*?transition-property:\s*opacity, transform, filter/);
		expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.is-leaving-empty/);
	});

	it("shows Desktop-local yearly daily Token activity without range controls", () => {
		expect(html).toContain('id="dreamTokenTotal"');
		expect(html).toContain('class="dream-token-overview"');
		expect(html).toContain('class="dream-token-primary"');
		expect(html).toContain('class="dream-token-secondary"');
		expect(html).toContain('class="dream-token-legend"');
		expect(html).not.toContain('id="dreamTokenCurrentStreak"');
		expect(html).not.toContain('id="dreamTokenLongestStreak"');
		expect(html).toMatch(/class="dream-token-period"[\s\S]*?data-i18n="daily"/);
		expect(html).not.toContain("data-token-view=");
		expect(html).toContain('id="dreamTokenMonths"');
		expect(html).toMatch(/id="dreamTokenHeatmap"[^>]*role="grid"[^>]*aria-rowcount="7"[^>]*aria-colcount="53"/);
		expect(app).toContain("function dreamTokenCalendarDays(dailyTokens = {}, weekCount = 53");
		expect(app).toContain("function dreamTokenActivityStats(dailyTokens = {})");
		expect(app).not.toContain("function dreamTokenValuesForView");
		expect(app).not.toContain("state.tokenActivityView");
		expect(app).toContain("desktop.sessionTokens.activity(sessionPaths)");
		expect(app).toContain("workStatsView?.tokenLevel?.(day.totalTokens, distribution)");
		expect(styles).toMatch(/\[data-purpose="main-chat"\] #dreamTokenCard\s*\{[\s\S]*?grid-template-columns:\s*178px minmax\(0, 1fr\);[\s\S]*?column-gap:\s*28px/);
		expect(styles).toMatch(/#dreamTokenCard \.dream-token-heatmap\s*\{[\s\S]*?grid-template-columns:\s*repeat\(53, minmax\(0, 1fr\)\);[\s\S]*?grid-template-rows:\s*repeat\(7, minmax\(0, 1fr\)\);[\s\S]*?width:\s*100%/);
		expect(styles).toContain('#dreamTokenCard .dream-token-cell[data-level="4"]');
		expect(styles).toMatch(/#dreamTokenCard \.dream-token-period\s*\{[\s\S]*?font-size:\s*10\.5px;[\s\S]*?font-weight:\s*570/);
		expect(styles).toMatch(/#dreamTokenCard \.dream-token-primary strong\s*\{[\s\S]*?font-size:\s*25px/);
		expect(styles).toMatch(/#dreamTokenCard \.dream-token-secondary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
		expect(styles).toMatch(/#dreamTokenCard \.dream-token-legend i\s*\{[\s\S]*?width:\s*8px/);
	});

	it("keeps a keyboard-accessible project switcher directly above the composer", () => {
		const switcher = html.indexOf('id="composerStatusRow"');
		const composer = html.indexOf('id="composer"');
		expect(switcher).toBeLessThan(composer);
		expect(html).toMatch(/id="projectSwitchCapsule"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
		expect(html).toMatch(/id="projectSwitchCapsule"[^>]*aria-controls="projectSwitchMenu"/);
		expect(html).toContain('class="project-switch-menu-label"');
		expect(html).toContain('class="p-4 flex-shrink-0" data-purpose="composer-stack"');
		expect(html).not.toContain('class="p-4 bg-white flex-shrink-0" data-purpose="composer-stack"');
		expect(app).toContain("const showProjectSwitch = state.projects.length > 0");
		expect(app).toContain('elements.projectSwitcher.classList.toggle("hidden", !showProjectSwitch)');
		expect(styles).toMatch(/#composerStatusRow\s*\{[\s\S]*?grid-template-columns:\s*max-content minmax\(0, 1fr\)/);
		expect(styles).toMatch(/\[data-purpose="main-chat"\] \[data-purpose="composer-stack"\]\s*\{[\s\S]*?background:\s*transparent !important/);
		expect(styles).toMatch(/\.project-switch-capsule,[\s\S]*?height:\s*34px;[\s\S]*?transition-property:\s*background-color, color/);
		expect(styles).toMatch(/\.project-switch-menu\s*\{[\s\S]*?bottom:\s*calc\(100% - 1px\);[\s\S]*?width:\s*100%;[\s\S]*?box-shadow:\s*none/);
		expect(styles).toMatch(/\.project-switcher\.open \.project-switch-capsule,[\s\S]*?border-radius:\s*0 0 var\(--composer-surface-radius\) var\(--composer-surface-radius\)/);
	});

	it("renders an accessible queue card backed by authoritative server operations", () => {
		expect(html).toMatch(/id="messageQueueToggle"[^>]*aria-expanded="true"[^>]*aria-controls="messageQueueList"/);
		expect(html).toMatch(/id="messageQueueList"[^>]*role="list"/);
		expect(html).toMatch(/id="messageQueueFeedback"[^>]*role="status"[^>]*aria-live="polite"/);
		expect(app).toContain('requestServer("/session/queue", "DELETE"');
		expect(app).toContain('requestServer("/session/queue/promote", "POST"');
		expect(app).toContain("applyQueueSnapshot(result)");
		expect(app).toContain('item.setAttribute("role", "listitem")');
		expect(app).toContain('elements.messageQueue.setAttribute("aria-busy"');
		expect(app).not.toContain("updateLocalFollowUpQueue");
		expect(styles).toMatch(/\.message-queue-action\s*\{[\s\S]*?min-width:\s*28px;[\s\S]*?height:\s*28px/);
		expect(styles).toMatch(/\.message-queue-action:focus-visible\s*\{[\s\S]*?outline:/);
	});

	it("always renders the full conversation list without collapse controls", () => {
		expect(app).toContain("window.metisDesktopConversations.sortConversationsByCreatedAt(activeProject.conversations)");
		expect(app).not.toContain("DEFAULT_VISIBLE_CONVERSATIONS");
		expect(app).not.toContain("conversation-expand-button");
		expect(styles).not.toContain(".conversation-expand-button");
	});

	it("keeps wider Token trails distinguishable and their dates readable", () => {
		expect(styles).not.toMatch(/\[data-purpose="channel-list"\]\s*\{[\s\S]*?width:\s*360px\s*!important/);
		expect(styles).toMatch(/\[data-purpose="channel-list"\]\s*\{[\s\S]*?width:\s*300px\s*!important;[\s\S]*?min-width:\s*300px\s*!important/);
		expect(styles).toMatch(/\.conversation-time\s*\{[\s\S]*?color:\s*var\(--ink-faint\)\s*!important;[\s\S]*?font-weight:\s*400\s*!important/);
		expect(styles).toMatch(/\.conversation-item\.active \.conversation-time\s*\{[\s\S]*?color:\s*var\(--ink-soft\)\s*!important/);
	});

	it("coalesces renderer work without changing visual timing or structure", () => {
		expect(app).toContain("function scheduleServerMessageRender()");
		expect(app).toContain("scheduledServerMessageRenderFrame = requestAnimationFrame");
		expect(app).toMatch(/event\.type === "message_update"[\s\S]*?scheduleServerMessageRender\(\)/);
		expect(app).toContain("if (activeChanged)");
		expect(app).not.toContain("conversationTokenTrailAnimationTimer");
		expect(app).not.toContain('context: canvas.getContext("2d")');
		expect(app).not.toContain("conversationTokenTrailAnimationStates");
		expect(styles).toContain("content-visibility: auto");
		expect(styles).toContain("contain-intrinsic-size: auto 38px");
		expect(app).toContain("const stableThroughIndex = hasActiveWork ? currentTurnStart : activeMessages.length - 1");
		expect(app).toContain("existingArticle.metisRenderedMessage === message");
	});

	it("enforces border reduction, 2-tier radius system, and concentric nesting", () => {
		expect(styles).toContain("--radius-lg: 14px;");
		expect(styles).toContain("--radius-md: 10px;");
		expect(styles).toContain("--radius-sm: 8px;");
		expect(styles).toContain("--radius-xs: 6px;");
		expect(styles).toContain("--radius-full: 50%;");
		expect(styles).toMatch(/\[data-purpose="main-chat"\] > header\s*\{[\s\S]*?border-bottom:\s*0\s*!important/);
		expect(styles).toMatch(/\[data-purpose="channel-list"\] > :first-child\s*\{[\s\S]*?border-bottom:\s*0\s*!important/);
		expect(styles).toMatch(/\.primary-button,[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
		expect(styles).toMatch(/\.secondary-button,[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
		expect(styles).toMatch(/\.user-bubble\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*var\(--radius-lg\)/);
		expect(styles).toMatch(/\.turn-files-summary\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?border:\s*0/);
		expect(styles).toMatch(/\.turn-files-summary-header\s*\{[\s\S]*?height:\s*26px;[\s\S]*?border-radius:\s*var\(--radius-sm\);[\s\S]*?background:\s*var\(--surface-soft\)/);
		expect(app).toContain('iconEl.setAttribute("class", "turn-files-summary-icon")');
		expect(styles).toMatch(/\.turn-files-summary-item\s*\{[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
		expect(styles).toMatch(/\.project-switch-capsule\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*var\(--radius-sm\)/);
	});
});
