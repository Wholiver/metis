import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VIDEO_TRANSCRIPTION_MODEL_ID = "onnx-community/whisper-base";
export const VIDEO_TRANSCRIPTION_MODEL_REVISION = "1846881b6b3a3024392c1eea3ad983695bc23925";
export const VIDEO_TRANSCRIPTION_DTYPE = "q8";
export const VIDEO_TRANSCRIPTION_DEVICES = ["cpu", "coreml", "webgpu"];
export const VIDEO_TRANSCRIPTION_REQUIRED_FILES = [
	"config.json",
	"onnx/encoder_model_quantized.onnx",
	"onnx/decoder_model_merged_quantized.onnx",
	"generation_config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"preprocessor_config.json",
];
export const VIDEO_TRANSCRIPTION_DISCOVERY_FILES = ["config.json", "tokenizer_config.json", "preprocessor_config.json"];

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export function getVideoTranscriptionCacheDir(root = packageRoot) {
	return join(root, ".metis-assets", "video-transcription", "whisper-base", VIDEO_TRANSCRIPTION_MODEL_REVISION);
}

export function getVideoTranscriptionMarkerPath(root = packageRoot) {
	return join(getVideoTranscriptionCacheDir(root), "prepared.json");
}

function getCachedModelFile(cacheDir, file) {
	return join(cacheDir, VIDEO_TRANSCRIPTION_MODEL_ID, VIDEO_TRANSCRIPTION_MODEL_REVISION, file);
}

function getDiscoveryFile(cacheDir, file) {
	return join(cacheDir, VIDEO_TRANSCRIPTION_MODEL_ID, file);
}

async function readVerifiedAssets(cacheDir, markerFiles) {
	if (!Array.isArray(markerFiles) || markerFiles.length !== VIDEO_TRANSCRIPTION_REQUIRED_FILES.length) return undefined;
	const assets = [];
	for (const file of VIDEO_TRANSCRIPTION_REQUIRED_FILES) {
		const recorded = markerFiles.find((candidate) => candidate?.path === file);
		if (!recorded || !Number.isSafeInteger(recorded.bytes) || recorded.bytes <= 0) return undefined;
		const info = await stat(getCachedModelFile(cacheDir, file));
		if (!info.isFile() || info.size !== recorded.bytes) return undefined;
		assets.push({ path: file, bytes: info.size });
	}
	return assets;
}

async function readVerifiedDiscoveryAssets(cacheDir, markerFiles) {
	if (!Array.isArray(markerFiles) || markerFiles.length !== VIDEO_TRANSCRIPTION_DISCOVERY_FILES.length) return undefined;
	for (const file of VIDEO_TRANSCRIPTION_DISCOVERY_FILES) {
		const recorded = markerFiles.find((candidate) => candidate?.path === file);
		if (!recorded || !Number.isSafeInteger(recorded.bytes) || recorded.bytes <= 0) return undefined;
		const info = await stat(getDiscoveryFile(cacheDir, file));
		if (!info.isFile() || info.size !== recorded.bytes) return undefined;
	}
	return markerFiles;
}

function parseDevice(value) {
	const device = value || "cpu";
	if (!VIDEO_TRANSCRIPTION_DEVICES.includes(device)) {
		throw new Error(`Unsupported METIS_VIDEO_TRANSCRIPTION_DEVICE=${JSON.stringify(device)}. Expected one of: ${VIDEO_TRANSCRIPTION_DEVICES.join(", ")}`);
	}
	return device;
}

export async function readPreparedVideoTranscription(root = packageRoot) {
	try {
		const marker = JSON.parse(await readFile(getVideoTranscriptionMarkerPath(root), "utf8"));
		if (
			marker.model !== VIDEO_TRANSCRIPTION_MODEL_ID ||
			marker.revision !== VIDEO_TRANSCRIPTION_MODEL_REVISION ||
			marker.dtype !== VIDEO_TRANSCRIPTION_DTYPE ||
			!VIDEO_TRANSCRIPTION_DEVICES.includes(marker.device)
		) return undefined;
		const cacheDir = getVideoTranscriptionCacheDir(root);
		if (!await readVerifiedAssets(cacheDir, marker.files)) return undefined;
		if (!await readVerifiedDiscoveryAssets(cacheDir, marker.discoveryFiles)) return undefined;
		return marker;
	} catch {
		return undefined;
	}
}

