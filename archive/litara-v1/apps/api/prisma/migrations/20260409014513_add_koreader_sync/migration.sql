-- AlterTable
ALTER TABLE "BookFile" ADD COLUMN     "koReaderHash" TEXT;

-- AlterTable
ALTER TABLE "ReadingProgress" ADD COLUMN     "koReaderDevice" TEXT,
ADD COLUMN     "koReaderDeviceId" TEXT,
ADD COLUMN     "koReaderProgress" TEXT,
ADD COLUMN     "koReaderTimestamp" INTEGER;

-- AlterTable
ALTER TABLE "ReadingProgress" ALTER COLUMN "location" DROP NOT NULL;

-- CreateTable
CREATE TABLE "KoReaderCredential" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KoReaderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KoReaderCredential_username_key" ON "KoReaderCredential"("username");

-- CreateIndex
CREATE UNIQUE INDEX "KoReaderCredential_userId_key" ON "KoReaderCredential"("userId");

-- AddForeignKey
ALTER TABLE "KoReaderCredential" ADD CONSTRAINT "KoReaderCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
