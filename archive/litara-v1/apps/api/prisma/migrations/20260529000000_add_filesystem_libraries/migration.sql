-- Migration: add_filesystem_libraries
--
-- 1. Convert existing per-user Libraries into per-owner Shelves
-- 2. Move UserBookLibrary rows into BookShelf using those new shelves
-- 3. Drop UserBookLibrary and WatchedFolder tables
-- 4. Drop Library.userId column / FK
-- 5. Add new Library columns (path, iconKey, metadataFieldOverrides, metadataProvidersDisabled, lastScanAt)
-- 6. Truncate Library (existing rows already converted to shelves; admin recreates filesystem-tied libraries)
-- 7. Add Book.isOrphan and PendingBook.targetLibraryId

-- ── Step 1: create Shelf for each (userId, library) pair ─────────────────────
INSERT INTO "Shelf" (id, "userId", name, "isSmart", logic, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  l."userId",
  l.name,
  false,
  'AND',
  NOW(),
  NOW()
FROM "Library" l
WHERE l."userId" IS NOT NULL;

-- ── Step 2: move UserBookLibrary → BookShelf using the new shelves ────────────
-- Match by (userId, libraryId) to find the newly created shelf, then insert
-- a BookShelf row for each (bookId, shelfId) pair.
INSERT INTO "BookShelf" ("shelfId", "bookId", "addedAt")
SELECT DISTINCT ON (s.id, ubl."bookId")
  s.id,
  ubl."bookId",
  ubl."assignedAt"
FROM "UserBookLibrary" ubl
JOIN "Library" l ON l.id = ubl."libraryId"
JOIN "Shelf" s ON s."userId" = ubl."userId" AND s.name = l.name
  -- pick the most-recently created shelf if names duplicated
  AND s."createdAt" = (
    SELECT MAX(s2."createdAt")
    FROM "Shelf" s2
    WHERE s2."userId" = ubl."userId" AND s2.name = l.name
  )
ON CONFLICT ("shelfId", "bookId") DO NOTHING;

-- ── Step 3: drop UserBookLibrary and WatchedFolder ───────────────────────────
DROP TABLE IF EXISTS "UserBookLibrary";
DROP TABLE IF EXISTS "WatchedFolder";

-- ── Step 4: drop Library.userId ───────────────────────────────────────────────
ALTER TABLE "Library" DROP CONSTRAINT IF EXISTS "Library_userId_fkey";
ALTER TABLE "Library" DROP COLUMN IF EXISTS "userId";
ALTER TABLE "Library" DROP COLUMN IF EXISTS "description";

-- ── Step 5: add new Library columns ──────────────────────────────────────────
ALTER TABLE "Library" ADD COLUMN IF NOT EXISTS "path" TEXT;
ALTER TABLE "Library" ADD COLUMN IF NOT EXISTS "iconKey" TEXT;
ALTER TABLE "Library" ADD COLUMN IF NOT EXISTS "metadataFieldOverrides" JSONB;
ALTER TABLE "Library" ADD COLUMN IF NOT EXISTS "metadataProvidersDisabled" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Library" ADD COLUMN IF NOT EXISTS "lastScanAt" TIMESTAMP(3);

-- ── Step 6: clear Library rows (admin will recreate filesystem-tied libraries) ──
-- Use DELETE (not TRUNCATE … CASCADE): DELETE fires the ON DELETE SET NULL rule
-- on Book.libraryId, so existing books survive as orphans (reclaimed later by
-- evaluateOrphans). TRUNCATE CASCADE ignores SET NULL and would wipe Book and
-- everything FK-chained off it (BookFile, ReadingProgress, Annotation, …).
DELETE FROM "Library";

-- path must be unique and non-null going forward — add constraint after clearing rows
ALTER TABLE "Library" ALTER COLUMN "path" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Library_path_key" ON "Library"("path");

-- ── Step 7a: add Book.isOrphan ────────────────────────────────────────────────
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "isOrphan" BOOLEAN NOT NULL DEFAULT false;

-- ── Step 7b: add PendingBook.targetLibraryId ─────────────────────────────────
ALTER TABLE "PendingBook" ADD COLUMN IF NOT EXISTS "targetLibraryId" TEXT;
ALTER TABLE "PendingBook" ADD CONSTRAINT "PendingBook_targetLibraryId_fkey"
  FOREIGN KEY ("targetLibraryId") REFERENCES "Library"(id) ON DELETE SET NULL;
