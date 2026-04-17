-- CreateEnum
CREATE TYPE "ProgressSource" AS ENUM ('LITARA', 'KOREADER');

-- AlterTable: add source column with LITARA as default (all existing rows become LITARA)
ALTER TABLE "ReadingProgress" ADD COLUMN "source" "ProgressSource" NOT NULL DEFAULT 'LITARA';

-- Backfill: rows with KOReader data get source = KOREADER
UPDATE "ReadingProgress" SET "source" = 'KOREADER' WHERE "koReaderProgress" IS NOT NULL;

-- DropIndex: remove old unique constraint
DROP INDEX "ReadingProgress_userId_bookId_key";

-- CreateIndex: new unique constraint includes source
CREATE UNIQUE INDEX "ReadingProgress_userId_bookId_source_key" ON "ReadingProgress"("userId", "bookId", "source");

-- AlterTable: add progressDisplaySource to UserSettings
ALTER TABLE "UserSettings" ADD COLUMN "progressDisplaySource" TEXT NOT NULL DEFAULT 'HIGHEST';
