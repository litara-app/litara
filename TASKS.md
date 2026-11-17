# Litara rebuild work packages

Updated: 2026-11-16
Coordination owner: the user and the ADR/integration chat

## Start here

**T001 and T002 are reviewed, merged, and Done for their scoped foundation/import work.** T001 merged in [PR #79](https://github.com/litara-app/litara/pull/79) at `bef07cf09e5faf2ca11553d3d82f98927ca483a7`; T002 merged in [PR #80](https://github.com/litara-app/litara/pull/80) at `b78b7a3b9f2f676ed6a9252b6ab5860a90ca6c52` on 2026-11-13. The backend and Android validation workflows passed. This does not claim production readiness, working client/server integration, or physical Cast/Auto/NAS acceptance.

**T003 and T004 are merged into `main`.** T003 merged in [PR #81](https://github.com/litara-app/litara/pull/81) at `deed67c8eef320e33cdc13da995e802c50f9662a`; T004 merged in [PR #82](https://github.com/litara-app/litara/pull/82) at `2abef2ed46d770bd21d714d299739144de619bce`, initially on the rebuild integration branch. [PR #83](https://github.com/litara-app/litara/pull/83) integrated that branch into `main` at `dae3f3e66cf125fbb428e1d010f7f6b44b3bb591` on 2026-11-14. The user requested this integration. Existing handoff verification evidence is retained; this merge is not fresh runtime/hardware verification. T004's named gaps remain open rather than being declared complete.

**T005 is reviewed, merged and Done for its scoped implementation.** [PR #85](https://github.com/litara-app/litara/pull/85) merged into main at `c65738a` on 2026-11-16. Its [handoff](handoffs/T005.md) records the coordinator review and verification. All 38 operations are implemented; 36 covered scenarios and two T007 partials remain the declared boundary, not production/hardware acceptance.

**T006 is Ready for one full-stack implementation owner; unassigned.** Accepted ADR-0073-0076, [assignment](handoffs/T006-assignment.md), [management and protocol contracts](contracts/t006/README.md), fixtures/scenarios and [readiness evidence](research/t006/readiness.md) are prepared on `codex/t006-readiness`. Use the immutable checkpoint in the preparation section below. OPDS 1.2/2.0, original ebook/comic/individual-audio delivery, both SMTP ownership modes, and separate-source per-device KOReader conflicts are included. No implementation worker has been launched. T007 remains unassigned and may not overlap this owner's server/schema scope. The dated preparation/review sections below are historical; this overview/register supersede their obsolete readiness statements.

**Release hold:** 2.0.0 requires a verified personal-state migration path (ADR-0062/0063). GitHub Actions is disabled repository-wide under ADR-0064; do not re-enable CI or publish builds without the user's explicit release-readiness decision. Local development verification remains allowed.

Prefer substantial end-to-end packages over small tickets. Each package may contain several reviewable commits and internal milestones, but should finish with a usable result and an evidence-backed handoff.

The authoritative working repository is `G:\Programming\ebooker`. `E:\Programming\ebooker` was a separate audit folder, not this Git repository. External reference clones/logs under `E:\Programming\_reference\` are optional local resources, not portable project dependencies.

**T006 assignment checkout:** start from the exact committed `codex/t006-readiness` checkpoint recorded below, based on merged main `c65738a`. The agent must receive the accepted ADRs, both protocol/management contracts, fixtures and full assignment through Git. Suggested worker branch: `codex/t006-delivery`. The old T003/T005 preparation checkpoints are historical provenance, not this task's source. Do not restore historical deletions or commit another owner's local work.

## Assignment and ownership rules

1. Read root `AGENTS.md`, `ADR/README.md`, and the accepted ADRs relevant to the assignment. Task briefs authorize work within those decisions; they do not accept unresolved architecture.
2. Start from the coordinator-supplied checkpoint in an isolated branch/worktree. Suggested branch names below use `codex/`; another agent can use that convention too. Record the actual base commit and branch in the handoff.
3. Only the coordination owner edits this register, shared ADRs, or task assignments. Workers write their own `handoffs/Tnnn.md`; they report progress or decision requests there rather than claiming another package or editing accepted decisions.
4. Only one worker owns a package. T002 is merged and its import assignment is closed; do not assign a duplicate import. Future Android adaptation needs an explicit new ownership/scope agreement. Do not invent worker availability or completion status.
5. Respect the write scope. Shared root files, CI, contracts, and source directories need explicit ownership. Two packages with overlapping scopes must run sequentially unless the coordinator narrows their scopes in writing.
6. Use current documentation through Context7 as required by `AGENTS.md`. Pin reproducible dependencies/tool versions. Routine implementation details can be chosen within accepted architecture; write down meaningful tradeoffs. Architectural decisions still open in the governing ADRs need a proposal/user decision before dependent implementation. Continue independent work and report the exact blocked boundary.
7. Keep the archive read-only. Preserve third-party licenses and source provenance. The backend/web are first-party MIT; Android remains AGPL. Never copy AGPL reader modifications into the MIT web implementation.
8. Finish with verification evidence, remaining risks, and a reviewable commit/diff. Ready for review is not Done. Only the coordinator marks work Done after integration/review. Do not publish, deploy, upload builds, push to a shared release branch, or access signing/publishing secrets as part of these tasks.

## Register

| Task | Package | State | Assignment | Dependencies / scheduling |
| --- | --- | --- | --- | --- |
| T001 | Go backend foundation and durable native audio inspection | Done: reviewed and merged, PR #79 | Closed | Init consolidation included; release/platform/NAS follow-ups remain documented |
| T002 | Native Android baseline, media preservation, and adaptation seams | Done: reviewed and merged, PR #80 | Closed; do not repeat import | Future adapter/account-isolation work belongs to T003; physical hardware gates remain |
| T003 | Shared client contract, accounts, and end-to-end recording playback API | Merged: PR #81, integrated to main by #83 | Closed implementation assignment | Handoff evidence retained; physical hardware and release gates remain |
| T004 | Catalog, library ingestion, metadata, and NAS recovery | Merged with named gaps: PR #82, integrated to main by #83 | Closed merged assignment; follow-ups need explicit ownership | See handoff: ebook entities, merge/split, writers, provider/NAS verification remain incomplete |
| T005 | Redesigned web library and complete reading/listening flows | Done: reviewed and merged, PR #85 at c65738a | Closed implementation assignment | handoffs/T005.md; two T007 partials and release gates retained |
| T006 | OPDS, email delivery, and basic KOReader integration | Ready: ADR-0073-0076, contracts/fixtures and complete brief | Unassigned; user selects one owner | Exact codex/t006-readiness checkpoint; exclusive web/server/schema scope; T007 waits |
| T007 | Cross-client integration, hardware acceptance, and release readiness | Not ready: earlier packages and test resources needed | Unassigned | Integrated T003–T006, hardware/operators and release decisions |

These are large work packages, not promises that every architectural question is resolved or every originally intended behavior is implemented. T001–T005 have been integrated. T006 is prepared for one owner; T007 still needs its own execution-ready brief/checkpoint and test resources. A roadmap description does not authorize a worker to pick one up opportunistically.

## T006 preparation verification - 2026-11-16

Base: integrated main `c65738a` (T005 PR #85). User choices in this chat are recorded as Accepted ADR-0073-0076. The assignment grants one owner the necessary backend/schema/protocol/contract and web settings scope. No agent is assigned or launched.

Preparation inventory: 26 management operations plus 16 wire-protocol operations; 35 task-prefixed schemas; 23 positive/negative examples; 38 acceptance scenarios; nine deterministic digest vectors and synthetic OPDS/SMTP/KOReader sequence fixtures. Static checks validate schemas/examples, normalized route/schema/operation collision freedom, transport/CSRF declarations, accepted ADR links, all-operation scenario references and deterministic vectors. Runtime/client/SMTP/hardware success remains the implementation owner's acceptance work. See research/t006/readiness.md for verification and the immutable source checkpoint after export validation.

**Verified immutable T006 source snapshot:** `8136c2fff98446f16107fd4b5e74426f8acc92b3` on `codex/t006-readiness`, based on merged main `c65738a`. An independent Git-archive export passed T006/T003/T005 static checks, all 76 ADR/index checks and existing generated API parity. Third-party validator packages were supplied separately and every version matched the pinned requirements. The final evidence-only commit follows this source snapshot. Give the worker the final coordinator-supplied branch-tip hash (containing this evidence), start `codex/t006-delivery` from it, and record that immutable base in handoffs/T006.md. T006 is Ready and Unassigned; no worker was started.

## T005 preparation verification — 2026-11-14

The user selected shared/smart shelves, owner-edited sharing, viewer-specific smart evaluation, online retry recovery, the restricted single-address reader boundary, file-anchored/manual-completion reading state, retained annotation conflicts/tombstones, Go-served Vite and one full-stack owner with bounded Go extraction and successor-based recording repair. Accepted ADRs 0065–0070 record those decisions.

Preparation checks passed: 70 ADRs/index; existing T003 static contract checks; T005's 38 operations/65 schemas/15 positive-negative examples/38 scenarios with collision/auth declarations checked; and deterministic generation/container structure for eight synthetic fixtures with nonempty-output protection. Application/reader/browser/codec/hardware behavior remains implementation acceptance work. No builds/releases or CI runs were launched. See the complete execution brief and preparation evidence; Ready does not mean production-ready or Assigned.

**Verified immutable T005 source snapshot:** `208684e5fdce39f6b39baefa03a11517078355a7`. Exported that committed tree into an independent clean source directory: both static contract checkers, all 70 ADR/index checks and the tracked fixture generator passed without uncommitted coordinator source. Validator dependencies were supplied separately from the pinned existing requirements. The following coordinator commit records readiness evidence only; supply the exact final branch-tip hash when assigning, and record that as the worker base. Branch: `codex/t005-readiness`; same preparation is proposed in PR #84. No worker is assigned.

## Readiness review — 2026-11-13

Evidence: fetched `origin/main` at `bef07cf09e5faf2ca11553d3d82f98927ca483a7`; both PRs report Merged. PR #79's backend check and container-smoke jobs passed, and PR #80's full/fdroid lint/test/assembly job passed. Earlier handoff statements that hosted CI was never run are historical, superseded by these results. Local backend integration/smoke and Android validation evidence remains in the handoffs and review conversation.

### Committed checkpoint and readiness evidence

- Verified source snapshot: `943e2cd51fb7a59a32b9da1ef9c96a136a019d8f` on `codex/t003-assignment-checkpoint`, built on merged main `bef07cf09e5faf2ca11553d3d82f98927ca483a7`. The following register-only readiness commit identifies it and is the assignment checkout tip.
- Exported the prepared Git tree into a clean temporary source directory; OpenAPI/fixture checks and all 43 ADR/index checks passed there without relying on local source files. Backend/Android active files and executable wrapper modes match merged main exactly.
- Source tree contains 1,102 files, including 624 archived historical files. Local books, signing keys, secrets/configuration, dependency caches and build outputs are excluded; existing local data was neither reset nor deleted. A high-confidence private-key/token pattern scan found no matches in 998 candidate text blobs; this is a scoped check, not a compliance certification.
- Active workflows are ADR, backend, Android and contract validation only. Historical build/release/deployment workflows are retained only as archived reference. New contract CI has not yet run remotely at the point of local readiness verification.
- Preparation is complete; **T003 is Ready but Unassigned**. This does not mark any T003 application behavior implemented or tests/hardware acceptance passed. Its implementation worker owns the acceptance work in the brief.

### T003 accepted decisions — completed decision pass

Accepted on 2026-11-13 from explicit user answers:

- ADR-0031: administrator-provisioned local accounts; local first-admin setup; explicit library grants for users and administrators.
- ADR-0032: offline downloads until the next online access check; detected access removal blocks cached content; logout locks the account’s local content.
- ADR-0033: 15-minute native access tokens; 30-day idle / 90-day absolute refresh sessions; per-device revocation; network failures retain sign-in state.
- ADR-0034: preserve competing positions and ask which to use when resuming.
- ADR-0035: natural-end recording completion plus manual finish/unfinish; no seek/percentage-based completion; separate reread-history controls deferred.
- ADR-0036: serialized native refresh, identical-request recovery for 60 seconds, different-ID reuse revokes that session, per-request session validation.
- ADR-0037: protected same-origin browser session cookie and CSRF checks; native/API clients keep bearer transport.
- ADR-0038: public discovery, /api/v1, opaque UUID resource IDs, zero-based page/size with totals (50 default / 200 cap), typed errors, unstable API until production compatibility commitment.
- ADR-0039: incomplete recordings block whole-recording playback/download; complete old downloads retain their content version until explicit redownload; never silently transfer positions to changed bytes.
- ADR-0040: server-issued progress revisions, operation IDs, 409 with saved conflicts, 412 for file/layout version changes, validated reuse after reorder and rejection of invalid offsets.
- ADR-0041: opaque server-backed credentials, protected native storage, HttpOnly/Secure/SameSite=Lax browser sessions (30-day idle / 90-day maximum), normal HTTPS and explicit development-only HTTP.
- ADR-0042: reject an invalid chapter source as a whole and fall back with visible issues; preserve raw evidence/edits; generate labeled file markers when needed.
- ADR-0043: no automatic pruning of sync receipts/conflicts or locked account data in T003; seeded multi-file integration slice, with full ingestion and separate reread-history controls deferred.

These policy choices are accepted, not merely recommendations. Shared wire schemas/examples and the execution brief still need to make them implementable and testable. These records are now included in the committed rebuild checkpoint for a separate worker checkout.

### T003 assignment preparation and verification

- Contract and examples: [contracts/t003/README.md](contracts/t003/README.md), [OpenAPI](contracts/t003/openapi.json), [persistence boundary](contracts/t003/model.md) and shared JSON fixtures specify discovery, users/grants, native/browser auth, recording snapshots, versioned Range/HEAD/artwork, revisions/conflicts/resolution and completion.
- Full execution brief: [handoffs/T003-assignment.md](handoffs/T003-assignment.md) defines one owner's exact server/contract/Android scope, explicit T002 transfer, T004 serialization, generated seeded media, verification, non-goals and handoff. No worker has been assigned.
- Static verification: OpenAPI 3.1, schema/positive/negative examples, recording order/content arithmetic, byte-range expectations and scenario inventory pass scripts/contracts/check.py. This is not application runtime verification; the brief requires the real backend/Android/emulator checks from the implementation worker.
- Checkpoint verification and immutable source reference are recorded above. A new worker must use the Ready branch tip, not the older source-only main commit or uncommitted root state.

No further T003 product-policy decision is intentionally left open for this seeded slice. If contract implementation exposes a new architectural choice, propose it rather than silently selecting it. Password-recovery UI, destructive retention/deletion, complete reread-history controls and production release policies remain outside scope.

### Remaining packages

T004 needs file move/content-version matching, grouping/merge/split confidence, import approval/copy-or-move/naming/collisions, CUE association under the accepted ADR-0042 source-validation rule, metadata protection/provider rules and NAS recovery semantics. Coordinate shared schema/API boundaries with T003 before parallel implementation. Existing-folder indexing must preserve paths and bytes; managed importing remains opt-in (ADR-0004/0006/0007/0014/0018/0029).

Historical dependency note: T005 is now merged and T006 decisions/contracts/brief are prepared as recorded above. T007 still requires working earlier flows and named hardware/operators; retained fake/emulator tests do not close physical Cast/Auto/NAS gates.

### Follow-ups retained after closing T001/T002

- Keep first-party schema changes in `apps/server/migrations/00001_init.sql` until production readiness (ADR-0030); leave River's migration history intact. Use fresh development databases after init edits; do not automate destructive resets.
- T003 must fix Android L6 with a failing regression first and replace the dormant BookOrbit-shaped API/auth adapter. The imported baseline is not already a Litara-connected client.
- T007 owns final packaging/source/notices, binary mirror/platform/support policy, production migration execution, release identity/signing and hardware acceptance. Resolve any of these earlier if it becomes an actual prerequisite; do not silently treat the dev container's choices as accepted release policy.

## T001 — Go backend foundation and durable native audio inspection

**Completed:** merged in PR #79, including the user-selected single-init policy. The brief below is retained as the scope/evidence checklist; it is not an available assignment.

**Outcome:** a runnable Go service with PostgreSQL, migrations, bounded durable workers, bundled native ffprobe/FFmpeg, and a diagnostic flow that submits a real file inspection, persists its result, and demonstrates recovery after a restart. This should be a useful foundation for the subsequent catalog and playback API, not an empty scaffold.

Suggested branch: `codex/t001-backend-inspection`.

### Required reading

- Root `AGENTS.md` and the ADR index.
- ADR-0002, 0003, 0007–0009, 0013–0016, 0018–0019, 0024–0025, and 0028–0030.
- `research/android/backend-contract.md` and `research/android/adr-reconciliation.md` for consumer needs. The reconciliation supersedes older timestamp/licensing recommendations.
- `research/media-inspection/decision-matrix.md` and `wasm-follow-up.md`. Native executables are selected; further WASM work is deferred.
- Relevant old scanner/extractor code may be read under `archive/litara-v1/` as reference. Do not build or port the old application wholesale.

### Owned write scope

- `apps/server/`: new Go service/module, internal packages, SQL/query generation, migrations, inspection workers, and diagnostic tooling.
- `deploy/`: new backend-only container/Compose configuration, pinned media tools, example configuration, and supporting packaging files. Keep old deployment files archived.
- `scripts/backend/`: portable development/check helpers for this package.
- `.github/workflows/backend.yml`: only this new workflow; do not edit Android or ADR workflows.
- `research/backend/`: design notes, decisions needed, fixture provenance, verification and setup documentation.
- `handoffs/T001.md`: the worker's coordination/handoff file.

Do not edit root `README.md`, `.gitignore`, `AGENTS.md`, `TASKS.md`, `ADR/`, `design/`, `apps/android/`, `apps/web/`, or shared API contracts. Put generated-output/credential ignores in scoped `.gitignore` files. Document proposed root changes in the handoff for the coordinator. Do not share this scope with another server package until integration.

### Work to complete

**1. Build a real service foundation.**

Use Go `net/http` with Huma, sqlc/pgx, Goose, and River open-source core as selected. Pin a supported toolchain and compatible dependencies based on current documentation; do not inherit the WASM experiment's Go version automatically. Separate configuration, HTTP wiring, database access, workers, and inspection code into understandable modules without introducing microservices. Provide operational health/readiness checks and graceful shutdown. Avoid public catalog, authentication, or progress endpoints in this increment; their exact contracts are not settled.

Use typed configuration with an example file, actionable startup errors, and structured logs that avoid credentials and full probe dumps. Readiness must reflect database/schema/worker prerequisites meaningfully rather than returning a constant success. A database outage must not require deleting data or resetting migrations to recover.

**2. Establish PostgreSQL and migration/query tooling.**

Create a minimal internal schema for this package's inspection requests/results and use sqlc-generated code with pgx transactions. Keep final title/edition/library/account tables out of this increment. Under the user-selected ADR-0030 policy, keep all application schema in one Goose init until production readiness; demonstrate fresh initialization and a data-preserving repeat invocation. The former demonstration-only incremental upgrade requirement is superseded by that choice. Account for River's own migrations without copying or editing its migration history.

Provide a documented explicit migration invocation for development/tests. Do not silently settle automatic production startup migration policy; list the deployment-policy choice for ADR review. Development scaffolding must not make destructive resets part of normal startup.

**3. Bundle and supervise native inspection tools.**

Package pinned native ffprobe and FFmpeg with the backend image, with recorded versions/build options, checksums or equivalent build provenance, and applicable notices/source references. Packaged use must not depend on host FFmpeg or first-run internet downloads. Identify exactly which platforms were built/tested; do not claim an untested platform as supported.

Invoke executables with argument arrays, without shell command construction. Apply bounded concurrency, deadlines, cancellation, captured-output limits, and clear failure classification. Inspect a file without changing its contents. Normalize available format/codec, duration, tags, artwork descriptors, and chapters into an internal typed result. Preserve source units/provenance and normalize known timeline values to milliseconds. Treat missing data as unknown/incomplete, not fabricated zero duration. Artwork decoding/extraction beyond available descriptors can remain a named follow-up; report the boundary precisely.

Use the agreed file-relative chapter semantics for extracted entries. Full CUE association/precedence, recording assembly, file identity matching, and manifest publication belong to later work. Do not disguise those missing stages as complete recording support.

**4. Complete one durable flow.**

Provide an internal diagnostic command or equivalent development harness that submits a file inspection through the actual PostgreSQL/River path, waits/queries for completion, and shows the persisted normalized result. It must exercise real ffprobe on a fixture, not return stub JSON. Keep this local/internal so it does not invent a remotely accessible unauthenticated filesystem-inspection API.

Demonstrate transactional submission, bounded processing, restart recovery, safe retries, and deterministic request/result association. Multiple executions must not corrupt or duplicate the logical result. Missing inputs, tool failures, timeouts, and inspection-incomplete states must be distinguishable. Use operation-specific retry rules rather than endlessly retrying a permanently invalid file. Persist enough information for the subsequent package to diagnose failures without storing secrets or unbounded raw tool output.

**5. Verify and package the result.**

Use generated or provenance-known fixtures and retain a fixture inventory. Cover ordinary MP3/M4A or M4B, embedded chapters, malformed media, missing timing, filenames with spaces/shell-significant characters, and cancellation. Include VBR/Opus/FLAC cases where available; list missing coverage rather than claiming the entire format ADR is implemented. Generated/sparse large-file checks must state what was actually exercised, without committing giant media files.

Integration checks must run against real PostgreSQL and packaged media tools. Include a restart/retry scenario and a meaningful concurrency bound check. Simulate disappearing/unreadable inputs where useful, distinguishing those tests from real NAS acceptance. CI should build/check the server, ensure generated SQL is current, and run the appropriate unit/integration checks. Include a container/Compose smoke path with local database/application state and separately mounted read-only media fixtures.

### Explicit boundaries

- Do not implement or choose transcoding behavior, derived-file formats, automatic container rewrites, or metadata write-back. Bundling FFmpeg is not authorization for those features.
- Do not add CGO/libav bindings, WASM fallback, a separate media service, Redis, SQLite, or an ORM.
- Do not define the final public auth, progress, catalog, pagination, or manifest contract. Huma bootstrap/operational wiring and internal inspector types are sufficient here.
- Do not choose a final production PostgreSQL support window or migration automation policy without the pending decision. Select reproducible test/development versions and document them as such.
- No downloads of users' private media, secrets, signing keys, publication, or edits to the archive.

### Acceptance criteria

- [x] A clean checkout can follow the documented commands to build/run the Go service and PostgreSQL setup.
- [x] The selected libraries are used for real work; query generation/migrations/jobs are not placeholder dependencies.
- [x] The container includes both native tools and reports their pinned versions without a host install or runtime download.
- [x] A real media inspection travels through durable submission, worker execution, and persisted result retrieval.
- [x] An interrupted pending/running inspection recovers safely after restart under the documented retry policy.
- [x] A repeated logical operation produces one coherent result; worker concurrency stays within its configured bound.
- [x] Missing timing, malformed input, missing input, timeout and cancellation have tested, distinguishable outcomes; originals remain unchanged.
- [x] Fresh init and data-preserving repeat-invocation checks pass under ADR-0030, and sqlc regeneration produces no unexplained diff.
- [x] CI/local verification commands and fixture provenance are documented; skipped/unavailable checks are explicit.
- [x] Scoped changes preserve license boundaries and contain no secrets, generated media, caches, or unrelated work.
- [x] `handoffs/T001.md` identifies base/head commits, governing ADRs, changed paths, exact check results, setup instructions, risks, and the smallest integration steps needed next.

**Definition of ready for review:** working service and durable inspection demonstration, repeatable verification, documented operational/deployment questions, and a reviewable change set. Finishing only a scaffold or a recommendation report does not complete T001. If an external prerequisite prevents a criterion, finish unaffected work and identify the exact remaining gap; do not label the package Done.

## T002 — Native Android baseline, preservation, and adaptation seams

**Completed:** merged in PR #80 on 2026-11-13. The reviewed Litara rename is retained, Gradle wrapper mode is `100755`, provenance/verification corrections and final commits are recorded, and hosted Android CI passed for full/fdroid. The previous wrapper/commit/integration blockers are closed. See [the historical coordinator review](research/android/T002-review.md) and merged `handoffs/T002.md` for evidence; the old staged/orphan status is superseded. Physical Cast/Auto, final release identity/signing, provenance gaps and the T003 account-isolation/API adapter remain separate work.

Substantial outcome: import the pinned AGPL native app into `apps/android/`, restore applicable reader/vendor notices, preserve full/fdroid distributions and Cast/Auto/offline behavior, and reproduce the existing lint/build/JVM/emulator checks from the new location. Identify clean seams for the future Litara catalog/media/auth adapters and document account-isolation/progress changes required by the ADRs. The original temporary-identifier instruction was overridden by the user's rename request; retain the reviewed Litara rename. Final release identity availability/signing still needs its decision record.

The import assignment is closed. Its completed write scope was: `apps/android/`, `.github/workflows/android.yml`, `research/android/import-verification.md`, and `handoffs/T002.md`. Root decisions/register and all backend files remain coordinator/other-package scope. Do not update API contracts, publish builds, or access signing credentials. No new client-to-Go integration is required until T003 settles its contract. Real Cast/head-unit checks remain separately reported hardware gates.

## T003 — Client contract, accounts, and end-to-end recording playback API

Planned outcome: a documented versioned API, local accounts/per-library authorization, revocable native sessions/refresh, coherent recording manifests, authenticated byte-exact Range delivery/artwork, revision-aware progress, and a working Android adapter for a multi-file recording. Include shared fixtures/contract checks and account-scoped offline writes; test stale updates and manifest/content changes. Preserve Cast/Auto player behavior.

Accepted decision basis: ADR-0031–0043 now select account/access policy, session/native refresh and browser auth, API conventions, recording readiness/versioned offline behavior, chapter validation, revision conflicts/completion and temporary retention/scope. Remaining assignment preparation is the exact shared contract/fixtures, seeded schema boundary and complete execution brief described above. This package overlaps server work and must follow integrated T001. Android adapter edits need an explicit ownership transfer/scope agreement with T002. Completion requires an actual client/server slice, not merely an OpenAPI document.

## T004 — Catalog, ingestion, metadata, and NAS recovery

Planned outcome: libraries and title/edition/recording/file persistence, rescan/watch reconciliation, file/version tracking, duplicate/grouping controls, approved import handling, protected metadata enrichment, chapter source resolution, and clear incomplete/missing states. Use durable jobs and the T001 inspector; preserve existing folders by default. Verify disconnect/reconnect, partial copies, rename/move/replacement, interrupted imports, and metadata conflicts.

Decision gates: grouping confidence and merge/split behavior, import copy/move/approval/naming/collisions, CUE association under ADR-0042 validation, metadata source/provider rules, and tested NAS support boundaries. Do not silently delete catalog history on share loss or choose automatic write-back. Coordinate API additions through T003's approved contract and serialize shared server ownership. This is the full content-ingestion package, not just a directory scanner.

## T005 — Redesigned web library and reading/listening workflows

**Ready preparation, 2026-11-14:** [assignment](handoffs/T005-assignment.md), [contract](contracts/t005/README.md), [readiness](research/t005/readiness.md). Accepted decisions: ADR-0065–0070. Shared and smart shelves are included. This owner receives necessary server/schema/contract extensions plus web; no separate parallel server worker is assigned. The original planning text below is retained as context, superseded where the accepted brief is more specific.

Planned outcome: React/TypeScript/Mantine library/title/edition browsing, metadata review and organization, pristine Foliate-based reading, direct PDF.js, image-comic reading, annotations/notes, and web audio playback against the real API. Include responsive navigation, loading/error/incomplete states, accessibility, exact-file resume, safe reader isolation, and verified source notices. Brand assets under `design/brand/` are reference inputs, not permission to overwrite another agent's design work.

The reader/location, annotation/shelf, extraction/isolation, tooling/serving and workflow decision gates are resolved for T005 by ADR-0065–0070 and contracts/t005/. Respect the MIT web/AGPL Android boundary. Completion requires actual reading/listening and persistence on supported fixtures, not a static dashboard or mocked-only UI.

## T006 — OPDS, email, and basic KOReader delivery

**Ready preparation, 2026-11-16:** [assignment](handoffs/T006-assignment.md), [contract](contracts/t006/README.md), [readiness](research/t006/readiness.md). Accepted ADR-0073-0076. OPDS 1.2 and 2.0 use revocable app credentials; acquisition/email covers ebook/comic originals and individual original audio files. Server SMTP plus optional personal SMTP and owner-managed saved recipients are included. Explicit sends use durable status, safe pre-acceptance retry and manual review for uncertain submission; no real people are emailed during implementation. Basic KOReader stays separate from web/Android positions/completion, uses per-device credentials and preserves competing candidates.

One full-stack owner receives the explicit server/schema/contracts/web brief. No format conversion, multi-file audiobook bundle, streaming manifest, advanced location conversion, account self-registration, annotation sync, external reading service integration, Android adaptation or release work is assigned. Preserve the conservative stock-protocol limitation: KOReader does not echo Litara revisions/operations, and a GET cannot silently rebase an old upload. Real client/sink/restart/browser verification is required by the scenario matrix; preparation checks alone are not completion.

## T007 — Integration, hardware acceptance, and release readiness

Planned outcome: exercise a realistic library through web, Android, Cast/Auto, offline recovery, NAS failures, backups/restores, upgrades, and delivery; fix integration defects and produce a supported-format/platform matrix. Verify package licenses/notices, media-tool provenance, release configuration, source/build reproducibility, and operational documentation. Hardware results must name the tested device/receiver/head unit and versions.

Requires integrated earlier packages and available hardware/operators. Playback through proxy/fake-player tests does not count as physical Cast acceptance. Prepare reviewable unsigned/test artifacts without publishing; release identity/signing/distribution decisions and final release approval remain with the user.

## Worker handoff format

Each worker owns `handoffs/Tnnn.md`. Include:

- Task ID, worker identifier, state, and last update date.
- Repository/worktree, base commit, branch, and final/review commit(s).
- Governing accepted ADRs and any proposals/decisions still needed.
- Completed behavior and changed paths; explain any scope request.
- Commands/environment and verification results, including failures/skips/hardware limits.
- Setup/reproduction steps, fixture provenance, and dependencies/tool versions.
- Known risks/blockers and integration instructions; do not conceal partial completion behind a Done label.

Use states Working, Blocked on decision, Blocked on external prerequisite, or Ready for review in the handoff. A worker may report a blocker and continue unaffected work. The coordinator alone updates the register to Assigned, Ready for review, or Done after inspecting the evidence.
