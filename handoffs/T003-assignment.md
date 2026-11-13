# T003 assignment — client contract, accounts and recording playback

State: **Ready to assign. Unassigned.** One worker owns this package; do not infer an assignment from this brief.

## Start point

Source integration base: main at bef07cf09e5faf2ca11553d3d82f98927ca483a7 (T001 PR #79 and T002 PR #80 merged). The runnable assignment checkout must be the **new committed rebuild checkpoint**, not this older source-only commit. The coordinator has validated and committed the source snapshot below; the branch tip adds the Ready register/brief metadata. Suggested implementation branch: codex/t003-recording-playback.

Verified source snapshot: `943e2cd51fb7a59a32b9da1ef9c96a136a019d8f`. **Assignment checkout: the tip of `codex/t003-assignment-checkpoint`, including the following Ready metadata commit.** The coordinator supplies that exact tip hash when assigning; record it as the implementation base in `handoffs/T003.md`. Verify that the source snapshot is its ancestor and that TASKS.md marks T003 Ready before starting. Do not use the main branch unless this checkpoint has first been integrated there.

Preparation checks passed from an exported Git source tree: OpenAPI 3.1/fixture validation and all 43 ADR/index checks. Active Go/Android sources and executable wrapper metadata match merged main. New contract CI is provided; its hosted result is not a prerequisite claimed passed by local checks. No T003 server/Android implementation or hardware behavior was executed in this preparation.

Read root AGENTS.md, TASKS.md, ADR/README.md and accepted ADRs 0002–0009, 0011, 0013–0025, 0028–0043 as applicable (skip superseded 0012/0026 as authority). Read contracts/t003/README.md, openapi.json, model.md and all shared fixtures; handoffs/T001.md and handoffs/T002.md; research/android/adr-reconciliation.md, backend-contract.md, media-preservation-matrix.md, and apps/android/ADAPTATION.md. Audit timestamp-winner/MIT-relicensing recommendations are superseded. Archive is reference-only, never part of active dependency discovery.

## Outcome

A locally bootstrapped administrator creates accounts and explicit library grants. A user signs in to the Go server, discovers/lists/searches permitted recordings, plays a seeded multi-file recording on Android using original versioned byte-range media, downloads its snapshot/files, resumes offline and handles a stale upload by preserving both candidates and asking on resume. Natural end/manual completion updates only that recording and title history. A second account cannot read or upload the first account's caches/queued work. Both Android distributions retain their media regressions.

This is an implemented client/server slice, not a document-only/fake-only adapter and not a whole catalog importer. The checked-in contract is the starting implementation target under Accepted ADRs; resolve inconsistencies through coordinator review, not silent policy changes.

## Exclusive write scope and handoff from T002

- apps/server/**: accounts/grants/sessions, seeded catalog model, original media/artwork routes, progress/conflicts/completion, local CLI/seed, migrations/sqlc/tests. Extend 00001_init.sql under ADR-0030; leave River migration history intact.
- apps/android/**: **T002 import ownership transfers to the one assigned T003 worker for this scope.** Auth/network/model adapters, account-scoped storage/downloads/queues/restore, recording UI/manifest/progress/conflict/completion, and focused integration/regression tests. Preserve full/fdroid paths, existing reader/player/Cast/Auto internals and AGPL notices. Do not upgrade Media3 or strip old media tests to make adaptation pass.
- contracts/t003/**: implement/refine exact schemas and fixtures within accepted semantics. Any externally observable convention change must be explained and reviewed; a policy conflict needs an accepted ADR.
- scripts/backend/**, scripts/contracts/**, .github/workflows/backend.yml and .github/workflows/android.yml: focused T003 checks/contract comparison/emulator wiring as needed; no old release workflows or publishing.
- deploy/**: development-only API/test configuration; keep default read-only media, credentials local, no destructive migration/reset automation or release-policy choices.
- research/t003/** and handoffs/T003.md: implementation evidence, decisions still needed, setup and review handoff.

Root TASKS.md, AGENTS.md, README.md, ADR/**, design/**, archive/**, apps/web/**, other research/handoffs and unrelated CI are coordinator/other-package scope. Request a scope change through the handoff; do not edit another owner's files. T004 server/schema/contract work must wait for integrated T003 unless the coordinator writes narrower independent scopes. Do not assign a second Android adapter worker.

## Work and acceptance

### 1. Contract and data foundation

- Implement all declared T003 operations, safe typed errors and OpenAPI/schema parity. No route may use BookOrbit fallback compatibility or official-app identity gating.
- Add minimal seeded schema from model.md with public stable UUID IDs/content versions/layout revisions distinct from T001 diagnostic request keys.
- Implement local atomic first-admin creation and password reset, administrator user management, explicit grants and own-device session list/revoke. No default credentials, public registration or OIDC.
- Add explicit repeatable local fixture seeding using generated/provenance-known media; no users' books, binaries or secrets in Git. Do not run a scanner or auto seed/reset at startup.
- Fresh init, idempotent rerun and sqlc currency pass. Preserve original bytes/read-only mount behavior and durable T001 job tests.

### 2. Auth and grants

- Opaque native credentials, protected device storage, 15-minute access and 30-day idle/90-day absolute sessions; same browser idle/absolute limits, protected same-origin cookie/CSRF profile.
- Prove serialized refresh with identical 60-second exchange retry, different-ID reuse revoking only its device, post-window typed failure, expiry and immediate validation on new requests. No credentials from revoked sessions, unbounded plaintext replay cache or network-error logout.
- Administrator without a grant cannot fetch library metadata/artwork/media/downloads. Access revocation/disabled users and account changes apply at every delivery path. Browser CSRF/origin failures cannot mutate state; no automatic TLS-to-HTTP fallback.

### 3. Recording, media and Android slice

- Authorized list/search/pagination/recent-unfinished, snapshot, artwork and versioned GET/HEAD endpoints match contract, including effective sizes/counts, typed absence and current scope.
- Real generated MP3 and M4B/M4A media play through the Go server/Android adapter; do not stub the decisive end-to-end test. Exercise a three-file recording and an alternate recording under the same title.
- Byte-exact Range cases include bounded/open/suffix/unsatisfiable, zero length, >4-GiB sparse offsets, validators/If-Range and token-expiry refresh retry. Report sparse checks as sparse, not large-valid-audiobook verification. No conversion or rewriting.
- Ready/chapterless and incomplete states are explicit. Chapter source selection/whole-source validation and derived starts match fixtures; real CUE association/parser stays T004.
- Self-contained account-scoped offline snapshot/download supports resume, explicit redownload/update notice, unchanged old bytes/version and interrupted download recovery. Never append full 200 to partial content or silently remap changed bytes.
- Replace the required auth/catalog/playback data edge with Litara. Unported imported UI/routes report unavailable; preserve the reader and media code rather than inventing 75 server compatibility routes.

### 4. Progress, completion and L6 regression

- Write an L6 test that demonstrably fails against the imported account-switch baseline first. Then isolate all downloads/snapshots/positions/pending writes/restore/caches by serverId+userId, including tasks finishing after logout/switch.
- Implement atomic revision/receipt/conflict transactions. Real PostgreSQL tests prove duplicate requests, changed-payload ID reuse, backward seek, two-device contention, restart, 409 durable conflict, 412 layout/content changes and conflict-resolution races without lost candidates.
- Android asks on resume; choosing server/candidate/new explicit position is a new revision-aware operation. Reorder may preserve the same validated file/version offset; changed bytes never auto-remap. Offsets are rejected, not clamped.
- Natural end/manual finish/unfinish have independent completion concurrency/idempotency, durable conflict handling and one history entry per transition. Seek-only never finishes; alternate recording stays unfinished; unfinish preserves history. No separate reread-history UI.
- Keep authorized complete downloads playable offline without a timed lease; confirmed online grant revocation locks them. Logout locks immediately. Retain unresolved conflicts, operation receipts and locked account data without automatic pruning; native credential recovery is still bounded to 60 seconds.

### 5. Verification and review

- Run python scripts/contracts/check.py and ADR structure validation; compare generated Huma OpenAPI/implemented responses to the shared spec and report any intentional, policy-compatible additions.
- Run scripts/backend/check.sh with LITARA_REQUIRE_INTEGRATION=1, a real PostgreSQL admin test URL and real media tools; no silent skips. Run a rebuilt container/Compose smoke that includes the new authenticated seeded flow plus T001 durable recovery.
- Run both Android flavors' lint, unit tests and debug assembly. Verify fdroid runtime classpaths exclude GMS/Cast; full retains Cast. Preserve and run media/Cast/Auto regressions and the new protocol/offline/account-switch cases.
- Run instrumentation only on a named disposable emulator with explicit serial; never clear a user's device. Record exact tests/emulator versions and distinguish fake/proxy/emulator checks from physical Chromecast/Auto behavior.
- Confirm public contract use by a third-party HTTP client, revoked/no-grant rejection, no secrets/artifacts and applicable notices intact. Do not publish, deploy, sign releases, send real mail or access signing keys.
- Hardware access is not a prerequisite to assigning T003. Automated/integration and emulator evidence is required for review; document a named physical Cast/Auto/NAS acceptance gate for T007 instead of claiming it passed. Report any unavailable acceptance check as incomplete, not a hidden skip or Done claim.

## Deliverable and review boundary

One reviewable branch/PR with runnable setup, generated fixture provenance, actual check commands/results, known gaps and handoffs/T003.md. Include source/checkpoint and final commits, governing ADRs, changed paths, failed/skipped tests and hardware limits. Update the contract and handoff when implementation changes its shape. The worker reports Ready for review; only the coordinator marks Done after review/integration.

No implementation is authorized for new architecture beyond the Accepted decisions. If a real unresolved choice appears, propose it and continue independent work. Production retention/deletion, binary sourcing/platform support, release identity/signing, API deprecation window and migration execution policy remain separately gated.
