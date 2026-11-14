# Reference research

Observed on 2026-11-12. This is evidence and a discussion queue, not a set of accepted decisions. Source review does not establish tested runtime behavior.

## Existing Litara

The current working tree is preserved under `../archive/litara-v1/`; its original HEAD is recorded in `source-commit.txt`. Already deleted packages and OpenSpec documents were not restored.

| Area | Evidence in archived tree | Observation |
| --- | --- | --- |
| Server/database | `apps/api/src/app.module.ts`, `database/database.service.ts`, `apps/api/prisma/schema.prisma` | NestJS, PostgreSQL through Prisma, application startup migrations. |
| Catalog | Schema `Book`, `BookFile`, `AudiobookFile`, `Library` | Book owns ebook/audio files; library has one configured root path. |
| Ingestion | `apps/api/src/library/library-scanner.service.ts`, `book-drop/` | Full scans plus watchers, hashes, missing-file tracking, review/import paths. |
| Jobs | `bulk-metadata/bulk-metadata.service.ts` | Persists a task then launches processing in the server; durable restart semantics need redesign. |
| Metadata | `metadata/`, `books/epub-metadata-writer.service.ts`, `common/extract-file-metadata.ts` | Several providers, field locks, sidecars, EPUB write-back. PDF/FB2/CBR/CB7 extraction falls back to filenames in the inspected extractor. Indexing a format is not complete reader/metadata support. |
| Reading | `reading-progress/`, `koreader-sync/koreader-sync.service.ts` | Separate LITARA/KOREADER records and selectable display preference; not general position conversion. |
| Statistics | `apps/web/src/components/ReadingStatsTab.tsx`, `apps/api/src/users/users.controller.ts` | Existing heatmap/status/rating statistics; do not describe statistics as absent. |
| Clients | `apps/web/package.json`, `apps/mobile/` | React/Mantine web, Expo mobile; latter is no longer the selected mobile starting point. |
| Delivery | `opds/`, `mail/`, `audiobook/` | OPDS, email, audiobook streaming/progress. |

## BookOrbit

