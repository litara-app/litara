# Fixture inventory (T001)

No media is committed. Every fixture is generated at test time, so provenance is the command. Generators: the host `ffmpeg` (tests) or the image's pinned `ffmpeg` (`scripts/backend/smoke.sh`). The audio source is always `-f lavfi -i sine=frequency=440:duration=N` (synthetic, license-free).

| Fixture | Generator settings | Used by | What it exercises |
| --- | --- | --- | --- |
| `cbr.mp3` | `-c:a libmp3lame -b:a 64k`, 3 s | `TestCommonFormats` | ordinary MP3, duration ≈ 3000 ms |
| `vbr.mp3` | `-c:a libmp3lame -q:a 4`, 3 s | `TestCommonFormats`, smoke | VBR MP3 |
| `book.m4b` | `-c:a aac -f ipod`, 3 s | `TestCommonFormats` | M4B/AAC |
| `track.flac` | `-c:a flac`, 3 s | `TestCommonFormats`, smoke | FLAC |
| `track.opus` | `-c:a libopus -b:a 32k`, 3 s | `TestCommonFormats`, smoke | Opus in Ogg |
| `track.ogg` | `-c:a libvorbis`, 3 s | `TestCommonFormats` | Vorbis |
| `book with chapters.m4b` | AAC + PNG (64×48, `attached_pic`) + ffmetadata with two 1/1000 chapters (0–1500, 1500–4000), 4 s | `TestChaptersAndArtwork` | embedded chapters, raw time-base provenance, artwork descriptor, format tags |
| shell-significant names | 1 s MP3 each: `a b`, `semi;colon`, `dollar$(touch pwned)`, `quote's`, `-leading-dash`, `pipe&amp`, `percent%20name` | `TestShellSignificantFilenames` | no shell/URL interpretation |
| `junk.mp3` | 50 000 bytes of text | `TestFailureOutcomesAreDistinct` | `malformed_media` |
| `empty.m4a` | 0 bytes | same | `malformed_media` |
| `trunc.m4a` | first third of a 3 s AAC file | same | damaged container; must not report `complete` |
| `huge.m4b` | 3 GiB zero-extended file (`Truncate`) | `TestLargeSparseFile…` | bounded rejection and unchanged size; **not** large valid media |
| `silent.mp4` | video-only, 1 s, `color=c=blue:s=64x64` | `TestMissingAndIncompleteOutcomesPersisted` | `incomplete` outcome (no audio stream) |
| `resume.m4b`, `crash.m4b`, `dup.m4a`, `f*.m4a` | 1–3 s AAC | `internal/jobs` tests | durability, restart, concurrency, idempotency |
| synthetic ffprobe JSON | inline in `inspector_test.go` | `TestNormalize…` | missing/`N/A`/zero duration, chapter without start, stream-duration fallback |

Smoke fixtures (container-generated): `book one.m4b`, `track.flac`, `track.opus`, `vbr.mp3`, `broken.mp3` (9 bytes of text), and a deliberately absent `missing.mp3`.

## Named gaps

Valid multi-GB audiobooks; multi-file recordings and CUE sidecars; ADTS-only AAC and other formats where ffprobe cannot time a real file; MP4 with chapter text tracks vs QuickTime chapter atoms; cover-art extraction; real NAS interruptions. Their absence means the broad format ADR-0025 is **not** fully implemented or verified.
