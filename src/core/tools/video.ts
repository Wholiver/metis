import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
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
const TRANSCRIPT_MAX_BYTES = 50 * 1024;
const TRANSCRIPTION_DEVICES = ["cpu", "coreml", "webgpu"] as const;
type TranscriptionDevice = (typeof TRANSCRIPTION_DEVICES)[number];
const ffmpegPath = (ffmpegStatic as unknown as { default?: string }).default ?? (ffmpegStatic as unknown as string);
const ffprobePath = (ffprobeStatic as unknown as { path?: string; default?: string }).path ?? (ffprobeStatic as unknown as { default?: string }).default ?? (ffprobeStatic as unknown as string);
const MODEL_PREPARED_MARKER = "prepared.json";

const videoSchema = Type.Object({
	action: Type.Optional(
		Type.Union([
			Type.Literal("inspect"),
			Type.Literal("storyboard"),
			Type.Literal("transcript"),
		]),
	),
	path: Type.String({ description: "Local video path" }),
	start: Type.Optional(Type.Union([Type.Number(), Type.String()])),
	end: Type.Optional(Type.Union([Type.Number(), Type.String()])),
	language: Type.Optional(Type.String({ description: "Whisper language code (for example zh or en); defaults to en" })),
});

export type VideoToolInput = Static<typeof videoSchema>;
export type VideoAction = NonNullable<VideoToolInput["action"]>;

