import "dotenv/config";
import { disconnectDatabase } from "@/lib/prisma";
import { checkDatabase } from "@/services/database-health";

async function main() {
  try {
    const result = await checkDatabase();
    console.log(`Database ${result.mode} check passed at ${result.checkedAt}.`);
  } catch {
    console.error("Database read/write check failed.");
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main();
