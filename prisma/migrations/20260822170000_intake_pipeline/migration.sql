-- AlterTable
ALTER TABLE "job_intakes" ALTER COLUMN "analysis" DROP NOT NULL,
ADD COLUMN     "preview" JSONB;
