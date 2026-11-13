# Third-party notices and inventory

Scope: `apps/android/` at the import of `deranjer/bookorbit-android@a55eaa13d8ba27cd143dda882836ed35a4dc923f`.
Evidence: `../../research/android/source-provenance.md` (audit) plus the checks recorded in
`../../research/android/import-verification.md`. This is an engineering inventory, not legal advice.

License texts packaged into every APK (under `assets/licenses/`):

| File | Text | Source verified against |
| --- | --- | --- |
| `foliate-js.LICENSE.txt` | MIT, Copyright (c) 2022 John Factotum | `johnfactotum/foliate-js` `LICENSE` at commit `78914aef4466eb960965702401634c2cb348e9b1` |
| `fflate.LICENSE.txt` | MIT, Copyright (c) Arjun Barrett | `101arrowz/fflate` `master` `LICENSE`, fetched 2026-11-12 (see note) |
| `zip.js.LICENSE.txt` | BSD-3-Clause, Copyright (c) 2023 Gildas Lormeau | `gildas-lormeau/zip.js` `master` `LICENSE`, fetched 2026-11-12 |

Note: the fflate and zip.js bundles are minified and carry **no embedded notice or version string**, so the
exact upstream release bundled was not established. The texts above are the current upstream license
files; the copyright year/holder line for the exact bundled release may differ and should be confirmed
if the version is ever identified. foliate-js's own README states these libraries' licenses
(zip.js BSD-3-Clause, fflate MIT).

## 1. Bundled reader assets (`app/src/main/assets/reader/`)

| Path | Origin | License | Status |
| --- | --- | --- | --- |
| `foliate/{text-walker,progress,comic-book,overlayer,search,dict,tts,fixed-layout,mobi,fb2,epubcfi}.js` | Reformatted foliate-js (audit: no identifiers absent from upstream revisions) | MIT, John Factotum | Notice restored (`foliate-js.LICENSE.txt`). Possibly older foliate-js revisions; exact revisions not established. |
| `foliate/{epub,paginator,view}.js` | foliate-js **modified** (direct-URL/streaming hooks, KOReader/Kobo progress helpers, continuous-scroll guards). Closest to BookOrbit's copy, whose lineage includes Booklore. | MIT for the foliate-js portions. The modifications are AGPL-3.0 per the audit's lineage evidence (BookOrbit, Booklore, Grimmory are AGPL-3.0). | Notice restored for the MIT portion. **Not** to be relabelled MIT. Authors of the modifications not fully established. |
| `foliate/streaming-loader.js` | Not from foliate-js. Present in BookOrbit and Booklore/Grimmory. | AGPL-3.0 per audit lineage; original author unresolved | Retained as-is. No MIT relabelling. |
| `foliate/vendor/fflate.js` | fflate (minified) | MIT, Arjun Barrett | Notice restored. Version unknown. |
| `foliate/vendor/zip.js` | zip.js (minified) | BSD-3-Clause, Gildas Lormeau | Notice restored. Version unknown. The BSD-3 clause 2 binary-redistribution requirement is met by `zip.js.LICENSE.txt` shipping in the APK. |
| `bridge.js`, `index.html` | Android host and bridge. `bridge.js` states parts are ported from BookOrbit's web client (`THEMES`, `generateCSS`, `applyToRenderer`, annotation drawing). Originally written for a React Native WebView host (unresolved whose). `index.html` contains a `groupBy` polyfill by contributor `kkucherenkov` (16 lines). | AGPL-3.0 (this repository's declared license); BookOrbit-ported portions are AGPL-3.0 | Retained. Contributor code is not relabelled. |

Unresolved: authorship of the BookOrbit-modified Foliate additions, the React Native origin of
`bridge.js`, and exact upstream foliate-js revisions. These do not block AGPL retention (ADR-0017) but
block any reuse of these assets in MIT code.

## 2. Kotlin/Java source

- Declared AGPL-3.0 as a whole. Contributor code (three outside contributors: `sharkusmanch`,
  `6801318d8d`, `kkucherenkov`) arrived under the repository's AGPL-3.0 with no CLA/DCO; see the
  audit. It is kept AGPL.
- `core/model/*` mirrors BookOrbit server DTOs; `ReaderThemes.kt` and `ReadStatusMeta.kt` mirror
  BookOrbit web client values. Interface facts only, and slated for replacement.
- No copied Google sample (UAMP etc.) code or foreign headers were found by the audit
  (absence of evidence only).

## 3. Branding and graphics

Launcher, notification and in-app logo are the Litara bookmark mark from `design/brand/logo.svg` (first-party
artwork, MIT per its README, converted to Android vector drawables and shipped inside this AGPL app). The
former BookOrbit "Orbit" artwork was removed. No bundled fonts were found in the source tree.

## 4. Declared dependencies (versions pinned in `gradle/libs.versions.toml`)

Licenses below are the upstream projects' published licenses and were **not** re-verified by an
automated scanner in this import. A complete transitive license report is a known gap.

| Dependency | Version | License | Flavor |
| --- | --- | --- | --- |
| AndroidX: core-ktx, appcompat, lifecycle (runtime, viewmodel, process, compose), activity-compose, navigation-compose, room (runtime, ktx, compiler, testing), datastore-preferences, security-crypto, documentfile, paging (runtime, compose), work-runtime-ktx, webkit, hilt-navigation-compose, hilt-work, Compose BOM (ui, graphics, material3, material-icons-extended, tooling) | see `libs.versions.toml` | Apache-2.0 | both |
| Media3 (exoplayer, session, common, datasource-okhttp) | 1.5.1 | Apache-2.0 | both |
| Media3 `media3-cast`, AndroidX `mediarouter` | 1.5.1 / 1.7.0 | Apache-2.0 | **full only** |
| `com.google.android.gms:play-services-cast-framework` (and transitive `play-services-cast`, `-base`, `-basement`, `-tasks`, `-flags`) | 21.5.0 | **Proprietary** (Android Software Development Kit / Google Play services terms). Binary dependency; not redistributed as source; not covered by AGPL. | **full only** |
| Dagger/Hilt | 2.53.1 | Apache-2.0 | both |
| Retrofit (+ kotlinx-serialization converter) | 2.11.0 | Apache-2.0 | both |
| OkHttp (+ logging-interceptor, mockwebserver, okhttp-tls) | 4.12.0 | Apache-2.0 | both (test-only for mockwebserver/tls) |
| kotlinx.serialization, kotlinx.coroutines | 1.7.3 / 1.9.0 | Apache-2.0 | both |
| Coil | 2.7.0 | Apache-2.0 | both |
| AppAuth for Android | 0.11.1 | Apache-2.0 | both |
| Gradle Play Publisher (build plugin, inert without credentials) | 3.13.0 | MIT (plugin; not shipped) | build only |
| JUnit | 4.13.2 | EPL-1.0 | test only, not shipped |
| MockK, Turbine, AndroidX Test/Espresso | 1.13.13 / 1.2.0 / see toml | Apache-2.0 | test only, not shipped |

Keep this table synchronised when `libs.versions.toml` changes. Dependency upgrades are out of
scope for the import.

## 5. Known gaps

- Exact bundled fflate/zip.js versions and foliate-js revisions unidentified.
- No machine-generated transitive license report.
- AGPL source-offer/UI notice screen not added (no behavior changes in this increment).
- No SPDX headers (per-file authorship unestablished).
