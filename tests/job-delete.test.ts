import assert from "node:assert/strict";
import test from "node:test";
import { AutoSendState, OutlookDraftState } from "../app/generated/prisma/enums";
import { draftToRemove, sameDeletedJob } from "../services/job-delete-rules";

const draft = { outlookMessageId: "msg-1", outlookState: OutlookDraftState.CREATED, autoSendState: null, sentConfirmedAt: null };

test("only a draft still unsent in Outlook is removed with its job", () => {
  assert.equal(draftToRemove(draft), true);
  assert.equal(draftToRemove({ ...draft, autoSendState: AutoSendState.CANCELLED }), true, "A cancelled send is still a draft.");
  assert.equal(draftToRemove({ ...draft, outlookMessageId: null }), false, "Nothing in Outlook to remove.");
  assert.equal(draftToRemove({ ...draft, outlookState: OutlookDraftState.SENT }), false);
  assert.equal(draftToRemove({ ...draft, autoSendState: AutoSendState.SENT }), false);
  assert.equal(draftToRemove({ ...draft, sentConfirmedAt: new Date() }), false, "Sent by hand stays in Sent Items.");
});

test("a deleted job comes back only from another recruiter", () => {
  const text = "Java Lead in Alpharetta. Send resumes to sam@vendor.test";
  assert.equal(sameDeletedJob("sam@vendor.test", text, null), true, "Named in the text.");
  assert.equal(sameDeletedJob("sam@vendor.test", "Java Lead", "sam@vendor.test"), true, "Found by the analysis.");
  assert.equal(sameDeletedJob("amy@vendor.test", text, "sam@vendor.test"), false, "Another recruiter is another chance.");
  assert.equal(sameDeletedJob(null, text, "sam@vendor.test"), true, "No recruiter on record: the JD alone decides.");
});
