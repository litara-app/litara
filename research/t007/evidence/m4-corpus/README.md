# M4 evidence: synthetic corpus through the real stack (2026-11-18)

Fixtures were generated, ingested by the real server (disposable stack) and read back through the API. Audio: 20 s sine files made with ffmpeg 8.0.1 (MP3, M4A, FLAC, Ogg Vorbis, Opus, WAV, ADTS AAC), a 30 s M4B with three embedded chapters, a three-part MP3 recording. Ebooks: Calibre `ebook-convert` of the synthetic EPUB to MOBI, AZW3 and FB2, a copied `.kepub.epub`, a hand-built fixed-layout EPUB, and a truncated (damaged) EPUB. Results: `audio-corpus.json`, `ebook-corpus.json`; interpretation in `research/t007/capabilities.md`.

Findings: **F5** FLAC/Ogg/Opus/WAV/AAC are inspected correctly but marked `incomplete` and neither playable nor downloadable because of the `catalog.SupportedMIME` allowlist (policy, not codec); **F6** a damaged EPUB is reported `ready`/`supported` (capabilities are format-level, no container validation, no stored damaged state; adding one needs a schema/behavior decision). The KEPUB copy joined the existing "Synthetic Tale" title (same identifier) with `format_untested`.

Not covered: playback or seek on any client for these files in T007, real-world files, DRM/encrypted files, files over 4 GiB, solid/encrypted comic archives.
