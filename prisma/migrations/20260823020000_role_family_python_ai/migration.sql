-- Java with React is covered by JAVA_FULLSTACK, so anything still on the removed value moves there first.
UPDATE "resumes" SET "role_family" = 'JAVA_FULLSTACK' WHERE "role_family" = 'JAVA_REACT';
UPDATE "opportunities" SET "role_family" = 'JAVA_FULLSTACK' WHERE "role_family" = 'JAVA_REACT';

-- PostgreSQL cannot drop an enum value, so the type is rebuilt without JAVA_REACT and with PYTHON_AI.
ALTER TYPE "RoleFamily" RENAME TO "RoleFamily_old";
CREATE TYPE "RoleFamily" AS ENUM ('JAVA_BACKEND', 'JAVA_FULLSTACK', 'JAVA_AI', 'REACT', 'REACT_FULLSTACK', 'PYTHON_AI');
ALTER TABLE "opportunities" ALTER COLUMN "role_family" TYPE "RoleFamily" USING ("role_family"::text::"RoleFamily");
ALTER TABLE "resumes" ALTER COLUMN "role_family" TYPE "RoleFamily" USING ("role_family"::text::"RoleFamily");
DROP TYPE "RoleFamily_old";
