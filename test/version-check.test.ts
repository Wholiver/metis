import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewMetisVersion,
	comparePackageVersions,
	getLatestMetisRelease,
	getLatestMetisVersion,
	isNewerPackageVersion,
	parseReleaseManifest,
	RELEASE_MANIFEST_SOURCES,
	resolveManifestSources,
} from "../src/utils/version-check.ts";

const GITHUB_URL = "https://raw.githubusercontent.com/Wholiver/metis-check-update/main/latest-version.json";
const MIRROR_A = "https://mirror.test/a.json";
const MIRROR_B = "https://mirror.test/b.json";

const originalSkipVersionCheck = process.env.METIS_SKIP_VERSION_CHECK;
const originalOffline = process.env.METIS_OFFLINE;
const originalManifestUrls = process.env.METIS_VERSION_MANIFEST_URLS;

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}

/** Respond per URL. A handler may throw or return a Response. */
function stubMirrors(handlers: Record<string, () => Promise<Response> | Response>) {
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const handler = handlers[url];
		if (!handler) throw new Error(`unexpected fetch: ${url}`);
		init?.signal?.throwIfAborted();
		return await handler();
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function manifestResponse(body: unknown, contentType = "text/plain"): Response {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status: 200,
		headers: { "content-type": contentType },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	restoreEnv("METIS_SKIP_VERSION_CHECK", originalSkipVersionCheck);
	restoreEnv("METIS_OFFLINE", originalOffline);
	restoreEnv("METIS_VERSION_MANIFEST_URLS", originalManifestUrls);
});

describe("version comparison", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});
});

describe("manifest parsing", () => {
	it("keeps optional metadata and drops blank fields", () => {
		expect(parseReleaseManifest({ version: " 1.2.4 ", packageName: " @new-scope/metis ", note: " **Read this** " })).toEqual({
			version: "1.2.4",
			packageName: "@new-scope/metis",
			note: "**Read this**",
		});
		expect(parseReleaseManifest({ version: "1.2.4", packageName: "  ", note: "  " })).toEqual({ version: "1.2.4" });
	});

	it("rejects payloads without a usable version", () => {
		expect(parseReleaseManifest({ version: "  " })).toBeUndefined();
		expect(parseReleaseManifest({ version: 12 })).toBeUndefined();
		expect(parseReleaseManifest(null)).toBeUndefined();
		expect(parseReleaseManifest("1.2.4")).toBeUndefined();
	});
});

describe("manifest sources", () => {
	it("defaults to the GitHub manifest", () => {
		expect(RELEASE_MANIFEST_SOURCES.map((source) => source.url)).toEqual([GITHUB_URL]);
		expect(RELEASE_MANIFEST_SOURCES.map((source) => source.id)).toEqual(["github"]);
		expect(resolveManifestSources()).toBe(RELEASE_MANIFEST_SOURCES);
	});

	it("honours METIS_VERSION_MANIFEST_URLS and ignores invalid entries", () => {
		process.env.METIS_VERSION_MANIFEST_URLS = ` ${MIRROR_A} , not-a-url , ${MIRROR_B} `;
		expect(resolveManifestSources()).toEqual([
			{ id: "custom", url: MIRROR_A },
			{ id: "custom", url: MIRROR_B },
		]);
	});

	it("falls back to the default when the override has no valid URL", () => {
		process.env.METIS_VERSION_MANIFEST_URLS = "not-a-url, also-bad";
		expect(resolveManifestSources()).toBe(RELEASE_MANIFEST_SOURCES);
	});
});

describe("release lookup", () => {
	it("queries the GitHub manifest with a metis user agent", async () => {
		const fetchMock = stubMirrors({
			[GITHUB_URL]: () => manifestResponse({ version: "1.2.4" }),
		});

		await expect(getLatestMetisVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			GITHUB_URL,
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^metis\/1\.2\.3 /),
					accept: "application/json",
				}),
			}),
		);
	});

	it("reports the source and optional metadata", async () => {
		stubMirrors({
			[GITHUB_URL]: () => manifestResponse({ packageName: "@new-scope/metis", version: "1.2.4", note: "Upgrade now" }),
		});

		await expect(getLatestMetisRelease("1.2.3")).resolves.toEqual({
			packageName: "@new-scope/metis",
			version: "1.2.4",
			note: "Upgrade now",
			source: "github",
		});
	});

	it("returns undefined when the manifest responds with an error status", async () => {
		stubMirrors({ [GITHUB_URL]: () => new Response("not found", { status: 404 }) });

		await expect(getLatestMetisRelease("1.2.3")).resolves.toBeUndefined();
	});

	it("treats malformed or incomplete manifests as failures", async () => {
		stubMirrors({ [GITHUB_URL]: () => manifestResponse("<html>blocked</html>") });
		await expect(getLatestMetisRelease("1.2.3")).resolves.toBeUndefined();

		vi.unstubAllGlobals();
		stubMirrors({ [GITHUB_URL]: () => manifestResponse({ note: "no version here" }) });
		await expect(getLatestMetisRelease("1.2.3")).resolves.toBeUndefined();
	});

	it("returns undefined and never throws when the request fails", async () => {
		stubMirrors({
			[GITHUB_URL]: () => {
				throw new Error("ENOTFOUND");
			},
		});

		await expect(getLatestMetisRelease("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewMetisVersion("1.2.3")).resolves.toBeUndefined();
	});

	it("races configured mirrors and aborts the losers", async () => {
		process.env.METIS_VERSION_MANIFEST_URLS = `${MIRROR_A},${MIRROR_B}`;
		let slowAborted = false;
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (url === MIRROR_B) return manifestResponse({ version: "1.2.4" });
			return await new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					slowAborted = true;
					reject(new Error("aborted"));
				});
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestMetisRelease("1.2.3")).resolves.toEqual({ version: "1.2.4", source: "custom" });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(slowAborted).toBe(true);
	});

	it("returns only newer versions", async () => {
		stubMirrors({ [GITHUB_URL]: () => manifestResponse({ version: "1.2.3" }) });

		await expect(checkForNewMetisVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewMetisVersion("1.2.2")).resolves.toMatchObject({ version: "1.2.3" });
	});

	it("skips network calls when version checks are disabled", async () => {
		process.env.METIS_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestMetisVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips network calls in offline mode", async () => {
		process.env.METIS_OFFLINE = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestMetisVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
