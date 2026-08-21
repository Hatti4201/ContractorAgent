import "dotenv/config";
import { defineConfig } from "prisma/config";

const cliUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(cliUrl ? { datasource: { url: cliUrl } } : {}),
});
