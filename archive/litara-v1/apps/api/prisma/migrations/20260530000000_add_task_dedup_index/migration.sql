-- Add an optional library scope to Task so per-library tasks can be deduplicated
-- independently of one another while global tasks share a single slot.
ALTER TABLE "Task" ADD COLUMN "libraryId" TEXT;

-- Prevents multiple PENDING or PROCESSING tasks of the same (type, libraryId)
-- from existing simultaneously. This enables distributed deduplication across
-- multiple app instances (e.g. k8s replicas): a global scan (libraryId IS NULL)
-- runs once at a time, while different libraries can scan concurrently.
-- NULLS NOT DISTINCT (Postgres 15+) makes two global tasks collide on NULL.
CREATE UNIQUE INDEX "Task_type_libraryId_active_unique" ON "Task" ("type", "libraryId")
NULLS NOT DISTINCT
WHERE status IN ('PENDING', 'PROCESSING');
