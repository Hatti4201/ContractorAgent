import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let prisma = globalForPrisma.prisma;

/**
 * Coding-agent worktrees share one development database, each in its own schema, named with the
 * `?schema=` parameter the Prisma CLI reads. The pg adapter ignores that parameter, so it is taken
 * out of the URL and handed to the adapter; a URL without it (production) is passed through as is.
 */
export function splitSchema(connectionString: string): { connectionString: string; schema?: string } {
  if (!/[?&]schema=/.test(connectionString)) return { connectionString };
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema") || undefined;
  url.searchParams.delete("schema");
  return { connectionString: url.toString(), schema };
}

export function getPrisma() {
  if (prisma) return prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  const target = splitSchema(connectionString);
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: target.connectionString }, target.schema ? { schema: target.schema } : undefined),
  });

  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
  return prisma;
}

export async function disconnectDatabase() {
  await prisma?.$disconnect();
  prisma = undefined;
  globalForPrisma.prisma = undefined;
}
