import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import type { DatabaseHealth } from "@/types/health";

export async function checkDatabase(): Promise<DatabaseHealth> {
  const marker = randomUUID();
  const rows = await getPrisma().$transaction(async (database) => {
    await database.$executeRaw`
      CREATE TEMPORARY TABLE phase_zero_check (
        value text NOT NULL
      ) ON COMMIT DROP
    `;
    await database.$executeRaw`
      INSERT INTO phase_zero_check (value) VALUES (${marker})
    `;
    return database.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM phase_zero_check WHERE value = ${marker}
    `;
  });

  if (rows[0]?.value !== marker) throw new Error("Database read/write check failed.");

  return {
    ok: true,
    mode: "read-write",
    checkedAt: new Date().toISOString(),
  };
}
