import assert from "node:assert/strict";
import test from "node:test";
import { mergedRecruiterFields, type MergeableRecruiter } from "@/services/recruiter-merge";

const empty: MergeableRecruiter = { name: "Blank", email: null, phone: null, linkedinUrl: null, notes: null, vendorId: null };

test("merging fills only the gaps the target left open", () => {
  const merged = mergedRecruiterFields(
    { ...empty, name: "Dana Duplicate", email: "dana@example.invalid", phone: "+1-555-0100", vendorId: "vendor-b" },
    { ...empty, name: "Dana", email: null, phone: null, vendorId: "vendor-a" },
  );
  assert.equal(merged.email, "dana@example.invalid");
  assert.equal(merged.phone, "+1-555-0100");
  assert.equal(merged.vendorId, "vendor-a", "A value the target already holds always wins.");
});

test("merging never silently discards a conflicting contact detail", () => {
  const merged = mergedRecruiterFields(
    { ...empty, name: "Dana Duplicate", email: "old@example.invalid", phone: "+1-555-0100", notes: "Prefers mornings." },
    { ...empty, name: "Dana", email: "new@example.invalid", phone: "+1-555-0199", notes: "Existing note." },
  );
  assert.equal(merged.email, "new@example.invalid");
  assert.match(merged.notes ?? "", /Existing note\./, "The target's own notes survive.");
  assert.match(merged.notes ?? "", /old@example\.invalid/, "A dropped email stays findable, since mail matches by sender.");
  assert.match(merged.notes ?? "", /\+1-555-0100/);
  assert.match(merged.notes ?? "", /Prefers mornings\./);
});

test("merging stays quiet and bounded when there is nothing to carry", () => {
  const identical = mergedRecruiterFields(
    { ...empty, name: "Dana Duplicate", email: "Dana@Example.Invalid" },
    { ...empty, name: "Dana", email: "dana@example.invalid", notes: "Kept." },
  );
  assert.equal(identical.notes, "Kept.", "A case-different duplicate of the same email adds no note.");

  const long = mergedRecruiterFields(
    { ...empty, name: "Dana Duplicate", notes: "x".repeat(1800) },
    { ...empty, name: "Dana", notes: "y".repeat(1800) },
  );
  assert.equal(long.notes?.length, 2000, "Merged notes stay inside the stored column limit.");
});
