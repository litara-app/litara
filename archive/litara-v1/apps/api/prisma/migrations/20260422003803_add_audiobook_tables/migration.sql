-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "hasAudiobook" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AudiobookFile" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSize" BIGINT,
    "fileIndex" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "mimeType" TEXT NOT NULL,
    "narrator" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudiobookFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudiobookChapter" (
    "id" TEXT NOT NULL,
    "audiobookFileId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION,

    CONSTRAINT "AudiobookChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudiobookProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "currentFileIndex" INTEGER NOT NULL DEFAULT 0,
    "currentTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDuration" DOUBLE PRECISION NOT NULL,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudiobookProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudiobookBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "timeSeconds" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudiobookBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AudiobookFile_filePath_key" ON "AudiobookFile"("filePath");

-- CreateIndex
CREATE UNIQUE INDEX "AudiobookProgress_userId_bookId_key" ON "AudiobookProgress"("userId", "bookId");

-- AddForeignKey
ALTER TABLE "AudiobookFile" ADD CONSTRAINT "AudiobookFile_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiobookChapter" ADD CONSTRAINT "AudiobookChapter_audiobookFileId_fkey" FOREIGN KEY ("audiobookFileId") REFERENCES "AudiobookFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiobookProgress" ADD CONSTRAINT "AudiobookProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiobookProgress" ADD CONSTRAINT "AudiobookProgress_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiobookBookmark" ADD CONSTRAINT "AudiobookBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudiobookBookmark" ADD CONSTRAINT "AudiobookBookmark_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
