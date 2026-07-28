import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const [runtimeRootArgument, workDirArgument] = process.argv.slice(2);
if (!runtimeRootArgument || !workDirArgument) {
	throw new Error("Usage: node scripts/smoke-video-runtime.mjs <runtime-root> <work-dir>");
}

const runtimeRoot = path.resolve(runtimeRootArgument);
const workDir = path.resolve(workDirArgument);
const executableExtension = process.platform === "win32" ? ".exe" : "";
const ffmpegPath = path.join(runtimeRoot, "dist", "video-bin", `ffmpeg${executableExtension}`);
process.env.METIS_PACKAGE_DIR = runtimeRoot;
process.env.METIS_CODING_AGENT_DIR = path.join(workDir, "agent");

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

const { createVideoTool } = await import(pathToFileURL(path.join(runtimeRoot, "dist", "core", "tools", "video.js")).href);
const tool = createVideoTool(workDir);
const baseVideo = path.join(workDir, "base.mp4");
await runFile(ffmpegPath, [
	"-hide_banner", "-loglevel", "error",
	"-f", "lavfi", "-i", "testsrc=duration=2:size=160x90:rate=10",
	"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
	"-shortest", "-pix_fmt", "yuv420p", "-y", baseVideo,
]);

function text(result) {
	return result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const inspect = await tool.execute("smoke-inspect", { action: "inspect", path: baseVideo });
assert(inspect.details.metadata?.width === 160 && inspect.details.metadata?.height === 90, "inspect returned incorrect dimensions");
assert(inspect.details.metadata?.hasAudio === true, "inspect did not detect audio");
console.log(`PASS inspect (${inspect.details.metadata.width}x${inspect.details.metadata.height}, audio=yes)`);

const storyboard = await tool.execute("smoke-storyboard", { action: "storyboard", path: baseVideo, start: 0, end: 1.5 });
const storyboardImage = storyboard.content.find((block) => block.type === "image");
assert(storyboard.details.frameTimes?.length === 9, "storyboard did not return nine frame times");
assert(storyboardImage?.mimeType === "image/jpeg" && storyboardImage.data.length > 1000, "storyboard did not return a JPEG image");
console.log(`PASS storyboard (9 frames, ${storyboardImage.data.length} base64 bytes)`);

const sidecarVideo = path.join(workDir, "sidecar.mp4");
await runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", baseVideo, "-c", "copy", "-y", sidecarVideo]);
await writeFile(path.join(workDir, "sidecar.srt"), "1\n00:00:00,000 --> 00:00:01,500\nsidecar smoke text\n", "utf8");
const sidecar = await tool.execute("smoke-sidecar", { action: "transcript", path: sidecarVideo, language: "en" });
assert(sidecar.details.transcript?.source === "sidecar" && text(sidecar).includes("sidecar smoke text"), "sidecar transcript failed");
console.log("PASS sidecar transcript");

const embeddedSubtitle = path.join(workDir, "embedded.srt");
const embeddedVideo = path.join(workDir, "embedded.mp4");
await writeFile(embeddedSubtitle, "1\n00:00:00,000 --> 00:00:01,500\nembedded smoke text\n", "utf8");
await runFile(ffmpegPath, [
	"-hide_banner", "-loglevel", "error", "-i", baseVideo, "-i", embeddedSubtitle,
	"-map", "0", "-map", "1:0", "-c", "copy", "-c:s", "mov_text", "-y", embeddedVideo,
]);
await rm(embeddedSubtitle);
const embedded = await tool.execute("smoke-embedded", { action: "transcript", path: embeddedVideo, language: "en" });
assert(embedded.details.transcript?.source === "embedded" && text(embedded).includes("embedded smoke text"), "embedded transcript failed");
console.log("PASS embedded transcript");

const whisper = await tool.execute("smoke-whisper", { action: "transcript", path: baseVideo, language: "en" });
assert(whisper.details.transcriptionReady === true, `Whisper runtime unavailable: ${whisper.details.transcriptionError || text(whisper)}`);
assert(whisper.details.transcript?.source === "whisper", "Whisper transcript did not execute");
console.log("PASS local Whisper transcript");

const cachedWhisper = await tool.execute("smoke-whisper-cache", { action: "transcript", path: baseVideo, language: "en" });
assert(cachedWhisper.details.transcript?.source === "whisper", "cached Whisper transcript was not reused");
console.log("PASS cached Whisper transcript");
