# Upstream provenance

This directory is an import of an existing native Android client, kept as a reproducible starting
point for the Litara Android application (ADR-0005, ADR-0017, ADR-0023).

| Field | Value |
| --- | --- |
| Upstream repository | <https://github.com/deranjer/bookorbit-android> |
| Exact revision | `a55eaa13d8ba27cd143dda882836ed35a4dc923f` (`chore(main): release 0.9.0 (#113)`, 2026-11-11) |
| Upstream version at import | `versionName 0.9.0` / `versionCode 900` |
| Upstream license | GNU AGPL v3 (`LICENSE`, unchanged) |
| Import date | 2026-11-12 |
| Import method | `git archive a55eaa1…` of a clean reference clone (tracked files only), extracted into `apps/android/`. Upstream commit history is **not** carried over. |

The upstream project is no longer maintained by its author (see `README.md`). Its commit history
(231 commits; contributors summarised in `../../research/android/source-provenance.md`) remains at the
upstream URL above.

## Imported verbatim, then renamed

The import commit state was byte-identical to the upstream revision except for the removals below.
Identity decisions were then applied as a **mechanical rename** (see "Identity" below). Package
names, identifiers and brand strings changed; `versionCode`/`versionName` were reset to `1`/`0.1.0`;
the old deprecation block and strings were removed; and launcher/notification assets and the brand
component were replaced. No player, queue, chapter or Cast logic and no dependency or test assertion
was changed. `gradle/`, `gradle.properties` and `LICENSE` are unchanged from upstream. The reader tree
`app/src/main/assets/reader/**` is unchanged apart from mechanically renamed comments/names.

- `app/upload_certificate.pem` was **removed** (see below).
- `.gitignore` was extended (additions only, marked in the file).

Files added by the Litara import (not upstream): `UPSTREAM.md`, `LITARA.md`, `LICENSING.md`,
`THIRD_PARTY_NOTICES.md`, `ADAPTATION.md`, `BUILDING.md`, and `app/src/main/assets/licenses/*`
(license texts that are packaged into the APK).

## Deliberately not imported

| Upstream path | Why |
| --- | --- |
| `.git/` | Nested Git metadata. |
| `.github/workflows/*` (`android-build`, `android-release`, `play-publish`, `release-please`, `deploy-docs`) | Obsolete publishing/release automation for the BookOrbit product (Play upload, signed release APKs, GitHub Pages docs, self-hosted F-Droid repo). Not wired as active workflows. Only the lint/test/assemble portion of `android-build.yml` is re-created, without signing or publishing steps, as the repository-root `.github/workflows/android.yml`. |
| `release-please-config.json`, `.release-please-manifest.json` | Release automation for the BookOrbit product. |
| `app/upload_certificate.pem` | Play upload *public* certificate for the BookOrbit listing. Not a secret, but release-signing identity material, and not needed to build. |
| `website/` | Docusaurus user-docs and privacy-policy site for the BookOrbit app (GitHub Pages). Product publishing content. |
| `ROADMAP.md`, `CHANGELOG.md`, `docs/server-3.8-compatibility.md`, upstream `README.md` | Upstream product history and BookOrbit-server notes (release-please changelog, deprecation notice, attestation analysis). Replaced by a Litara `README.md`; recoverable at the pinned revision. |
| `fastlane/`, `store-assets/` | BookOrbit store-listing metadata and branding images (about 6 MB). Product identity; not needed to build. |
| `build/`, `app/build/`, `.gradle/`, `.kotlin/`, `local.properties`, `*.iml`, `.idea/` | Never tracked upstream (build outputs, caches, SDK paths, IDE state). |
| `app/keystore.properties`, `app/play-service-account.json`, `*.jks`, `*.keystore` | Never tracked upstream. The build reads them if a developer supplies them locally; they are git-ignored. |

Every excluded tracked file remains recoverable from the upstream revision above.

## Verify the import

The verbatim state can be reproduced from upstream with:

```bash
git clone https://github.com/deranjer/bookorbit-android.git
git -C bookorbit-android checkout a55eaa13d8ba27cd143dda882836ed35a4dc923f
git -C bookorbit-android archive HEAD | tar -x -C <empty-dir>
```

Because of the rename below, `diff -r` against upstream now shows differences in nearly every Kotlin/XML
file. The rename is limited to the substitutions listed under "Identity"; the pre-rename import
comparison (only the documented additions and removals differed) is recorded in
`../../research/android/import-verification.md`.

## Identity (user-selected, applied)

The repository owner selected these values. They are recorded here, not in an ADR (ADR-0023 still lists
application ID/signing as open and ADRs were not edited; the ADR owner should record them).

| Item | Before (BookOrbit) | Now |
| --- | --- | --- |
| `applicationId` / Kotlin package / namespace | `com.bookorbit` | `com.litara` (debug build `com.litara.debug`) |
| OIDC redirect | `bookorbit://oauth2-callback`, placeholder `bookorbit` | `litara://oauth2-callback`, placeholder `litara` |
| Classes/resources | `BookOrbitApp`, `BookOrbitApplication`, `BookOrbitDatabase`, `BookOrbitTheme`, `BookOrbitTypography`, `Theme.BookOrbit*` | `Litara*` equivalents |
| App/display name | `BookOrbit`, `BookOrbit Debug`, `R.string.bookorbit` | `Litara`, `Litara Debug`, `R.string.litara` |
| Gradle project name | `BookOrbit` | `Litara` |
| Local file names | `bookorbit_secure_prefs`, `bookorbit_data_ownership`, `bookorbit_user_ca_trust`, `bookorbit[-<scope>].db` | `litara_*`, `litara[-<scope>].db` |
| Dev tooling | `bookorbit-test-ca.crt`, "BookOrbit temporary test CA", `bookorbit-upload.jks` example | `litara-*` equivalents |

Second pass (also applied): every remaining BookOrbit name in app strings, comments, tests and tooling became
Litara, including the server-URL placeholder, the audiobook-manifest schema test fixture, the stats-source key
and the `docs/testing` checklists. The in-app "No longer maintained" notice (and its link to the upstream README)
was removed. Launcher, notification and in-app logo now use `design/brand/logo.svg` (Litara bookmark mark, converted
to Android vector drawables; white adaptive-icon background). `versionCode`/`versionName` reset to `1`/`0.1.0`
as placeholders.

Caveat: the networking layer is still shaped like the BookOrbit server API (paths, DTO fields, auth flow), so
the renamed strings and fixtures describe a server API that does not exist yet. The Litara adapter
(`ADAPTATION.md`) replaces it; until then the app can only talk to a BookOrbit-compatible server. Provenance
mentions of BookOrbit remain in this file, `LICENSING.md`, `THIRD_PARTY_NOTICES.md` and `ADAPTATION.md` because
the code lineage requires them.

Consequences: this is a **different app identity** from the BookOrbit app, so there is no upgrade path
or shared data with it. Ownership/availability of `com.litara` on Google Play or F-Droid was not checked.
No on-device data migration from `bookorbit*` file names exists (none is needed for a debug baseline).

## Release wiring (kept inert by decision)

Signing and publishing wiring is **unchanged**: `app/build.gradle.kts` still loads optional git-ignored
`app/keystore.properties` and applies Gradle Play Publisher (`com.github.triplet.play`), which only
configures publishing if a git-ignored `app/play-service-account.json` exists. Neither file is
present, no key was accessed or created, and no publishing workflow exists. Unsigned release
builds are the only possible output here. A release/signing plan is still open.