Inspected tree: [`3e8cf110271044bdd6f3ed300093780f5f291ff9`](https://github.com/bookorbit/bookorbit/tree/3e8cf110271044bdd6f3ed300093780f5f291ff9).

- [README](https://github.com/bookorbit/bookorbit/blob/3e8cf110271044bdd6f3ed300093780f5f291ff9/README.md): advertised formats, device/service sync, permissions, delivery, and storage restriction. Feature claims were not independently exercised.
- [Development architecture](https://github.com/bookorbit/bookorbit/blob/3e8cf110271044bdd6f3ed300093780f5f291ff9/docs/DEVELOPMENT.md): Vue client, NestJS/Fastify server, PostgreSQL/Drizzle, optional workers.
- [Library schema](https://github.com/bookorbit/bookorbit/blob/3e8cf110271044bdd6f3ed300093780f5f291ff9/server/src/db/schema/libraries.ts): multiple roots, folder/file grouping, format priority, precedence, write/rename configuration.
- [Book/file schema](https://github.com/bookorbit/bookorbit/blob/3e8cf110271044bdd6f3ed300093780f5f291ff9/server/src/db/schema/books.ts): file identity and catalog/storage relationships.
- [Reader schema](https://github.com/bookorbit/bookorbit/blob/3e8cf110271044bdd6f3ed300093780f5f291ff9/server/src/db/schema/reader.ts): separate status, reading attempts, and reading data.
- [Position converter](https://github.com/bookorbit/bookorbit/blob/3e8cf110271044bdd6f3ed300093780f5f291ff9/server/src/modules/position-converter/position-converter.service.ts): explicit CFI/XPointer conversion with exact/repaired/failed outcomes.

The README has differing provider counts across sections; choose providers by requirements rather than relying on a marketing count. Current README excludes NAS/network writable paths; Litara intentionally chooses different requirements in ADR-0007. No BookOrbit source has been copied into the active project.

## Native Android starting point

Inspected tree: [`a55eaa13d8ba27cd143dda882836ed35a4dc923f`](https://github.com/deranjer/bookorbit-android/tree/a55eaa13d8ba27cd143dda882836ed35a4dc923f).

- [README](https://github.com/deranjer/bookorbit-android/blob/a55eaa13d8ba27cd143dda882836ed35a4dc923f/README.md): Kotlin/Compose, Media3, local/offline state, hand-maintained API models and reader assets. Its maintenance notice cites upstream app-attestation restrictions; do not interpret this as every endpoint being blocked.
- [Build configuration](https://github.com/deranjer/bookorbit-android/blob/a55eaa13d8ba27cd143dda882836ed35a4dc923f/app/build.gradle.kts): full flavor includes Google Cast; fdroid flavor omits it. App ID, signing and distribution are separate decisions.
- [Cast test history](https://github.com/deranjer/bookorbit-android/blob/a55eaa13d8ba27cd143dda882836ed35a4dc923f/docs/testing/cast-handoff.md): range forwarding, MIME/queue handoff, MP4 chapter filtering, and physical test history. Historical success is not proof of the new backend's behavior.
- [Auto acceptance checks](https://github.com/deranjer/bookorbit-android/blob/a55eaa13d8ba27cd143dda882836ed35a4dc923f/docs/testing/android-auto.md): media service cold start, browsing/search, offline playback, artwork, account isolation, and head-unit checks.
- [License](https://github.com/deranjer/bookorbit-android/blob/a55eaa13d8ba27cd143dda882836ed35a4dc923f/LICENSE): currently declares AGPL-3.0. The selected MIT direction needs a provenance/rights audit before source import.

No Android source has been imported. Preserve the starting point by this pinned reference. The selected destination is `apps/android/`. ADR-0017 now accepts keeping Android under AGPL, replacing the earlier MIT-import requirement. The [completed audit](../research/android/README.md) is preserved alongside its [ADR reconciliation](../research/android/adr-reconciliation.md).

## Next discussion rounds

1. Sync details: revisions/conflict presentation, rereads, title versus edition status, basic KOReader boundaries. Revision-aware device/file conflicts are accepted.
2. Runtime details: extraction/conversion tools, Go SQL and migration tooling. One modular service with durable PostgreSQL jobs is accepted.
3. Ingestion details: multiple roots, grouping/matching, imports, approval, copy/move, collisions, NAS failure recovery.
4. Reading contract: supported formats, browser reader, shared Android assets, offline requirements, media auth/range behavior.
5. Account details: default access, admin visibility, sessions, revocation, public/API credentials.
6. Android notices and provenance, branding/application identity, and release setup. Repository placement at `apps/android/`, AGPL licensing, and both full/F-Droid distributions are accepted.

The completed Android audit's API, progress, and licensing recommendations must be read with ADR-0017 through ADR-0023. Client timestamps alone do not decide resume conflicts. See the reconciliation for the 13-question disposition.

## Backend, formats, and reader decision round

ADR-0024 selects net/http/Huma, sqlc/pgx, Goose, and River core after current documentation review. Sources: [Huma](https://huma.rocks/tutorial/your-first-api/), [sqlc](https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html), [Goose](https://github.com/pressly/goose), and [River](https://github.com/riverqueue/river). River's open-source dependency remains MPL-2.0; first-party source remains MIT. No backend application was implemented in this round.

ADR-0025 selects broad format targets with explicit capability states; it does not establish completed codec/client support. ADR-0027 selects pristine upstream Foliate and direct PDF.js for web, retaining the Android reader initially. Foliate's own documentation describes its API as unstable and its PDF adapter as experimental; pinning and integration tests are required.

The user's initial no-native-helper preference led to a [Go/WASM prototype](../research/media-inspection/README.md) under historical ADR-0026. After reviewing the options, the user selected bundled native ffprobe/FFmpeg in [ADR-0028](0028-bundle-native-ffmpeg-tools.md), superseding that evaluation-first approach. WASM remains deferred follow-up research. Go-native tag/MP4 and archive libraries were reviewed as building blocks but not selected as the complete media inspection implementation. Automatic transcoding remains undecided.
