import { compare, valid } from "semver";
import { getMetisUserAgent } from "./metis-user-agent.ts";

const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export type ReleaseManifestSourceId = "github" | "custom";

export interface ReleaseManifestSource {
	id: ReleaseManifestSourceId;
	url: string;
}

/**
 * The version manifest is hosted on GitHub. METIS_VERSION_MANIFEST_URLS can
 * replace this with one or more alternate URLs (e.g. a private mirror); when
 * several are configured they are requested concurrently and the first valid
 * manifest wins, with the remaining requests aborted.
 */
export const RELEASE_MANIFEST_SOURCES: ReadonlyArray<ReleaseManifestSource> = [
	{ id: "github", url: "https://raw.githubusercontent.com/Wholiver/metis-check-update/main/latest-version.json" },
];

export interface LatestMetisRelease {
	version: string;
	packageName?: string;
	note?: string;
	/** Source that produced this manifest. Diagnostic only; callers may ignore it. */
	source?: ReleaseManifestSourceId;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

/** Parse a raw manifest payload. Returns undefined when the payload is unusable. */
export function parseReleaseManifest(data: unknown): LatestMetisRelease | undefined {
	if (typeof data !== "object" || data === null) {
		return undefined;
	}
	const manifest = data as { packageName?: unknown; version?: unknown; note?: unknown };
	if (typeof manifest.version !== "string" || !manifest.version.trim()) {
		return undefined;
	}
	const packageName =
		typeof manifest.packageName === "string" && manifest.packageName.trim() ? manifest.packageName.trim() : undefined;
	const note = typeof manifest.note === "string" && manifest.note.trim() ? manifest.note.trim() : undefined;
	return {
		version: manifest.version.trim(),
		...(packageName ? { packageName } : {}),
		...(note ? { note } : {}),
	};
}

/**
 * Override the manifest source list with a comma-separated URL list. Intended for
 * private mirrors and local testing; invalid entries fall back to the built-in source.
 */
export function resolveManifestSources(): ReadonlyArray<ReleaseManifestSource> {
	const configured = process.env.METIS_VERSION_MANIFEST_URLS?.trim();
	if (!configured) {
		return RELEASE_MANIFEST_SOURCES;
	}
	const sources: ReleaseManifestSource[] = [];
	for (const entry of configured.split(",")) {
		const url = entry.trim();
		if (!url) continue;
		try {
			new URL(url);
		} catch {
			continue;
		}
		sources.push({ id: "custom", url });
	}
	return sources.length > 0 ? sources : RELEASE_MANIFEST_SOURCES;
}

async function fetchReleaseManifest(
	source: ReleaseManifestSource,
	currentVersion: string,
	signal: AbortSignal,
): Promise<LatestMetisRelease> {
	const response = await fetch(source.url, {
		headers: {
			"User-Agent": getMetisUserAgent(currentVersion),
			accept: "application/json",
			"cache-control": "no-cache",
		},
		signal,
	});
	if (!response.ok) {
		throw new Error(`${source.id} manifest request failed with status ${response.status}`);
	}
	// Raw file hosts do not reliably send a JSON content type, so parse the body
	// text directly instead of relying on response.json().
	const manifest = parseReleaseManifest(JSON.parse(await response.text()));
	if (!manifest) {
		throw new Error(`${source.id} manifest is missing a usable version`);
	}
	return { ...manifest, source: source.id };
}

export async function getLatestMetisRelease(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<LatestMetisRelease | undefined> {
	if (process.env.METIS_SKIP_VERSION_CHECK || process.env.METIS_OFFLINE) return undefined;

	const sources = resolveManifestSources();
	const controller = new AbortController();
	const signal = AbortSignal.any([
		controller.signal,
		AbortSignal.timeout(options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS),
	]);
	try {
		return await Promise.any(sources.map((source) => fetchReleaseManifest(source, currentVersion, signal)));
	} catch {
		// Every source failed (offline, blocked, malformed manifest). Treat this the
		// same as "no update information available".
		return undefined;
	} finally {
		// Cancel any source that lost the race, and release the timeout timer.
		controller.abort();
	}
}

export async function getLatestMetisVersion(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
	return (await getLatestMetisRelease(currentVersion, options))?.version;
}

export async function checkForNewMetisVersion(currentVersion: string): Promise<LatestMetisRelease | undefined> {
	try {
		const latestRelease = await getLatestMetisRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

