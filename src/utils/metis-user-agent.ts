export function getMetisUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `metis/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

/** Backward-compatible name retained for existing callers. */
export const getPiUserAgent = getMetisUserAgent;
