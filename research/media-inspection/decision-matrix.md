# Media inspection and FFmpeg integration decision matrix

Reviewed: 2026-11-12. Following this comparison, the user selected bundled native ffprobe/FFmpeg in [ADR-0028](../../ADR/0028-bundle-native-ffmpeg-tools.md). WASM is deferred follow-up research. The options and evidence below remain useful comparisons; automatic transcoding has not been selected.

## What Litara needs

Reliable container/codec identification, duration, tags, artwork, chapters, and seekable large-file inspection support library scanning. Conversion is a separate feature: useful for incompatible playback clients but unnecessary for serving originals. Ordinary HTTP Range delivery belongs to the Go server regardless of extractor choice.

No implementation automatically guarantees every audiobook variant or every client codec. Resource limits, bounded concurrency, restart recovery, and format fixtures are required for every option.

## Options

| Option | Deployment and execution | Inspection coverage | Conversion | Litara assessment |
| --- | --- | --- | --- | --- |
| Native Go parsers | Go libraries only; no FFmpeg engine, native libs, or process | Compose tag/container libraries and verify missing duration/chapter paths | Requires additional Go implementations; not a general FFmpeg substitute | Simplest runtime dependency model; largest format-specific engineering commitment |
| afmpeg + FFmpeg WASM | Go/wazero plus a pinned WASM engine; no CGO or native media process | Structured probe supports timing/tags/chapters; our generated fixture checks pass | Available within the selected engine profile; unmeasured on long audio | Deferred follow-up; real corpus and platform checks still needed |
| Native ffprobe/FFmpeg executables | Bundle per-platform tools, usually in the app container; Go can remain CGO-disabled | Native ffprobe provides machine-readable stream/container information | Native FFmpeg pipelines | Selected in ADR-0028; packaging/updating tools remains our responsibility |
| CGO library bindings, e.g. go-astiav | C build toolchain/headers and compatible libav libraries; in-process native calls | Direct demux/metadata access; application assembles results | Fine-grained decoding/filtering/encoding | Useful for custom media pipelines; adds native memory lifecycle and build/version coupling for an inspection-first app |
| No-CGO dynamic library bindings, e.g. ffgo/purego | CGO-disabled Go build, native libav libraries at runtime, and potentially a platform C shim | Direct native inspection through wrapper coverage; shim/version requirements matter | Native conversion through exposed APIs | Avoids CGO build integration, but not native dependencies, ABI coupling, or in-process native-code failure exposure |
| afmpeg native backend | Same wrapper family plus a separate native engine driver | Structured native probe API | Native engine processing | Possible later backend change; published driver currently targets Linux/amd64, restricting our deployment matrix |
| Separate media worker/service | Native tools or bindings in a separate container/process with a work protocol and shared/mapped storage | Depends on chosen engine | Can isolate/scale expensive conversions | Keeps native media dependencies outside the API process, at the cost of another deployment component and more file/job coordination |
| Native Go fast path + WASM fallback | Both parser libraries and the WASM engine | Common inputs handled in Go, others delegated; normalize provenance/errors | Delegate supported conversions if later authorized | A potential optimization after measurement; dual implementations increase correctness and maintenance work |

Inspection/encoding performance has not been compared on a shared Litara corpus. Native conversion paths can use native threading/CPU facilities; the documented WASM engine has constraints, but published video-encoding ratios must not be applied to audiobook probing or audio conversion. The table's suitability assessments are engineering judgments, not benchmark rankings.

## What the names mean

- `ffmpeg-go` is a command-building wrapper around external executables, not an in-process FFmpeg engine. It belongs to the native CLI row; a Go import does not eliminate binary packaging.
- `go-astiav` is an actual C API binding. Its current README targets FFmpeg n9.0 and documents explicit allocation/free patterns; pin a matching dependency set.
- `ffgo` loads native FFmpeg through purego. Its README documents an optional C shim needed for some platform/version combinations, including accurate timing/chapter metadata. Purego itself does not make C memory lifetimes or ABI signatures safe automatically.
- afmpeg's WASM and native backends are distinct execution choices. Only the WASM path has been exercised here. The Go wrapper's MIT license is distinct from the selected engine artifact's license.

