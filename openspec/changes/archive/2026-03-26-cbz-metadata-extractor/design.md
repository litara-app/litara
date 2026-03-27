## Context

CBZ (Comic Book ZIP) is a ZIP archive containing images, with an optional `ComicInfo.xml` at the root. This XML schema (originally defined by ComicRack) is the de facto standard across comic managers. Currently the library scanner falls back to filename-only metadata for all CBZ files. The mobi-parser precedent — a purpose-built in-house package with zero external runtime deps — is the pattern to follow.

Relevant files:

- `apps/api/src/common/extract-file-metadata.ts` — routes extraction by extension
- `apps/api/src/library/library-scanner.service.ts` — calls cover extraction
- `packages/mobi-parser/` — reference implementation for a new parser package

## Goals / Non-Goals

**Goals:**

- Extract `ComicInfo.xml` metadata (title, writer, series, publisher, year, language, description, genres/tags) when present
- Extract the cover image (first sorted image in the archive)
- Graceful fallback to filename when no `ComicInfo.xml` exists
- Mirror the `mobi-parser` package structure so the pattern is consistent

**Non-Goals:**

- CBR (RAR) support — RAR requires a native binary or WASM; out of scope
- Full ComicInfo.xml spec compliance (obscure fields like AgeRating, BlackAndWhite, etc.)
- Writing metadata back to the archive

## Decisions

### Decision 1: New `packages/cbz-parser` package vs. inline in `apps/api`

**Chosen:** New package `@litara/cbz-parser`

**Rationale:** Mirrors `@litara/mobi-parser`. Keeps the API codebase clean, isolates the binary format logic, and makes the parser independently testable.

**Alternative considered:** Add directly to `apps/api/src/common/`. Rejected — creates the same tech debt the mobi code escaped from.

---

### Decision 2: ZIP library — `adm-zip` vs. `yauzl` vs. custom

**Chosen:** `adm-zip`

**Rationale:** Simple synchronous-style API that matches the mobi-parser pattern (reads whole file into buffer, processes). `yauzl` is streaming/async which adds complexity for a parser that only needs two entries (the XML and one image). `adm-zip` has no native bindings and works on all platforms.

**Alternative considered:** Parse ZIP format manually (no dep). ZIP's local file header + central directory is straightforward but ~200 lines of boilerplate. Not worth it when `adm-zip` is small and well-maintained.

---

### Decision 3: XML parser — `fast-xml-parser` vs. `xml2js` vs. regex

**Chosen:** `fast-xml-parser`

**Rationale:** Zero native deps, TypeScript-first, fast, produces a plain JS object. `xml2js` is older with a callback API. Regex is fragile for XML (the `extractEpubIds` hack in the codebase acknowledges this with a TODO). `fast-xml-parser` is the right tool.

---

### Decision 4: Cover image — first image vs. explicit `<Pages>` cover tag

**Chosen:** First alphabetically-sorted image entry

**Rationale:** `ComicInfo.xml` can optionally tag a page as `Type="FrontCover"` inside a `<Pages>` element, but many real-world CBZs omit this. First sorted image is the universal fallback and matches how virtually all comic readers find the cover. If a `FrontCover` page index exists, use it; otherwise fall back to the first image.

## Risks / Trade-offs

- **`adm-zip` loads entire archive into memory** → Mitigation: CBZ files are typically 20–200 MB; acceptable for a scanner process. If a 2 GB file appears, memory could spike. We cap by returning early if the archive has no XML and we only need the first image (no need to decompress all pages).
- **`ComicInfo.xml` encoding** → Mitigation: XML standard requires UTF-8 or UTF-16 with BOM; `fast-xml-parser` handles both.
- **Archives with no images** → Return `undefined` cover, log a warning.

## Migration Plan

No migration needed. Existing CBZ books in the DB will keep their filename-derived titles until a user triggers a rescan or the library scanner re-encounters the file on next startup full scan. No data is destroyed.
