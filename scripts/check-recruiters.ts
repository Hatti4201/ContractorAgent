import "dotenv/config";
import assert from "node:assert/strict";
import { disconnectDatabase, getPrisma } from "@/lib/prisma";
import { resolveContacts } from "@/services/contacts";
import { mergeRecruiterRecords } from "@/services/recruiter-merge";

class RollbackCheck extends Error {}

const ALPHA = "Fictional Vendor Alpha";
const BETA = "Fictional Vendor Beta";

async function main() {
  try {
    await getPrisma().$transaction(async (database) => {
      const first = await resolveContacts(database, {
        vendorName: ALPHA,
        recruiterName: "Dana Fictional",
        recruiterEmail: "dana@example.invalid",
        recruiterPhone: "+1-555-0100",
      });

      const nameOnly = await resolveContacts(database, {
        vendorName: ALPHA,
        recruiterName: "dana fictional",
        recruiterEmail: null,
        recruiterPhone: null,
      });
      assert.equal(nameOnly.recruiterId, first.recruiterId, "A name-only repeat must reuse the same recruiter row.");
      assert.equal(nameOnly.vendorId, first.vendorId, "The same vendor name must reuse the same vendor row.");

      const kept = await database.recruiter.findUniqueOrThrow({ where: { id: first.recruiterId! } });
      assert.equal(kept.email, "dana@example.invalid", "A name-only match must not clear a known email.");
      assert.equal(kept.phone, "+1-555-0100", "A name-only match must not clear a known phone.");

      const otherVendor = await resolveContacts(database, {
        vendorName: BETA,
        recruiterName: "Dana Fictional",
        recruiterEmail: null,
        recruiterPhone: null,
      });
      assert.notEqual(otherVendor.recruiterId, first.recruiterId, "The same name at another vendor must stay a separate recruiter.");

      const byEmail = await resolveContacts(database, {
        vendorName: ALPHA,
        recruiterName: "Dana Renamed",
        recruiterEmail: "DANA@EXAMPLE.INVALID",
        recruiterPhone: null,
      });
      assert.equal(byEmail.recruiterId, first.recruiterId, "A case-different email must still match the existing recruiter.");
      const renamed = await database.recruiter.findUniqueOrThrow({ where: { id: first.recruiterId! } });
      assert.equal(renamed.name, "Dana Renamed", "An email match must apply the newly supplied name.");
      assert.equal(renamed.phone, null, "An email match must still apply a deliberately cleared phone.");

      const total = await database.recruiter.count({ where: { name: { in: ["Dana Renamed", "Dana Fictional"] } } });
      assert.equal(total, 2, "Four resolutions of one contact must leave exactly two recruiter rows.");

      const directoryFields = await database.recruiter.update({
        where: { id: first.recruiterId! },
        data: { linkedinUrl: "https://example.invalid/in/fictional-recruiter", notes: "Fictional directory note." },
      });
      assert.equal(directoryFields.linkedinUrl, "https://example.invalid/in/fictional-recruiter");
      assert.equal(directoryFields.notes, "Fictional directory note.");

      await database.opportunity.create({
        data: {
          title: "Fictional Directory Role",
          recruiterId: first.recruiterId,
          applicationTrack: { create: {} },
        },
      });
      const listed = await database.recruiter.findUniqueOrThrow({
        where: { id: first.recruiterId! },
        include: { vendor: true, opportunities: { include: { applicationTrack: true } } },
      });
      assert.equal(listed.opportunities.length, 1, "The directory must reach the recruiter's linked opportunities.");
      assert.equal(listed.opportunities[0]?.applicationTrack?.currentStage, "DISCOVERED");
      assert.equal(listed.vendor?.name, ALPHA, "The directory must reach the recruiter's vendor.");

      const strayJob = await database.opportunity.create({
        data: { title: "Fictional Stray Role", recruiterId: otherVendor.recruiterId, applicationTrack: { create: {} } },
      });
      const movedCount = await mergeRecruiterRecords(database, otherVendor.recruiterId!, first.recruiterId!);
      assert.equal(movedCount, 1);
      assert.equal(await database.recruiter.count({ where: { id: otherVendor.recruiterId! } }), 0, "The merged record must be gone.");
      const rehomed = await database.opportunity.findUniqueOrThrow({
        where: { id: strayJob.id },
        include: { activities: true },
      });
      assert.equal(rehomed.recruiterId, first.recruiterId, "A merged job must follow the surviving recruiter, not become orphaned.");
      assert.ok(
        rehomed.activities.some((activity) => activity.type === "CORRECTION" && activity.description.includes("merged")),
        "Every moved job must keep an explainable correction record.",
      );
      throw new RollbackCheck();
    });
  } catch (error) {
    if (!(error instanceof RollbackCheck)) throw error;
  }

  console.log("Recruiter directory check passed: deduplication, profile fields, linked jobs, and merge with correction records all hold; sample transaction rolled back.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Recruiter identity check failed.");
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
