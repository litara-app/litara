# ADR-0026: Evaluate Go-hosted WASM for media inspection before selecting an extractor

Status: Superseded
Date: 2026-11-12
Decision owner: Repository owner
Superseded by: [ADR-0028](0028-bundle-native-ffmpeg-tools.md)

## Context

Historical evaluation-first decision. ADR-0028 now selects bundled native tools and defers further WASM testing; the original rationale and completed evidence below are retained.

The user first preferred strict pure-Go parsing over native helper executables, then requested investigation of afmpeg/ffmpeg-wasi. Native Go libraries offer useful tag and container primitives but are not a verified complete audiobook extractor. The supplied approach runs an FFmpeg-derived WASM engine in a Go runtime without CGO or a native helper process.

## Decision

The user accepted Go plus WASM as a candidate satisfying the deployment goal and authorized evaluating audiobook media inspection. Evaluate afmpeg with its WASM backend, including duration, chapters, tags, resource usage, file seeking, and reproducible engine acquisition. This authorizes an isolated research prototype, not selecting afmpeg for production, native subprocess fallback, or enabling transcoding.

## Alternatives

- Implement and validate all inspection using native Go parsers.
- Bundle native ffprobe; optionally add FFmpeg conversion later.
- Evaluate a no-CGO/no-subprocess WASM engine first, as selected.

## Consequences

Go hosting is not a Go rewrite of FFmpeg: the engine remains separately licensed compiled media code. Verify engine artifact/license/version independently of the MIT wrapper. Treat documentation as claims until tested on our corpus. Host-provided seekable filesystems may avoid whole-file RAM copies; do not infer that from in-memory examples. Preserve ordinary range serving outside inspection. Module download behavior, production packaging, architecture compatibility, and performance need evidence before adoption.

## Verification

Compare expected duration/tags/chapters against results from generated and provenance-known fixtures. Include VBR MP3, M4B chapter variants, Ogg/Opus, FLAC, and a large seekable input. Measure cold/warm probing, bytes read, memory, timeouts, cancellation and worker contention. Record pinned wrapper/engine versions, signatures/checksums, failures, and missing tests in `research/media-inspection/`. No transcoding or production extractor acceptance follows merely from a successful small-file probe.

Initial completed evidence: the [isolated prototype](../research/media-inspection/README.md) passed generated WAV duration, metadata/chapters, a virtual 8 GiB RF64 input with bounded reads, malformed-input rejection, and pre-cancelled-request rejection on Windows/amd64. Real audiobook formats, other platforms, peak memory, in-flight cancellation, and offline packaging remain unverified. This does not change the evaluation-only decision.

## Open questions

Does the candidate meet correctness and bounded-resource requirements? Can it operate offline after packaging? Which module profile, runtime/API version, license notices and supported platforms are needed? Production adoption, native fallback, and client codec conversion remain open.

## References

- [User-supplied showcase](https://phpboyscout.uk/showcase/media-in-pure-go/)
- [afmpeg](https://afmpeg.phpboyscout.uk/)
- [Probe vocabulary](https://ffmpeg-wasi.phpboyscout.uk/reference/job-spec/)
- [wazero](https://wazero.io/docs/)
