import assert from "node:assert/strict";
import test from "node:test";
import { splitSchema } from "@/lib/prisma";

test("a worktree's schema is lifted out of the URL for the pg adapter; production URLs pass untouched", () => {
  const production = "postgresql://user:p%40ss@127.0.0.1:55432/contractor_agent";
  assert.deepEqual(splitSchema(production), { connectionString: production });
  const worktree = splitSchema("postgresql://dev:secret@127.0.0.1:55433/contractor_agent_dev?schema=agent_alpha&sslmode=disable");
  assert.equal(worktree.schema, "agent_alpha");
  assert.equal(new URL(worktree.connectionString).searchParams.has("schema"), false);
  assert.equal(new URL(worktree.connectionString).searchParams.get("sslmode"), "disable");
});