export interface VideoMetadata {
	duration: number;
	width?: number;
	height?: number;
	hasAudio: boolean;
	hasSubtitles: boolean;
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
	readSidecarSubtitles: (path: string) => Promise<TranscriptSegment[] | undefined>;
	readEmbeddedSubtitles: (path: string, signal?: AbortSignal) => Promise<TranscriptSegment[] | undefined>;
	transcribe: (path: string, range: { start: number; end: number }, language: string, signal?: AbortSignal) => Promise<TranscriptSegment[]>;
	isModelInstalled: () => Promise<boolean>;
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

function frameTimesForRange(range: { start: number; end: number }): number[] {
	const span = range.end - range.start;
	return Array.from({ length: 9 }, (_, index) => range.start + (span * (index + 0.5)) / 9);
}

function parseSrtTimestamp(value: string): number {
	const [hours, minutes, rest] = value.trim().replace(",", ".").split(":");
	return Number(hours) * 3600 + Number(minutes) * 60 + Number(rest);
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
	return join(getPackageDir(), ".metis-assets", "video-transcription", "whisper-base", VIDEO_TRANSCRIPTION_MODEL_REVISION);
}

function getModelInstallMarker(): string {
	return join(getModelCacheDir(), MODEL_PREPARED_MARKER);
}

function getMediaBinary(staticPath: string | null, name: "ffmpeg" | "ffprobe"): string {
	if (!isBunBinary) return requireBinary(staticPath, name);
	return join(dirname(process.execPath), "video-bin", process.platform === "win32" ? `${name}.exe` : name);
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
		const result = await run(getMediaBinary(ffprobePath, "ffprobe"), ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], signal);
		const data = JSON.parse(result.stdout.toString("utf8")) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
		const streams = data.streams ?? [];
		const video = streams.find((stream) => stream.codec_type === "video");
		if (!video) throw new Error("File has no video stream");
		const duration = Number(data.format?.duration);
		if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video duration is unavailable");
		return { duration, width: video.width, height: video.height, hasAudio: streams.some((stream) => stream.codec_type === "audio"), hasSubtitles: streams.some((stream) => stream.codec_type === "subtitle") };
	},
	async createStoryboard(path, frameTimes, signal) {
		const workDir = join(tmpdir(), `metis-video-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(workDir, { recursive: true });
		try {
			const cells: string[] = [];
			for (let index = 0; index < frameTimes.length; index++) {
				const cell = join(workDir, `frame-${index}.jpg`);
				const drawText = `drawtext=text='${formatTimestamp(frameTimes[index]).replace(/:/g, "\\:")}':x=18:y=h-42:fontcolor=white:fontsize=30:box=1:boxcolor=black@0.65:boxborderw=8`;
				const outputArgs = ["-frames:v", "1", "-vf", `scale=${CELL_SIZE}:${CELL_SIZE}:force_original_aspect_ratio=decrease,pad=${CELL_SIZE}:${CELL_SIZE}:(ow-iw)/2:(oh-ih)/2:black,${drawText}`, "-q:v", "3", "-y", cell];
				try {
					await run(getMediaBinary(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-i", path, "-ss", String(frameTimes[index]), ...outputArgs], signal);
					await access(cell);
				} catch (error) {
					if (index !== frameTimes.length - 1) throw error;
					await run(getMediaBinary(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-sseof", "-0.1", "-i", path, ...outputArgs], signal);
					await access(cell);
				}
				cells.push(cell);
			}
			const output = join(workDir, "storyboard.jpg");
			const args = cells.flatMap((cell) => ["-i", cell]);
			args.push("-filter_complex", "xstack=inputs=9:layout=0_0|512_0|1024_0|0_512|512_512|1024_512|0_1024|512_1024|1024_1024", "-frames:v", "1", "-q:v", "3", "-y", output);
			await run(getMediaBinary(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", ...args], signal);
			return await readFile(output);
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
			const result = await run(getMediaBinary(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-i", path, "-map", "0:s:0", "-f", "webvtt", "-"], signal);
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
			await run(getMediaBinary(ffmpegPath, "ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", String(range.start), "-to", String(range.end), "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", wavPath], signal);
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
	await writeFile(await cachedTranscriptPath(path), JSON.stringify({ model: VIDEO_TRANSCRIPTION_MODEL_ID, revision: VIDEO_TRANSCRIPTION_MODEL_REVISION, segments }), "utf8");
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
		description: "Initialize inspection of a local video. inspect returns metadata and explicit next-call instructions without generating frames or a transcript. Then call storyboard and/or transcript for a chosen time range. Local transcription assets are prepared during npm installation; there is no runtime installation action.",
		promptSnippet: "Initialize local video inspection, then explicitly request a storyboard or transcript",
		promptGuidelines: ["For requests to understand, inspect, summarize, or locate content in a local video file, call video before using bash or other file tools.", "Call inspect first. Read its returned instructions and choose the minimum follow-up action needed; do not assume storyboard and transcript are both necessary.", "For transcript, pass the spoken language code when known (for example zh or en); the local runtime defaults to en.", "Transcription is expected to be ready after npm installation. If it reports unavailable, explain that Metis must be reinstalled with npm lifecycle scripts enabled; do not invent or call an installation action.", "Never use this tool for remote URLs."],
		parameters: videoSchema,
		async execute(_toolCallId, input, signal, onUpdate) {
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
					text: `Video inspector initialized. No storyboard or transcript has been generated.\nTranscription runtime prepared: ${details.transcriptionReady ? "yes" : "no"}.\n\nChoose next action based on user need:\n- For visual events: call video with action=storyboard, path=${JSON.stringify(input.path)}, start=<time>, end=<time>. It returns exactly one timestamped 3×3 image.\n- For spoken or subtitle text: call video with action=transcript, path=${JSON.stringify(input.path)}, start=<time>, end=<time>.\n- For both: make the two explicit calls above.\n\nUse start/end to narrow the range; omit them only when the whole video is required. If transcription runtime is not prepared, Metis must be reinstalled with npm lifecycle scripts enabled; there is no runtime installation action.`,
				});
				return { content, details };
			}

			if (action === "storyboard") {
				const frameTimes = frameTimesForRange(range);
				details.frameTimes = frameTimes;
				onUpdate?.({ content: [{ type: "text", text: "Creating 3×3 timestamped storyboard…" }], details: {} });
				const sheet = await operations.createStoryboard(path, frameTimes, signal);
				content.push({ type: "text", text: `Storyboard frames: ${frameTimes.map((time, index) => `${index + 1}=${formatTimestamp(time)}`).join(", ")}` });
				content.push({ type: "image", data: sheet.toString("base64"), mimeType: "image/jpeg" });
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
				} else if (!transcript?.length && !(await operations.isModelInstalled())) {
					details.transcriptionReady = false;
					details.transcriptionError = "Bundled transcription assets are missing or were not verified during npm installation.";
					content.push({ type: "text", text: `[Bundled transcription runtime is unavailable. Reinstall Metis with npm lifecycle scripts enabled (do not use --ignore-scripts), then retry transcript. Expected model: ${VIDEO_TRANSCRIPTION_MODEL_ID}@${VIDEO_TRANSCRIPTION_MODEL_REVISION}. Storyboard remains available.]` });
				} else {
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
							content.push({ type: "text", text: `[Local transcription failed: ${message}. Reinstall Metis with npm lifecycle scripts enabled to rebuild and verify the bundled transcription cache. Storyboard remains available.]` });
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
