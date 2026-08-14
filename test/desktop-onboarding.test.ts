import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const app = readFileSync(resolve(root, "desktop/renderer/app.js"), "utf8");
const html = readFileSync(resolve(root, "desktop/renderer/index.html"), "utf8");
const onboarding = readFileSync(resolve(root, "desktop/renderer/onboarding.js"), "utf8");
const css = readFileSync(resolve(root, "desktop/renderer/styles.css"), "utf8");
const main = readFileSync(resolve(root, "desktop/main.cjs"), "utf8");
const preload = readFileSync(resolve(root, "desktop/preload.cjs"), "utf8");

describe("Desktop fullscreen onboarding", () => {
	it("loads the helper before app.js and keeps one active overlay root", () => {
		expect(html).toMatch(/<script src="onboarding\.js"><\/script>[\s\S]*?<script src="attachments\.js"><\/script>[\s\S]*?<script src="app\.js"><\/script>[\s\S]*?id="onboardingOverlay"/);
		expect(html).toMatch(/id="onboardingOverlay" hidden/);
	});

	it("runs only on first launch and can be restarted from Settings", () => {
		expect(app).toContain('if (!window.MetisOnboarding?.isCompleted())');
		expect(app).toContain('window.MetisOnboarding.start()');
		expect(app).toContain('#settingsShowOnboarding');
		expect(app).toContain('window.MetisOnboarding?.reset()');
		expect(html).toContain('id="settingsShowOnboarding"');
	});

	it("covers greeting, language, provider, and project scenes", () => {
		expect(onboarding).toContain('const STEP_COUNT = 4');
		expect(onboarding).toContain('const unicode = (...codePoints) => String.fromCodePoint(...codePoints)');
		expect(onboarding).toContain('unicode(0x4f60, 0x597d)');
		expect(onboarding).toContain('onboardingLanguageTitle');
		expect(onboarding).toContain('onboardingProviderTitle');
		expect(onboarding).toContain('onboardingWorkspaceTitle');
		expect(onboarding).not.toContain('function illustration(');
		expect(onboarding).toContain('onboarding-scene-heading');
	});

	it("offers API Key, OAuth, and custom Base URL provider setup", () => {
		expect(onboarding).toContain('data-provider-tab="api"');
		expect(onboarding).toContain('data-provider-tab="oauth"');
		expect(onboarding).toContain('data-provider-tab="custom"');
		expect(onboarding).toContain('async function saveOAuthProvider()');
		expect(onboarding).toContain('async function saveCustomProvider()');
		expect(onboarding).toContain('providerConfig?.saveCustom');
	});

	it("keeps provider methods compact with concentric radii and language-sized controls", () => {
		expect(onboarding).toContain('class="onboarding-provider-actions"');
		expect(onboarding).toContain('class="onboarding-provider-inputs"');
		expect(css).toMatch(/\.onboarding-provider-card,[^\{]*\{[^}]*padding:\s*12px[^}]*border-radius:\s*20px/);
		expect(css).toMatch(/\.onboarding-provider-tabs\s*\{[^}]*border-radius:\s*10px/);
		expect(css).toMatch(/\.onboarding-provider-tabs button\s*\{[^}]*min-height:\s*32px[^}]*border-radius:\s*7px/);
		expect(css).toMatch(/\.onboarding-provider-panel\s*\{[^}]*min-height:\s*0/);
		expect(css).toMatch(/\.onboarding-provider-fields :is\(input, select\)\s*\{[^}]*height:\s*36px[^}]*padding:\s*0 12px/);
		expect(css).not.toMatch(/\.onboarding-provider-(?:panel|fields)\s*\{[^}]*height:\s*180px/);
	});

	it("updates language selection in place without rebuilding the scene", () => {
		expect(onboarding).toContain("function updateLanguageSelection(root, language)");
		expect(onboarding).toContain("updateLanguageSelection(root, language);");
		expect(onboarding).not.toMatch(/const language = button\.dataset\.language;[\s\S]{0,240}render\(\);/);
	});

	it("keeps previous and next in one persistent fullscreen navigation rail", () => {
		expect(onboarding).toContain('function navigation()');
		expect(onboarding).toContain('class="onboarding-navigation ${step === 1');
		expect(onboarding).not.toContain('function footer(');
		expect(css).toMatch(/\.onboarding-navigation\s*\{[^}]*position:\s*fixed[^}]*bottom:/);
		expect(css).toMatch(/\.onboarding-navigation\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 136px\)\)[^}]*justify-content:\s*center[^}]*gap:\s*12px/);
		expect(css).toMatch(/\.onboarding-navigation > button\s*\{[^}]*width:\s*136px[^}]*text-align:\s*center/);
	});

	it("centers screen content and keeps the welcome action with its greeting", () => {
		expect(onboarding).toContain('class="onboarding-primary onboarding-welcome-action"');
		expect(onboarding).toContain('onboarding-navigation-hidden');
		expect(css).toMatch(/\.onboarding-stage\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*place-items:\s*center/);
		expect(css).toMatch(/\.onboarding-navigation-hidden\s*\{[^}]*visibility:\s*hidden/);
	});

	it("pins setup titles to one shared row and removes moving artwork", () => {
		expect(css).toMatch(/\.onboarding-setup-screen\s*\{[^}]*grid-template-rows:\s*92px/);
		expect(css).not.toContain(".onboarding-art {");
		expect(onboarding).not.toContain("onboarding-art");
	});

	it("activates selected project into a fresh task only after completion", () => {
		expect(onboarding).toContain('if (selectedWorkspaces.size === 0) return;');
		expect(onboarding).toContain('localStorage.setItem(STORAGE_KEY, "true")');
		expect(onboarding).toContain('window.ensureProject?.(workspace)');
		expect(onboarding).toContain('window.activateProject?.(project, { forceNewConversation: true })');
	});

	it("supports multi-project selection without rebuilding the scene", () => {
		expect(onboarding).toContain("let selectedWorkspaces = new Map()");
		expect(onboarding).toContain("function updateWorkspaceSelection(root)");
		expect(onboarding).toContain("workspace?.selectMany?.()");
		expect(onboarding).not.toMatch(/data-workspace-path[\s\S]{0,800}render\(\);/);
		expect(onboarding).toContain('href="#i-folder"');
		expect(onboarding).toContain('href="#i-check"');
		expect(css).toMatch(/\.onboarding-recent button\.selected\s*\{/);
		expect(preload).toContain('selectMany: () => ipcRenderer.invoke("workspace:select-many")');
		expect(main).toContain('ipcMain.handle("workspace:select-many"');
		expect(main).toContain('properties: ["openDirectory", "multiSelections"]');
	});

	it("uses restrained, reduced-motion-safe fullscreen visual treatment", () => {
		expect(css).toContain('.fullscreen-onboarding');
		expect(css).toContain('@media (prefers-reduced-motion: reduce)');
		expect(css).not.toMatch(/\.onboarding-[^{]+\{[^}]*transition:\s*all/);
		expect(css).toContain('scale: .96');
	});
});
