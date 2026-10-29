import { NextResponse } from "next/server";
import { AiIncidentDiagnosisStatus } from "@/app/generated/prisma/enums";
import { isMcpRequestAuthorized } from "@/services/mcp-events";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isMcpRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const incidents = await getPrisma().aiIncidentDiagnosis.findMany({
    where: { status: { in: [AiIncidentDiagnosisStatus.PENDING, AiIncidentDiagnosisStatus.RUNNING, AiIncidentDiagnosisStatus.COMPLETED, AiIncidentDiagnosisStatus.FAILED] } },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { eventId: true, status: true, severity: true, summary: true, diagnosis: true, recommendedAction: true, needsUser: true, safeToRecover: true, codexHandoff: true, error: true, attempts: true, updatedAt: true, event: { select: { eventId: true, occurredAt: true, data: true } } },
  });
  return NextResponse.json({ incidents });
}
