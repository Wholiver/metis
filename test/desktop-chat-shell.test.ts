import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererPath = resolve(process.cwd(), "desktop/renderer");
const rendererHtml = readFileSync(resolve(rendererPath, "index.html"), "utf8");
const activeHtml = rendererHtml
	.replace(/<!--[\s\S]*?-->/g, "");
const activeMainHtml = activeHtml.match(/<main(?=[^>]*data-purpose="main-chat")[\s\S]*?<\/main>/)?.[0] || "";
const appSource = readFileSync(resolve(rendererPath, "app.js"), "utf8");
const cssSource = readFileSync(resolve(rendererPath, "styles.css"), "utf8");
const desktopMainSource = readFileSync(resolve(process.cwd(), "desktop/main.cjs"), "utf8");
const desktopPackage = JSON.parse(readFileSync(resolve(process.cwd(), "desktop/package.json"), "utf8"));

function liveIdCount(id: string) {
	return (activeHtml.match(new RegExp(`\\bid=["']${id}["']`, "g")) || []).length;
}

describe("desktop active chat shell contracts", () => {
	it("keeps conversations ordered by creation time when switching", () => {
		expect(appSource).toContain("sortConversationsByCreatedAt(project.conversations)");
		expect(appSource).not.toContain("project.conversations.unshift(conversation)");
	});

	it("uses conversation title in composer and a distinct prompt for new tasks", () => {
		expect(activeMainHtml).toMatch(/data-purpose="message-input"[^>]*data-i18n-placeholder="composerPlaceholder"/);
		expect(appSource).toMatch(/function updateComposerPlaceholder\(title, isGenerating = false\)/);
		expect(appSource).toMatch(/hasConversationTitle[\s\S]*?\? title\.trim\(\)[\s\S]*?: `\$\{uiText\("newTask"\)\} · \$\{uiText\("composerPlaceholder"\)\}`/);
		expect(appSource).toMatch(/for \(const input of document\.querySelectorAll\('\[data-purpose="message-input"\]'\)\)/);
	});

	it("keeps one live renderer target inside the Stitch three-column shell without legacy layout hooks", () => {
		expect(activeHtml).toMatch(/id="projectList"/);
		expect(activeHtml).toMatch(/id="conversationList"/);
		expect(activeMainHtml).toMatch(/<main[^>]*data-purpose="main-chat"/);
		expect(activeMainHtml).toMatch(/id="messageScroll"/);
		expect(activeMainHtml).toMatch(/data-purpose="composer-stack"/);
		expect(activeMainHtml).toMatch(/id="composer"/);
		expect(activeMainHtml).toMatch(/data-purpose="composer-controls"/);
		expect(activeMainHtml).toMatch(/data-purpose="composer-submit"/);
		for (const legacyClass of ["conversation-pane", "topbar", "message-scroll", "composer-wrap", "composer-bottom", "composer-submit"]) {
			expect(activeMainHtml).not.toMatch(new RegExp(`class=["'][^"']*${legacyClass}`));
		}
		for (const id of [
			"messageScroll", "messageColumn", "emptyState", "composer", "composerInput",
			"modelPicker", "modelTrigger", "modelOptions", "sendButton", "sendButtonIcon",
		]) {
			expect(liveIdCount(id), id).toBe(1);
		}
		expect(liveIdCount("runState")).toBe(0);
		expect(liveIdCount("dreamCard")).toBe(0);
		expect(activeHtml).not.toContain("run-state");
		expect(cssSource).not.toMatch(/\.run-state|\.pulse-dot/);
		expect(appSource).not.toContain("elements.runState");
		expect(appSource).toMatch(/function setStreamingState\(active\)/);
		expect(appSource).not.toContain("humanizeEvent");
		expect(appSource).toContain("document.querySelector('[data-purpose=\"main-chat\"]')");
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #messageScroll\s*\{[\s\S]*?flex:\s*1 1 0%/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #messageColumn\s*\{[\s\S]*?width:\s*min\(calc\(100% - 72px\), 680px\)/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] \[data-purpose="composer-stack"\]\s*\{[\s\S]*?flex:\s*0 0 auto/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #composer\s*\{[\s\S]*?width:\s*min\(calc\(100% - 72px\), 680px\)/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #modelPicker,[\s\S]*?#composer\s*\{[\s\S]*?overflow:\s*visible/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #composerDropFeedback\s*\{[\s\S]*?display:\s*none[\s\S]*?opacity:\s*0/);
		expect(cssSource).toMatch(/#composer\.is-dragging-attachments #composerDropFeedback\s*\{[\s\S]*?display:\s*flex[\s\S]*?opacity:\s*1/);
		expect(cssSource).toMatch(/#composer\.attachment-added\s*\{[\s\S]*?composer-attachment-pulse/);
		expect(activeMainHtml).toMatch(/id="attachButton"[^>]*>[\s\S]*?<i class="[^"]*fa-paperclip/);
		expect(cssSource).toMatch(/#composer\.is-attaching #attachButton :is\(i, svg\)\s*\{[\s\S]*?attachment-button-spin/);
		expect(activeMainHtml).not.toContain('id="subagentDock"');
		expect(appSource).not.toContain("renderSubagentDock");
	});

	it("uses local active-shell geometry and a strict local-script CSP", () => {
		const csp = rendererHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] || "";
		expect(rendererHtml).not.toContain("cdn.tailwindcss.com");
		expect(csp).toContain("script-src 'self'");
		expect(csp).not.toMatch(/script-src[^;]*(https:|'unsafe-inline'|'unsafe-eval')/);
		expect(csp).toContain("https://cdnjs.cloudflare.com");
		expect(csp).toContain("https://fonts.googleapis.com");
		expect(csp).toContain("https://fonts.gstatic.com");
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] > header\s*\{[\s\S]*?display:\s*flex[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*space-between/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #messageScroll\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] \[data-purpose="composer-controls"\]\s*\{[\s\S]*?display:\s*flex[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*space-between/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #composerInput\s*\{[\s\S]*?field-sizing:\s*content[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*48px[\s\S]*?max-height:\s*200px[\s\S]*?overflow-y:\s*auto/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\] #(attachButton|sendButton),[\s\S]*?#(attachButton|sendButton)\s*\{[\s\S]*?display:\s*grid[\s\S]*?place-items:\s*center/);
		expect(cssSource).toMatch(/\[data-purpose="icon-sidebar"\]\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/);
		expect(cssSource).toMatch(/\[data-purpose="icon-sidebar"\]\s*\{[\s\S]*?background:\s*transparent\s*!important/);
		expect(cssSource).toMatch(/\[data-purpose="channel-list"\]\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/);
		expect(activeHtml).toMatch(/id="iconSidebarWorkspace"/);
		expect(activeHtml).toMatch(/id="iconSidebarAddProject"/);
		expect(cssSource).toMatch(/#iconSidebarWorkspace,[\s\S]*?#iconSidebarAddProject\s*\{[\s\S]*?width:\s*40px[\s\S]*?height:\s*40px[\s\S]*?place-items:\s*center/);
		expect(cssSource).toMatch(/#iconSidebarWorkspace > svg\s*\{[\s\S]*?width:\s*32px[\s\S]*?height:\s*32px/);
		expect(cssSource).toMatch(/\[data-purpose="icon-sidebar"\] > :nth-child\(2\),[\s\S]*?> :last-child > :first-child\s*\{[\s\S]*?width:\s*32px[\s\S]*?height:\s*1px/);
		expect(cssSource).toMatch(/\[data-purpose="channel-list"\]\s*\{[\s\S]*?border:\s*1px solid #f3f4f6[\s\S]*?border-radius:\s*12px 12px 0 0[\s\S]*?box-shadow/);
		expect(cssSource).toMatch(/\[data-purpose="main-chat"\]\s*\{[\s\S]*?border:\s*1px solid #f3f4f6[\s\S]*?border-radius:\s*12px 12px 0 0[\s\S]*?box-shadow/);
		expect(appSource).toMatch(/function autoSizeComposer\(\) \{[\s\S]*?CSS\.supports\?\.\("field-sizing", "content"\)[\s\S]*?input\.style\.height = `\$\{height\}px`/);
	});

	it("keeps first-prompt persistence and generated titles attached to the active project", () => {
		expect(appSource).toContain("async function alignNewConversationWithActiveProject()");
		expect(appSource).toMatch(/await requestServer\("\/session\/new", "POST", \{[\s\S]*?cwd: project\.path,[\s\S]*?collaborationMode: "plan"/);
		expect(appSource).toMatch(/if \(wasNewConversation && !shouldQueue\) \{[\s\S]*?syncServerSession\(\{ loadModels: false, refreshConversations: false \}\)/);
		expect(appSource).toMatch(/event\.type === "session_name_generation"[\s\S]*?event\.status === "completed"[\s\S]*?state\.session\.sessionName = event\.name\.trim\(\)/);
	});

	it("keeps cached history when a server refresh temporarily fails", () => {
		expect(appSource).toMatch(/if \(!Array\.isArray\(result\?\.sessions\)\) throw new Error/);
		expect(appSource).toMatch(/async function refreshAllProjectConversations\(\)[\s\S]*?catch \(error\) \{\s*project\.conversationLoadError = error\.message;/);
		expect(appSource).not.toMatch(/async function refreshAllProjectConversations\(\)[\s\S]*?catch \(error\) \{\s*project\.conversations = \[\]/);
	});

	it("opens projects in a new task while preserving explicit history selection", () => {
		expect(appSource).toMatch(/async function activateProject\([\s\S]*?forceNewConversation = true,[\s\S]*?syncSession = true,/);
		expect(appSource).toMatch(/async function selectConversation\([\s\S]*?activateProject\(project, \{[\s\S]*?targetSessionPath: conversation\.sessionPath,[\s\S]*?forceNewConversation: false,/);
		expect(appSource).toMatch(/if \(forceNewConversation\) \{\s*await requestServer\("\/session\/new", "POST", \{ cwd: project\.path, collaborationMode: "plan" \}\);\s*\} else \{\s*const destination = targetSessionPath[\s\S]*?project\.lastSessionPath[\s\S]*?project\.conversations\[0\]\?\.sessionPath/);
		expect(appSource).toMatch(/if \(forceNewConversation\) \{[\s\S]*?state\.messages = \[\];[\s\S]*?renderEmptyState\(true\);[\s\S]*?const currentSession/);
		expect(appSource).toMatch(/if \(destination && destination !== currentSession\.sessionFile\) \{\s*await requestServer\("\/session\/switch", "POST", \{ sessionPath: destination \}\);\s*\} else if \(!destination \|\| currentCwd !== project\.path\) \{\s*await requestServer\("\/session\/new", "POST", \{ cwd: project\.path, collaborationMode: "plan" \}\);/);
		expect(appSource).toMatch(/await syncServerSession\(\{ loadModels, refreshConversations: false \}\);/);
	});

	it("keeps startup loading visible until the new project task is ready", () => {
		expect(activeHtml).toMatch(/class="server-loading" id="serverLoading"/);
		expect(activeHtml).toMatch(/class="server-loading-mark"[\s\S]*?assets\/metis-pixel-mark\.svg/);
		expect(cssSource).toMatch(/\.server-loading-progress span\s*\{[\s\S]*?animation:\s*server-loading-sweep/);
		expect(appSource).toMatch(/if \(autoConnectServerRequest\) return autoConnectServerRequest;[\s\S]*?autoConnectServerRequest = performAutoConnectServer\(\)/);
		expect(appSource).toMatch(/if \(result\.ok\) \{[\s\S]*?await activateProject\(project,[\s\S]*?await refreshAllProjectConversations\(\);\s*finishServerLoading\(\);/);
	});

	it("uses independent loading planes for project and conversation switches", () => {
		expect(activeHtml).toMatch(/id="conversationListLoading"[^>]*aria-hidden="true"/);
		expect(activeMainHtml).toMatch(/id="conversationViewLoading"[^>]*aria-hidden="true"/);
		expect(appSource).toContain("function beginScopedLoading(overlay, host, labelElement, label)");
		expect(appSource).toMatch(/async function selectConversation[\s\S]*?beginScopedLoading\([\s\S]*?elements\.conversationViewLoading[\s\S]*?finishConversationLoading\(\)/);
		expect(appSource).toMatch(/async function activateProject[\s\S]*?beginScopedLoading\([\s\S]*?elements\.conversationListLoading[\s\S]*?finishProjectLoading\(\)/);
		expect(appSource).not.toMatch(/setStreamingState\(true, uiText\("switching(?:Session|Project)"\)\)/);
		expect(cssSource).toMatch(/\.scoped-loading-conversations\s*\{[\s\S]*?inset:\s*56px 0 0/);
		expect(cssSource).toMatch(/\.scoped-loading-conversation-view\s*\{[\s\S]*?inset:\s*56px 0 0/);
		expect(cssSource).toMatch(/\.scoped-loading\s*\{[\s\S]*?transition-property:\s*opacity, visibility/);
		expect(cssSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.scoped-loading-content img/);
	});

	it("renders workflow mode, current plan, and instruction provenance without raw runtime internals", () => {
		for (const id of ["workflowPicker", "workflowTrigger", "workflowMenu", "workflowPlanCard", "workflowPlanToggle", "instructionSources"]) {
			expect(liveIdCount(id), id).toBe(1);
		}
		expect(activeMainHtml).toMatch(/id="workflowTrigger"[^>]*aria-haspopup="menu"/);
		expect(activeMainHtml).toMatch(/id="modelPicker"[\s\S]*?id="workflowPicker"/);
		expect(activeMainHtml.indexOf('id="workflowPicker"')).toBeGreaterThan(activeMainHtml.indexOf('id="modelPicker"'));
		expect(appSource).toContain('requestServer("/session/collaboration-mode", "PUT", { mode })');
		expect(appSource).toMatch(/event\.type === "collaboration_mode_changed"[\s\S]*?renderWorkflowControls\(\);[\s\S]*?renderWorkflowPlanCard\(\);[\s\S]*?updateProposedPlanControls\(\)/);
		expect(appSource).toMatch(/event\.entry\.customType === "workflow_plan"[\s\S]*?renderWorkflowPlanCard/);
		expect(appSource).toContain('const isPlanMode = state.session?.collaborationMode === "plan"');
		expect(appSource).toContain('if (isPlanMode || !workflowPlan)');
		expect(appSource).toContain('workflowAction: "process_proposal"');
		expect(appSource).not.toContain('workflow-plan-proposal-body');
		expect(appSource).toContain('"workflow_plan", "workflow_plan_reset"');
		expect(appSource).toContain('const visibleWorkItems = workItems\n\t\t.map((part, sourceIndex) => ({ part, sourceIndex }))');
		expect(appSource).toContain('if (!itemEl) continue;');
		expect(appSource).toContain('workflowPlanInterrupted');
		expect(appSource).toMatch(/await requestServer\("\/session\/abort", "POST", \{\}\);[\s\S]*?await syncServerSession\(\{ loadModels: false, refreshConversations: false \}\)/);
		expect(appSource).toMatch(/cot-thoughts-group\$\{thoughtIsActive \? "" : " collapsed"\}/);
		expect(appSource).toContain('itemEl.classList.toggle("collapsed", !thoughtIsActive)');
		expect(appSource).toMatch(/part\.name === "update_plan"\) return null/);
		expect(appSource).not.toContain("semanticHash");
		expect(cssSource).toMatch(/\.workflow-trigger\s*\{[\s\S]*?min-height:\s*32px/);
		expect(activeMainHtml).toContain('class="workflow-picker open plan" id="workflowPicker"');
		expect(activeMainHtml).toContain('id="workflowMenu" role="menu" aria-hidden="false"');
		expect(appSource).toContain('elements.workflowPicker.classList.add("open")');
		expect(appSource).toContain("option.disabled = !connected || busy");
		expect(cssSource).toMatch(/\.workflow-menu\s*\{[\s\S]*?display:\s*flex/);
		expect(cssSource).toMatch(/\.workflow-trigger:focus-visible[\s\S]*?box-shadow/);
		expect(cssSource).toMatch(/\.workflow-plan-card\s*\{/);
		expect(cssSource).toMatch(/\.workflow-plan-card\s*\{[\s\S]*?background:\s*var\(--surface-raised\)/);
		expect(cssSource).not.toContain(".workflow-plan-proposal");
		expect(cssSource).toMatch(/\.model-picker\s*\{[\s\S]*?position:\s*relative\s*!important/);
		expect(cssSource).toMatch(/\.model-menu\s*\{[\s\S]*?position:\s*absolute\s*!important;[\s\S]*?bottom:\s*calc\(100% \+ 10px\)\s*!important/);
		expect(appSource).toContain('elements.modelMenu.style.setProperty("--model-menu-shift-x"');
		expect(appSource).not.toContain('elements.modelMenu.style.setProperty("--model-menu-top"');
		expect(appSource).toContain("function renderAssistantText(target, text)");
		expect(appSource).toContain('proposed-plan-card${wasExpanded ? " expanded" : ""}');
		expect(appSource).toContain('const isFirstPlanRender = !target.classList.contains("has-proposed-plan")');
		expect(appSource).toContain('" is-reformatting"');
		expect(appSource).toContain('card.classList.remove("is-reformatting")');
		expect(appSource).toContain('target.dataset.proposedPlanExpanded = String(expanded)');
		expect(appSource).toContain('label.className = "proposed-plan-label"');
		expect(appSource).toContain("<use href=\"#i-list\"/>");
		expect(appSource).toContain('actions.className = "proposed-plan-actions"');
		expect(appSource).toContain("card.append(header, body, actions)");
		expect(appSource).toContain('await changeCollaborationMode("build")');
		expect(appSource).toContain('elements.composerInput.value = uiText("proposedPlanProcessPrompt")');
		expect(appSource).toContain("const turnIsStreaming = Boolean(state.isStreaming && turnContext.isCurrentTurn)");
		expect(appSource).toMatch(/optimisticUserMessage = \{[\s\S]*?role: "user"[\s\S]*?state\.messages\.push\(optimisticUserMessage\);[\s\S]*?renderServerMessages\(state\.messages\);/);
		expect(cssSource).toMatch(/\.proposed-plan-card\.is-reformatting\s*\{[\s\S]*?filter:\s*blur\(4px\)/);
		expect(cssSource).toMatch(/\.proposed-plan-card\.is-reformatting \.proposed-plan-body\s*\{[\s\S]*?max-height:\s*0/);
		expect(cssSource).toMatch(/\.proposed-plan-body\s*\{[\s\S]*?max-height:\s*144px/);
		expect(cssSource).toMatch(/\.proposed-plan-process\s*\{[\s\S]*?min-height:\s*32px/);
		expect(cssSource).toMatch(/\.proposed-plan-process::before\s*\{[\s\S]*?inset:\s*-4px 0/);
		expect(cssSource).not.toContain(".proposed-plan-process:active:not(:disabled)");
		expect(cssSource).not.toMatch(/\.proposed-plan-header\s*\{[^}]*border-bottom/);
		expect(cssSource).not.toMatch(/\.proposed-plan-header::after\s*\{/);
	});

	it("builds the repository CLI before development startup and auto-starts its local server", () => {
		expect(desktopPackage.scripts["prepare:cli"]).toBe("npm --prefix .. run build");
		expect(desktopPackage.scripts.predev).toBe("npm run prepare:cli");
		expect(desktopPackage.scripts.prestart).toBe("npm run prepare:cli");
		expect(desktopMainSource).toContain("void ensureLocalMetisServer()");
		expect(desktopMainSource).toContain('utilityProcess.fork(cliPath, ["server", "--hostname", "127.0.0.1", "--port", "4096"]');
	});
});

