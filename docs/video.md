# Video Tool

`video` lets Metis inspect a local video without placing video bytes in model context. It returns text plus a timestamped 3×3 storyboard image.

## Actions

| Action | Result |
| --- | --- |
| `inspect` (default) | probes metadata, then returns instructions for next calls; it does not generate frames or transcript |
| `storyboard` | one 3×3 image containing nine timestamped frames |
| `transcript` | timestamped subtitle/transcript text only |

`path` is required. `start` and `end` accept seconds, `MM:SS`, or `HH:MM:SS.mmm`. They limit storyboard sampling and transcript output, so call again with a narrower range to inspect a moment in detail.

For local Whisper transcription, pass `language` when known (for example `zh` or `en`). Transformers.js does not currently auto-detect Whisper language, so an omitted or `auto` value uses `en`.

Call `inspect` first. It returns duration, available streams, and a small instruction protocol. The model then explicitly chooses `storyboard`, `transcript`, or both; `inspect` never preselects a fixed analysis pipeline.

## Transcript source and privacy

Metis reads sidecar `.vtt`/`.srt` subtitles first, then embedded subtitles. If neither exists and the video has audio, it uses the local Whisper runtime.

The first Whisper transcript request downloads pinned `onnx-community/whisper-base` quantized files into the user agent directory, initializes the selected runtime, verifies a second load with remote access disabled, and only then writes the prepared marker. Later transcription is offline and shares the verified model between CLI and Desktop. Set `METIS_VIDEO_TRANSCRIPTION_DEVICE=cpu|coreml|webgpu` before the first transcript request to select a device; `cpu` is the default. `METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE=1` intentionally disables automatic preparation. Transcript cache entries are invalidated when the source file changes.

If preparation fails, `transcript` returns an actionable network/filesystem message instead of throwing a tool error. Retry the same request after fixing the reported condition.

## Runtime assets

The build copies FFmpeg and FFprobe into Metis' own `dist/video-bin/` directory. npm CLI and Desktop releases resolve these bundled copies before dependency install paths, so installs made with `--ignore-scripts` remain usable. Compiled Bun distributions place the same files beside the executable under `video-bin/`. Packaging fails if either binary is absent, and Desktop packaging executes both binaries before producing the DMG. These executables are GPL-3.0 licensed; see their upstream packages: [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) and [ffprobe-static](https://github.com/derhuerst/ffprobe-static).
