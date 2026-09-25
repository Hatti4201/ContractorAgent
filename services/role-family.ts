import { getPrisma } from "@/lib/prisma";

export type RoleFamilyOption = { code: string; label: string; description: string };

/**
 * The families a job or resume may be filed under now. Deactivating one hides it from every picker
 * without touching the records that already carry it, which is why nothing here filters old rows.
 */
export async function activeRoleFamilies(database = getPrisma()): Promise<RoleFamilyOption[]> {
  return database.roleFamily.findMany({
    where: { active: true },
    select: { code: true, label: true, description: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
}

/** Every family, active or not, for the screen that maintains them. */
export async function allRoleFamilies(database = getPrisma()) {
  return database.roleFamily.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
}

const codePattern = /^[A-Z][A-Z0-9_]{1,39}$/;

/** "Python + React" becomes PYTHON_REACT, so the user only has to name the family. */
export function codeFromLabel(label: string) {
  return label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^[^A-Z]+|_+$/g, "").slice(0, 40);
}

/**
 * A code is written onto every job and resume that uses it and is the foreign key itself, so it is
 * checked before it can become one. Renaming is left to the database, which cascades it.
 */
export function readRoleFamilyCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
  if (!codePattern.test(code)) {
    throw new Error("Code must be 2 to 40 characters of A-Z, 0-9 and underscore, and start with a letter.");
  }
  return code;
}
