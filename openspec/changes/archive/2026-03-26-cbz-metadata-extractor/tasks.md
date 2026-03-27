## 1. Package Scaffold

- [x] 1.1 Create `packages/cbz-parser/` directory with `package.json` (name `@litara/cbz-parser`, mirroring mobi-parser structure)
- [x] 1.2 Add `tsconfig.json` to the package (extend root, emit to `dist/`)
- [x] 1.3 Add `adm-zip` and `fast-xml-parser` as dependencies in `packages/cbz-parser/package.json`
- [x] 1.4 Register `@litara/cbz-parser` as a workspace package in root `package.json` (packages array)
- [x] 1.5 Add `cbz-parser` to `turbo.json` build pipeline if needed

## 2. Core Parser Implementation

- [x] 2.1 Create `packages/cbz-parser/src/index.ts` exporting `extractCbzMetadata` and `extractCbzCover`
- [x] 2.2 Implement `parseComicInfoXml(xmlString)` — use `fast-xml-parser` to parse, map Title/Writer/Publisher/Series/Year/Month/Day/Summary/LanguageISO/Genre/Tags to result object
- [x] 2.3 Implement `extractCbzMetadata(filePath)` — open ZIP with `adm-zip`, find `ComicInfo.xml` (case-insensitive), call `parseComicInfoXml`, fall back to filename if absent
- [x] 2.4 Implement `extractCbzCover(filePath)` — open ZIP, collect image entries (jpg/jpeg/png/gif/webp), sort alphabetically, check for FrontCover page index in ComicInfo.xml, return correct image buffer or `undefined`
- [x] 2.5 Handle Writer field split on `,` and trim whitespace; same for Genre and Tags → subjects

## 3. API Integration

- [x] 3.1 Add `@litara/cbz-parser` to `apps/api/package.json` dependencies
- [x] 3.2 In `extract-file-metadata.ts`, import `extractCbzMetadata` and add a `.cbz` branch (remove CBZ from the filename-fallback comment)
- [x] 3.3 In `library-scanner.service.ts`, find the cover extraction block and add a `.cbz` branch calling `extractCbzCover`

## 4. Tests

- [x] 4.1 Add a small test CBZ fixture to `apps/api/test/fixtures/ebook-library/` (a real CBZ with `ComicInfo.xml` — keep it under 1 MB)
- [x] 4.2 Add scanner e2e test: CBZ book is imported with title from `ComicInfo.xml` (not filename)
- [x] 4.3 Add scanner e2e test: CBZ book has `coverData` populated

## 5. Wrap-up

- [x] 5.1 Run `tsc --noEmit` on both `apps/api` and the new package — fix any type errors
- [x] 5.2 Run existing scanner e2e suite to confirm no regressions
