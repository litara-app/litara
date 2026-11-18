# T007 release gates (worker status, not acceptance)

States are the worker's observation as of the latest commit: `passed`, `partial` (some evidence, blocker named), `pending` (not run), `failed`, `blocked`, `not-applicable`. Nothing here authorizes a release, marks T007 done, or reduces scope; only the user/coordinator can accept a scope reduction. Detailed per-scenario evidence paths are in `coverage.json`.

## Scenarios

| ID | Gate | State | Evidence | Open boundary |
| --- | --- | --- | --- | --- |
| `native-catalog` | Native edition/catalog acquisition | **partial** | `research/t007/evidence/m1-epub/README.md` | Synthetic two-book library only; no real corpus. |
| `native-reflowable` | Native reflowable reader | **partial** | `research/t007/evidence/m1-epub/README.md`, `research/t007/evidence/m1-locators/` | Synthetic fixtures; KEPUB/MOBI/AZW unproven. |
| `native-pdf-comic` | Native PDF and comic reader | **partial** | `research/t007/evidence/m1-pdf-comics/` | CBR/CB7, rotated/encrypted PDFs, comic offline not covered. |
| `locator-roundtrip` | Web/native actual locator compatibility | **partial** | `research/t007/evidence/m1-locators/` | Synthetic fixtures; sub-page PDF coordinates and KEPUB/MOBI open. |
| `native-personal-state` | Native annotations, shelves and completion | **partial** | `research/t007/evidence/m1-annotations/`, `research/t007/evidence/m1-finish-conflicts/` | Shelves UI, real two-writer annotation conflicts, account switch not covered. |
| `native-offline-isolation` | Native durable queues and downloads | **pending** | - | Not started. |
| `audio-regression` | Integrated native/web audio regression | **pending** | - | Not started. |
| `auth-refresh` | Sessions, refresh and grant revocation | **partial** | `research/t007/evidence/m3-tls-origins/run.json` | Native refresh rotation and session revocation over TLS; grant revocation and token race on device only in slice 4 notes. |
| `ingest-reader` | Ingestion to edition/recording workflows | **pending** | - | Not started. |
| `repair-native` | Recording repair with old clients/offline state | **pending** | - | Not started. |
| `metadata-writers` | Per-format in-file writer fidelity | **partial** | `research/t007/evidence/m2-epub-writer/README.md`, `research/t007/evidence/m2-epub-writer/live-run.json` | EPUB only; MP3/FLAC/M4A/M4B have no writer and stay disabled with a visible reason. |
| `write-recovery` | Reviewed write/import safety | **partial** | `research/t007/evidence/m3-writeback-kill/run.json`, `research/t007/evidence/m3-import-kill/run.json` | No-overwrite publication race and filesystems without hard links (NAS) not tested; backup on/failure paths not exercised live. |
| `providers` | Opt-in provider qualification | **pending** | - | Not started. |
| `reconcile-concurrency` | Reconciliation and concurrent workers | **pending** | - | Not started. |
| `tls-reader-isolation` | Actual TLS and separate reader origin | **partial** | `research/t007/evidence/m3-tls-origins/` | No real browser, no production proxy config, reader asset packaging open. |
| `process-restart` | Process-death job/state recovery | **passed** | `research/t007/evidence/m3-kill-recovery/README.md`, `research/t007/evidence/m3-writeback-kill/run.json`, `research/t007/evidence/m3-import-kill/run.json` | Single-host Windows, default rescue 5 min; no concurrent-load or container-supervisor kills. |
| `smtp-key-restart` | SMTP key loss through real restart | **partial** | `research/t007/evidence/m3-backup-restore/run.json` | Missing, other-id and wrong-material key restarts observed; same-id wrong key is reported available (finding). |
| `secret-logs` | Credential log regression | **pending** | - | Not started. |
| `opds-conformance` | OPDS semantic/conformance closure | **pending** | - | Not started. |
| `backup-restore` | Independent whole-stack restore rehearsal | **partial** | `research/t007/evidence/m3-backup-restore/` | No audio/KOReader/queued-delivery restore, same-path media required, single host. |
| `package-notices` | Unsigned package and provenance | **pending** | - | Not started. |
| `corpus-capabilities` | Realistic per-capability corpus | **pending** | - | Not started. |
| `nas-mounted` | Mounted NAS acceptance | **pending** | - | Needs a user-assisted mounted SMB/NFS test share. |
| `koreader-app` | Actual KOReader/OPDS app over TLS | **pending** | - | Needs the actual KOReader/OPDS apps over TLS. |
| `koreader-large-digest` | Upstream large-file digest agreement | **pending** | - | Not started. |
| `accessibility` | Screen-reader, keyboard and touch | **pending** | - | Needs screen reader, keyboard and touch checks by a person. |
| `android-emulator` | Both Android emulator flavors | **partial** | `research/t007/logs/instrumented-results/`, `handoffs/T007.md` | 24/24 per flavor on API 36; API 37 blocked by Espresso 3.6.1 (finding F4); new screens lack instrumented tests. |
| `physical-phone` | Physical Android acceptance | **pending** | - | Physical Android resource/operator not confirmed. |
| `physical-auto` | Physical Android Auto acceptance | **pending** | - | Physical Android resource/operator not confirmed. |
| `physical-cast` | Delayed actual Chromecast debugging | **pending** | - | User requested Chromecast debugging last; actual receiver/controller not identified. |
| `migration-gate` | Separate migration release hold | **pending** | - | Separate package or explicit user decision required. |
| `release-policy` | Production decisions and release hold | **pending** | - | Separate package or explicit user decision required. |

## Held decisions and visible blockers

* **T008 / ADR-0063:** personal-state migration is a separate reserved task and a release hold; T007 neither implements nor weakens it.
* **ADR-0064:** GitHub Actions stays disabled; no CI, publishing, signing or tags were touched.
* **Metadata writers:** EPUB enabled-by-operator with evidence; MP3, FLAC, M4A, M4B have no writer and stay disabled with a visible reason and an open gate (not an undocumented stream-copy claim).
* **Findings needing a decision** (see `handoffs/T007.md`): absolute media paths make restores path-sensitive; SMTP `keyAvailable` overstates for a same-id wrong key; web lockfile fails `npm ci` on npm 11.21; managed-import targets use "Unknown Author"; KEPUB/MOBI/AZW locator compatibility is unproven; Android Espresso 3.6.1 cannot run on API 37; root `.gitattributes` for Windows checkouts.
* **Hardware:** physical phone, Android Auto head unit and Chromecast are not available to the worker and stay open.
