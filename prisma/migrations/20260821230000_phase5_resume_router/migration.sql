-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'RESUME_SELECTED';

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN "selected_resume_id" TEXT;

-- One enabled file per role family keeps routing deterministic.
CREATE UNIQUE INDEX "resumes_one_active_per_role_family" ON "resumes"("role_family") WHERE "active" = true;

-- CreateIndex
CREATE INDEX "opportunities_selected_resume_id_idx" ON "opportunities"("selected_resume_id");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_selected_resume_id_fkey" FOREIGN KEY ("selected_resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
