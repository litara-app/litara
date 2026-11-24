# Licensing boundary

ADR-0017 (Accepted) keeps the Android application under AGPL and the new backend/web under MIT.

| Component | License |
| --- | --- |
| `apps/android/` first-party and upstream-contributed source | **GNU AGPL v3** (`LICENSE` in this directory, unchanged from upstream) |
| Litara backend and web (elsewhere in this repository) | MIT (not affected by this directory) |
| Bundled Foliate-derived reader assets (`app/src/main/assets/reader/`) | MIT upstream (foliate-js) with **modifications that, per the provenance audit, originate in AGPL-3.0 BookOrbit/Booklore code** (see `THIRD_PARTY_NOTICES.md`) |
| Shared reader engine (`app/src/main/assets/reader-shared/`, ADR-0093) | A build output copied byte-for-byte from the MIT web source `apps/web/public/reader` (Litara `bridge.js` and `frame.html` MIT; foliate-js MIT, PDF.js Apache-2.0, notices and `PROVENANCE.md` travel with it). Unmodified, so it carries none of the AGPL reader changes. The Android host page `assets/reader-shared-host/` and the Kotlin around it are AGPL. |
| Other bundled and linked third-party code | Each component's own license (`THIRD_PARTY_NOTICES.md`) |
| Google Cast SDK (`full` flavor only) | Proprietary Google terms; not covered by the AGPL grant; absent from `fdroid` |

Rules for contributors:

1. A root-level MIT license, or any MIT labelling elsewhere in the repository, does **not** apply to
   files under `apps/android/`. Do not describe the monorepo as uniformly MIT.
2. Do not relabel contributor-authored code, or the BookOrbit-modified Foliate/bridge code, as MIT.
3. Do not copy AGPL Android or reader code from here into MIT backend/web source without a separate,
   explicit rights decision. Sharing runs one way (ADR-0093): web reader assets are bundled into the Android app by
   `./gradlew syncSharedReader`; nothing from the Android reader goes back into `apps/web`.
4. Preserve upstream copyright notices and provenance. No SPDX headers were added to imported files,
   because per-file authorship is not established (the authorship CSV is optional provenance work).
5. AGPL source-offer obligations apply when distributing builds. Source and notice packaging must be
   verified before any release. No release of this baseline is planned.

This records the engineering position of the import. It is not legal advice or a compliance
certification.
