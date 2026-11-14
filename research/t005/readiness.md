# T005 readiness review

Reviewed 2026-11-14 against integrated main `dae3f3e66cf125fbb428e1d010f7f6b44b3bb591` (PR #83), including T003 #81 and T004 #82. This is coordinator preparation, not an implementation assignment or acceptance of new architecture. No agent has been assigned.

## Assessment

The full T005 package is **not ready for implementation assignment**. Accounts, browser sessions, versioned audio playback/progress and catalog-management APIs exist. The web application itself does not exist on the integrated rebuild tree. Ebook editions, reader-facing catalog/content access, reading progress, annotations and shelves still require server/schema/contract work. A frontend-only brief cannot deliver the accepted reading and listening outcome.

The accepted basis already selects React/TypeScript/Mantine (ADR-0010), title/edition/recording/file separation (0006), exact versioned file identity (0018), revision-aware progress/conflicts (0015/0034), edition/recording completion (0022), broad formats with honest capability reporting (0025), pristine upstream Foliate plus direct PDF.js and bounded server comic extraction (0027), and protected same-origin cookie/CSRF authentication (0037/0041). Do not reopen these choices by accident or import Android's AGPL reader changes into MIT web code.

## Evidence and usable foundations

| Area | Observed evidence | Implication for T005 |
| --- | --- | --- |
| Accounts and browser sessions | `contracts/t003/openapi.json`, `apps/server/internal/httpapi/handlers.go` | Login/session/logout, current user, library grants and session controls can be consumed; preserve cookie/CSRF rules. |
| Audio | T003 recordings, versioned file bytes, artwork, position/completion/conflict routes | Build real web listening against the existing protocol, including 409/412 handling and missing/incomplete states. Browser codec/profile support still needs evidence. |
| Ingestion and management | T004's 21 operations, `contracts/t004/README.md` and `model.md` | Library config/scans, review resolution, metadata, managed import and write-back plans can support admin workflows. Admin status alone never bypasses a library grant. |
| Ebook catalog | `handoffs/T004.md`, single init schema | Ebook files are indexed, but there are no ebook edition or reader-facing entities. Existing media resolution must be checked/extended for ebook library grants and versions, not assumed sufficient because a file route exists. |
| Reader state and organization | T003/T004 path inventories and init schema | No ebook reading-position, annotation or shelf APIs/tables were found in this source review. These need implementation, not mock-only frontend stores. |
| Web source | No `apps/web/` in integrated tree | Establish a replacement app and reproducible tooling; archived web code is read-only behavior reference. |
| Brand | `design/brand/README.md` and `logo.svg` | Selected blue bookmark mark exists. It does not supply approved screen designs or typography. Preserve the vector master. |

This is source/contract inspection plus existing handoff evidence. No new server, browser, device, provider or NAS runtime behavior was tested for this review.

## Decisions needed before the full assignment

Write proposed ADRs and obtain explicit user choices for unresolved architectural behavior; do not label this review as acceptance.

1. **Ebook edition and location contract.** Define how scanned ebook files become editions and relate to titles, including uncertain associations and manual repair. Define format-specific location envelopes anchored to file ID/content version, revision/idempotency rules, conflict candidates/resolution, invalidated locations, and completion. Keep translations and different files distinct; no implicit percentage or cross-format conversion. Decide whether Android ebook adaptation belongs to this package or a subsequent explicitly owned package.
2. **Annotations and organization.** Define private versus shared visibility, highlight/note/bookmark capabilities per format, edit/delete concurrency, tombstone retention and retry behavior. ADR-0015 explicitly requires an independent annotation-deletion specification. Define shelf ownership/visibility, membership, ordering and any smart-shelf scope. Unspecified smart shelves or advanced annotation conversion are not automatic requirements.
3. **Reader security and extraction.** Select the concrete content-isolation boundary, credential-free content delivery and validated bridge protocol consistent with ADR-0027. Specify ZIP/RAR/7z handling, chosen extraction dependencies/executables and licenses, page ordering, cancellation, cache ownership, path traversal protection and explicit byte/page/expanded-size/time/concurrency limits. EPUB embedded scripts must not obtain application privileges. Accepted reader engines do not settle these mechanisms.
4. **Workflow and capability boundaries.** Agree the navigation and main user/admin flows, exact-file edition/recording selection, resume/conflict UI, and format-specific annotations/accessibility behavior. Define the browser support and codec matrix, unsupported/DRM/damaged-file states, and browser offline expectations. Android offline decisions do not automatically select a browser service worker or downloads system. Broad format targets remain in force; a phased implementation must not silently redefine release support.
5. **Supporting web architecture and serving.** Select unresolved routing, state/data-fetching and build/test approach, reader revision/asset packaging and same-origin web/API hosting. Pin versions using current Context7/upstream documentation. Routine configuration within accepted choices can be chosen by the assigned worker; meaningful new architecture requires an accepted ADR. No CI reactivation or production publishing is authorized.

## T004 follow-ups and their relationship to T005

| Gap carried from the merged handoff | Preparation treatment |
| --- | --- |
| Ebook editions/reading entities absent | Direct blocker for complete reading. Explicitly give T005 server/schema/query/contract ownership for this work, or complete a serialized prerequisite before frontend assignment. |
| Manual recording merge/split absent | Existing accepted requirement (ADR-0045), not a new product decision. Assign backend repair/identity/history work before promising working web controls. A tombstone versus equivalent identity-preserving mechanism still needs concrete design. |
| No registered in-file writer or fidelity evidence | Do not render an enabled write action. Show actual capabilities and disabled reasons; separately assign format writers/fidelity work. This need not prevent catalog/reader implementation, but it remains an accepted feature gap for final release. |
| Provider adapters only tested with local servers | Keep enrichment opt-in and expose real failures/review states. Assign live verification separately; do not claim provider readiness. |
| NAS and atomic publication unverified on real shares | Preserve root-health and recovery UI. Keep physical acceptance as a release gate; desktop simulations are not sufficient evidence. |
| Replacement-to-stale-position 412 not retested end to end | Add real T004 replacement plus existing audio resume/conflict coverage to T005 integration acceptance. |
| Watcher hints absent; narrator/language grouping incomplete | Track as follow-ups with explicit ownership and honest UI. Do not obscure them behind a successful scan indicator. |

These classifications describe dependencies, not permission to drop accepted features or declare the project production-ready.

## Artifacts required to mark Ready

- Accepted ADRs for the choices above, with unresolved subquestions kept open.
- `contracts/t005/`: exact API schemas, persistence/ownership boundary, positive/negative examples and scenario fixtures for editions, locators, reading progress/conflicts, annotations and shelves. Preserve T003/T004 parity and consumers.
- `handoffs/T005-assignment.md`: one named owner's complete end-to-end brief, immutable base commit, exclusive paths, milestones, acceptance matrix, local verification commands and non-goals.
- Committed fixture generation/provenance for representative DRM-free formats; no local books, user state, credentials or signing material.
- Explicit ownership of T004 gaps needed by promised web flows, plus an integration order for any other server work. No overlapping migrations/contracts/server ownership with T006 or Android adaptation.
- A committed, clean checkout containing the above. Do not ask an external worker to rely on this coordinator's uncommitted files.

Suggested write scope for discussion: `apps/web/**`, necessary ebook/annotation/shelf modules and queries under `apps/server/**`, the first-party init migration under ADR-0030, `contracts/t005/**`, narrowly scoped parity/fixture updates, `scripts/web/**`, `research/t005/**`, and the worker's `handoffs/T005.md`. Coordinator-owned ADRs/register/assignments, Android, archive, brand masters, CI, signing and publication stay outside that scope unless explicitly transferred. This suggested scope is not an assignment.

## Proposed implementation sequence after readiness

Use one substantial end-to-end assignment with reviewable internal milestones: establish catalog/edition and read-state contracts/server support; build the authenticated responsive shell and real catalog; integrate reader engines with persisted positions/annotations/shelves; add web audio and management flows; then complete failure/security/accessibility and format-matrix verification. Avoid handing off a static dashboard as completed T005.

Planned acceptance must include real API/browser tests for access isolation and CSRF, scan-to-edition-to-reader, exact-file resume after reload/font/layout changes, stale/changed-content conflicts, annotation edit/delete retries, shelf persistence, multi-file audio/chapter navigation/completion, managed-import preview, protected metadata edits/clears, disabled writer states, malicious embedded content/archive inputs, bounded large-file handling, keyboard navigation and responsive layouts. Name exact supported browser/format results and failures. Cross-client locator checks need explicitly owned Android participation and compatible fixtures.

## Release boundary

T005 does not ship 2.0.0. ADR-0062 targets the version, ADR-0063 requires verified personal-state migration before shipping, and ADR-0064 keeps GitHub Actions disabled until explicit user release-readiness approval. Design new personal-state models so the future importer has documented supported write paths; do not invent the legacy conversion rules in T005. Local development builds and checks remain allowed; CI, release tags, package/image publishing and signing access remain paused/out of scope.