export async function prepareVideoTranscription(options = {}) {
	const root = options.root || packageRoot;
	const device = parseDevice(options.device || process.env.METIS_VIDEO_TRANSCRIPTION_DEVICE);
	const log = options.log || console.log;
	const existing = await readPreparedVideoTranscription(root);
	if (existing?.device === device) {
		log(`[metis] Video transcription model already prepared (${existing.device}).`);
		return existing;
	}

	const cacheDir = getVideoTranscriptionCacheDir(root);
	const markerPath = getVideoTranscriptionMarkerPath(root);
	await mkdir(cacheDir, { recursive: true });
	log(`[metis] Preparing ${VIDEO_TRANSCRIPTION_MODEL_ID}@${VIDEO_TRANSCRIPTION_MODEL_REVISION} for local video transcription…`);

	const transformers = await (options.loadTransformers?.() ?? import("@huggingface/transformers"));
	transformers.env.cacheDir = cacheDir;
	transformers.env.localModelPath = join(cacheDir, "local-models");
	transformers.env.allowRemoteModels = true;
	const completedFiles = new Set();
	const downloaded = await transformers.pipeline("automatic-speech-recognition", VIDEO_TRANSCRIPTION_MODEL_ID, {
		cache_dir: cacheDir,
		revision: VIDEO_TRANSCRIPTION_MODEL_REVISION,
		dtype: VIDEO_TRANSCRIPTION_DTYPE,
		device,
		progress_callback: (progress) => {
			if (progress?.status === "done" && VIDEO_TRANSCRIPTION_REQUIRED_FILES.includes(progress.file) && !completedFiles.has(progress.file)) {
				completedFiles.add(progress.file);
				log(`[metis] Cached video transcription asset ${completedFiles.size}/${VIDEO_TRANSCRIPTION_REQUIRED_FILES.length}: ${progress.file}`);
			}
		},
	});
	await downloaded.dispose?.();

	const discoveryFiles = [];
	for (const file of VIDEO_TRANSCRIPTION_DISCOVERY_FILES) {
		const target = getDiscoveryFile(cacheDir, file);
		await mkdir(dirname(target), { recursive: true });
		await copyFile(getCachedModelFile(cacheDir, file), target);
		const info = await stat(target);
		discoveryFiles.push({ path: file, bytes: info.size });
	}

	transformers.env.allowRemoteModels = false;
	const offline = await transformers.pipeline("automatic-speech-recognition", VIDEO_TRANSCRIPTION_MODEL_ID, {
		cache_dir: cacheDir,
		revision: VIDEO_TRANSCRIPTION_MODEL_REVISION,
		dtype: VIDEO_TRANSCRIPTION_DTYPE,
		device,
		local_files_only: true,
	});
	await offline.dispose?.();

	const files = [];
	for (const file of VIDEO_TRANSCRIPTION_REQUIRED_FILES) {
		const info = await stat(getCachedModelFile(cacheDir, file));
		if (!info.isFile() || info.size <= 0) throw new Error(`Prepared transcription asset is missing or empty: ${file}`);
		files.push({ path: file, bytes: info.size });
	}

	const marker = {
		model: VIDEO_TRANSCRIPTION_MODEL_ID,
		revision: VIDEO_TRANSCRIPTION_MODEL_REVISION,
		dtype: VIDEO_TRANSCRIPTION_DTYPE,
		device,
		files,
		discoveryFiles,
		preparedAt: new Date().toISOString(),
	};
	const temporaryMarker = `${markerPath}.tmp-${process.pid}`;
	await mkdir(dirname(markerPath), { recursive: true });
	await writeFile(temporaryMarker, JSON.stringify(marker), "utf8");
	await rename(temporaryMarker, markerPath);
	log(`[metis] Video transcription model prepared for offline use (${device}).`);
	return marker;
}

async function main() {
	if (process.env.METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE === "1") {
		console.warn("[metis] Skipping video transcription preparation because METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE=1.");
		return;
	}
	await prepareVideoTranscription();
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
	main().catch((error) => {
		console.error(`[metis] Failed to prepare video transcription model: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}

