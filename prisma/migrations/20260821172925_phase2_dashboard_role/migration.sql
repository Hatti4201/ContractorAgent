-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "role_family" "RoleFamily";

-- CreateIndex
CREATE INDEX "opportunities_role_family_idx" ON "opportunities"("role_family");
