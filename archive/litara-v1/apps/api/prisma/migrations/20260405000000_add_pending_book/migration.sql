-- CreateEnum
CREATE TYPE "PendingBookStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COLLISION');

-- CreateTable
CREATE TABLE "PendingBook" (
    "id" TEXT NOT NULL,
    "status" "PendingBookStatus" NOT NULL DEFAULT 'PENDING',
    "stagedFilePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "authors" TEXT NOT NULL DEFAULT '[]',
    "seriesName" TEXT,
    "seriesPosition" DOUBLE PRECISION,
    "seriesTotalBooks" INTEGER,
    "publisher" TEXT,
    "publishedDate" TIMESTAMP(3),
    "language" TEXT,
    "description" TEXT,
    "isbn10" TEXT,
    "isbn13" TEXT,
    "pageCount" INTEGER,
    "genres" TEXT NOT NULL DEFAULT '[]',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "moods" TEXT NOT NULL DEFAULT '[]',
    "googleBooksId" TEXT,
    "openLibraryId" TEXT,
    "goodreadsId" TEXT,
    "asin" TEXT,
    "goodreadsRating" DOUBLE PRECISION,
    "coverUrl" TEXT,
    "targetPath" TEXT,
    "collidingPath" TEXT,
    "overwriteApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingBook_pkey" PRIMARY KEY ("id")
);

-- Rename Book.amazonId to Book.asin for naming consistency
ALTER TABLE "Book" RENAME COLUMN "amazonId" TO "asin";
