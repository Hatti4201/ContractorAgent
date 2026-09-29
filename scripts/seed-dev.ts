import "dotenv/config";
import { ActivityType, ApplicationStage } from "@/app/generated/prisma/enums";
import { disconnectDatabase, getPrisma, splitSchema } from "@/lib/prisma";

// Fictional starter data for a coding-agent worktree's schema in the development database.
// It refuses anything that is not a worktree schema, so it can never write into production.

const stages = [ApplicationStage.DISCOVERED, ApplicationStage.OUTREACH_SENT, ApplicationStage.INTERVIEW_SCHEDULED];

async function main() {
  const { schema } = splitSchema(process.env.DATABASE_URL ?? "");
  if (!schema?.startsWith("agent_") || !/:55433\//.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to seed: DATABASE_URL is not a worktree schema in the development database (port 55433, ?schema=agent_...).");
  }
  const database = getPrisma();
  if (await database.opportunity.count()) {
    console.log(`Schema ${schema} already has data; seed skipped.`);
    return;
  }
  const vendor = await database.vendor.create({ data: { name: "Example Staffing (fictional)" } });
  const recruiter = await database.recruiter.create({ data: { name: "Riley Example", email: "riley@example.invalid", vendorId: vendor.id } });
  for (const [index, stage] of stages.entries()) {
    await database.opportunity.create({ data: {
      title: `Fictional Java Developer ${index + 1}`,
      client: "Example Client Co",
      location: "Remote",
      rawJd: "Fictional job description for development. Java, Spring Boot, AWS.",
      recruiterId: recruiter.id,
      vendorId: vendor.id,
      applicationTrack: { create: { currentStage: stage } },
      activities: { create: { type: ActivityType.JD_RECEIVED, description: "Fictional seed record." } },
    } });
  }
  console.log(`Seeded ${schema}: 1 vendor, 1 recruiter, ${stages.length} jobs (all fictional).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seeding failed.");
  process.exitCode = 1;
}).finally(disconnectDatabase);
