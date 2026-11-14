# Backend foundation (T001): design, setup and verification

Governing ADRs: 0002, 0003, 0007–0009, 0013–0016, 0018–0019, 0024–0025, 0028–0030. This note records what was built, how to run it, what was actually verified, and what is still open. Nothing here changes an accepted ADR.

## What exists

`apps/server/` is a single Go module (`github.com/deranjer/ebooker/apps/server`, Go 1.26.0) with two binaries:

| Binary | Purpose |
| --- | --- |
| `cmd/server` | Huma operational endpoints (`/healthz`, `/readyz`, generated OpenAPI) plus bounded River workers. Does **not** migrate. Refuses to start if the schema is behind. |
| `cmd/ctl` | Local-only operations: `migrate up\|status`, `tools`, `inspect <abs-path>`, `show <abs-path>`. This is the internal diagnostic harness; there is deliberately no HTTP endpoint that inspects arbitrary filesystem paths. |

Packages: `config` (typed env config), `db` (pool, Goose + River migrations, schema check), `db/sqlcgen` (sqlc output, committed), `inspect` (ffprobe subprocess + normalization), `jobs` (River worker + atomic submission), `httpapi`, `app` (wiring), `testutil`.

Pinned versions (`go.mod`): Huma v2.40.0, pgx v5.13.0, Goose v3.30.1, River v0.51.2 (core, `riverpgxv5`, `rivermigrate`), sqlc v1.31.1 (generator, installed separately). Development/test PostgreSQL is `postgres:17.6-alpine`. That is a **test/dev choice, not a production support window**.

## Setup (clean checkout)

Prerequisites: Go ≥ 1.26 (the module pins it; `GOTOOLCHAIN=auto` fetches it), Docker, `ffmpeg`/`ffprobe` on PATH for host-side tests (the container carries its own), and optionally `sqlc` v1.31.1.

```bash
# 1. database (dev only)
docker run -d --name litara-dev-pg -e POSTGRES_USER=litara -e POSTGRES_PASSWORD=litara \
  -e POSTGRES_DB=litara -p 54329:5432 postgres:17.6-alpine

# 2. explicit migration (application + River)
export LITARA_DATABASE_URL='postgres://litara:litara@localhost:54329/litara?sslmode=disable'
cd apps/server
go run ./cmd/ctl migrate up
go run ./cmd/ctl migrate status

# 3. durable diagnostic flow with an in-process worker
go run ./cmd/ctl inspect --with-worker /absolute/path/to/book.m4b

# or run the service and submit separately
go run ./cmd/server &
go run ./cmd/ctl inspect /absolute/path/to/book.m4b
curl localhost:8080/readyz
```

Configuration is environment-only (`LITARA_*`); see `deploy/.env.example` and `apps/server/internal/config/config.go`. Startup errors list every problem and never echo the database URL.

### Container / Compose

```bash
LITARA_MEDIA_DIR=/path/to/media docker compose -f deploy/compose.yaml up --build
```

The stack is `db` → one-shot `migrate` → `server`; media is mounted read-only at `/media`, database state is a named volume, and the server container has a read-only root filesystem. `scripts/backend/smoke.sh` automates a full pass (see below).

### Pre-production schema policy

The user selected a single application init migration until production readiness (ADR-0030, 2026-11-13). Keep first-party schema changes in `migrations/00001_init.sql`; freeze it before production and use incremental migrations afterward. River continues to own its independent migration history.

After changing init, initialize a **new development database** and point `LITARA_DATABASE_URL` at it. Already-applied version 1 is not replayed by Goose; databases from the previous two-migration baseline are not upgrade targets. Existing development data is not deleted automatically: retain the old database if needed. Production migration execution policy is still open.

## Design notes

