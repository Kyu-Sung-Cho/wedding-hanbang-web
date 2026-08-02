// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803101000_require_customer_survey_consent_evidence.sql",
  ),
  "utf8",
);

const databases: PGlite[] = [];

async function fixture() {
  const db = await PGlite.create();
  databases.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.customer_survey_responses (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      q1_status text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.customer_survey_responses(q1_status) VALUES ('legacy');
  `);
  await db.exec(migration);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("customer survey consent evidence migration", () => {
  it("keeps legacy rows explicitly unverifiable and rejects new rows without current consent", async () => {
    const db = await fixture();

    const legacy = await db.query<{
      survey_consent_version: string | null;
      survey_consented_at: string | null;
    }>(`SELECT survey_consent_version, survey_consented_at
       FROM public.customer_survey_responses WHERE q1_status = 'legacy'`);
    expect(legacy.rows).toEqual([{
      survey_consent_version: null,
      survey_consented_at: null,
    }]);

    await expect(db.exec(`
      INSERT INTO public.customer_survey_responses(q1_status)
      VALUES ('missing-consent')
    `)).rejects.toThrow(/consent evidence is required/iu);

    await expect(db.exec(`
      INSERT INTO public.customer_survey_responses(
        q1_status, survey_consent_version, survey_consented_at
      ) VALUES ('stale', '2026-07-01', statement_timestamp())
    `)).rejects.toThrow(/consent evidence is required/iu);
  });

  it("accepts current evidence and makes it immutable", async () => {
    const db = await fixture();
    await db.exec(`
      INSERT INTO public.customer_survey_responses(
        q1_status, survey_consent_version, survey_consented_at
      ) VALUES ('current', '2026-08-02', statement_timestamp())
    `);

    await db.exec(`
      UPDATE public.customer_survey_responses
      SET q1_status = 'updated'
      WHERE q1_status = 'current'
    `);
    await expect(db.exec(`
      UPDATE public.customer_survey_responses
      SET survey_consented_at = statement_timestamp()
      WHERE q1_status = 'updated'
    `)).rejects.toThrow(/consent evidence is immutable/iu);
  });
});
