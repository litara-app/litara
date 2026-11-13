# Go/WASM media inspection evaluation

Date: 2026-11-12. Experiment authorized by historical [ADR-0026](../../ADR/0026-evaluate-wasm-media-inspection.md). Current selection: [ADR-0028](../../ADR/0028-bundle-native-ffmpeg-tools.md) chooses bundled native ffprobe/FFmpeg and defers further WASM work. Preserve these results as research; see [the follow-up checklist](wasm-follow-up.md).

## Result

**The initial inspection prototype passed.** afmpeg ran an FFmpeg-derived WASM engine inside a Go process with `CGO_ENABLED=0`, without a native FFmpeg/ffprobe executable. This is a promising deployment option, not an accepted production extractor or verified broad-format implementation.

The authoritative captured output is [results.json](results.json). The experiment uses generated media, not library books, and does not transcode anything.

| Check | Observed result |
| --- | --- |
| Two-second mono PCM WAV | Correct duration, sample rate, channels, and codec |
| Generated WAV with INFO title and two cue/label chapters | Correct title, both chapter titles, and 0–1/1–2 second bounds |
| Virtual RF64/WAV with an 8 GiB payload | Correct 536870.912-second duration; only 65,536 bytes read through the host bridge |
| Malformed input | Probe returned an error |
| Already-cancelled request | Probe returned an error |

The virtual large input is a seekable synthetic file, not 8 GiB of allocated RAM or disk data. This establishes size-aware bounded reading for this container, not arbitrary large-offset seeking correctness for every format. Small fixtures are read from a read-only, directory-scoped OS filesystem; the large fixture is supplied by the instrumented filesystem implementation.

In the recorded run, the three probes took 8/6/5 ms after runtime initialization; initialization took 1,311 ms including acquisition/verification/cache access and compilation. These are single-run observations, not stable benchmarks. An earlier initialization including first engine acquisition took 4,359 ms. Sampled Go heap allocation was about 41 MB in the recorded run. These samples are **not peak process memory**; a separate 256 MiB guest linear-memory limit was configured.

## Reproducibility and boundaries

- Host: Windows/amd64.
- Installed Go: 1.25.4. afmpeg v0.16.1 requires Go >= 1.27.1; the experiment downloaded Go 1.27.1 into its ignored module cache without replacing installed Go.
- Wrapper: `gitlab.com/phpboyscout/afmpeg v0.16.1`, source commit `dd1a514597414bffe29261bd2bd405d92d956186`. Dependencies are recorded in `go.mod`/`go.sum`.
- Engine: `ffmpeg-wasi n9.0.1-8`, LGPL lean WASM, release source commit `e576598926663c22474916b0a6c91782821626f1`.
- The wrapper's certified release loader verifies the signed checksums, engine/provenance hashes, and declared variant. The current release assets are hosted at the project's `https://pkg.phpboyscout.uk/ffmpeg-wasi` mirror; the wrapper's default GitLab package URL is overridden with this published release location.
- Guest timeout: 30 seconds per invocation; overall experiment context: five minutes. No native backend is imported or selected. No conversion operation is invoked.
- Engine, toolchain, generated fixtures, and dependency/build caches stay under ignored `.cache/`. Application dependency files are unaffected.

Run from any working directory:

```powershell
pwsh -NoProfile -File G:/Programming/ebooker/research/media-inspection/run.ps1
```

The script formats this research module, resolves pinned dependencies, and runs the assertions. It may download the pinned toolchain, dependencies, and verified engine. Engine loading still performs network requests for verification metadata; the prototype is **not offline-ready**. The library source exposes an offline release-bundle verification option, but this was not exercised. `results.json` is replaced only after engine initialization and probe execution reach report generation; if startup fails, an older result file may remain. Check the command exit status.

## Still unverified

- Real M4B/M4A AAC/ALAC files; both Nero-style and QuickTime text-track chapter variants; embedded artwork extraction.
- VBR MP3 duration/chapters; Ogg/Opus and FLAC; truncated or hostile variants beyond the tiny malformed fixture.
- Large real MP4 structures, >4 GiB seek offsets, long tag/chapter tables, and NAS-backed reads.
- Peak/RSS memory, sustained scan throughput, concurrent runtime pools, timeouts during active parsing, and worker crash/retry behavior.
- Linux/amd64 and Linux/arm64 deployment and offline verified engine bundles.
- Client codec compatibility, real Android/Cast integration, conversion performance, and derived-file identity/timing behavior. Conversion is not authorized by this evaluation.

When the deferred WASM evaluation resumes, use provenance-known fixtures across those audio formats and compare extracted timing/chapters with known expected values and the selected native tools. A future WASM adoption/fallback decision needs a new ADR after corpus and deployment checks.

## Evidence and licensing

[The supplied showcase](https://phpboyscout.uk/showcase/media-in-pure-go/) introduced this candidate. [afmpeg](https://afmpeg.phpboyscout.uk/) is the Go wrapper; [the engine probe contract](https://ffmpeg-wasi.phpboyscout.uk/reference/job-spec/) documents structured inspection results. Context7 had no matching afmpeg entry, so its primary documentation and the downloaded pinned source were inspected directly; wazero documentation was fetched through Context7.

The wrapper is MIT, but the tested FFmpeg engine is LGPL-2.1-or-later per verified provenance. No engine binary is committed here. WASM changes execution/packaging, not the engine's license. Shipping it with Litara will require its own notices/source-distribution arrangements. Source review confirms a separate native backend exists; selecting it would reintroduce a subprocess and needs a separate decision.
