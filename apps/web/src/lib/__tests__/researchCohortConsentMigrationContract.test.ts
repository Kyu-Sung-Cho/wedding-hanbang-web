import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260713120000_research_cohort_consent_version.sql",
  ),
  "utf8",
);

describe("research cohort consent-version migration", () => {
  it("bounds lock and validation waits inside one transaction", () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/);
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
    expect(migration).toContain("SET LOCAL statement_timeout = '120s';");
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
  });

  it("allows exactly the two reviewed consent versions and validates the constraint", () => {
    expect(migration).toContain(
      "CHECK (privacy_policy_version IN ('2026-07-12', '2026-07-14'))",
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT research_cohort_applications_privacy_policy_check[\s\S]*?NOT VALID;[\s\S]*?VALIDATE CONSTRAINT research_cohort_applications_privacy_policy_check/,
    );
    expect(migration).toContain(
      "'CHECK (privacy_policy_version = ANY (ARRAY[''2026-07-12''::text, ''2026-07-14''::text]))'",
    );
    expect(migration).toContain("IS DISTINCT FROM");
  });
});
