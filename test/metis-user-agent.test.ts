import { describe, expect, it } from "vitest";
import { getMetisUserAgent } from "../src/utils/metis-user-agent.ts";

describe("getMetisUserAgent", () => {
	it("formats the user agent expected by metis.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getMetisUserAgent("1.2.3");

		expect(userAgent).toBe(`metis/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^metis\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});

