# T007 release gates (worker status, not acceptance)

States are the worker's observation as of the latest commit: `passed`, `partial` (some evidence, blocker named), `pending` (not run), `deferred`, `failed`, `blocked`, `not-applicable`. Nothing here authorizes a release, marks T007 done, or reduces scope; only the user/coordinator can accept a scope reduction. Detailed per-scenario evidence paths are in `coverage.json`.

## Scenarios

| ID | Gate | State | Evidence | Open boundary |
| --- | --- | --- | --- | --- |
| `native-catalog` | Native edition/catalog acquisition | **partial** | `research/t007/evidence/m1-epub/README.md` | Synthetic two-book library only; no real corpus. |
| `native-reflowable` | Native reflowable reader | **partial** | `research/t007/evidence/m1-epub/README.md`, `research/t007/evidence/m1-locators/` | Synthetic fixtures; KEPUB/MOBI/AZW unproven. |
| `native-pdf-comic` | Native PDF and comic reader | **partial** | `research/t007/evidence/m1-pdf-comics/` | CBR/CB7, rotated/encrypted PDFs, comic offline not covered. |
| `locator-roundtrip` | Web/native actual locator compatibility | **partial** | `research/t007/evidence/m1-locators/` | Synthetic fixtures; sub-page PDF coordinates and KEPUB/MOBI open. |
| `native-personal-state` | Native annotations, shelves and completion | **partial** | `research/t007/evidence/m1-annotations/`, `research/t007/evidence/m1-finish-conflicts/` | Shelves UI, real two-writer annotation conflicts, account switch not covered. |
| `native-offline-isolation` | Native durable queues and downloads | **partial** | `research/t007/evidence/m4-phone/README.md` | Account-scoped EPUB download and offline chapter list passed on the API 36 emulator. Offline PDF, phone follow-up and wider isolation remain open. |
| `audio-regression` | Integrated native/web audio regression | **partial** | `research/t007/evidence/m4-corpus/android-audio-playback.txt`, `research/t007/evidence/m4-corpus/audio-playback-chromium.json` | Native playback of the corpus only; offline completion, revocation, account switch and post-repair/replacement regression on native audio not re-run (G03). |
| `auth-refresh` | Sessions, refresh and grant revocation | **partial** | `research/t007/evidence/m3-tls-origins/run.json` | Native refresh rotation and session revocation over TLS; grant revocation and token race on device only in slice 4 notes. |
| `ingest-reader` | Ingestion to edition/recording workflows | **pending** | - | Not started. |
| `repair-native` | Recording repair with old clients/offline state | **pending** | - | Not started. |
| `metadata-writers` | Per-format in-file writer fidelity | **partial** | `research/t007/evidence/m2-epub-writer/README.md`, `research/t007/evidence/m2-epub-writer/live-run.json` | EPUB and [audio title writers](evidence/m2-audio-writers/README.md) qualified on generated fixtures. More fields and container layouts remain outside the tested scope. |
| `write-recovery` | Reviewed write/import safety | **partial** | `research/t007/evidence/m3-writeback-kill/run.json`, `research/t007/evidence/m3-import-kill/run.json` | No-overwrite publication race and filesystems without hard links (NAS) not tested; backup on/failure paths not exercised live. |
| `providers` | Opt-in provider qualification | **partial** | `research/t007/evidence/m2-providers/README.md` | Optional Open Library contact and shared provider budgets implemented. Audnexus retained. Google Books previously returned 429 without a key. Google caching terms and replica coordination remain open. |
| `reconcile-concurrency` | Reconciliation and concurrent workers | **pending** | - | Not started. |
| `tls-reader-isolation` | Actual TLS and separate reader origin | **partial** | `research/t007/evidence/m3-tls-origins/` | No real browser, no production proxy config, reader asset packaging open. |
| `process-restart` | Process-death job/state recovery | **passed** | `research/t007/evidence/m3-kill-recovery/README.md`, `research/t007/evidence/m3-writeback-kill/run.json`, `research/t007/evidence/m3-import-kill/run.json` | Single-host Windows, default rescue 5 min; no concurrent-load or container-supervisor kills. |
| `smtp-key-restart` | SMTP key loss through real restart | **partial** | `research/t007/evidence/m3-backup-restore/run.json` | Missing, other-id and wrong-material key restarts observed; same-id wrong key is reported available (finding). |
| `secret-logs` | Credential log regression | **partial** | `research/t007/evidence/m4-secret-logs/` | No leak found, but the server has no request/access log, so redaction is untested; Atom conformance validator not run. |
| `opds-conformance` | OPDS semantic/conformance closure | **partial** | `research/t007/evidence/m4-atom/README.md`, `research/t007/evidence/m4-atom/run.json` | Not formal validation (no Atom/OPDS 1.x RelaxNG validator); real OPDS client apps are a user-assisted gate; publication entry documents lack rel=self (advisory). |
| `backup-restore` | Independent whole-stack restore rehearsal | **partial** | `research/t007/evidence/m3-backup-restore/` | No audio/KOReader/queued-delivery restore, same-path media required, single host. |
| `package-notices` | Unsigned package and provenance | **partial** | `research/t007/evidence/m5-package/README.md`, `research/t007/evidence/m5-package/image-contents.txt`, `research/t007/evidence/m5-package/package-check.txt` | Reproducibility not compared; Android artifacts and FFmpeg component licences not audited; no signing (out of scope). |
| `corpus-capabilities` | Realistic per-capability corpus | **partial** | `research/t007/evidence/m4-corpus/`, `research/t007/capabilities.md`, `research/t007/evidence/m4-corpus/android-audio-playback.txt` | Synthetic fixtures only; no lawful real-world corpus, no >4 GiB valid media, WebKit (Windows) has no decoders. F6 is implemented for confirmed EPUB and KEPUB structural damage. |
| `nas-mounted` | Mounted NAS acceptance | **pending** | - | Needs a user-assisted mounted SMB/NFS test share. |
| `koreader-app` | Actual KOReader/OPDS app over TLS | **partial** | `research/t007/evidence/m4-koreader/` | KOReader OPDS and progress sync ran on the Pixel 9 Pro over TLS with the documented `/1` URL. Other client/device builds are open. |
| `koreader-large-digest` | Upstream large-file digest agreement | **passed** | `research/t007/evidence/m4-koreader-digest/README.md` | KOReader v2026.07.1 matched four local fixtures, including a synthetic ZIP64 CBZ beyond 4 GiB. |
| `accessibility` | Screen-reader, keyboard and touch | **deferred** | - | User-assisted screen reader, keyboard and touch are scheduled for a later segment. |
| `android-emulator` | Both Android emulator flavors | **partial** | `research/t007/logs/instrumented-results/`, `handoffs/T007.md` | 24/24 per flavor on API 36; API 37 blocked by Espresso 3.6.1 (finding F4); new screens lack instrumented tests. |
| `physical-phone` | Physical Android acceptance | **deferred** | `research/t007/evidence/m4-phone/README.md` | Initial physical-phone session ran. F10 confirmation and follow-up Android checks are deferred. |
| `physical-auto` | Physical Android Auto acceptance | **deferred** | - | User-assisted Android Auto is scheduled for a later segment. |
| `physical-cast` | Delayed actual Chromecast debugging | **deferred** | - | Actual Chromecast is the final user-assisted check in a later segment. |
| `migration-gate` | Separate migration release hold | **pending** | - | Separate package or explicit user decision required. |
| `release-policy` | Production decisions and release hold | **pending** | - | Separate package or explicit user decision required. |

## Held decisions and visible blockers

* **T008 / ADR-0063:** personal-state migration is a separate reserved task and a release hold; T007 neither implements nor weakens it.
* **ADR-0064:** GitHub Actions stays disabled; no CI, publishing, signing or tags were touched.
* **Metadata writers:** EPUB, MP3, FLAC, M4A and M4B require operator enablement with per-format evidence.
* **Findings needing a decision** (see `handoffs/T007.md`): absolute media paths make restores path-sensitive; SMTP `keyAvailable` overstates for a same-id wrong key; web lockfile fails `npm ci` on npm 11.21; F5 (audio allowlist) resolved by user decision; F7 sign-in/process-restart persistence race fixed; managed-import targets use "Unknown Author"; KEPUB/MOBI/AZW locator compatibility is unproven; Android Espresso 3.6.1 cannot run on API 37; root `.gitattributes` for Windows checkouts.
* **Hardware:** User-assisted phone follow-up, accessibility, Android Auto and Chromecast are deferred. Chromecast is last.
