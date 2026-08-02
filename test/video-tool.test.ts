import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAllTools } from "../src/core/tools/index.ts";
import { createVideoTool, createVideoToolDefinition, parseSubtitleText, resolveMediaBinaryPath, type VideoOperations } from "../src/core/tools/video.ts";

const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string;

const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=", "base64");

const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw2cWQAAAABJRU5ErkJggg==", "base64");

describe("video tool", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `metis-video-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "clip.mp4"), "fixture");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(testDir, { recursive: true, force: true });
	});

	function operations(overrides: Partial<VideoOperations> = {}): VideoOperations {
		return {
			probe: vi.fn(async () => ({ duration: 80, width: 1280, height: 720, frameRate: 30, hasAudio: true, hasSubtitles: false })),
			createStoryboard: vi.fn(async () => TINY_JPEG),
			createFrames: vi.fn(async (_path, frameTimes) => frameTimes.map(() => TINY_PNG)),
			createMotionComposite: vi.fn(async () => ({ image: TINY_JPEG, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, changeRatio: 0.05, magnitude: "Medium", isGlobalMotion: false })),
			readSidecarSubtitles: vi.fn(async () => undefined),
			readEmbeddedSubtitles: vi.fn(async () => undefined),
			transcribe: vi.fn(async () => [{ start: 10, end: 12, text: "hello video" }]),
			isModelInstalled: vi.fn(async () => false),
			prepareModel: vi.fn(async () => undefined),
			...overrides,
		};
	}

	it("parses SRT and WebVTT timestamped segments", () => {
		expect(parseSubtitleText("WEBVTT\n\n00:01.000 --> 00:02.500\nShort timestamp\n\n00:00:03.000 --> 00:00:04.500\nHi <b>there</b>\n\n2\n00:00:05,000 --> 00:00:06,000\nAgain")).toEqual([
			{ start: 1, end: 2.5, text: "Short timestamp" },
			{ start: 3, end: 4.5, text: "Hi there" },
			{ start: 5, end: 6, text: "Again" },
		]);
	});

	it("prefers Metis bundled media binaries over dependency install paths", () => {
		const bundledRoot = join(testDir, "dist");
		const executable = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
		const bundledPath = join(bundledRoot, "video-bin", executable);
		mkdirSync(join(bundledRoot, "video-bin"), { recursive: true });
		writeFileSync(bundledPath, "fixture");
		expect(resolveMediaBinaryPath(join(testDir, "missing-dependency-ffprobe"), "ffprobe", bundledRoot)).toBe(bundledPath);
	});

	it("falls back to the dependency media binary during source development", () => {
		const dependencyPath = join(testDir, "dependency-ffmpeg");
		expect(resolveMediaBinaryPath(dependencyPath, "ffmpeg", join(testDir, "missing-dist"))).toBe(dependencyPath);
	});

	it("initializes inspection with explicit next-call instructions", async () => {
		const ops = operations();
		const tool = createVideoTool(testDir, { operations: ops });
		const result = await tool.execute("video-init", { action: "inspect", path: "clip.mp4", start: "00:00:20", end: "00:00:28" });
		const output = result.content.filter((block): block is { type: "text"; text: string } => block.type === "text").map((block) => block.text).join("\n");
		expect(result.details.range).toEqual({ start: 20, end: 28 });
		expect(result.content.find((block) => block.type === "image")).toBeUndefined();
		expect(output).toContain("Video inspector initialized");
		expect(output).toContain("action=storyboard");
		expect(output).toContain("action=frames");
		expect(output).toContain("action=transcript");
		expect(output).toContain("30.000 fps");
		expect(output).toContain("Audio stream: yes");
		expect(output).toContain("Transcription runtime prepared: no");
		expect(result.details.transcriptionReady).toBe(false);
		expect(ops.createStoryboard).not.toHaveBeenCalled();
		expect(ops.transcribe).not.toHaveBeenCalled();
	});

	it("does not recommend transcription for a video without audio or subtitles", async () => {
		const ops = operations({ probe: vi.fn(async () => ({ duration: 80, width: 1280, height: 720, hasAudio: false, hasSubtitles: false })) });
		const result = await createVideoTool(testDir, { operations: ops }).execute("video-silent", { action: "inspect", path: "clip.mp4" });
		const output = result.content.map((block) => block.type === "text" ? block.text : "").join("\n");
		expect(output).toContain("Audio stream: no");
		expect(output).toContain("Transcription runtime prepared: not needed");
		expect(output).toContain("Do not call action=transcript");
		expect(ops.prepareModel).not.toHaveBeenCalled();
	});

	it("returns one timestamped 3×3 storyboard for a requested range", async () => {
		const ops = operations({ readSidecarSubtitles: async () => [{ start: 20, end: 22, text: "focused text" }] });
		const tool = createVideoTool(testDir, { operations: ops });
		const result = await tool.execute("video-1", { action: "storyboard", path: "clip.mp4", start: "00:00:20", end: "00:00:28" });
		const output = result.content.filter((block): block is { type: "text"; text: string } => block.type === "text").map((block) => block.text).join("\n");
		expect(result.details.range).toEqual({ start: 20, end: 28 });
		expect(result.details.frameTimes).toHaveLength(9);
		expect(result.details.frameTimes?.[0]).toBeCloseTo(20.444, 3);
		expect(result.details.frameTimes?.[8]).toBeCloseTo(27.556, 3);
		expect(result.content.find((block) => block.type === "image")?.mimeType).toBe("image/jpeg");
		expect(output).not.toContain("focused text");
		expect(ops.createStoryboard).toHaveBeenCalledTimes(1);
	});

	it("returns independent high-fidelity JPEG frames at exact timestamps", async () => {
		const ops = operations();
		const tool = createVideoTool(testDir, { operations: ops });
		const crop = { x: 0, y: 0, width: 1, height: 0.25 };
		const result = await tool.execute("video-detail", { action: "frames", path: "clip.mp4", timestamps: ["00:00:20.000", 20.1], crop });
		const images = result.content.filter((block) => block.type === "image");
		const output = result.content.map((block) => block.type === "text" ? block.text : "").join("\n");
		expect(result.details.frameTimes).toEqual([20, 20.1]);
		expect(result.details.crop).toEqual(crop);
		expect(images).toHaveLength(2);
		expect(images.every((image) => image.mimeType === "image/jpeg")).toBe(true);
		expect(output).toContain("Frame 1/2: 00:00:20.000");
		expect(output).toContain("Frame 2/2: 00:00:20.100");
		expect(ops.createFrames).toHaveBeenCalledWith(join(testDir, "clip.mp4"), [20, 20.1], crop, undefined);
	});

	it("samples four detail frames by default and validates detail requests", async () => {
		const tool = createVideoTool(testDir, { operations: operations() });
		const result = await tool.execute("video-detail-default", { action: "frames", path: "clip.mp4", start: 20, end: 28 });
		expect(result.details.frameTimes).toEqual([21, 23, 25, 27]);
		await expect(tool.execute("video-detail-time", { action: "frames", path: "clip.mp4", timestamps: [81] })).rejects.toThrow("beyond video duration");
		await expect(tool.execute("video-detail-end", { action: "frames", path: "clip.mp4", timestamps: [80] })).rejects.toThrow("beyond video duration");
		await expect(tool.execute("video-detail-crop", { action: "frames", path: "clip.mp4", timestamps: [20], crop: { x: 0.8, y: 0, width: 0.3, height: 1 } })).rejects.toThrow("normalized coordinates");
	});

	it("warns explicit text-only models and requires high-fidelity verification", async () => {
		const definition = createVideoToolDefinition(testDir, { operations: operations() });
		const result = await definition.execute("video-text-only", { action: "storyboard", path: "clip.mp4" }, undefined, undefined, {
			model: { input: ["text"] },
		} as any);
		const output = result.content.map((block) => block.type === "text" ? block.text : "").join("\n");
		expect(output).toContain("explicitly configured as text-only");
		expect(definition.promptGuidelines?.join("\n")).toContain("frames at explicit timestamps");
		expect(definition.promptGuidelines?.join("\n")).toContain("1–4 source frames apart");
	});

	it("automatically prepares a missing transcription model", async () => {
		const ops = operations();
		const tool = createVideoTool(testDir, { operations: ops });
		const result = await tool.execute("video-2", { action: "transcript", path: "clip.mp4" });
		expect(ops.prepareModel).toHaveBeenCalledTimes(1);
		expect(ops.transcribe).toHaveBeenCalledTimes(1);
		expect(result.details.transcriptionReady).toBe(true);
		expect(result.details.transcript?.source).toBe("whisper");
	});

	it("returns a recoverable result when transcription initialization fails", async () => {
		const ops = operations({ prepareModel: vi.fn(async () => { throw new Error("download unavailable"); }) });
		const result = await createVideoTool(testDir, { operations: ops }).execute("video-prepare-failure", { action: "transcript", path: "clip.mp4" });
		expect(ops.transcribe).not.toHaveBeenCalled();
		expect(result.details.transcriptionReady).toBe(false);
		expect(result.details.transcriptionError).toContain("download unavailable");
		expect(result.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("Local transcription initialization failed");
	});

	it("uses an already configured local transcription implementation", async () => {
		const ops = operations({ isModelInstalled: vi.fn(async () => true) });
		const tool = createVideoTool(testDir, { operations: ops });
		const result = await tool.execute("video-5", { action: "transcript", path: "clip.mp4" });
		expect(ops.transcribe).toHaveBeenCalledTimes(1);
		expect(result.details.transcript?.source).toBe("whisper");
	});

	it("returns a recoverable result instead of a tool error when local transcription fails", async () => {
		const ops = operations({ isModelInstalled: vi.fn(async () => true), transcribe: vi.fn(async () => { throw new Error("runtime unavailable"); }) });
		const result = await createVideoTool(testDir, { operations: ops }).execute("video-transcript-failure", { action: "transcript", path: "clip.mp4" });
		expect(result.details.transcriptionReady).toBe(false);
		expect(result.details.transcriptionError).toContain("runtime unavailable");
		expect(result.content.map((block) => block.type === "text" ? block.text : "").join("\n")).toContain("Local transcription failed");
	});

	it("rejects invalid time ranges", async () => {
		const tool = createVideoTool(testDir, { operations: operations() });
		await expect(tool.execute("video-5", { action: "storyboard", path: "clip.mp4", start: 40, end: 20 })).rejects.toThrow("end must be later than start");
	});

	it("registers video with all built-in tools", () => {
		expect(createAllTools(testDir)).toHaveProperty("video");
	});

	it("creates a real 3×3 storyboard with bundled FFmpeg", async () => {
		const videoPath = join(testDir, "real.mp4");
		await runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1.5:size=160x90:rate=10", "-an", "-pix_fmt", "yuv420p", "-y", videoPath]);
		const result = await createVideoTool(testDir).execute("video-real", { action: "storyboard", path: "real.mp4" });
		const image = result.content.find((block) => block.type === "image");
		expect(result.details.frameTimes).toHaveLength(9);
		expect(image?.mimeType).toBe("image/jpeg");
		 expect(image?.data.length).toBeGreaterThan(1000);
	});

	it("extracts real high-fidelity detail frames and normalized crops with bundled FFmpeg", async () => {
		const videoPath = join(testDir, "real-detail.mp4");
		await runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1.5:size=320x180:rate=10", "-an", "-pix_fmt", "yuv420p", "-y", videoPath]);
		const result = await createVideoTool(testDir).execute("video-real-detail", { action: "frames", path: "real-detail.mp4", timestamps: [0.5], crop: { x: 0, y: 0, width: 0.5, height: 1 } });
		const image = result.content.find((block) => block.type === "image");
		expect(result.details.frameTimes).toEqual([0.5]);
		expect(image?.mimeType).toBe("image/jpeg");
		expect(Buffer.from(image?.data ?? "", "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
	});

	it("returns a dense motion sequence grid image, quantitative metrics, and 4D action guidance for action=motion", async () => {
		const ops = operations();
		const tool = createVideoTool(testDir, { operations: ops });
		const result = await tool.execute("video-motion", { action: "motion", path: "clip.mp4", start: 1, end: 2, count: 6 });
		const image = result.content.find((block) => block.type === "image");
		const output = result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
		expect(result.details.motionBbox).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
		expect(result.details.motionChangeRatio).toBe(0.05);
		expect(result.details.motionMagnitude).toBe("Medium");
		expect(result.details.isGlobalMotion).toBe(false);
		expect(image?.mimeType).toBe("image/jpeg");
		expect(output).toContain("Universal Motion Sequence Grid");
		expect(output).toContain("Motion Magnitude: Medium");
		expect(output).toContain("4D Universal Action Analysis Instructions");
		expect(ops.createMotionComposite).toHaveBeenCalledWith(join(testDir, "clip.mp4"), 1, 2, 6, undefined, undefined);
	});

	it("extracts real motion composite image and detects pixel difference with bundled FFmpeg", async () => {
		const videoPath = join(testDir, "real-motion.mp4");
		await runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1.5:size=320x180:rate=10", "-an", "-pix_fmt", "yuv420p", "-y", videoPath]);
		const result = await createVideoTool(testDir).execute("video-real-motion", { action: "motion", path: "real-motion.mp4", start: 0.1, end: 1.0 });
		const image = result.content.find((block) => block.type === "image");
		expect(image?.mimeType).toBe("image/jpeg");
		expect(Buffer.from(image?.data ?? "", "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
	});
});
