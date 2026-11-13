# Deferred WASM media inspection follow-up

Status: Deferred follow-up
Recorded: 2026-11-12
Current decision: [ADR-0028](../../ADR/0028-bundle-native-ffmpeg-tools.md)

Bundled native ffprobe/FFmpeg is the current implementation direction. The user requested WASM remain an eventual testing follow-up. This is a work backlog, not a scheduled task, production fallback, or prerequisite for the native implementation.

## Preserve

- The isolated research module, dependency pins, generated fixture code, and [captured results](results.json).
- The [report](README.md) distinguishing passed synthetic checks from unverified real audiobook cases.
- Engine provenance and licensing evidence. Cache contents are local/ignored and can be reacquired.

## Resume with a shared corpus

Compare WASM and the selected native inspection implementation using the same provenance-known M4B/M4A chapter variants, VBR MP3, Ogg/Opus, FLAC, artwork, damaged files, and large files. Keep expected metadata/timing results independent of the candidate being tested; investigate disagreements rather than treating either engine as infallible.

Measure startup, warm inspection, bytes/seeks, peak host and guest memory, sustained throughput, bounded parallelism, active cancellation, and NAS interruptions. Verify Linux deployment targets and offline signed-bundle loading. Reassess package/engine maintenance and supported profiles at that time.

## Decision after testing

Report correctness, deployment costs, and reproducible measurements. Propose an ADR only if the evidence supports WASM as a replacement, optional backend, or narrowly scoped fallback. Do not silently add it to production. Conversion is a separate evaluation and requires explicit authorization/policy.
