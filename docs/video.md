# Video Tool

`video` lets Metis inspect a local video without placing video bytes in model context. It provides metadata, a timestamped overview, ordered motion evidence, independent high-resolution frames, and transcript text.

## Actions

| Action | Result |
| --- | --- |
| `inspect` (default) | probes metadata, then returns instructions for next calls; it does not generate frames or transcript |
| `storyboard` | one 3×3 image containing nine ordered frames plus an explicit cell-to-timestamp mapping |
| `motion` | 4–9 ordered samples spanning `start..end`, per-step pixel-change metrics, and a separate motion-evidence map |
| `frames` | up to six independent high-quality JPEG frames for readable text, UI styling, and exact visual state |
| `transcript` | timestamped subtitle/transcript text only |

`path` is required. `start`, `end`, and each `timestamps` value accept seconds, `MM:SS`, or `HH:MM:SS.mmm`. `start` and `end` limit storyboard sampling, default frame sampling, and transcript output.

Use `storyboard` to navigate time, not to prove small visual details: read cells left-to-right, top-to-bottom and pair `#1`–`#9` with the timestamp mapping returned beside the image. Timestamps remain outside pixels so rendering does not depend on FFmpeg's optional `drawtext` filter across macOS, Windows, and Linux. Each cell is only 512×512. Before reporting website copy, typography, colors, spacing, layout, selected controls, cursor targets, or other UI details, call `frames` with explicit `timestamps`. Each result is a separate high-quality JPEG capped to 2048 pixels on its longest dimension without upscaling. If `timestamps` is omitted, `frames` returns four evenly spaced frames from the requested range.

`frames` also accepts `crop={x,y,width,height}` using normalized 0–1 coordinates. Crop a header, button, table, dialog, or other small region when the full frame still makes details hard to read. For clicks, animation, scrolling, or state transitions, compare timestamps immediately before and after the event. `inspect` reports frame rate so adjacent samples can be placed one to four source frames apart.

Use `motion` only after locating an event range. Pass a tight `start` and `end`; `count` defaults to six and accepts 4–9. Samples always span the requested range, so they are not necessarily consecutive source frames. The result reports exact timestamps, seconds between samples, estimated source-frame gap, and one of two sampling modes:

- `near-continuous`: samples are no more than four source frames apart and can support finer transition analysis;
- `sparse`: samples show broad phases but may omit intermediate movement; narrow the range and call `motion` again before making precise timing or direction claims.

The first motion image is the ordered sample grid: read it left-to-right, top-to-bottom and pair each cell with the numbered timestamp mapping in the adjacent text. The second is a motion-evidence map where brighter red pixels indicate larger changes between adjacent samples. Pixel-change ratios, bounding boxes, and broad/localized coverage are heuristics. They cannot by themselves distinguish subject movement from camera movement, a scene cut, a fade, lighting change, or compression noise. Inspect the ordered frames before assigning a cause.

For local Whisper transcription, pass `language` when known (for example `zh` or `en`). Transformers.js does not currently auto-detect Whisper language, so an omitted or `auto` value uses `en`.

Call `inspect` first. It returns duration, dimensions, frame rate, available streams, and an evidence protocol. Recommended flow: use `storyboard` to locate time, `motion` to follow change across a tight interval, `frames` or `crop` to confirm exact states, and `transcript` only for spoken or subtitle text. `inspect` never preselects a fixed analysis pipeline.

## Transcript source and privacy

Metis reads sidecar `.vtt`/`.srt` subtitles first, then embedded subtitles. If neither exists and the video has audio, it uses the local Whisper runtime.

The first Whisper transcript request downloads pinned `onnx-community/whisper-base` quantized files into the user agent directory, initializes the selected runtime, verifies a second load with remote access disabled, and only then writes the prepared marker. Later transcription is offline and shares the verified model between CLI and Desktop. Set `METIS_VIDEO_TRANSCRIPTION_DEVICE=cpu|coreml|webgpu` before the first transcript request to select a device; `cpu` is the default. `METIS_SKIP_VIDEO_TRANSCRIPTION_PREPARE=1` intentionally disables automatic preparation. Transcript cache entries are invalidated when the source file changes.

If preparation fails, `transcript` returns an actionable network/filesystem message instead of throwing a tool error. Retry the same request after fixing the reported condition.

## Runtime assets

The build copies FFmpeg and FFprobe into Metis' own `dist/video-bin/` directory. npm CLI and Desktop releases resolve these bundled copies before dependency install paths, so installs made with `--ignore-scripts` remain usable. Compiled Bun distributions place the same files beside the executable under `video-bin/`. Packaging fails if either binary is absent, and Desktop packaging executes both binaries before producing the DMG. These executables are GPL-3.0 licensed; see their upstream packages: [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) and [ffprobe-static](https://github.com/derhuerst/ffprobe-static).
