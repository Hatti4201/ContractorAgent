import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OutreachMode } from "../app/generated/prisma/enums";
import { decryptOutlookTokenCache, encryptOutlookTokenCache } from "../services/outlook-crypto";
import { createOutlookMessageDraft, inspectOutlookSentMessage } from "../services/outlook-graph";

test("Outlook cache encryption rejects tampering and Graph creates verified drafts without sending", async () => {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptOutlookTokenCache('{"fictional":"cache"}', encryptionKey);
  assert.equal(decryptOutlookTokenCache(encrypted, encryptionKey), '{"fictional":"cache"}');
  assert.throws(() => decryptOutlookTokenCache(`${encrypted.slice(0, -1)}x`, encryptionKey));

  const directory = await mkdtemp(join(tmpdir(), "contractor-agent-outlook-"));
  try {
    const resumePath = join(directory, "fictional-resume.pdf");
    const resumeContent = "%PDF-1.7\nfictional Outlook fixture";
    await writeFile(resumePath, resumeContent);
    const calls: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
    let draftNumber = 0;
    let currentSubject = "";
    let currentRecipient = "";
    let currentAttachmentName = "fictional-resume.pdf";
    let currentAttachmentSize = Buffer.byteLength(resumeContent);
    let mismatchAttachment = false;
    let sent = false;
    let sourceAddress = "recruiter@example.invalid";

    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
      calls.push({ url, method, body, headers });
      if (url === "https://outlook.office.com/upload/fictional") {
        assert.equal(headers.get("authorization"), null);
        return new Response(null, { status: 201 });
      }
      assert.equal(headers.get("authorization"), "Bearer fictional-access-token");
      assert.equal(headers.get("prefer"), 'IdType="ImmutableId"');

      if (method === "POST" && (url.endsWith("/me/messages") || url.endsWith("/createReply"))) {
        draftNumber += 1;
        if (body) {
          currentSubject = String(body.subject);
          currentRecipient = String((((body.toRecipients as Array<{ emailAddress: { address: string } }>)[0]).emailAddress.address));
        }
        return Response.json({ id: `draft-${draftNumber}`, webLink: "https://outlook.office.com/mail/deeplink/compose" }, { status: 201 });
      }
      if (method === "GET" && url.includes("?$select=id,subject,receivedDateTime,from,isDraft")) {
        return Response.json({ id: "source-message-1", subject: "Fictional source", receivedDateTime: "2026-08-22T00:00:00.000Z", from: { emailAddress: { address: sourceAddress } }, isDraft: false });
      }
      if (method === "PATCH") {
        currentSubject = String(body?.subject);
        currentRecipient = String((((body?.toRecipients as Array<{ emailAddress: { address: string } }>)[0]).emailAddress.address));
        return Response.json({ id: `draft-${draftNumber}` }, { status: 200 });
      }
      if (method === "POST" && url.endsWith("/attachments")) {
        currentAttachmentName = String(body?.name);
        currentAttachmentSize = Buffer.from(String(body?.contentBytes), "base64").length;
        return Response.json({ id: "attachment-1" }, { status: 201 });
      }
      if (method === "POST" && url.endsWith("/attachments/createUploadSession")) {
        const item = body?.AttachmentItem as { name: string; size: number };
        currentAttachmentName = item.name;
        currentAttachmentSize = item.size;
        return Response.json({ uploadUrl: "https://outlook.office.com/upload/fictional" }, { status: 201 });
      }
      if (method === "GET" && url.includes("/attachments?")) {
        return Response.json({ value: [{ name: currentAttachmentName, size: mismatchAttachment ? 1 : currentAttachmentSize, isInline: false }] });
      }
      if (method === "GET" && url.includes("?$select=id,isDraft")) {
        return Response.json({
          id: `draft-${draftNumber}`,
          isDraft: !sent,
          sentDateTime: sent ? "2026-08-22T01:00:00.000Z" : null,
          subject: currentSubject,
          toRecipients: [{ emailAddress: { address: currentRecipient } }],
          hasAttachments: true,
          webLink: "https://outlook.office.com/mail/deeplink/compose",
        });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected fictional Graph request: ${method} ${url}`);
    }) as typeof fetch;

    const common = {
      toAddress: "recruiter@example.invalid",
      subject: "Fictional role inquiry",
      body: "Fictional approved body.",
      resumePath,
    };
    await createOutlookMessageDraft({ ...common, mode: OutreachMode.FIRST_OUTREACH, replySourceMessageId: null }, { accessToken: "fictional-access-token", fetcher });
    await createOutlookMessageDraft({ ...common, mode: OutreachMode.DIRECT_EMAIL_REPLY, replySourceMessageId: "source-message-1" }, { accessToken: "fictional-access-token", fetcher });
    assert.ok(calls.some((call) => call.url.endsWith("/source-message-1/createReply")));
    assert.ok(!calls.some((call) => call.url.endsWith("/send")));

    sent = true;
    const result = await inspectOutlookSentMessage("draft-2", common, { accessToken: "fictional-access-token", fetcher });
    assert.equal(result.sent, true);
    assert.equal(result.matchesApprovedRouting, true);

    sent = false;
    const largeResumePath = join(directory, "fictional-large-resume.pdf");
    await writeFile(largeResumePath, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(3 * 1024 * 1024)]));
    await createOutlookMessageDraft({ ...common, resumePath: largeResumePath, mode: OutreachMode.FIRST_OUTREACH, replySourceMessageId: null }, { accessToken: "fictional-access-token", fetcher });
    assert.ok(calls.some((call) => call.method === "PUT" && call.url === "https://outlook.office.com/upload/fictional"));

    sourceAddress = "different@example.invalid";
    await assert.rejects(() => createOutlookMessageDraft({ ...common, mode: OutreachMode.DIRECT_EMAIL_REPLY, replySourceMessageId: "source-message-1" }, { accessToken: "fictional-access-token", fetcher }));

    mismatchAttachment = true;
    await assert.rejects(() => createOutlookMessageDraft({ ...common, mode: OutreachMode.FIRST_OUTREACH, replySourceMessageId: null }, { accessToken: "fictional-access-token", fetcher }));
    assert.ok(calls.some((call) => call.method === "DELETE"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
