import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getVideoTranscriptionMarkerPath,
	prepareVideoTranscription,
	VIDEO_TRANSCRIPTION_DTYPE,
	VIDEO_TRANSCRIPTION_DISCOVERY_FILES,
	VIDEO_TRANSCRIPTION_MODEL_ID,
	VIDEO_TRANSCRIPTION_MODEL_REVISION,
	VIDEO_TRANSCRIPTION_REQUIRED_FILES,
	getVideoTranscriptionCacheDir,
} from "../scripts/prepare-video-transcription.mjs";
import {
	VIDEO_TRANSCRIPTION_DTYPE as RUNTIME_DTYPE,
	VIDEO_TRANSCRIPTION_DISCOVERY_FILES as RUNTIME_DISCOVERY_FILES,
	VIDEO_TRANSCRIPTION_MODEL_ID as RUNTIME_MODEL_ID,
	VIDEO_TRANSCRIPTION_MODEL_REVISION as RUNTIME_MODEL_REVISION,
	VIDEO_TRANSCRIPTION_REQUIRED_FILES as RUNTIME_REQUIRED_FILES,
} from "../src/core/tools/video.ts";

describe("video transcription npm preparation", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `metis-video-prepare-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("keeps postinstall and runtime model contracts identical", () => {
		expect(VIDEO_TRANSCRIPTION_MODEL_ID).toBe(RUNTIME_MODEL_ID);
		expect(VIDEO_TRANSCRIPTION_MODEL_REVISION).toBe(RUNTIME_MODEL_REVISION);
		expect(VIDEO_TRANSCRIPTION_DTYPE).toBe(RUNTIME_DTYPE);
		expect(VIDEO_TRANSCRIPTION_REQUIRED_FILES).toEqual(RUNTIME_REQUIRED_FILES);
		expect(VIDEO_TRANSCRIPTION_DISCOVERY_FILES).toEqual(RUNTIME_DISCOVERY_FILES);
	});

	it("downloads, verifies offline loading, then writes the prepared marker", async () => {
		const env = { cacheDir: "", allowRemoteModels: true };
		const calls: Array<{ options: Record<string, unknown>; allowRemoteModels: boolean }> = [];
		const dispose = vi.fn(async () => undefined);
		const pipeline = vi.fn(async (_task: string, _model: string, options: Record<string, unknown>) => {
			calls.push({ options, allowRemoteModels: env.allowRemoteModels });
			if (calls.length === 1) {
				for (const file of VIDEO_TRANSCRIPTION_REQUIRED_FILES) {
					const path = join(String(options.cache_dir), VIDEO_TRANSCRIPTION_MODEL_ID, VIDEO_TRANSCRIPTION_MODEL_REVISION, file);
					mkdirSync(join(path, ".."), { recursive: true });
					writeFileSync(path, file);
				}
			}
			return { dispose };
		});

		const marker = await prepareVideoTranscription({
			root: testDir,
			device: "cpu",
			log: vi.fn(),
			loadTransformers: async () => ({ env, pipeline }),
		});

		expect(calls).toHaveLength(2);
		expect(calls[0].allowRemoteModels).toBe(true);
		expect(calls[0].options.cache_dir).toBe(getVideoTranscriptionCacheDir(testDir));
		expect(calls[0].options).not.toHaveProperty("local_files_only");
		expect(calls[1].allowRemoteModels).toBe(false);
		expect(calls[1].options.local_files_only).toBe(true);
		expect(dispose).toHaveBeenCalledTimes(2);
		expect(JSON.parse(readFileSync(getVideoTranscriptionMarkerPath(testDir), "utf8"))).toEqual(marker);
	});

	it("is idempotent after a verified marker exists", async () => {
		const env = { cacheDir: "", allowRemoteModels: true };
		const pipeline = vi.fn(async (_task: string, _model: string, pipelineOptions: Record<string, unknown>) => {
			for (const file of VIDEO_TRANSCRIPTION_REQUIRED_FILES) {
				const path = join(String(pipelineOptions.cache_dir), VIDEO_TRANSCRIPTION_MODEL_ID, VIDEO_TRANSCRIPTION_MODEL_REVISION, file);
				mkdirSync(join(path, ".."), { recursive: true });
				writeFileSync(path, file);
			}
			return { dispose: vi.fn(async () => undefined) };
		});
		const options = { root: testDir, device: "cpu", log: vi.fn(), loadTransformers: async () => ({ env, pipeline }) };
		await prepareVideoTranscription(options);
		await prepareVideoTranscription(options);
		expect(pipeline).toHaveBeenCalledTimes(2);
	});

	it("does not trust a marker when bundled model assets are missing", async () => {
		const env = { cacheDir: "", allowRemoteModels: true };
		const pipeline = vi.fn(async (_task: string, _model: string, pipelineOptions: Record<string, unknown>) => {
			for (const file of VIDEO_TRANSCRIPTION_REQUIRED_FILES) {
				const path = join(String(pipelineOptions.cache_dir), VIDEO_TRANSCRIPTION_MODEL_ID, VIDEO_TRANSCRIPTION_MODEL_REVISION, file);
				mkdirSync(join(path, ".."), { recursive: true });
				writeFileSync(path, file);
			}
			return { dispose: vi.fn(async () => undefined) };
		});
		const options = { root: testDir, device: "cpu", log: vi.fn(), loadTransformers: async () => ({ env, pipeline }) };
		await prepareVideoTranscription(options);
		rmSync(join(getVideoTranscriptionCacheDir(testDir), VIDEO_TRANSCRIPTION_MODEL_ID, VIDEO_TRANSCRIPTION_MODEL_REVISION, VIDEO_TRANSCRIPTION_REQUIRED_FILES[0]));
		await prepareVideoTranscription(options);
		expect(pipeline).toHaveBeenCalledTimes(4);
	});

	it("rejects unsupported configured devices before downloading", async () => {
		await expect(prepareVideoTranscription({ root: testDir, device: "wasm", log: vi.fn() })).rejects.toThrow("Unsupported METIS_VIDEO_TRANSCRIPTION_DEVICE");
	});
});

