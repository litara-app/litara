# ADR-0028: Bundle ffprobe and FFmpeg; defer WASM evaluation

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner
Supersedes: [ADR-0026](0026-evaluate-wasm-media-inspection.md)

## Context

The [decision matrix](../research/media-inspection/decision-matrix.md) compared Go parsers, WASM, native tools, bindings, and separate workers. The initial WASM inspection prototype passed generated fixtures but did not establish broad audiobook coverage. The user selected bundled ffprobe plus FFmpeg as the most compelling current approach and requested WASM remain an eventual testing follow-up.

## Decision

Bundle pinned native ffprobe and FFmpeg executables with supported Litara application packages/container images. Invoke them from the Go application as managed subprocesses rather than selecting in-process libav bindings. Use ffprobe for media inspection; make FFmpeg available for explicitly designed media operations. Users of packaged deployments must not need to install FFmpeg on the host separately.

Retain the WASM prototype and its results as research. Defer further WASM testing; it is not the selected production backend or a prerequisite to implementing the native tool path. A future replacement/fallback decision requires evidence and an accepted ADR.

## Alternatives

- Continue WASM as the primary candidate before implementing a production extractor.
- Use strict Go parsers only.
- Use CGO or no-CGO bindings to native libav libraries.
- Bundle the native executables now and keep WASM as later research, as selected.

## Consequences

The server remains Go, while deployment includes native media tools built for each supported platform. Pin their provenance, versions, codecs, license variant, and notices; manage updates alongside Litara releases. Preserve original library bytes. Bundling FFmpeg does not select automatic transcoding, on-demand conversion, conversion presets, or a derived-file lifecycle. Those behaviors remain undecided.

Run media work under the accepted bounded job architecture, with cancellation/time limits, bounded captured output, and explicit errors. Pass arguments directly rather than constructing shell commands. A subprocess boundary is not automatically a filesystem sandbox. Handle NAS disconnects and incomplete files without fabricating timing or deleting catalog state. Original-file HTTP range serving remains the Go server's responsibility.

## Verification

Planned: verify both executables exist in each supported package/image and operate without a host install or runtime download. Exercise representative M4B/M4A, VBR MP3, Ogg/Opus, FLAC, chapter/artwork variants, and large files. Check resource bounds, cancellation, process exit/error handling, NAS interruptions, and retry behavior. Record binary versions/build options and required notices. No native extractor or packaging implementation was performed when recording this decision.

## Open questions

Exact binary versions/build source, supported platforms, codec/license build configuration, process limits and inspection schema remain open. Transcoding policy and derived-media storage/timing/versioning need separate decisions. The deferred WASM checklist is maintained in [the follow-up](../research/media-inspection/wasm-follow-up.md).

## References

- [ffprobe documentation](https://ffmpeg.org/ffprobe.html)
- [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html)
- [Existing WASM experiment](../research/media-inspection/README.md)
