import { createIcoFromPngs, encodeRgbaPng } from "./ico-from-png.mjs";

/**
 * Rasterize the Metis pixel-mark path into an RGBA buffer.
 * Path: M180 171h40v37h24v38h24v-38h24v-37h40v153h-40v-78h-24v39h-24v-39h-24v78h-40z
 * viewBox: 160 151 192 193
 */
const VIEW_X = 160;
const VIEW_Y = 151;
const VIEW_W = 192;
const VIEW_H = 193;
const FILL = { r: 0x11, g: 0x17, b: 0x13, a: 0xff };

/** Axis-aligned rectangles that compose the M glyph in viewBox units. */
const MARK_RECTS = [
	[180, 171, 40, 153],
	[220, 208, 24, 38],
	[244, 246, 24, 39],
	[268, 208, 24, 38],
	[292, 171, 40, 153],
];

function fillRect(rgba, size, x0, y0, x1, y1, color) {
	const left = Math.max(0, Math.floor(x0));
	const top = Math.max(0, Math.floor(y0));
	const right = Math.min(size, Math.ceil(x1));
	const bottom = Math.min(size, Math.ceil(y1));
	for (let y = top; y < bottom; y += 1) {
		for (let x = left; x < right; x += 1) {
			const index = (y * size + x) * 4;
			rgba[index] = color.r;
			rgba[index + 1] = color.g;
			rgba[index + 2] = color.b;
			rgba[index + 3] = color.a;
		}
	}
}

export function renderMetisMarkPng(size) {
	const rgba = Buffer.alloc(size * size * 4, 0);
	const scaleX = size / VIEW_W;
	const scaleY = size / VIEW_H;
	for (const [x, y, w, h] of MARK_RECTS) {
		const x0 = (x - VIEW_X) * scaleX;
		const y0 = (y - VIEW_Y) * scaleY;
		const x1 = (x + w - VIEW_X) * scaleX;
		const y1 = (y + h - VIEW_Y) * scaleY;
		fillRect(rgba, size, x0, y0, x1, y1, FILL);
	}
	return encodeRgbaPng(size, size, rgba);
}

export function createMetisIco(sizes = [16, 24, 32, 48, 64, 128, 256]) {
	return createIcoFromPngs(sizes.map((size) => ({ width: size, height: size, png: renderMetisMarkPng(size) })));
}