- **Logical identity.** One `inspection_requests` row per cleaned absolute path (`request_key` = SHA-256 of the path). A repeated submission returns the existing request and enqueues nothing. `--reinspect` resets a terminal request and enqueues one new job. Eight concurrent submissions of one path yield one row, one job (tested).
- **Atomic submission.** The request insert and `river.InsertTx` share one transaction, so a request never exists without its job or vice versa. River's own uniqueness feature is intentionally not used: the table's unique key is the single source of truth.
- **State machine.** `queued → running → completed | failed | cancelled`, with `outcome` recording the last/terminal classification. Transitions are guarded in SQL (`WHERE state IN (...)`), so a re-delivered job after completion is a no-op and cannot overwrite the result. Completion writes the result and terminal state in one transaction.
- **Outcomes** (distinguishable, stored in `outcome`): `ok`, `incomplete` (container parsed but duration missing or no audio; result stored with issues, state `completed`), `missing_input`, `unreadable_input` (including outside `LITARA_MEDIA_ROOT`, directories), `malformed_media`, `tool_unavailable`, `tool_failure`, `io_error`, `timeout`, `output_limit`, `cancelled`.
- **Retry rules (per operation).** Permanent: `missing_input`, `unreadable_input`, `malformed_media`, `output_limit`. These are recorded as failed immediately and the job is cancelled (one attempt). Transient: `timeout`, `io_error`, `tool_failure`, `tool_unavailable`. Retried with `attempt² × base` backoff up to `LITARA_INSPECT_MAX_ATTEMPTS`, then recorded as failed with the last outcome. Shutdown/cancellation re-queues the request instead of failing it.
- **Restart recovery.** Graceful stop: the worker re-queues its request (`outcome=cancelled`, `queued`) and the next process resumes it. Crash: River's rescuer reclaims jobs stuck `running` longer than `LITARA_RESCUE_STUCK_AFTER`; the worker accepts a request already `running`. River requires `RESCUE_STUCK_AFTER ≥ job timeout`, and config validation enforces `≥ INSPECT_TIMEOUT + 30s`.
- **Subprocess boundary.** Argument arrays only, no shell. `-protocol_whitelist file` and a `file:` prefix stop names such as `pipe:0` or `http://…` being treated as URLs. Per-run deadline, stdout cap (`LITARA_MAX_PROBE_OUTPUT_BYTES`), 16 KiB stderr cap, 2 s `WaitDelay` kill. Files are only opened read-only. Persisted failure text is control-character-stripped and capped at 512 bytes; full probe dumps are never logged or stored beyond the normalized result. Failure messages can contain the input path and a short ffprobe line.
- **Normalization.** Container/stream codec, duration, bit rate, sample rate, channels, tags (lower-cased keys), embedded-picture *descriptors*, and file-relative chapters. Timeline values are milliseconds; chapters also keep `rawTimeBase/rawStart/rawEnd`; `rawDurationSeconds` keeps ffprobe's text. Missing, `N/A` or non-positive durations are `null`, never `0`. The container duration falls back to the first audio stream's duration with a `duration_from_stream` issue. Chapter positions are file-relative per ADR-0029.
- **Readiness.** `/readyz` pings PostgreSQL, compares the Goose version to the embedded target, validates River's schema, runs `ffprobe -version`, and checks the workers have started. It returns 503 with per-check reasons; liveness (`/healthz`) is independent. A database outage needs no reset: pooled connections reconnect (tested by terminating all backends).
- **Concurrency.** `MaxWorkers` on the River queue is the bound (`LITARA_INSPECT_WORKERS`, default 2, max 64).

## Verification performed

Environment: Windows 11 host, Go 1.26.0, host ffprobe/ffmpeg 8.0.1 (Gyan "essentials" build) for the Go tests, `postgres:17.6-alpine` in Docker Desktop, and the linux/amd64 image for the smoke path.

| Check | Command | Result |
| --- | --- | --- |
| format, vet, build, tidy, sqlc currency, all tests | `scripts/backend/check.sh` (with `LITARA_TEST_DATABASE_URL`, `LITARA_REQUIRE_INTEGRATION=1`) | `CHECK OK` |
| Container + Compose smoke | `scripts/backend/smoke.sh` | `SMOKE OK` |

Covered by tests (real PostgreSQL and real ffprobe unless noted):

- Fresh init (application version 1, provenance column and state index), current River migrations, and an idempotent re-run that preserves existing request/result data (`internal/db`). The earlier v1 → v2 demonstration was replaced under the pre-production init policy (ADR-0030).
- Durable submit → worker → persisted result; idempotent/concurrent submission; reinspect keeps one result (`internal/jobs`).
- Exactly-2 concurrent executions with 8 queued; maximum observed is 2.
- Graceful interruption re-queues and a second process completes it (attempts ≥ 2, one result). Simulated crash (job forced `running` with a stale attempt) is rescued and completed.
- Retry policy: a transient failure used all 3 attempts then failed as `timeout`; a permanent one made exactly 1 attempt. Missing input and `incomplete` are distinct persisted outcomes. (Retry tests use a scripted inspector; the classification of real ffprobe failures is covered in `internal/inspect`.)
- Inspector: CBR/VBR MP3, M4B (aac), FLAC, Opus, Ogg Vorbis; chapters and an attached picture descriptor; filenames with spaces/`;`/`$()`/quotes/leading dash/`%`/`&` (no shell expansion); missing, directory, relative path, garbage, empty, truncated media; tool not found; output limit; media-root violation; timeout; pre-cancelled context; originals' SHA-256 unchanged; a 3 GiB zero-extended file is rejected as unusable quickly and left unchanged.
- Readiness for unmigrated DB, stopped workers, missing ffprobe, closed pool, and recovery after all backends are killed.
- Smoke: image contains pinned `ffprobe`/`ffmpeg` (n8.1.3-35-gf1acb0a266) with no host install; `/readyz` ready; media mount is read-only; submissions made while the server is stopped are processed after restart; good/malformed/missing files end as `ok`/`malformed_media`/`missing_input`.

