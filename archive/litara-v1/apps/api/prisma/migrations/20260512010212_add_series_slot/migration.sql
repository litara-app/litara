-- CreateTable
CREATE TABLE "SeriesSlot" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sequence" DOUBLE PRECISION,
    "authors" TEXT[],
    "coverData" BYTEA,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeriesSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeriesSlot_seriesId_sequence_key" ON "SeriesSlot"("seriesId", "sequence");

-- AddForeignKey
ALTER TABLE "SeriesSlot" ADD CONSTRAINT "SeriesSlot_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
