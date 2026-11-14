# T005 assignment: complete web reading/listening and personal organization

Preparation date: 2026-11-14. Status: **Ready for one implementation owner after the coordinator supplies the committed checkpoint hash.** No worker is assigned by this document. The coordinator's final register/checkpoint identifies the immutable source; do not follow branch movement silently.

## Outcome

A usable responsive React/TypeScript/Mantine web app served by the Go application, with real catalog/edition browsing, exact-file reading/resume, private annotations, private/shared manual and smart shelves, web audio, account/library administration and T004 management/review flows. Include the missing server/schema/contracts, ebook file authorization and reviewed recording merge/split. A static dashboard, mocked reader or browser-local-only personal state is not completion.

The user explicitly accepted ADR-0065–0070 on 2026-11-14. No product-policy decision intentionally blocks this assignment. If implementation exposes another architectural choice, propose it and await the user's decision while continuing unaffected work; do not weaken reader isolation, silently add native tools or claim unsupported formats as complete.

## Base and ownership

- Starting code: integrated T001–T004 at main `dae3f3e66cf125fbb428e1d010f7f6b44b3bb591`, plus release-decision/README preparation `5aa0b65a1dbba8f9bd3ef43af7dfeaf1b16fe3c2`, plus this complete T005 preparation checkpoint. Use the coordinator-supplied final hash, not either older commit by itself. Pending review PR #84 may contain the full preparation before it is merged into main.
- Use a fresh isolated branch/worktree; suggested implementation branch `codex/t005-web-reading`. Record actual worker identity/base/branch in your own `handoffs/T005.md` before implementing.
- One owner receives the full scope below; no concurrent T006/Android/server/schema/contract worker may overlap. Coordinate any necessary ownership transfer in writing first.

### Owned write scope

- `apps/web/**`: the new app, Litara-owned reader bridge, pristine upstream engine assets/notices, isolated renderer, styles, tests, lockfile and package scripts.
- `apps/server/**`: edition/catalog/ebook metadata integration, reading/annotations/shelves/conflicts, extraction/cache/durable workers, repair plans/tombstones and necessary auth/media/query/HTTP wiring. Preserve unrelated T001–T004 behavior.
- `apps/server/migrations/00001_init.sql` and generated sqlc outputs under the same module. Fold pre-production schema into init; do not rewrite River migrations or reset user data.
- `contracts/t005/**`; narrowly required additive T003 repair error/context examples and their implementation parity updates. Do not remove existing T003/T004 operations or change unrelated successful recording/auth schemas.
- `scripts/contracts/check_t005.py`, necessary existing contract/parity/live-check scripts; `scripts/web/**`; narrowly necessary local backend smoke additions. Do not turn CI back on.
- `deploy/**` only as needed to bundle/serve unsigned local web/reader assets with Go; no new public hosting, deployment or publication. Preserve pinned ffprobe/FFmpeg provenance and existing support boundaries.
- `research/t005/**` and your own `handoffs/T005.md`: supporting choices/pins, fixture provenance, test results, capability matrix, gaps and integration evidence.

Do not edit shared `TASKS.md`, root `AGENTS.md`, `ADR/**`, other workers' handoffs/assignments, archive, Android, brand masters, signing/publishing secrets or `.github/**`. Report root/CI/documentation changes needed for coordinator integration. `design/brand/` is read-only input. Avoid archived hooks/release workflows; do not build/format the archive. Preserve all local data and existing deletions.

## Required reading

Root AGENTS/register; ADR index and research; accepted ADRs 0004, 0006–0011, 0013–0015, 0017–0019, 0022, 0024–0025, 0027–0030, 0031–0043, 0044–0061, 0062–0070 as relevant. Read `contracts/t003/`, `contracts/t004/`, **all** `contracts/t005/` files, and T003/T004 handoffs. Use archived Litara/pinned BookOrbit as read-only behavior references with provenance, not a second active application. Android remains AGPL; web/backend are MIT.

## Work and milestones

Each milestone is reviewable work inside one assignment, not permission to leave later required work unfinished.

### 1. Reproducible foundation and isolated-reader proof

Pin compatible React/TypeScript/Mantine/Vite, router/query/test tools and pristine Foliate/PDF.js revisions using current Context7/upstream sources. Supporting router/query dependencies are routine choices within the accepted SPA; report pins, source/license hashes and tradeoffs. Do not add SSR, native helpers or a different auth/storage architecture. Keep dependency assets self-contained; no runtime CDN downloads. Keep Litara bridge/UI outside pristine upstream renderer sources and record checksums/notices.

Establish the Go-served static app, restricted SPA fallback and same-origin development proxy. Prove real Foliate and direct PDF.js modules/workers work inside the selected opaque iframe sandbox with production CSP/CORS headers. Reader content gets no session, CSRF or generic network/API privileges. The parent validates per-open channel/schema/file/version/generation and bounds data transfers. Embedded scripts/external links/hostile messages are blocked. Apply browser-side ZIP resource limits too. If a renderer cannot satisfy this boundary, report a concrete blocker; do not silently add allow-same-origin, unsafe-inline/eval script permissions, unrestricted fetch, book scripting or a second hostname. Book layout styling does not imply permission for embedded scripts or external resource loads.

### 2. Editions, metadata and real reader-facing APIs

Implement the additive contract and persistence model. Extend ingestion to produce distinct ebook/comic editions, capability evidence and conservative/provisional title associations; support identity-preserving moves/replacements and reviewed title linking. Extend file authorization for ebook-only memberships without fake recordings, preserving current Range/HEAD/version semantics. Add bounded Go-based metadata parsing and provenance/protected edits/clears for editions, preserving existing recording metadata and opt-in-provider rules.

