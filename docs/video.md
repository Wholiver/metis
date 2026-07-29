# Video Tool

`video` lets Metis inspect a local video without placing video bytes in model context. It provides a timestamped overview, independent high-fidelity frames, and transcript text.

## Actions

| Action | Result |
| --- | --- |
| `inspect` (default) | probes metadata, then returns instructions for next calls; it does not generate frames or transcript |
| `storyboard` | one 3×3 image containing nine timestamped frames |
| `frames` | up to six independent lossless PNG frames for readable text, UI styling, and exact visual state |
| `transcript` | timestamped subtitle/transcript text only |

`path` is required. `start`, `end`, and each `timestamps` value accept seconds, `MM:SS`, or `HH:MM:SS.mmm`. `start` and `end` limit storyboard sampling, default frame sampling, and transcript output.

Use `storyboard` to navigate time, not to prove small visual details: each cell is only 512×512. Before reporting website copy, typography, colors, spacing, layout, selected controls, cursor targets, or other UI details, call `frames` with explicit `timestamps`. Each result is a separate PNG at source resolution, capped to 2048 pixels on its longest dimension without upscaling. If `timestamps` is omitted, `frames` returns four evenly spaced frames from the requested range.

`frames` also accepts `crop={x,y,width,height}` using normalized 0–1 coordinates. Crop a header, button, table, dialog, or other small region when the full frame still makes details hard to read. For clicks, animation, scrolling, or state transitions, compare timestamps immediately before and after the event. `inspect` reports frame rate so adjacent samples can be placed one to four source frames apart.

For local Whisper transcription, pass `language` when known (for example `zh` or `en`). Transformers.js does not currently auto-detect Whisper language, so an omitted or `auto` value uses `en`.

Call `inspect` first. It returns duration, dimensions, frame rate, available streams, and a small evidence protocol. The model then chooses an overview storyboard, high-fidelity frames, transcript, or a combination; `inspect` never preselects a fixed analysis pipeline.

## Transcript source and privacy

Metis reads sidecar `.vtt`/`.srt` subtitles first, then embedded subtitles. If neither exists and the video has audio, it uses the local Whisper runtime.

The first Whisper transcript request downloads pinned `onnx-community/whisper-base` quantized files into the user agent directory, initializes the selected runtime, verifies a second load with remote access disabled, and only then writes the prepared marker. Later transcription is offline and shares the verified model between CLI and Desktop. Set `METIS_VIDEO_TRANSCRIPTION_DEVICE=cpu|coreml|webgpu` before the first transcript request to select a device; `cpu` is the default. `METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE=1` intentionally disables automatic preparation. Transcript cache entries are invalidated when the source file changes.

If preparation fails, `transcript` returns an actionable network/filesystem message instead of throwing a tool error. Retry the same request after fixing the reported condition.

## Runtime assets

The build copies FFmpeg and FFprobe into Metis' own `dist/video-bin/` directory. npm CLI and Desktop releases resolve these bundled copies before dependency install paths, so installs made with `--ignore-scripts` remain usable. Compiled Bun distributions place the same files beside the executable under `video-bin/`. Packaging fails if either binary is absent, and Desktop packaging executes both binaries before producing the DMG. These executables are GPL-3.0 licensed; see their upstream packages: [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) and [ffprobe-static](https://github.com/derhuerst/ffprobe-static).
