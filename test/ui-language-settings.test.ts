import { describe, expect, it } from "vitest";
import {
	SettingsManager,
	type SettingsScope,
	type SettingsStorage,
} from "../src/core/settings-manager.ts";

class MemorySettingsStorage implements SettingsStorage {
	global: string | undefined;
	project: string | undefined;

	constructor(global?: unknown, project?: unknown) {
		this.global = global === undefined ? undefined : JSON.stringify(global);
		this.project = project === undefined ? undefined : JSON.stringify(project);
	}

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		if (scope === "global") this.global = fn(this.global);
		else this.project = fn(this.project);
	}
}

describe("SettingsManager UI language", () => {
	it("defaults invalid or missing values to auto", () => {
		expect(SettingsManager.fromStorage(new MemorySettingsStorage()).getUiLanguage()).toBe("auto");
		expect(SettingsManager.fromStorage(new MemorySettingsStorage({ uiLanguage: "ar" })).getUiLanguage()).toBe("auto");
	});

	it("persists the preference globally", async () => {
		const storage = new MemorySettingsStorage({ theme: "dark" });
		const manager = SettingsManager.fromStorage(storage);
		manager.setUiLanguage("ja");
		await manager.flush();
		expect(JSON.parse(storage.global ?? "{}")).toMatchObject({ uiLanguage: "ja" });
	});

	it("does not allow project settings to override the global preference", () => {
		const storage = new MemorySettingsStorage({ uiLanguage: "fr" }, { uiLanguage: "ja" });
		expect(SettingsManager.fromStorage(storage).getUiLanguage()).toBe("fr");
	});
});
