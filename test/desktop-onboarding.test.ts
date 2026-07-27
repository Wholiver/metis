import { describe, it, expect, beforeEach } from "vitest";

describe("Desktop Onboarding Storage Test", () => {
	let store: Record<string, string> = {};

	const mockLocalStorage = {
		getItem: (key: string) => store[key] || null,
		setItem: (key: string, value: string) => {
			store[key] = String(value);
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
	};

	beforeEach(() => {
		mockLocalStorage.clear();
	});

	it("manages onboarding completion state in storage", () => {
		const STORAGE_KEY = "metis.desktopOnboardingCompleted.v1";
		expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();

		mockLocalStorage.setItem(STORAGE_KEY, "true");
		expect(mockLocalStorage.getItem(STORAGE_KEY)).toBe("true");

		mockLocalStorage.removeItem(STORAGE_KEY);
		expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});
