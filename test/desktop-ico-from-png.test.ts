import { describe, expect, it } from "vitest";
import { createIcoFromPngs, encodeRgbaPng } from "../desktop/scripts/ico-from-png.mjs";
import { createMetisIco, renderMetisAppIconPng } from "../desktop/scripts/metis-icon.mjs";

describe("createIcoFromPngs", () => {
	it("embeds PNG payloads in a valid ICO header", () => {
		const rgba = Buffer.alloc(16 * 16 * 4, 0xff);
		const png = encodeRgbaPng(16, 16, rgba);
		const ico = createIcoFromPngs([{ width: 16, height: 16, png }]);
		expect(ico.readUInt16LE(0)).toBe(0);
		expect(ico.readUInt16LE(2)).toBe(1);
		expect(ico.readUInt16LE(4)).toBe(1);
		expect(ico.readUInt32LE(14)).toBe(png.length);
		expect(ico.readUInt32LE(18)).toBe(22);
		expect(ico.subarray(22, 22 + png.length)).toEqual(png);
	});
});

describe("createMetisIco", () => {
	it("renders the canonical app icon and embeds a multi-size ICO", async () => {
		const png = await renderMetisAppIconPng(32);
		expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		const ico = await createMetisIco([16, 32]);
		expect(ico.readUInt16LE(4)).toBe(2);
		expect(ico.length).toBeGreaterThan(100);
	});
});
