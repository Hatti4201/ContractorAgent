-- AlterTable
ALTER TABLE "recruiters" ADD COLUMN     "linkedin_url" TEXT,
ADD COLUMN     "notes" TEXT;

-- CreateIndex
CREATE INDEX "recruiters_name_idx" ON "recruiters"("name");
