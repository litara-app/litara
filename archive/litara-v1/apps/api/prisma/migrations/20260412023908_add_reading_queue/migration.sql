-- CreateTable
CREATE TABLE "ReadingQueueItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadingQueueItem_userId_position_idx" ON "ReadingQueueItem"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingQueueItem_userId_bookId_key" ON "ReadingQueueItem"("userId", "bookId");

-- AddForeignKey
ALTER TABLE "ReadingQueueItem" ADD CONSTRAINT "ReadingQueueItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingQueueItem" ADD CONSTRAINT "ReadingQueueItem_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
