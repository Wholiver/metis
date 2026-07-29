import { deflateSync } from "node:zlib";

/** Build a Windows .ico that embeds PNG images (Vista+). */
export function createIcoFromPngs(pngImages) {
	if (!Array.isArray(pngImages) || pngImages.length === 0) {
		throw new Error("ICO requires at least one PNG image");
	}

	const headerSize = 6;
	const entrySize = 16;
	const entriesOffset = headerSize + entrySize * pngImages.length;
	let dataOffset = entriesOffset;
	const entries = [];
	const payloads = [];

	for (const image of pngImages) {
		const png = Buffer.isBuffer(image.png) ? image.png : Buffer.from(image.png);
		const width = Number(image.width);
		const height = Number(image.height);
		if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
			throw new Error("ICO PNG entries require positive integer width/height");
		}
		entries.push({
			width: width >= 256 ? 0 : width,
			height: height >= 256 ? 0 : height,
			dataOffset,
			size: png.length,
		});
		payloads.push(png);
		dataOffset += png.length;
	}

	const buffer = Buffer.alloc(dataOffset);
	buffer.writeUInt16LE(0, 0);
	buffer.writeUInt16LE(1, 2);
	buffer.writeUInt16LE(entries.length, 4);

	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const offset = headerSize + entrySize * index;
		buffer.writeUInt8(entry.width, offset);
		buffer.writeUInt8(entry.height, offset + 1);
		buffer.writeUInt8(0, offset + 2);
		buffer.writeUInt8(0, offset + 3);
		buffer.writeUInt16LE(1, offset + 4);
		buffer.writeUInt16LE(32, offset + 6);
		buffer.writeUInt32LE(entry.size, offset + 8);
		buffer.writeUInt32LE(entry.dataOffset, offset + 12);
	}

	let writeAt = entriesOffset;
	for (const png of payloads) {
		png.copy(buffer, writeAt);
		writeAt += png.length;
	}
	return buffer;
}

/** Minimal RGBA PNG encoder for solid filled rectangles (used by tests / fallbacks). */
export function encodeRgbaPng(width, height, rgba) {
	if (rgba.length !== width * height * 4) throw new Error("RGBA buffer size mismatch");
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y += 1) {
		const rowStart = y * (stride + 1);
		raw[rowStart] = 0;
		rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
	}
	const compressed = deflateSync(raw);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	return Buffer.concat([
		signature,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", compressed),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function pngChunk(type, data) {
	const typeBuffer = Buffer.from(type);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
	return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
	let crc = 0xffffffff;
	for (let i = 0; i < buffer.length; i += 1) {
		crc ^= buffer[i];
		for (let bit = 0; bit < 8; bit += 1) {
			const mask = -(crc & 1);
			crc = (crc >>> 1) ^ (0xedb88320 & mask);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}
