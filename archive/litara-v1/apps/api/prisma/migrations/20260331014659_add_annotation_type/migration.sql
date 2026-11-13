-- CreateEnum
CREATE TYPE "AnnotationType" AS ENUM ('HIGHLIGHT', 'UNDERLINE', 'STRIKETHROUGH', 'BOOKMARK');

-- AlterTable
ALTER TABLE "Annotation" ADD COLUMN     "type" "AnnotationType" NOT NULL DEFAULT 'HIGHLIGHT';
