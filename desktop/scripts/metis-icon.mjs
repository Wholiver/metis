import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { createIcoFromPngs } from "./ico-from-png.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const METIS_APP_ICON_SVG_PATH = path.join(
	desktopDir,
	"public",
	"assets",
	"metis-app-icon-centered.svg",
);

export async function renderMetisAppIconPng(size) {
	if (!Number.isInteger(size) || size <= 0) throw new TypeError("Icon size must be a positive integer");
	const svg = await readFile(METIS_APP_ICON_SVG_PATH);
	const rendered = new Resvg(svg, {
		fitTo: { mode: "width", value: size },
	});
	return Buffer.from(rendered.render().asPng());
}

export async function createMetisIco(sizes = [16, 24, 32, 48, 64, 128, 256]) {
	const images = await Promise.all(sizes.map(async (size) => ({
		width: size,
		height: size,
		png: await renderMetisAppIconPng(size),
	})));
	return createIcoFromPngs(images);
}