Implement edition reading position/completion/history, durable per-device candidates/receipts/conflicts, exact file/version locators and manual ebook finish/unfinish. Do not substitute a percentage or transfer locations to changed bytes. Keep recording history/API compatibility; ebook history is additive. Use real transactions and existing permission/session infrastructure. No user identity comes from mutation bodies.

### 3. Reader, annotations, shelves and retry recovery

Build library/title/edition selection with real API data, responsive navigation, search, empty/loading/error/incomplete/unsupported states and explicit recording/edition choices. Integrate Foliate reflowable/CBZ, direct PDF.js and CBR/CB7 image-page manifests under accepted bounds. Reader controls include TOC/page navigation, appropriate font/layout/zoom/rotation settings, exact-file resume, valid text/page selection, highlights/notes/bookmarks with capability-specific UI and keyboard access.

Implement private revisioned annotations/tombstones/conflict recovery and private/shared owner-edited manual/smart shelves. Smart filters are viewer-specific, bounded and never expose owner state or bypass grants. Persist pending personal operations in server/account-scoped IndexedDB before sending. Clearly distinguish saved, pending, locked and conflict states. Test reload/network failure/logout/account switch/revocation. No browser offline book downloads/service worker; Android ebook adaptation remains separately owned.

### 4. Audio, administration and repair

Web audio uses the existing versioned multi-file recording/chapters/revisions/conflict/completion protocol. Preserve intentional backwards seeks; a changed layout/version is explicit. Verify real codec/profile behavior, chapter/file transitions, reload and T004 replacement-to-412 integration. Do not add automatic transcoding.

Build current-account/session controls and admin-provisioned accounts/library grants/config, scan health/status, protected metadata edits/clears, review queues, copy-only managed-import plan/approval, and actual write-back capability/status controls. Use existing T004 endpoints rather than fake frontend state. Writers remain disabled without fidelity evidence; backups remain optional/default off. Do not implement provider live qualification or metadata format writers in this assignment.

Implement reviewed merge/split per ADR-0070, including plan approval/revalidation, successor recording IDs and retained source tombstones/history/state/candidates. No source file changes or automatic interpretation of old completion/resume. Preserve unrepaired Android/T003 success paths and verify additive error/context changes against old fixtures. Any native UI adaptation beyond contract compatibility needs a separate owner/scope, not edits in Android here.

### 5. Complete verification and handoff

Exercise all 38 scenarios in `contracts/t005/scenarios.json`, not only happy paths. Extend existing OpenAPI parity to T005 when routes are implemented; require zero unexplained drift across T003/T004/T005. Run meaningful server integration with real PostgreSQL/ffprobe plus real browser/API tests under actual reader headers; mocks alone do not prove isolation, auth or persistence. Use generated fixtures and record the complete format/browser/capability matrix, including unsupported variants.

Pin browser versions for Chromium/Firefox/WebKit tests, including narrow viewport/touch and keyboard flows. Record untested OS/device/codec/physical hardware honestly. Hardware and real NAS acceptance remains T007; claiming an engine loaded or a fake media element advanced is not physical/browser codec evidence. Local unsigned development builds are permitted; publishing, CI reactivation, signing, tags and real-user mail are not.

## Contracts, fixtures and local checks

Start with `python scripts/web/generate_reader_fixtures.py .tmp/t005-fixtures` into an absent/empty directory; never overwrite user files. Read `contracts/t005/fixtures.md` and complete the broader licensed/synthetic corpus during implementation before claiming coverage. Do not commit media binaries or local books. T003 already supplies generated audio/Range/media fixtures.

Preparation commands (no application builds):

```powershell
pwsh -NoProfile -File scripts/Validate-Adrs.ps1
python scripts/contracts/check.py
python scripts/contracts/check_t005.py
git diff --check
```

Contract validators use the pinned `scripts/contracts/requirements.txt`, installed in `.tmp/t003-validation`. Do not require the coordinator's local dependency cache; install documented dependencies in a clean checkout. The implementation must add a local `scripts/web/check` entry point (portable wrapper or documented equivalent) for install/lockfile validation, typecheck, meaningful tests, build and browser/API acceptance. Update local backend checks/smoke as needed; do not modify workflows. Run checks appropriate to the work, avoid archived hooks, and record commands/environment/results in the handoff. Preparation checks do not establish application readiness.

## Done means evidence, not a UI screenshot

- Every promised end-to-end workflow above is implemented against persisted real server state; no placeholder APIs or mocked-only reader/player.
- Auth/grants/private/shared visibility and no-cross-account pending data are proven; exact-file state/conflicts/deletes and repair histories survive restarts/retries.
- Actual CSP/sandbox/bridge/resource bounds are exercised on target browsers; pristine engine provenance/notices and package pins are recorded.
- Broad-format/capability matrix and negative cases are honest; all remaining failures/skips and hardware/provider/NAS limits are visible and assigned as follow-ups, not mislabeled Passed.
- Full local validation and integration evidence is attached, with a clean reviewable implementation diff/commits and reproduction instructions.
- `handoffs/T005.md` names owner, immutable base and final commits, governing ADRs, completed behavior/changed paths, fixture provenance, commands/results, exact gaps/blockers and integration notes. The worker reports **Ready for review**; only the coordinator marks Done after review/integration.

## Explicit release and follow-up boundaries

T005 does not ship 2.0.0, migrate legacy application state, implement OPDS/email/KOReader, adapt Android ebooks, enable metadata format writers, qualify providers live, implement filesystem watchers, or close physical NAS/Cast/Auto acceptance. These remain named follow-ups/release gates, including T006/T007 and the required migration work under ADR-0063. T006/server work waits for T005's stable integrated model/contract or an explicit narrowed ownership agreement. GitHub Actions remains disabled under ADR-0064 until the user's explicit release-readiness decision.
