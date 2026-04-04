-- Detach books from system libraries (userId IS NULL) so they become unassigned.
-- This cleans up the auto-created "Default Library" left by older scanner versions.
UPDATE "Book" SET "libraryId" = NULL
WHERE "libraryId" IN (SELECT id FROM "Library" WHERE "userId" IS NULL);

-- Remove any system libraries now that no books reference them.
DELETE FROM "Library" WHERE "userId" IS NULL;

-- Add ON DELETE SET NULL so future library deletions automatically unassign books.
ALTER TABLE "Book" DROP CONSTRAINT IF EXISTS "Book_libraryId_fkey";
ALTER TABLE "Book" ADD CONSTRAINT "Book_libraryId_fkey"
  FOREIGN KEY ("libraryId") REFERENCES "Library"(id) ON DELETE SET NULL ON UPDATE CASCADE;
