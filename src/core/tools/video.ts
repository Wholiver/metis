import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentTool } from "@earendil-works/metis-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/metis-ai";
import { Text } from "@earendil-works/metis-tui";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "@derhuerst/ffprobe-static";
import { type Static, Type } from "typebox";
import { getAgentDir, getPackageDir, isBunBinary } from "../../config.ts";
import { type Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { resolveReadPathAsync } from "./path-utils.ts";
import { getTextOutput, renderToolPath } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const VIDEO_TRANSCRIPTION_MODEL_ID = "onnx-community/whisper-base";
export const VIDEO_TRANSCRIPTION_MODEL_REVISION = "1846881b6b3a3024392c1eea3ad983695bc23925";
export const VIDEO_TRANSCRIPTION_DTYPE = "q8";
export const VIDEO_TRANSCRIPTION_REQUIRED_FILES = [
	"config.json",
	"onnx/encoder_model_quantized.onnx",
	"onnx/decoder_model_merged_quantized.onnx",
	"generation_config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"preprocessor_config.json",
] as const;
export const VIDEO_TRANSCRIPTION_DISCOVERY_FILES = ["config.json", "tokenizer_config.json", "preprocessor_config.json"] as const;
const STORYBOARD_SIZE = 1536;
const CELL_SIZE = STORYBOARD_SIZE / 3;
const DETAIL_FRAME_COUNT = 4;
const MAX_DETAIL_FRAMES = 6;
const UNCROPPED_MAX_DIMENSION = 2048;
const CROPPED_MAX_DIMENSION = 2048;
const MOTION_DEFAULT_FRAME_COUNT = 6;
const MOTION_MIN_FRAME_COUNT = 4;
const MOTION_MAX_FRAME_COUNT = 9;
const MOTION_NEAR_CONTINUOUS_MAX_FRAME_GAP = 4;
const TRANSCRIPT_MAX_BYTES = 50 * 1024;
const TRANSCRIPTION_DEVICES = ["cpu", "coreml", "webgpu"] as const;
type TranscriptionDevice = (typeof TRANSCRIPTION_DEVICES)[number];
const ffmpegPath = (ffmpegStatic as unknown as { default?: string }).default ?? (ffmpegStatic as unknown as string);
const ffprobePath = (ffprobeStatic as unknown as { path?: string; default?: string }).path ?? (ffprobeStatic as unknown as { default?: string }).default ?? (ffprobeStatic as unknown as string);
const MODEL_PREPARED_MARKER = "prepared.json";
let modelPreparationPromise: Promise<TranscriptionDevice> | undefined;

const videoSchema = Type.Object({
	action: Type.Optional(
		Type.Union([
			Type.Literal("inspect"),
			Type.Literal("storyboard"),
			Type.Literal("frames"),
			Type.Literal("transcript"),
			Type.Literal("motion"),
		]),
	),
	path: Type.String({ description: "Local video path" }),
	start: Type.Optional(Type.Union([Type.Number(), Type.String()])),
	end: Type.Optional(Type.Union([Type.Number(), Type.String()])),
	timestamps: Type.Optional(Type.Array(Type.Union([Type.Number(), Type.String()]), { minItems: 1, maxItems: MAX_DETAIL_FRAMES, description: "Exact timestamps for action=frames; each value accepts seconds, MM:SS, or HH:MM:SS.mmm" })),
	crop: Type.Optional(Type.Object({
		x: Type.Number({ minimum: 0, maximum: 1, description: "Left edge as a fraction of frame width" }),
		y: Type.Number({ minimum: 0, maximum: 1, description: "Top edge as a fraction of frame height" }),
		width: Type.Number({ minimum: 0, maximum: 1, description: "Crop width as a fraction of frame width" }),
		height: Type.Number({ minimum: 0, maximum: 1, description: "Crop height as a fraction of frame height" }),
	}, { description: "Optional normalized crop for action=frames or action=motion; useful for reading small UI regions" })),
	count: Type.Optional(Type.Integer({ minimum: MOTION_MIN_FRAME_COUNT, maximum: MOTION_MAX_FRAME_COUNT, description: "Number of ordered samples for action=motion (default 6). Samples span start..end; use a tight interval for frame-adjacent animation evidence." })),
	language: Type.Optional(Type.String({ description: "Whisper language code (for example zh or en); defaults to en" })),
});

export type VideoToolInput = Static<typeof videoSchema>;
export type VideoAction = NonNullable<VideoToolInput["action"]>;

export interface VideoMetadata {
	duration: number;
	width?: number;
	height?: number;
	frameRate?: number;
	hasAudio: boolean;
	hasSubtitles: boolean;
}

export interface VideoCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TranscriptSegment {
	start: number;
	end: number;
	text: string;
}

export interface VideoToolDetails {
	metadata?: VideoMetadata;
	range?: { start: number; end: number };
	frameTimes?: number[];
	crop?: VideoCrop;
	motionBbox?: { x: number; y: number; width: number; height: number };
	motionChangeRatio?: number;
	motionStepChangeRatios?: number[];
	motionMagnitude?: "Low" | "Medium" | "High";
	isGlobalMotion?: boolean;
	motionSampling?: "near-continuous" | "sparse";
	motionFrameGap?: number;
	transcript?: {
		source: "sidecar" | "embedded" | "whisper";
		truncated?: boolean;
		nextStart?: number;
	};
	transcriptionReady?: boolean;
	transcriptionError?: string;
}

export interface VideoOperations {
	probe: (path: string, signal?: AbortSignal) => Promise<VideoMetadata>;
	createStoryboard: (path: string, frameTimes: number[], signal?: AbortSignal) => Promise<Buffer>;
	createFrames?: (path: string, frameTimes: number[], crop: VideoCrop | undefined, signal?: AbortSignal) => Promise<Buffer[]>;
	createMotionComposite?: (path: string, start: number, end: number, count: number, crop: VideoCrop | undefined, signal?: AbortSignal) => Promise<{
		image: Buffer;
		evidenceImage?: Buffer;
		frameTimes?: number[];
		stepChangeRatios?: number[];
		bbox?: { x: number; y: number; width: number; height: number };
		changeRatio: number;
		magnitude: "Low" | "Medium" | "High";
		/** Legacy broad-change heuristic. This does not prove camera motion. */
		isGlobalMotion: boolean;
	}>;
	readSidecarSubtitles: (path: string) => Promise<TranscriptSegment[] | undefined>;
	readEmbeddedSubtitles: (path: string, signal?: AbortSignal) => Promise<TranscriptSegment[] | undefined>;
	transcribe: (path: string, range: { start: number; end: number }, language: string, signal?: AbortSignal) => Promise<TranscriptSegment[]>;
	isModelInstalled: () => Promise<boolean>;
	prepareModel?: (onProgress?: (message: string) => void) => Promise<void>;
}

export interface VideoToolOptions {
	operations?: VideoOperations;
}

function abortError(): Error {
	return new Error("Operation aborted");
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function formatTimestamp(seconds: number): string {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
	const milliseconds = totalMilliseconds % 1000;
	const totalSeconds = Math.floor(totalMilliseconds / 1000);
	const secondsPart = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60) % 60;
	const hours = Math.floor(totalSeconds / 3600);
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function parseTimestamp(value: number | string | undefined, name: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number of seconds`);
		return value;
	}
	if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value)) {
		throw new Error(`${name} must be seconds, MM:SS, or HH:MM:SS.mmm`);
	}
	const values = value.split(":").map(Number);
	const seconds = values.length === 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values.length === 2 ? values[0] * 60 + values[1] : values[0];
	if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`${name} must be a non-negative time`);
	return seconds;
}

function resolveRange(input: VideoToolInput, duration: number): { start: number; end: number } {
	const start = parseTimestamp(input.start, "start") ?? 0;
	const end = parseTimestamp(input.end, "end") ?? duration;
	if (start >= duration) throw new Error(`start ${formatTimestamp(start)} is beyond video duration ${formatTimestamp(duration)}`);
	if (end > duration + 0.001) throw new Error(`end ${formatTimestamp(end)} is beyond video duration ${formatTimestamp(duration)}`);
	if (end <= start) throw new Error("end must be later than start");
	return { start, end: Math.min(end, duration) };
}

function frameTimesForRange(range: { start: number; end: number }, count = 9): number[] {
	const span = range.end - range.start;
	return Array.from({ length: count }, (_, index) => range.start + (span * (index + 0.5)) / count);
}

export function motionFrameTimesForRange(range: { start: number; end: number }, count: number): number[] {
	if (count === 1) return [range.start];
	const span = range.end - range.start;
	return Array.from({ length: count }, (_, index) => range.start + (span * index) / (count - 1));
}

export function motionGridLayout(count: number): { cellSize: number; layout: string } {
	const columns = count <= 4 ? 2 : 3;
	const cellSize = count <= 4 ? 768 : 512;
	const layout = Array.from({ length: count }, (_, index) => `${(index % columns) * cellSize}_${Math.floor(index / columns) * cellSize}`).join("|");
	return { cellSize, layout };
}

function motionSampling(frameTimes: number[], frameRate?: number): { kind: "near-continuous" | "sparse"; interval: number; frameGap?: number } {
	const intervals = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
	const interval = intervals.length ? Math.max(...intervals) : 0;
	const frameGap = frameRate ? interval * frameRate : undefined;
	return {
		kind: frameGap !== undefined && frameGap <= MOTION_NEAR_CONTINUOUS_MAX_FRAME_GAP + 0.001 ? "near-continuous" : "sparse",
		interval,
		frameGap,
	};
}

function resolveFrameTimes(input: VideoToolInput, range: { start: number; end: number }, duration: number): number[] {
	if (!input.timestamps) return frameTimesForRange(range, DETAIL_FRAME_COUNT);
	if (input.timestamps.length === 0 || input.timestamps.length > MAX_DETAIL_FRAMES) throw new Error(`timestamps must contain between 1 and ${MAX_DETAIL_FRAMES} values`);
	const times = input.timestamps.map((value, index) => parseTimestamp(value, `timestamps[${index}]`)!);
	for (const time of times) {
		if (time >= duration) throw new Error(`frame timestamp ${formatTimestamp(time)} is at or beyond video duration ${formatTimestamp(duration)}`);
		if (time < range.start || time > range.end + 0.001) throw new Error(`frame timestamp ${formatTimestamp(time)} is outside requested range ${formatTimestamp(range.start)} - ${formatTimestamp(range.end)}`);
	}
	return times;
}

function resolveCrop(input: VideoToolInput): VideoCrop | undefined {
	if (!input.crop) return undefined;
	const { x, y, width, height } = input.crop;
	if (![x, y, width, height].every(Number.isFinite)) throw new Error("crop values must be finite numbers");
	if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
		throw new Error("crop must use normalized coordinates within the frame, with positive width and height");
	}
	return { x, y, width, height };
}

function parseSrtTimestamp(value: string): number {
	const parts = value.trim().replace(",", ".").split(":").map(Number);
	return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

export function parseSubtitleText(content: string): TranscriptSegment[] {
	const lines = content.replace(/\r/g, "").split("\n");
	const segments: TranscriptSegment[] = [];
	let index = 0;
	while (index < lines.length) {
		if (!lines[index].trim() || lines[index] === "WEBVTT" || /^\d+$/.test(lines[index].trim())) {
			index++;
			continue;
		}
		const match = /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})/.exec(lines[index]);
		if (!match) {
			index++;
			continue;
		}
		index++;
		const text: string[] = [];
		while (index < lines.length && lines[index].trim()) text.push(lines[index++]);
		const cleaned = text.join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
		if (cleaned) segments.push({ start: parseSrtTimestamp(match[1]), end: parseSrtTimestamp(match[2]), text: cleaned });
	}
	return segments;
}

function filterTranscript(segments: TranscriptSegment[], range: { start: number; end: number }): TranscriptSegment[] {
	return segments.filter((segment) => segment.end >= range.start && segment.start <= range.end);
}

function renderTranscript(segments: TranscriptSegment[]): { text: string; truncated: boolean; nextStart?: number } {
	let used = 0;
	const lines: string[] = [];
	for (const segment of segments) {
		const line = `[${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}] ${segment.text}`;
		const size = Buffer.byteLength(`${line}\n`, "utf8");
		if (lines.length > 0 && used + size > TRANSCRIPT_MAX_BYTES) {
			return { text: `${lines.join("\n")}\n\n[Transcript truncated. Continue with start=${formatTimestamp(segment.start)}.]`, truncated: true, nextStart: segment.start };
		}
		used += size;
		lines.push(line);
	}
	return { text: lines.length ? lines.join("\n") : "[No spoken or subtitle text in this range.]", truncated: false };
}

function getModelCacheDir(): string {
	return join(getAgentDir(), ".metis-assets", "video-transcription", "whisper-base", VIDEO_TRANSCRIPTION_MODEL_REVISION);
}

function getModelInstallMarker(): string {
	return join(getModelCacheDir(), MODEL_PREPARED_MARKER);
}

export function resolveMediaBinaryPath(
	staticPath: string | null,
	name: "ffmpeg" | "ffprobe",
	bundledRoot = isBunBinary ? dirname(process.execPath) : join(getPackageDir(), "dist"),
): string {
	const executable = process.platform === "win32" ? `${name}.exe` : name;
	const bundledPath = join(bundledRoot, "video-bin", executable);
	if (existsSync(bundledPath)) return bundledPath;
	return requireBinary(staticPath, name);
}

function isTranscriptionDevice(value: unknown): value is TranscriptionDevice {
	return typeof value === "string" && (TRANSCRIPTION_DEVICES as readonly string[]).includes(value);
}

async function getInstalledTranscriptionDevice(): Promise<TranscriptionDevice | undefined> {
	try {
		const marker = JSON.parse(await readFile(getModelInstallMarker(), "utf8")) as { model?: string; revision?: string; dtype?: string; device?: unknown; files?: Array<{ path?: unknown; bytes?: unknown }>; discoveryFiles?: Array<{ path?: unknown; bytes?: unknown }> };
		if (marker.model !== VIDEO_TRANSCRIPTION_MODEL_ID || marker.revision !== VIDEO_TRANSCRIPTION_MODEL_REVISION || marker.dtype !== VIDEO_TRANSCRIPTION_DTYPE || !isTranscriptionDevice(marker.device) || !Array.isArray(marker.files) || !Array.isArray(marker.discoveryFiles)) return undefined;
		for (const file of VIDEO_TRANSCRIPTION_REQUIRED_FILES) {
			const recorded = marker.files.find((candidate) => candidate.path === file);
			if (!recorded || !Number.isSafeInteger(recorded.bytes) || Number(recorded.bytes) <= 0) return undefined;
			const info = await stat(join(getModelCacheDir(), VIDEO_TRANSCRIPTION_MODEL_ID, VIDEO_TRANSCRIPTION_MODEL_REVISION, file));
			if (!info.isFile() || info.size !== recorded.bytes) return undefined;
		}
		for (const file of VIDEO_TRANSCRIPTION_DISCOVERY_FILES) {
			const recorded = marker.discoveryFiles.find((candidate) => candidate.path === file);
			if (!recorded || !Number.isSafeInteger(recorded.bytes) || Number(recorded.bytes) <= 0) return undefined;
			const info = await stat(join(getModelCacheDir(), VIDEO_TRANSCRIPTION_MODEL_ID, file));
			if (!info.isFile() || info.size !== recorded.bytes) return undefined;
		}
		return marker.device;
	} catch {
		return undefined;
	}
}

async function prepareTranscriptionModel(onProgress?: (message: string) => void): Promise<TranscriptionDevice> {
	const installed = await getInstalledTranscriptionDevice();
	if (installed) return installed;
	if (process.env.METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE === "1") {
		throw new Error("Video transcription preparation is disabled by METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE=1");
	}
	if (!modelPreparationPromise) {
		modelPreparationPromise = (async () => {
			const scriptPath = join(getPackageDir(), "scripts", "prepare-video-transcription.mjs");
			const preparation = await import(pathToFileURL(scriptPath).href) as {
				prepareVideoTranscription: (options: {
					root: string;
					device?: string;
					log: (message: string) => void;
					loadTransformers: () => Promise<any>;
				}) => Promise<{ device?: unknown }>;
			};
			const marker = await preparation.prepareVideoTranscription({
				root: getAgentDir(),
				device: process.env.METIS_VIDEO_TRANSCRIPTION_DEVICE,
				log: (message) => onProgress?.(message),
				loadTransformers: () => import("@huggingface/transformers"),
			});
			if (!isTranscriptionDevice(marker.device)) throw new Error("Prepared transcription marker has an invalid device");
			return marker.device;
		})().finally(() => {
			modelPreparationPromise = undefined;
		});
	}
	return modelPreparationPromise;
}

async function run(command: string, args: string[], signal?: AbortSignal): Promise<{ stdout: Buffer; stderr: string }> {
	assertNotAborted(signal);
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { windowsHide: true });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const onAbort = () => {
			child.kill("SIGTERM");
			reject(abortError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", (error) => {
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
		child.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			const errorText = Buffer.concat(stderr).toString("utf8").trim();
			if (code !== 0) {
				reject(new Error(`${basename(command)} failed${errorText ? `: ${errorText}` : ""}`));
				return;
			}
			resolve({ stdout: Buffer.concat(stdout), stderr: errorText });
		});
	});
}

function requireBinary(path: string | null, name: string): string {
	if (!path) throw new Error(`${name} binary is unavailable for this platform`);
	return path;
}

const defaultVideoOperations: VideoOperations = {
	async probe(path, signal) {
		const result = await run(resolveMediaBinaryPath(ffprobePath, "ffprobe"), ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], signal);
		const data = JSON.parse(result.stdout.toString("utf8")) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }> };
		const streams = data.streams ?? [];
		const video = streams.find((stream) => stream.codec_type === "video");
		if (!video) throw new Error("File has no video stream");
		const duration = Number(data.format?.duration);
		if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video duration is unavailable");
		const [numerator, denominator] = (video.avg_frame_rate ?? video.r_frame_rate ?? "").split("/").map(Number);
		const frameRate = Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : undefined;
		return { duration, width: video.width, height: video.height, frameRate: frameRate && frameRate > 0 ? frameRate : undefined, hasAudio: streams.some((stream) => stream.codec_type === "audio"), hasSubtitles: streams.some((stream) => stream.codec_type === "subtitle") };
	},
	async createStoryboard(path, frameTimes, signal) {
		const workDir = join(tmpdir(), `metis-video-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(workDir, { recursive: true });
		try {
			const cells: string[] = [];
			for (let index = 0; index < frameTimes.length; index++) {
				const cell = join(workDir, `frame-${index}.jpg`);
				const outputArgs = ["-frames:v", "1", "-vf", `scale=${CELL_SIZE}:${CELL_SIZE}:force_original_aspect_ratio=decrease,pad=${CELL_SIZE}:${CELL_SIZE}:(ow-iw)/2:(oh-ih)/2:black`, "-q:v", "3", "-y", cell];
				try {
					await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", String(frameTimes[index]), "-i", path, ...outputArgs], signal);
					await access(cell);
				} catch (error) {
					if (index !== frameTimes.length - 1) throw error;
					await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-sseof", "-0.1", "-i", path, ...outputArgs], signal);
					await access(cell);
				}
				cells.push(cell);
			}
			const output = join(workDir, "storyboard.jpg");
			const args = cells.flatMap((cell) => ["-i", cell]);
			args.push("-filter_complex", "xstack=inputs=9:layout=0_0|512_0|1024_0|0_512|512_512|1024_512|0_1024|512_1024|1024_1024", "-frames:v", "1", "-q:v", "3", "-y", output);
			await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", ...args], signal);
			return await readFile(output);
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	},
	async createFrames(path, frameTimes, crop, signal) {
		const workDir = join(tmpdir(), `metis-video-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(workDir, { recursive: true });
		try {
			const images: Buffer[] = [];
			const maxDimension = crop ? CROPPED_MAX_DIMENSION : UNCROPPED_MAX_DIMENSION;
			for (let index = 0; index < frameTimes.length; index++) {
				const output = join(workDir, `frame-${index}.jpg`);
				const filters = crop ? [`crop=w='iw*${crop.width}':h='ih*${crop.height}':x='iw*${crop.x}':y='ih*${crop.y}'`] : [];
				filters.push(`scale=w='min(${maxDimension},iw)':h='min(${maxDimension},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
				const outputArgs = ["-frames:v", "1", "-vf", filters.join(","), "-q:v", "2", "-y", output];
				try {
					await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", String(frameTimes[index]), "-i", path, ...outputArgs], signal);
					await access(output);
				} catch (error) {
					if (index !== frameTimes.length - 1) throw error;
					await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-sseof", "-0.1", "-i", path, ...outputArgs], signal);
					await access(output);
				}
				images.push(await readFile(output));
			}
			return images;
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	},
	async createMotionComposite(path, start, end, count = MOTION_DEFAULT_FRAME_COUNT, crop, signal) {
		const numFrames = Math.max(MOTION_MIN_FRAME_COUNT, Math.min(MOTION_MAX_FRAME_COUNT, count || MOTION_DEFAULT_FRAME_COUNT));
		const workDir = join(tmpdir(), `metis-video-motion-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(workDir, { recursive: true });
		try {
			const frameTimes = motionFrameTimesForRange({ start, end }, numFrames);
			const { cellSize, layout } = motionGridLayout(numFrames);

			const cropFilter = crop ? `crop=w='iw*${crop.width}':h='ih*${crop.height}':x='iw*${crop.x}':y='ih*${crop.y}',` : "";
			const scaleFilter = `scale=${cellSize}:${cellSize}:force_original_aspect_ratio=decrease,pad=${cellSize}:${cellSize}:(ow-iw)/2:(oh-ih)/2:black`;

			const cellFiles: string[] = [];
			for (let i = 0; i < numFrames; i++) {
				const cellFile = join(workDir, `cell-${i}.jpg`);
				const outputArgs = ["-frames:v", "1", "-vf", `${cropFilter}${scaleFilter}`, "-q:v", "2", "-y", cellFile];
				try {
					await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", String(frameTimes[i]), "-i", path, ...outputArgs], signal);
					await access(cellFile);
				} catch (error) {
					if (i !== numFrames - 1) throw error;
					await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-sseof", "-0.1", "-i", path, ...outputArgs], signal);
					await access(cellFile);
				}
				cellFiles.push(cellFile);
			}

			const rawW = 320;
			const rawH = 180;
			const rawBuffers: Buffer[] = [];
			for (let i = 0; i < numFrames; i++) {
				const rawFile = join(workDir, `raw-${i}.rgb`);
				await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", String(frameTimes[i]), "-i", path, "-frames:v", "1", "-vf", `${cropFilter}scale=${rawW}:${rawH}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-y", rawFile], signal);
				rawBuffers.push(await readFile(rawFile));
			}

			let minX = rawW;
			let minY = rawH;
			let maxX = -1;
			let maxY = -1;
			let totalChangedPixels = 0;
			const threshold = 12;
			const totalPixelsPerFrame = rawW * rawH;
			const frameDiffsCount = numFrames - 1;
			const maxPixelDeltas = Buffer.alloc(totalPixelsPerFrame);
			const stepChangeRatios: number[] = [];

			for (let i = 0; i < frameDiffsCount; i++) {
				const bufA = rawBuffers[i];
				const bufB = rawBuffers[i + 1];
				let stepChangedPixels = 0;
				for (let y = 0; y < rawH; y++) {
					for (let x = 0; x < rawW; x++) {
						const pixelIndex = y * rawW + x;
						const idx = pixelIndex * 3;
						if (idx + 2 < bufA.length && idx + 2 < bufB.length) {
							const dR = Math.abs(bufA[idx] - bufB[idx]);
							const dG = Math.abs(bufA[idx + 1] - bufB[idx + 1]);
							const dB = Math.abs(bufA[idx + 2] - bufB[idx + 2]);
							const maxDelta = Math.max(dR, dG, dB);
							if (maxDelta > maxPixelDeltas[pixelIndex]) maxPixelDeltas[pixelIndex] = maxDelta;
							if (maxDelta > threshold) {
								totalChangedPixels++;
								stepChangedPixels++;
								if (x < minX) minX = x;
								if (x > maxX) maxX = x;
								if (y < minY) minY = y;
								if (y > maxY) maxY = y;
							}
						}
					}
				}
				stepChangeRatios.push(Number((stepChangedPixels / totalPixelsPerFrame).toFixed(4)));
			}

			const changeRatio = Number((totalChangedPixels / (totalPixelsPerFrame * frameDiffsCount)).toFixed(4));
			const magnitude: "Low" | "Medium" | "High" = changeRatio < 0.01 ? "Low" : changeRatio < 0.15 ? "Medium" : "High";
			let bbox: { x: number; y: number; width: number; height: number } | undefined;
			let isGlobalMotion = false;

			if (totalChangedPixels > 0 && maxX >= minX && maxY >= minY) {
				const bboxW = (maxX - minX + 1) / rawW;
				const bboxH = (maxY - minY + 1) / rawH;
				bbox = {
					x: Number((minX / rawW).toFixed(4)),
					y: Number((minY / rawH).toFixed(4)),
					width: Number(bboxW.toFixed(4)),
					height: Number(bboxH.toFixed(4)),
				};
				if (bboxW * bboxH > 0.35 || changeRatio > 0.20) {
					isGlobalMotion = true;
				}
			}

			const motionMapPixels = Buffer.alloc(totalPixelsPerFrame * 3);
			const referenceFrame = rawBuffers[0];
			for (let pixelIndex = 0; pixelIndex < totalPixelsPerFrame; pixelIndex++) {
				const idx = pixelIndex * 3;
				const luminance = Math.round((referenceFrame[idx] + referenceFrame[idx + 1] + referenceFrame[idx + 2]) / 3);
				const background = Math.round(luminance * 0.28);
				const delta = maxPixelDeltas[pixelIndex];
				const heat = delta > threshold ? Math.min(255, (delta - threshold) * 5) : 0;
				motionMapPixels[idx] = Math.max(background, heat);
				motionMapPixels[idx + 1] = heat > 0 ? Math.round(background * 0.35) : background;
				motionMapPixels[idx + 2] = heat > 0 ? Math.round(background * 0.15) : background;
			}
			const motionMapPpm = join(workDir, "motion-evidence.ppm");
			await writeFile(motionMapPpm, Buffer.concat([Buffer.from(`P6\n${rawW} ${rawH}\n255\n`, "ascii"), motionMapPixels]));
			const evidenceOutput = join(workDir, "motion-evidence.jpg");
			await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-i", motionMapPpm, "-frames:v", "1", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black", "-q:v", "2", "-y", evidenceOutput], signal);

			const output = join(workDir, "motion-grid.jpg");
			const inputArgs = cellFiles.flatMap((file) => ["-i", file]);
			await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", ...inputArgs, "-filter_complex", `xstack=inputs=${numFrames}:layout=${layout}`, "-frames:v", "1", "-q:v", "2", "-y", output], signal);

			return {
				image: await readFile(output),
				evidenceImage: await readFile(evidenceOutput),
				frameTimes,
				stepChangeRatios,
				bbox,
				changeRatio,
				magnitude,
				isGlobalMotion,
			};
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	},
	async readSidecarSubtitles(path) {
		const base = join(dirname(path), basename(path, extname(path)));
		for (const extension of [".vtt", ".srt"]) {
			try {
				return parseSubtitleText(await readFile(`${base}${extension}`, "utf8"));
			} catch (error: any) {
				if (error?.code !== "ENOENT") throw error;
			}
		}
		return undefined;
	},
	async readEmbeddedSubtitles(path, signal) {
		try {
			const result = await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-i", path, "-map", "0:s:0", "-f", "webvtt", "-"], signal);
			const segments = parseSubtitleText(result.stdout.toString("utf8"));
			return segments.length ? segments : undefined;
		} catch {
			return undefined;
		}
	},
	async transcribe(path, range, language, signal) {
		const workDir = join(tmpdir(), `metis-video-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const wavPath = join(workDir, "audio.wav");
		await mkdir(workDir, { recursive: true });
		try {
			await run(resolveMediaBinaryPath(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", String(range.start), "-to", String(range.end), "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", wavPath], signal);
			const waveform = readPcm16Wav(await readFile(wavPath));
			if (!hasAudibleSignal(waveform)) return [];
			const transformers: any = await import("@huggingface/transformers");
			const modelCacheDir = getModelCacheDir();
			transformers.env.cacheDir = modelCacheDir;
			transformers.env.localModelPath = join(modelCacheDir, "local-models");
			transformers.env.allowRemoteModels = false;
			const device = await getInstalledTranscriptionDevice();
			if (!device) throw new Error("Bundled transcription assets are unavailable or incomplete.");
			const pipe = await transformers.pipeline("automatic-speech-recognition", VIDEO_TRANSCRIPTION_MODEL_ID, { cache_dir: modelCacheDir, revision: VIDEO_TRANSCRIPTION_MODEL_REVISION, dtype: VIDEO_TRANSCRIPTION_DTYPE, device, local_files_only: true });
			assertNotAborted(signal);
			const maxNewTokens = Math.max(16, Math.min(160, Math.ceil((range.end - range.start) * 8)));
			const output = await pipe(waveform, { return_timestamps: true, language, task: "transcribe", chunk_length_s: 30, stride_length_s: 5, max_new_tokens: maxNewTokens });
			const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
			if (chunks.length) return chunks.map((chunk: any) => ({ start: Math.max(range.start, range.start + Number(chunk.timestamp?.[0] ?? 0)), end: Math.min(range.end, range.start + Number(chunk.timestamp?.[1] ?? 0)), text: String(chunk.text ?? "").trim() })).filter((chunk: TranscriptSegment) => chunk.text && chunk.end >= chunk.start);
			return output?.text ? [{ start: range.start, end: range.end, text: String(output.text).trim() }] : [];
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	},
	async isModelInstalled() {
		return !!(await getInstalledTranscriptionDevice());
	},
	async prepareModel(onProgress) {
		await prepareTranscriptionModel(onProgress);
	},
};

function readPcm16Wav(buffer: Buffer): Float32Array {
	if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("Expected PCM WAV audio from ffmpeg");
	let offset = 12;
	let dataOffset = -1;
	let dataSize = 0;
	while (offset + 8 <= buffer.length) {
		const id = buffer.toString("ascii", offset, offset + 4);
		const size = buffer.readUInt32LE(offset + 4);
		if (id === "data") {
			dataOffset = offset + 8;
			dataSize = size;
			break;
		}
		offset += 8 + size + (size % 2);
	}
	if (dataOffset < 0) throw new Error("WAV audio data is missing");
	const samples = new Float32Array(Math.floor(dataSize / 2));
	for (let index = 0; index < samples.length; index++) samples[index] = buffer.readInt16LE(dataOffset + index * 2) / 32768;
	return samples;
}

function hasAudibleSignal(waveform: Float32Array): boolean {
	if (!waveform.length) return false;
	let energy = 0;
	for (const sample of waveform) energy += sample * sample;
	return Math.sqrt(energy / waveform.length) >= 0.0005;
}

async function cachedTranscriptPath(path: string): Promise<string> {
	const fileStat = await stat(path);
	const key = createHash("sha256").update(`${path}\0${fileStat.size}\0${fileStat.mtimeMs}`).digest("hex");
	const cacheDir = join(getAgentDir(), "cache", "video", key);
	await mkdir(cacheDir, { recursive: true });
	return join(cacheDir, "transcript.json");
}

async function readCachedTranscript(path: string): Promise<TranscriptSegment[] | undefined> {
	try {
		const value = JSON.parse(await readFile(await cachedTranscriptPath(path), "utf8")) as { model: string; revision: string; segments: TranscriptSegment[] };
		return value.model === VIDEO_TRANSCRIPTION_MODEL_ID && value.revision === VIDEO_TRANSCRIPTION_MODEL_REVISION ? value.segments : undefined;
	} catch {
		return undefined;
	}
}

async function cacheTranscript(path: string, segments: TranscriptSegment[]): Promise<void> {
	try {
		await writeFile(await cachedTranscriptPath(path), JSON.stringify({ model: VIDEO_TRANSCRIPTION_MODEL_ID, revision: VIDEO_TRANSCRIPTION_MODEL_REVISION, segments }), "utf8");
	} catch {
		// Ignore cache write failures
	}
}

function renderCall(args: VideoToolInput | undefined, theme: Theme, cwd: string): string {
	const action = args?.action ?? "inspect";
	return theme.fg("toolTitle", theme.bold(`video ${action}`)) + (args?.path ? ` ${renderToolPath(args.path, theme, cwd)}` : "");
}

function renderResult(result: { content: (TextContent | ImageContent)[] }, options: ToolRenderResultOptions, theme: Theme, showImages: boolean): string {
	if (!options.expanded) return "";
	return `\n${theme.fg("toolOutput", getTextOutput(result, showImages))}`;
}

export function createVideoToolDefinition(cwd: string, options?: VideoToolOptions): ToolDefinition<typeof videoSchema, VideoToolDetails> {
	const operations = options?.operations ?? defaultVideoOperations;
	return {
		name: "video",
		label: "video",
		description: "Inspect local video without sending video bytes to model: inspect=metadata; storyboard=event location; motion=ordered samples+pixel-change evidence in range; frames=high-res confirmation; transcript=spoken text. Motion metrics show changed pixels, not movement cause.",
		promptSnippet: "Inspect local video with metadata, temporal overview, motion evidence, detail frames, and transcript",
		promptGuidelines: [
			"For local-video understanding/inspection/summary/content location, call video before bash/other file tools.",
			"First action=inspect: duration/frame rate only, no visual evidence; then use smallest sufficient action.",
			"storyboard locates scenes/time ranges. Read 3×3 left-to-right/top-to-bottom; pair cells #1–#9 with adjacent timestamps. Navigation evidence only: no fine text/style/state/animation claims.",
			"motion: tightly bound one movement with start/end; read grid left-to-right/top-to-bottom and pair cells with adjacent timestamps. Returns exact-range ordered samples, timestamps/spacing, per-step pixel-change ratios, separate evidence map. Sampling mode matters: sparse=broad phases/may miss intermediate motion; near-continuous=finer transitions.",
			"For action/animation track same subject across all ordered samples; describe position/shape/scale/rotation/opacity/state before intent/cause. Pixel changes alone cannot distinguish subject/camera motion, cut, fade, lighting, compression noise.",
			"frames at explicit timestamps confirm small details/ambiguous states. UI/micro-interactions: sample immediately before/during/after, usually 1–4 source frames apart; normalized crop enlarges subject/UI region.",
			"transcript: pass known spoken language (e.g. zh/en); proves speech/subtitle text, not visual state; first local request may download+verify pinned model.",
			"Never use for remote URLs.",
		],
		parameters: videoSchema,
		async execute(_toolCallId, input, signal, onUpdate, ctx) {
			const action: VideoAction = input.action ?? "inspect";
			assertNotAborted(signal);
			const path = await resolveReadPathAsync(input.path, cwd);
			const metadata = await operations.probe(path, signal);
			const range = resolveRange(input, metadata.duration);
			const details: VideoToolDetails = { metadata, range };
			const content: (TextContent | ImageContent)[] = [{ type: "text", text: `Video: ${input.path}\nDuration: ${formatTimestamp(metadata.duration)}\nRange: ${formatTimestamp(range.start)} - ${formatTimestamp(range.end)}` }];
			if (action === "inspect") {
				details.transcriptionReady = await operations.isModelInstalled();
				content.push({
					type: "text",
					text: [
						"Video inspector initialized. No visual frames or transcript have been generated.",
						`Video dimensions: ${metadata.width ?? "unknown"}×${metadata.height ?? "unknown"}.`,
						`Frame rate: ${metadata.frameRate ? `${metadata.frameRate.toFixed(3)} fps` : "unknown"}.`,
						`Audio stream: ${metadata.hasAudio ? "yes" : "no"}.`,
						`Subtitle stream: ${metadata.hasSubtitles ? "yes" : "no"}.`,
						`Transcription runtime prepared: ${metadata.hasAudio ? (details.transcriptionReady ? "yes" : "no") : "not needed (no audio stream)"}.`,
						"",
						"Evidence workflow:",
						`1. Locate time: action=storyboard with path=${JSON.stringify(input.path)}, start=<time>, end=<time>. This overview helps find scenes or event ranges; its small cells do not prove fine visual details.`,
						`2. Understand movement: action=motion with path=${JSON.stringify(input.path)}, start=<tight-event-start>, end=<tight-event-end>, count=${MOTION_DEFAULT_FRAME_COUNT}. Samples span the requested range. The result states whether spacing is near-continuous or sparse; sparse samples can miss intermediate motion.`,
						`3. Confirm state and detail: action=frames with path=${JSON.stringify(input.path)}, timestamps=[<before>, <during>, <after>], crop={x,y,width,height}. This returns up to ${MAX_DETAIL_FRAMES} independent high-resolution JPEG frames.`,
						metadata.hasAudio || metadata.hasSubtitles
							? `4. Verify speech: action=transcript with path=${JSON.stringify(input.path)}, start=<time>, end=<time>. Transcript proves spoken or subtitle text, not visual state.`
							: "4. Transcript is unavailable because this video has no audio or subtitle stream. Do not call action=transcript.",
						"",
						`For animation or interaction, track the same subject through before/during/after samples. Check position, shape, scale, rotation, opacity, and state. Pixel-change metrics show visual difference only; they do not prove whether the cause is subject motion, camera motion, a cut, a fade, lighting, or compression.`,
						metadata.frameRate
							? `At ${metadata.frameRate.toFixed(3)} fps, 1–4 source frames span ${(1 / metadata.frameRate).toFixed(4)}–${(4 / metadata.frameRate).toFixed(4)} seconds.`
							: "Frame rate is unknown, so verify timing with nearby samples.",
						metadata.hasAudio && !details.transcriptionReady ? "The first transcript call downloads and verifies the local transcription model." : "",
					].filter(Boolean).join("\n"),
				});
				return { content, details };
			}

			if (action === "storyboard") {
				const frameTimes = frameTimesForRange(range);
				details.frameTimes = frameTimes;
				onUpdate?.({ content: [{ type: "text", text: "Creating 3×3 ordered storyboard…" }], details: {} });
				const sheet = await operations.createStoryboard(path, frameTimes, signal);
				content.push({ type: "text", text: `Storyboard cells are ordered left-to-right, top-to-bottom. Timestamp mapping: ${frameTimes.map((time, index) => `#${index + 1}=${formatTimestamp(time)}`).join(", ")}` });
				if (ctx?.model && !ctx.model.input.includes("image")) {
					content.push({ type: "text", text: "[Current model is explicitly configured as text-only, so the storyboard image cannot be sent to it. Use a vision-capable model or change this model's input capability to [\"text\", \"image\"].]" });
				}
				content.push({ type: "image", data: sheet.toString("base64"), mimeType: "image/jpeg" });
			}

			if (action === "frames") {
				if (!operations.createFrames) throw new Error("High-fidelity frame extraction is unavailable for these custom video operations");
				const frameTimes = resolveFrameTimes(input, range, metadata.duration);
				const crop = resolveCrop(input);
				details.frameTimes = frameTimes;
				details.crop = crop;
				onUpdate?.({ content: [{ type: "text", text: `Extracting ${frameTimes.length} high-fidelity video frame${frameTimes.length === 1 ? "" : "s"}…` }], details: {} });
				const frames = await operations.createFrames(path, frameTimes, crop, signal);
				if (frames.length !== frameTimes.length) throw new Error(`Frame extractor returned ${frames.length} images for ${frameTimes.length} timestamps`);
				const maxDimension = crop ? CROPPED_MAX_DIMENSION : UNCROPPED_MAX_DIMENSION;
				content.push({ type: "text", text: `High-fidelity JPEG frames (${maxDimension}px maximum dimension, no upscaling)${crop ? `; crop x=${crop.x}, y=${crop.y}, width=${crop.width}, height=${crop.height}` : ""}:` });
				if (ctx?.model && !ctx.model.input.includes("image")) {
					content.push({ type: "text", text: "[Current model is explicitly configured as text-only, so the frame images cannot be sent to it. Use a vision-capable model or change this model's input capability to [\"text\", \"image\"].]" });
				}
				for (let index = 0; index < frames.length; index++) {
					content.push({ type: "text", text: `Frame ${index + 1}/${frames.length}: ${formatTimestamp(frameTimes[index])}` });
					content.push({ type: "image", data: frames[index].toString("base64"), mimeType: "image/jpeg" });
				}
			}

			if (action === "motion") {
				if (!operations.createMotionComposite) throw new Error("Motion composite extraction is unavailable for these custom video operations");
				const crop = resolveCrop(input);
				const count = Math.max(MOTION_MIN_FRAME_COUNT, Math.min(MOTION_MAX_FRAME_COUNT, input.count ?? MOTION_DEFAULT_FRAME_COUNT));
				details.crop = crop;
				onUpdate?.({ content: [{ type: "text", text: `Generating ${count}-sample ordered motion evidence…` }], details: {} });
				const motion = await operations.createMotionComposite(path, range.start, range.end, count, crop, signal);
				const frameTimes = motion.frameTimes ?? motionFrameTimesForRange(range, count);
				const sampling = motionSampling(frameTimes, metadata.frameRate);
				const { image, evidenceImage, bbox, changeRatio, stepChangeRatios, magnitude, isGlobalMotion } = motion;
				details.frameTimes = frameTimes;
				details.motionBbox = bbox;
				details.motionChangeRatio = changeRatio;
				details.motionStepChangeRatios = stepChangeRatios;
				details.motionMagnitude = magnitude;
				details.isGlobalMotion = isGlobalMotion;
				details.motionSampling = sampling.kind;
				details.motionFrameGap = sampling.frameGap;
				const spacingDescription = sampling.frameGap === undefined
					? `${sampling.interval.toFixed(4)}s between samples; source-frame gap unknown because frame rate is unavailable`
					: `${sampling.interval.toFixed(4)}s between samples, about ${sampling.frameGap.toFixed(2)} source frames`;
				const samplingGuidance = sampling.kind === "near-continuous"
					? "Near-continuous evidence: spacing is at most four source frames. Track the same subject across every sample before describing trajectory or state change."
					: `Sparse evidence: these are ordered samples, not consecutive source frames. Use them to identify broad phases only; intermediate motion may be missing.${metadata.frameRate ? ` For finer evidence with ${count} samples, narrow start..end to about ${(((count - 1) * MOTION_NEAR_CONTINUOUS_MAX_FRAME_GAP) / metadata.frameRate).toFixed(3)}s or less.` : " Narrow the interval and run motion again for finer evidence."}`;
				const motionInfo = [
					`Motion sequence evidence (${count} ordered samples, ${formatTimestamp(range.start)} - ${formatTimestamp(range.end)}, duration ${(range.end - range.start).toFixed(3)}s)${crop ? `; crop x=${crop.x}, y=${crop.y}, width=${crop.width}, height=${crop.height}` : ""}:`,
					"Grid order: read left-to-right, top-to-bottom; map each cell to the numbered timestamp below.",
					`Samples: ${frameTimes.map((time, index) => `#${index + 1}=${formatTimestamp(time)}`).join(", ")}`,
					`Sampling: ${sampling.kind}; ${spacingDescription}.`,
					samplingGuidance,
					`Pixel-change level: ${magnitude} (${(changeRatio * 100).toFixed(2)}% average changed pixels per adjacent sample pair). This is a visual-difference heuristic, not an action classification.`,
					stepChangeRatios?.length ? `Per-step changed pixels: ${stepChangeRatios.map((ratio, index) => `#${index + 1}→#${index + 2}=${(ratio * 100).toFixed(2)}%`).join(", ")}` : "Per-step changed-pixel ratios are unavailable for these custom video operations.",
					`Spatial coverage heuristic: ${bbox ? (isGlobalMotion ? "broad change across the frame" : "change concentrated in part of the frame") : "no change above threshold"}. Broad change can come from camera movement, a cut, a fade, lighting, or a large moving subject; inspect the images before assigning a cause.`,
					bbox
						? `Union changed-pixel bounding box: x=${bbox.x}, y=${bbox.y}, width=${bbox.width}, height=${bbox.height}`
						: "No changed-pixel bounding box detected.",
					"",
					"How to interpret this evidence:",
					"1. Identify the same subject or UI element in each ordered sample; do not treat a cursor or touch marker as the animated component.",
					"2. Report only visible changes first: position, shape, scale, rotation, opacity, color, or discrete state.",
					"3. Separate observation from cause. Use surrounding frames, transcript, or user context before claiming what triggered the change.",
					"4. If timing, direction, or an intermediate state remains ambiguous, narrow the range or request explicit detail frames before concluding.",
				].join("\n");
				content.push({ type: "text", text: motionInfo });
				if (ctx?.model && !ctx.model.input.includes("image")) {
					content.push({ type: "text", text: "[Current model is explicitly configured as text-only, so the motion image cannot be sent to it. Use a vision-capable model or change this model's input capability to [\"text\", \"image\"].]" });
				}
				content.push({ type: "text", text: "Ordered sample grid:" });
				content.push({ type: "image", data: image.toString("base64"), mimeType: "image/jpeg" });
				if (evidenceImage) {
					content.push({ type: "text", text: "Motion-evidence map: brighter red marks pixels with larger change across adjacent sample pairs. Use it to locate change, not to infer direction or cause." });
					content.push({ type: "image", data: evidenceImage.toString("base64"), mimeType: "image/jpeg" });
				}
			}

			if (action === "transcript") {
				let transcript: TranscriptSegment[] | undefined;
				let source: "sidecar" | "embedded" | "whisper" | undefined;
				transcript = await operations.readSidecarSubtitles(path);
				if (transcript?.length) source = "sidecar";
				if (!transcript?.length) {
					transcript = await operations.readEmbeddedSubtitles(path, signal);
					if (transcript?.length) source = "embedded";
				}
				if (!transcript?.length) {
					transcript = await readCachedTranscript(path);
					if (transcript?.length) source = "whisper";
				}
				if (!transcript?.length && !metadata.hasAudio) {
					content.push({ type: "text", text: "[No audio stream; transcript is unavailable.]" });
				} else {
					if (!transcript?.length && !(await operations.isModelInstalled())) {
						details.transcriptionReady = false;
						onUpdate?.({ content: [{ type: "text", text: "Preparing local video transcription model…" }], details: {} });
						try {
							if (!operations.prepareModel) throw new Error("Automatic transcription preparation is unavailable for custom video operations");
							await operations.prepareModel((message) => onUpdate?.({ content: [{ type: "text", text: message }], details: {} }));
							details.transcriptionReady = true;
						} catch (error) {
							if (signal?.aborted) throw error;
							const message = error instanceof Error ? error.message : String(error);
							details.transcriptionError = message;
							content.push({ type: "text", text: `[Local transcription initialization failed: ${message}. Check network access and write permission for ${getAgentDir()}, then retry. Storyboard remains available.]` });
							return { content, details };
						}
					}
					if (!transcript?.length) {
						onUpdate?.({ content: [{ type: "text", text: "Transcribing audio locally…" }], details: {} });
						try {
							transcript = await operations.transcribe(path, range, input.language && input.language !== "auto" ? input.language : "en", signal);
							await cacheTranscript(path, transcript);
							source = "whisper";
							details.transcriptionReady = true;
						} catch (error) {
							if (signal?.aborted) throw error;
							const message = error instanceof Error ? error.message : String(error);
							details.transcriptionReady = false;
							details.transcriptionError = message;
							content.push({ type: "text", text: `[Local transcription failed: ${message}. Remove the local transcription cache and retry initialization if this persists. Storyboard remains available.]` });
							return { content, details };
						}
					}
					const rendered = renderTranscript(filterTranscript(transcript, range));
					details.transcript = { source: source!, truncated: rendered.truncated, nextStart: rendered.nextStart };
					content.push({ type: "text", text: `Transcript (${source}):\n${rendered.text}` });
				}
			}
			return { content, details };
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderCall(args as VideoToolInput | undefined, theme, context.cwd));
			return text;
		},
		renderResult(result, renderOptions, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderResult(result, renderOptions, theme, context.showImages));
			return text;
		},
	};
}

export function createVideoTool(cwd: string, options?: VideoToolOptions): AgentTool<typeof videoSchema, VideoToolDetails> {
	return wrapToolDefinition(createVideoToolDefinition(cwd, options));
}
