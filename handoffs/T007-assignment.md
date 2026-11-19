# T007 assignment: native readers, integrated workflows and release evidence

Prepared: 2026-11-17. **Ready for one implementation owner once supplied the final committed checkpoint. Unassigned.** Preparation does not launch a worker or establish runtime/hardware success. The coordinator records the immutable source and final assignment tip in `research/t007/readiness.md` and `TASKS.md`.

## Outcome and boundary

Finish the Litara Android ebook/PDF/comic adapter using the preserved native reader, correct integration defects across the merged T001–T006 application, qualify metadata writers and remaining capabilities, and deliver repeatable end-to-end, recovery, storage, client and packaging evidence. Produce an honest release-gate report, supported-capability matrix and operator instructions. This is a substantial implementation assignment, not a test-plan-only task.

On 2026-11-17 the user selected Android reader adaptation in T007 and a separate legacy migration package. Android acceptance starts with emulators; Chromecast debugging is deliberately last. Read [the recorded choices](../research/t007/decisions.md). Legacy migration, unaccepted production policies and release authorization remain separate gates. A worker can submit completed local work for review with named external gates open; it cannot call the complete release ready or mark T007 Done itself.

## Base, owner and write scope

Integrated main: `8de06b96c704bbf2a6067dc4df61a25401390393` (PR #86, merged T006). Start from the coordinator's **final `codex/t007-readiness` commit**, which adds this preparation. Do not start from the main hash alone, another task's checkpoint or a moving branch tip. Suggested implementation branch: `codex/t007-integration`. Use a fresh isolated checkout; record worker identity, actual immutable base and branch in `handoffs/T007.md` before implementation.

One owner receives:

- `apps/android/**`: Litara edition/catalog/reader adapters, native personal-state queues/UI, account isolation and integration fixes/tests. Preserve AGPL notices, upstream reader provenance, Cast/Auto and full/F-Droid builds. Prefer narrow seams over rewriting the imported player/reader.
- `apps/server/**`: required compatibility/capability/integration fixes, qualified metadata writers, queries/generated code, recovery and test harnesses. Application schema stays in `migrations/00001_init.sql` under ADR-0030; River migrations stay intact. Use disposable fresh test databases; never reset a user's database.
- `apps/web/**`: integration/accessibility fixes and tests; preserve pristine vendor engines and the separate reader origin.
- `contracts/t003/**`, `contracts/t004/**`, `contracts/t005/**`, `contracts/t006/**`: narrowly necessary additive integration corrections/examples, plus associated check/parity scripts. Existing operation semantics are authoritative; no arbitrary API redesign or deletion of failing scenarios. Document every wire change and its governing ADR. Architecture changes still require a proposal/decision.
- `scripts/t007/**`, necessary local `scripts/backend/**`, `scripts/web/**` and `scripts/contracts/**` helpers; `deploy/**` for local reproducible unsigned test packaging and two-origin TLS test configuration only. Preserve existing pins/provenance until a reviewed compatible update is necessary.
- `research/t007/**`, `handoffs/T007.md`, and a new `docs/operations/**` directory for setup, backup/restore, recovery and diagnostic instructions. Keep other workers' historical ledgers intact; reference their limitations from the new ledger.

Do not edit root `TASKS.md`, `AGENTS.md`, `README.md`, `ADR/**`, other assignments/handoffs, `.github/**`, archive, brand masters, signing/publishing secrets or local books. Propose needed root/ADR/CI changes to the coordinator in the handoff. No CI activation, release tags, publishing, public deployment, signing, real-recipient email, production migration automation, legacy importer, credential transfer or destructive retention. No extra worker is assigned; delegation is not implicit in this scope.

## Read before changing behavior

Read root instructions/register, ADR index and relevant accepted records, especially 0005–0011, 0013–0025, 0027–0043, 0044–0061, 0062–0076. Read current/final sections of T001–T006 handoffs; the full T003–T006 contracts and fixtures; `apps/android/ADAPTATION.md`, `BUILDING.md`, `research/android/`; `research/t005/{coverage,format-matrix}.md`; `research/t006/coverage.md`; all `research/t007/` files and `contracts/t007/scenarios.json`.

Historical handoff milestones are not current truth. In particular T005 already implemented ebook editions and recording merge/split; do not duplicate them. The Android reader connection and production metadata writers are actual missing implementation at the baseline. Use Context7 (resolve then concept-scoped queries) for current libraries/platform APIs. Inspect pinned upstream source where protocol or reader behavior needs proof. Record dependencies, licenses, versions and reproducible setup; never copy AGPL Android modifications into MIT server/web.

## Milestone 1: baseline and actual Android reading

Establish a clean, disposable real-server/PostgreSQL/media fixture stack against the merged checkpoint. Run existing contract checks and native/server/web baselines; report failures/skips distinctly. Use documented free ports, unique containers/databases and an owned emulator. Do not stop unrelated services or take over the user's existing emulator. Baseline failures are owned integration work unless outside the authorized architecture.

Adapt native catalog/title/edition selection and exact file/version acquisition to existing T005 APIs and bearer sessions. Open actual EPUB/KEPUB, supported Foliate reflowable formats, PDF and comics through the preserved Android reader. Keep ebook and recording identities distinct, paginate all lists, and expose truthful read/download/resume/annotation capability states. Do not fabricate a recording for an ebook, infer a file by title or build BookOrbit-compatible endpoints.

Wire native reading position, manual finish/unfinish, supported private annotations/notes/bookmarks and ordinary shelf access to their revisioned contracts. Persist pending personal writes with operation/base/content identity before sending; survive app/process death and lost responses; scope metadata, files, queues and callbacks by server/account. Logout/access removal locks data; a returning authenticated owner can recover it. Preserve versioned downloads without silently applying new-byte positions. Old unattributed Android data stays quarantined, neither claimed nor deleted.

Prove renderer-produced native/web locator round trips on identical file/version, including layout/font changes, PDF crop/rotation coordinates and comic stable entry IDs. Consult `contracts/t005/README.md`'s compatibility-profile rule. Native ancestry or a parsed CFI is not compatibility evidence. Never tag an incompatible locator with the web profile to make the API accept it, resume by percentage, convert between changed bytes, or overwrite unsupported anchors. Where existing semantics cannot represent native behavior, provide a failing fixture and a concrete proposed decision to the coordinator; pause only that dependent behavior and continue other work. No unaccepted profile extension or weaker validation.

Exercise backward saves, lost acknowledgements, two-client stale writes, explicit conflict resolution, annotation tombstones, replacement 412 and separate edition completion/history through real native UI/API. Advanced cross-engine annotation conversion is excluded; supported same-file typed anchors require evidence. Preserve existing audio natural-end/manual completion and the Cast proxy's credential boundary.

## Milestone 2: close inherited integration and writer gaps

Reconcile every [gap row](../research/t007/gaps.md) and acceptance scenario with actual code. Test ingest-to-read/listen, protected metadata/clears, reviewed imports, repaired recording successors, old offline versions and server/account revocation together. Fix defects with meaningful regressions, preferably reproduced before the fix. Do not broaden into podcasts, transcoding, new providers, browser offline downloads or new sync algorithms.

Implement the selected metadata write formats (EPUB/MP3/FLAC/M4A/M4B) under ADR-0048/0052/0057 using safe, licensed, pinned tools/libraries. Qualify each enabled field/format combination independently. Verify unchanged book content/audio payload, codec streams, chapter timing/text, artwork bytes and unknown metadata preservation; duration or count equality alone is insufficient. Test malformed/protected inputs, stale plans, concurrent edits, backup off/on/failure, staging/version rechecks and recovery. Register a production writer only with retained fidelity evidence and safe publication. A failed format remains disabled with a visible reason and open gate, not an undocumented stream-copy claim. No conversion or automatic write-back.

Check opt-in providers against current upstream docs/terms using public/synthetic queries; report unavailable services or policy choices rather than substituting a provider. Scheduled reconciliation is the safety net. Event hints may be added as bounded hints under ADR-0050 if useful, but do not replace polling or turn absence into deletion. Test no-overwrite import publication races and fail safely when a filesystem cannot supply required guarantees.

## Milestone 3: real recovery, TLS and backup/restore

Use actual production server wiring and durable jobs. Kill/restart an owned disposable process after observable partial extraction, import staging and SMTP submission boundaries; retain exact timing/evidence. Verify no partial reader manifest, duplicate import or automatic uncertain mail resend; queued work recovers. Restart with missing/wrong SMTP key, restore the correct key and prove settings/data survive without exposing secrets. Restart KOReader state, candidates and receipts. Test hooks supplement rather than replace process-death evidence.

Test application plus isolated reader behind a local certificate-validated TLS proxy with separate origins. Exercise cookies, CSRF, CORS/CSP, reader root-route denial, hostile content/messages, authenticated original Range/HEAD/replacement and native bearer refresh/revocation. Never fall back to development HTTP after TLS failure. Fix local packaging so the actual unsigned test package contains web/reader assets and both pinned native media tools and operates without a host FFmpeg install or runtime asset downloads.

Perform a disposable backup and restore into an independent fresh stack. Inventory database, roles needed for restoration, operator configuration/SMTP key ring, durable state and media roots; distinguish regenerable caches. Restore exact IDs/versions/progress/conflicts/annotations/shelves/grants and verify reading, playback, KOReader and queued-delivery safety. Prove original fixture media unchanged. Backup keys are necessary for encrypted SMTP secrets but never enter committed evidence. Do not interpret this rehearsal as an accepted production backup/retention or automatic schema-upgrade policy. ADR-0030 still governs init; propose production migration execution instead of silently replacing it.

## Milestone 4: corpus, clients, accessibility, then hardware

Start with automation and both Android emulator flavors, including real reader UI, offline queues, force-stop/relaunch, account switch, natural-end and post-repair audio. Use actual tested renderers/decoders, not mocks. Large sparse files prove arithmetic only; record valid >4 GiB media tests separately. Expand lawful fixture provenance and the capability matrix for realistic ebook/font/PDF/archive/audio variants. Record read/inspect/seek/resume/annotate/download/write separately per client/OS/codec. Do not require all recognized formats to pass to produce honest evidence; unresolved accepted release requirements remain open.

Next coordinate user-assisted mounted NAS (SMB/NFS where available), actual KOReader/OPDS application with TLS, screen reader and touch/keyboard checks. Request exact resources only when the local setup and steps are reviewable. Use synthetic accounts/recipients and dedicated test shares/copies, not private libraries or a mounted share unmount without explicit coordination. Match large digest vectors against upstream code and full app behavior; disclose KOReader's generic conflict failure and web resolution flow.

**Chromecast last:** prepare exact debug build, synthetic recording and reproduction/diagnostic steps, then coordinate with the user for receiver/network debugging. Name receiver, phone/controller, OS/app/firmware and network topology. Prove phone proxy, Range/seeking, handoff/reconnect, expiry/revocation and no server token reaching receiver. A fake receiver or emulator test is not physical Cast acceptance. Android currently has emulator resources only; real phone/Auto head-unit, vehicle voice/steering-wheel/artwork gates remain open until an operator supplies them. Do not repeatedly request hardware while independent local work remains.

Mail testing stays on a local sink with synthetic recipients. No external mailbox delivery is authorized. T006 partials need automated secret-log assertions and explicit Atom rules/client conformance evidence; retain a formal-validation limitation if no adequate authoritative validator is available.

## Milestone 5: package evidence and handoff

Audit first-/third-party licenses, reader/vendor provenance, binary build configuration/source references and notices. Build reproducible unsigned local test artifacts where possible; record source commit, lockfiles, toolchain, platform, checksums and package contents. Repeated-build differences must be explained rather than labeled reproducible. Verify full and Cast-free F-Droid dependency graphs. Do not change release identifiers/signing/distribution or promise new platforms without an accepted decision.

Deliver:

- Updated `research/t007/coverage.json` with each scenario's observed status, evidence files, exact command/environment and blockers; linked detailed logs/reports with secrets redacted. Never rewrite inherited evidence as freshly run.
- `research/t007/capabilities.md`: format/client/platform and each capability, tested fixture/codec/size and explicit incomplete/unsupported reasons.
- `research/t007/release-gates.md`: pass/fail/pending/not-applicable per gate; migration T008 and unresolved production/hardware decisions remain visible. Only the user/coordinator can accept a scope reduction.
- `docs/operations/`: concrete clean setup, local TLS/reader origins, scan/import/write recovery, key handling, backup/restore, troubleshooting and upgrade caveats, all exercised where claimed. Explain local build/rehearsal versus supported release.
- `handoffs/T007.md`: worker/base/head/branch, governing ADRs, changed paths, setup/reproduction, exact checks with failure/skip counts, device identities, fixture/license provenance, decisions needed and smallest integration steps. Submit reviewable commits with state **Ready for review**, or the appropriate blocked state with completed independent work and the exact remaining boundary. Do not mark the task Done yourself.

## Validation and preparation distinction

Preparation: `python scripts/t007/check_readiness.py`, existing static T003/T005/T006 contract checks, ADR/index validation and `git diff --check`. These validate assignment integrity, not application behavior. No T007 OpenAPI endpoints are invented: existing contracts are the starting API; additive corrections require parity/fixture coverage.

Implementation: run `scripts/backend/check.sh` with `LITARA_REQUIRE_INTEGRATION=1` and disposable PostgreSQL; rebuilt `scripts/backend/smoke.sh`; web lockfile install/typecheck/build/unit and real-stack browser/isolation suites; Android full/F-Droid lint/unit/assembly plus both emulator suites against the integrated server. Read existing scripts and handoffs for exact prerequisites/runner arguments, pin versions, fail on missing required integration rather than hiding skips, and update local helpers as needed. Run appropriate checks after changes; no unrelated archive build/format or broad source churn. Workflow files and Actions settings stay untouched.

External checks may remain explicitly pending with operator prerequisites; this permits review of local work, not a false full acceptance. There is no release authorization in this assignment. T008 migration design/implementation remains unassigned and cannot overlap T007's server/schema ownership without a written narrowed transfer.
