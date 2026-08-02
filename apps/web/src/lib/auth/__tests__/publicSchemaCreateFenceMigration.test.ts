// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802151000_revoke_untrusted_public_schema_create.sql",
  ),
  "utf8",
);

const databases: PGlite[] = [];

async function createDatabase() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE unrelated_login NOLOGIN;
    GRANT USAGE, CREATE ON SCHEMA public TO PUBLIC, anon, authenticated, service_role;
    CREATE TABLE public.readable_probe (id integer PRIMARY KEY);
    GRANT SELECT ON public.readable_probe TO anon, authenticated, service_role;
  `);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("public schema CREATE fence", () => {
  it("removes direct and inherited CREATE from every application role", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    for (const [role, suffix] of [
      ["anon", "anon"],
      ["authenticated", "authenticated"],
      ["service_role", "service"],
      ["unrelated_login", "public"],
    ] as const) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(
          db.exec(`CREATE TABLE public.forbidden_${suffix} (id integer)`),
        ).rejects.toThrow();
      } finally {
        await db.exec("RESET ROLE");
      }
    }
  });

  it("preserves intended schema usage and table reads", async () => {
    const db = await createDatabase();
    await db.exec(migration);

    for (const role of ["anon", "authenticated", "service_role"] as const) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(db.query("SELECT id FROM public.readable_probe")).resolves.toBeDefined();
      } finally {
        await db.exec("RESET ROLE");
      }
    }
  });

  it("is idempotent and keeps the postcondition in the migration", async () => {
    const db = await createDatabase();
    await db.exec(migration);
    await expect(db.exec(migration)).resolves.toBeDefined();
    expect(migration).toMatch(/aclexplode[\s\S]*privilege_type\s*=\s*'CREATE'/u);
    expect(migration).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/u);
  });
});
