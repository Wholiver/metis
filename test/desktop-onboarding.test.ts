import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const app = source("desktop/src/App.tsx");
const onboarding = source("desktop/src/components/onboarding/Onboarding.tsx");
const onboardingCss = source("desktop/src/components/onboarding/Onboarding.css");
const settings = source("desktop/src/components/settings/SettingsDialog.tsx");
const main = source("desktop/main.cjs");
const preload = source("desktop/preload.cjs");
const build = source("desktop/scripts/build.mjs");

describe("Desktop React first-run onboarding", () => {
	it("uses a three-step fullscreen flow and preserves legacy completion", () => {
		expect(onboarding).toContain("metis.desktopOnboardingCompleted.v3");
		expect(onboarding).toContain("metis.desktopOnboardingCompleted.v2");
		expect(onboarding).not.toContain("<header");
		expect(onboarding).not.toContain("Configure later in settings");
		expect(onboarding).toContain("step === 1");
		expect(onboarding).toContain("step === 2");
		expect(onboarding).toContain("step === 3");
		expect(onboarding).toContain("localStorage.setItem(COMPLETED_KEY, 'true')");
	});

	it("wires first launch and Settings re-open into active React application state", () => {
		expect(app).toContain("shouldShowOnboarding()");
		expect(app).toContain("setIsOnboardingOpen(true)");
		expect(app).toContain("<Onboarding");
		expect(settings).toContain("onOpenOnboarding");
		expect(settings).toContain('label="Onboarding"');
	});

	it("offers language, API key, OAuth, custom Provider, and safe project choices", () => {
		expect(onboarding).toContain("setUiLanguage");
		expect(onboarding).toContain("window.dispatchEvent(new CustomEvent('metis:language-changed'");
		expect(onboarding).toContain("method === 'api'");
		expect(onboarding).toContain("method === 'oauth'");
		expect(onboarding).toContain("'api' | 'oauth' | 'custom'");
		expect(onboarding).toContain("providerConfig?.discoverModels");
		expect(onboarding).toContain("providerConfig?.saveCustom");
		expect(onboarding).toContain("workspace?.selectParent");
		expect(onboarding).toContain("workspace?.create");
		expect(onboarding).toContain("workspace?.select");
		expect(onboarding).not.toMatch(/localStorage\.(?:getItem|setItem)\([^)]*apiKey/i);
	});

	it("keeps the overlay accessible and motion-reduced without generic transitions", () => {
		expect(onboarding).toContain('max-w-3xl overflow-hidden rounded-xl border');
		expect(onboarding).not.toContain('rounded-[28px]');
		expect(onboarding).not.toContain('min-h-[470px]');
		expect(onboarding).not.toContain('border-t border-slate-100');
		expect(onboarding).toContain('rounded-2xl border border-slate-200 bg-slate-50/70 p-2');
		expect(onboarding).toContain('min-h-10 rounded-xl');
		expect(onboarding).toContain('role="dialog"');
		expect(onboarding).toContain('aria-modal="true"');
		expect(onboarding).toContain('role="tablist"');
		expect(onboardingCss).toContain('prefers-reduced-motion: reduce');
		expect(onboardingCss).not.toContain("transition: all");
	});

	it("exposes narrowly scoped native workspace creation APIs", () => {
		expect(preload).toContain('selectParent: () => ipcRenderer.invoke("workspace:select-parent")');
		expect(preload).toContain('create: (input) => ipcRenderer.invoke("workspace:create", input)');
		expect(main).toContain('ipcMain.handle("workspace:select-parent"');
		expect(main).toContain('ipcMain.handle("workspace:create"');
		expect(main).toContain("createWorkspaceDirectory(input?.parentPath, input?.name)");
		expect(build).toContain('"workspace-create.cjs"');
	});
});
