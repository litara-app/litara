-- Migrate AudiobookBookmark rows into Annotation as BOOKMARK type,
-- then drop the AudiobookBookmark table.
--
-- Location format: 'audiobook:<timeSeconds>' (absolute time across all files).
-- Both web and mobile players seek by absolute time, so fileIndex is not needed here.

BEGIN;

INSERT INTO "Annotation" ("id", "userId", "bookId", "type", "location", "text", "note", "color", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "userId",
  "bookId",
  'BOOKMARK'::"AnnotationType",
  'audiobook:' || "timeSeconds"::text,
  NULL,
  NULLIF("note", ''),
  NULL,
  "createdAt",
  "createdAt"
FROM "AudiobookBookmark";

DROP TABLE "AudiobookBookmark";

COMMIT;
