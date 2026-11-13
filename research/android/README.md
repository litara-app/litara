# Android preservation audit: BookOrbit Android → Litara

**Source revision analysed:** `deranjer/bookorbit-android` @ `a55eaa13d8ba27cd143dda882836ed35a4dc923f`
("chore(main): release 0.9.0 (#113)", 2026-11-11). This equals `main` HEAD on 2026-11-12, so there are
**no later changes** to the inspected baseline. The reference clone is at
`E:\Programming\_reference\bookorbit-android` (outside the Litara stack). Nothing was imported into
`apps/android/`, no ADR was edited, and no licence was changed.

Audit date: 2026-11-12. Labels used throughout: **[Obs]** observation, **[Rec]** recommendation,
**[Q]** unresolved question.

| Document | Contents |
| --- | --- |
| [architecture-map.md](architecture-map.md) | Subsystem map with files/symbols: auth, models, catalog, readers, downloads, playback, progress, Cast, Auto. Reusable vs BookOrbit-specific |
| [source-provenance.md](source-provenance.md) | History, contributors, reader-asset lineage (Foliate/BookOrbit/Booklore), dependency licences, classification |
| [backend-contract.md](backend-contract.md) | Endpoints/fields Android uses, and the behaviour the media stack requires, separated from BookOrbit naming |
| [media-preservation-matrix.md](media-preservation-matrix.md) | 20 preserved behaviours → code → tests → hardware-only checks; known limitations |
| [baseline-verification.md](baseline-verification.md) | Commands, environment, results (lint, 335 JVM tests, 20 instrumented tests, debug + release, both flavours) |
| [adaptation-plan.md](adaptation-plan.md) | Prerequisites, 10 increments, the first Android/Go slice, ADR questions, the next task |

## Key findings

1. **[Obs] The media stack is strong and well tested.** Player, Cast and Auto are built on Media3 1.5.1 with a
   session-level `BookAggregatingPlayer`, an on-device Cast LAN proxy with Range support and MP4
   chapter-track hiding, and a `MediaLibraryService` browse/search tree that works offline and from a cold
   start. Lint, 335 JVM tests and 20 instrumentation tests passed in **both** `full` and `fdroid` flavours
   in this audit's own run (emulator, Android 16). Physical Chromecast results exist only as the upstream
   repo's own notes and were **not** reproduced here.
2. **[Obs] The upstream app is unmaintained.** Its README says development ended because BookOrbit 3.8
   gates routes behind Android app attestation for the official package. This supports Litara's accepted
   "documented API for third-party clients" constraint and argues against any BookOrbit compatibility layer.
3. **[Obs] Licensing is the main blocker, not engineering.**
   - The repository is AGPL-3.0, with no CLA/DCO. Three outside contributors (`sharkusmanch`: 18 commits,
     +1842 lines in the **player/chapter/restore/download core**; `6801318d8d`: sync queue; `kkucherenkov`:
     a 16-line polyfill) contributed under AGPL.
   - `app/src/main/assets/reader/` is a copy of **BookOrbit's (AGPL) modified foliate.js**, not pristine
     foliate-js (MIT). It has streaming-loader/KOReader/Kobo additions shared with Booklore (AGPL), and no
     MIT notice is retained. `bridge.js` says it was "ported verbatim" from BookOrbit's web client. The
     repository owner has no commits in `bookorbit/bookorbit`.
   - **[Q]** `bridge.js` was first written for a React Native WebView, possibly Litara's former Expo app.
     This could not be checked because `archive/litara-v1/` was absent.
   - All runtime dependencies are Apache-2.0, except Google Cast (proprietary, full flavour only, verified
     absent from fdroid APKs). Dependencies do not force AGPL.
4. **[Obs] The backend contract that matters is small.** Media needs: stable per-file ids, ordered files
   with per-file duration/size/MIME, recording-time chapters, byte-exact Range with identity encoding and
   bearer auth, artwork, and a position API with client capture time, idempotency and newer-wins. Most
   of the remaining roughly 75 routes are BookOrbit product UI.
5. **[Obs] There are limitations to carry forward or fix.** SAF downloads can't be Cast. The real `CastPlayer` lifecycle
   has no automated test. Local progress/downloads are scoped per *server*, not per *user* (L6). File↔asset
   mapping is heuristic. Media3 is pinned to 1.5.1 with Cast-specific workarounds.
6. **[Obs] Environment gap.** `AGENTS.md`, `ADR/`, `ADR/RESEARCH.md` and `archive/litara-v1/` were not
   present in `E:\Programming\ebooker` during this audit, and the folder is not a git repository, so a worktree
   could not be created. Findings were derived from the Android source and the task brief's accepted
   constraints. **[Rec]** Re-check them against the accepted ADRs once available.

## Readiness

| Area | Ready to import? | Blocker |
| --- | --- | --- |
| Pure media math/ids (Jared-only files) | After rights confirmation (P1) | P1, P2 |
| Player core / chapter clock / restore / downloads | **No** | `sharkusmanch` grant or reimplementation (P3) |
| Cast proxy + MP4 filter + Cast flavours | After P1/P2 (appears Jared-authored; mixed only in `PlaybackService`/`PlayerManager`) | P1, P2 |
| Android Auto catalog/search/artwork | After P1/P2 (Jared-only except `MediaLibraryCallback`/`AutoBrowseTree`) | P1, P2, P3 |
| Sync queue | **No** | `6801318d8d` grant or reimplementation |
| Reader assets / bridge | **No** | Replace with pristine foliate-js + new bridge (P4) |
| Catalog UI / Book Dock / dashboard | Not recommended | BookOrbit product model |
| Network edge (ApiService/DTOs) | Not recommended | Replace with the Litara API |

## Prioritised next steps

1. **Authorship classification CSV** (smallest useful task; details and acceptance criteria are in
   `adaptation-plan.md` §5). It needs no ADR decisions.
2. Project owner: written rights confirmation (P1). Contact the three contributors (P3).
3. ADR session: answer the 13 questions in `adaptation-plan.md` §4, prioritising playable-unit ids,
   the position model, media auth and the refresh transport.
4. Increment 1 (skeleton + CI with the emulator job) once P0/P1 are done.
5. Draft the Litara media contract tests (Range cases, position semantics) so the Go slice and the Android fake
   share fixtures.

## Proposed ADR questions (summary; full list in adaptation-plan.md §4)

Playable unit and id format · position representation and concurrency rule · chapter ownership/time
base · media auth (bearer vs signed URL) · native refresh-token transport · discovery/server-id endpoint ·
one pagination convention · offline snapshot document · per-file annotation addressing · finished state
ownership · third-party access policy (no attestation gate) · Android app identity and flavours ·
licensing intake policy.

## Notes for sibling sessions

Large artefacts remain outside the repo: `E:\Programming\_reference\bookorbit-android` (clone + build
outputs), `E:\Programming\_reference\foliate-js`, `E:\Programming\_reference\upstream-assets`,
`E:\Programming\_reference\logs`.