## NAS, failure behavior, and packaging

All in-process/filepath approaches can inspect mounted NAS files only as well as the application's I/O and mount-health handling permit. Custom seekable I/O is especially relevant to WASM/bindings. Native CLI tools can read mounted paths; a separate worker needs consistent mounts/path mapping or a transfer protocol. None removes network latency or partial-read failures.

WASM constrains guest access/memory through the host configuration; host buffers, runtime compilation, and pool size still consume resources. Native bindings share the API process's address space. Native subprocesses offer a process boundary, but are not automatically a filesystem/security sandbox. Separate workers add a stronger operational boundary only when configured accordingly.

Bundling tools in Docker does not require the end user to install host FFmpeg. It does require platform-specific images/assets. WASM likewise needs a verified engine asset, and our current prototype still fetches verification metadata online; offline packaging remains untested. All FFmpeg-derived paths need engine-specific license/notices and distribution review, regardless of the wrapper's license.

## Current selection and future decision gates

1. Implement the selected bundled ffprobe/FFmpeg path, verifying broad audiobook inspection and reproducible per-platform packaging. Conversion behavior still needs an explicit feature decision.
2. Preserve WASM as a deferred comparison using the same corpus and measured native results. Its remaining checks are tracked in [the follow-up](wasm-follow-up.md). Do not gate native implementation on completing this research.
3. Choose CGO/dynamic bindings only if a concrete custom-I/O or frame-processing requirement justifies the extra native integration. Consider a separate worker if conversion becomes operationally significant; that would require revisiting the accepted initial topology.
4. Keep strict Go parsers as the deliberate option for no FFmpeg-derived engine at all, accepting the associated format implementation/verification work. Add mixed fast paths only after profiling identifies a meaningful bottleneck.

Production acceptance should require correct timing/chapters/artwork on representative fixtures, tested bounded memory/time/cancellation, reproducible offline packaging, supported deployment platforms, and recoverable jobs. The exact thresholds and winning implementation remain undecided.

## Evidence

- [Local tested results and limitations](README.md): afmpeg v0.16.1 with verified LGPL engine n9.0.1-8; generated WAV metadata/chapters and virtual 8 GiB RF64 only. No native alternative was benchmarked.
- [afmpeg](https://afmpeg.phpboyscout.uk/) and [supplied showcase](https://phpboyscout.uk/showcase/media-in-pure-go/): backend distinction, runtime model, and deployment limitations. The pinned source under the ignored research cache was also inspected.
- [Engine codecs](https://ffmpeg-wasi.phpboyscout.uk/reference/codecs/) and [containers](https://ffmpeg-wasi.phpboyscout.uk/reference/containers/): profile-dependent capability lists, not evidence that Litara tested every listed format.
- [ffprobe](https://ffmpeg.org/ffprobe.html) and [FFmpeg](https://ffmpeg.org/ffmpeg.html): native inspection and processing interfaces.
- [go-astiav](https://github.com/asticode/go-astiav): native dependencies, version coupling, memory lifecycle. Current docs fetched through Context7.
- [ffmpeg-go](https://github.com/u2takey/ffmpeg-go): CLI wrapper and external executable requirement. Current docs fetched through Context7.
- [ffgo](https://github.com/obinnaokechukwu/ffgo): dynamic library/shim architecture and platform caveats.
- [purego](https://github.com/ebitengine/purego): no-CGO native calls and ABI/lifetime limitations. Current docs fetched through Context7.
- [Tag](https://github.com/dhowden/tag), [go-mp4](https://github.com/abema/go-mp4): examples of Go inspection building blocks, not a complete selected extractor.