## Not verified / gaps (be explicit)

- **Hosted CI follow-up:** the original worker had not run GitHub Actions. PR #79 subsequently passed the backend check and container-smoke jobs before merge on 2026-11-13; TASKS.md records the coordinator verification. This does not add NAS/hardware/platform coverage.
- **Platforms.** Only linux/amd64 was built and run (image) and a Windows host for Go tests. No arm64, macOS or Windows container is claimed.
- **Real NAS.** Disappearing/unreadable-input behaviour is simulated (missing file, truncated file, killed DB connections). No real SMB/NFS interruption was tested.
- **Large valid media.** No multi-GB *valid* M4B/MP3 was inspected; only the zero-filled 3 GiB case. No CBR vs VBR duration accuracy comparison beyond ±250 ms on 3 s fixtures. No Opus-in-M4B, AAC-in-ADTS-only, or multi-file recordings.
- **Chapters.** Only embedded file-relative chapters. No CUE parsing, precedence, whole-recording timelines, file-boundary markers, user edits, or manifest publication (ADR-0029 later work).
- **Artwork.** Descriptors only (codec, size); bytes are not extracted or decoded.
- **Missing timing from a real file.** Covered by synthetic ffprobe JSON (`Normalize` tests) and by a video-only file (`incomplete`), not by a real audio file ffprobe cannot time.
- **Server signal handling.** Graceful shutdown code exists and `docker compose stop` exercised it in the smoke run, but exit logs/behaviour under in-flight work were not asserted by an automated test.
- **Context7.** The Context7 MCP server timed out at session start, so `AGENTS.md`'s documentation requirement was met with `go doc` and module source for Huma, River, rivermigrate, Goose and sqlc, not Context7.
- **Retry tests are slow.** River's scheduler promotes retryable jobs on its own interval, so the retry test takes a few seconds per attempt.

## Decisions needed (for coordinator/ADR review)

1. **Migration policy in production.** Today only `ctl migrate up` migrates; `server` refuses to start on a stale schema. Choose between explicit-only, a startup flag, or an init job.
2. **PostgreSQL support window.** 17.6 was used for tests only.
3. **Request identity.** Keying by path means a renamed or moved file is a new request. Align with ADR-0018 file/content identity when T003/T004 define it. Also decide whether `missing_input` should become retryable for NAS-mount flakiness (currently permanent; re-submit with `--reinspect`).
4. **River retention and failure retention.** Completed jobs are kept 24 h; `inspection_*` rows are never pruned.
5. **FFmpeg build variant and sourcing.** The image uses an LGPL static autobuild from `FFmpeg-Builds/FFmpeg-Builds` tag `autobuild-2026-11-12-15-40`, SHA-256 verified. Decide LGPL vs GPL, how to provide corresponding source/notices for distribution, how to mirror the archive (upstream autobuilds are pruned, so the pinned URL can disappear), and which platforms to ship.
6. **Windows/macOS packaging** is untouched.
7. **Log-field policy.** Failure messages and logs include the input path; confirm that is acceptable for support bundles.
8. **API conventions.** Huma is wired only for operational endpoints; no versioning, error-envelope or pagination convention was chosen.

## Licensing and provenance

First-party code is MIT-direction per ADR-0012/0017. Dependencies keep their own licenses (River is MPL-2.0; others are MIT/Apache/BSD). The bundled FFmpeg LGPL build ships its `LICENSE.txt` at `/usr/share/doc/litara/ffmpeg/` and build metadata at `/opt/litara/ffmpeg-BUILDINFO.txt`. No AGPL Android code was touched. Old scanner code under `archive/` was not read or ported.
