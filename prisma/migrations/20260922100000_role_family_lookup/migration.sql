-- Role families stop being a Postgres enum and become a table the user maintains from the app.
-- Destructive: the enum type is dropped. Run it with the app stopped, after a pg_dump.
CREATE TABLE "role_families" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_families_pkey" PRIMARY KEY ("code")
);

-- The seven values the enum carried, with the descriptions that used to live in the analyzer prompt.
INSERT INTO "role_families" ("code", "label", "description", "sort_order") VALUES
  ('JAVA_BACKEND',    'Java Backend',    'Java-first backend role with no front-end requirement.', 10),
  ('JAVA_FULLSTACK',  'Java Fullstack',  'Java with any front end, including React.', 20),
  ('JAVA_AI',         'Java AI',         'Java-first role with AI integration; not a substitute for PYTHON_AI.', 30),
  ('REACT',           'React',           'Front-end React role with no backend requirement.', 40),
  ('REACT_FULLSTACK', 'React Fullstack', 'React with a non-Java backend.', 50),
  ('REACT_AI',        'React AI',        'Front-end-first role whose product is AI driven: LLM interfaces, streaming output, AI SDK integration. Building the models or data pipelines is PYTHON_AI, not REACT_AI.', 60),
  ('PYTHON_AI',       'Python AI',       'Python-first AI, ML or LLM role; not a substitute for JAVA_AI.', 70);

-- The stored values are already these exact strings, so the columns only change type.
ALTER TABLE "opportunities" ALTER COLUMN "role_family" TYPE TEXT USING "role_family"::TEXT;
ALTER TABLE "resumes" ALTER COLUMN "role_family" TYPE TEXT USING "role_family"::TEXT;

DROP TYPE "RoleFamily";

-- Restrict keeps a family that is still in use from being deleted; Cascade makes a rename free.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_role_family_fkey"
    FOREIGN KEY ("role_family") REFERENCES "role_families"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_role_family_fkey"
    FOREIGN KEY ("role_family") REFERENCES "role_families"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
