import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260710110000_wedding_code_atomic_pairing.sql"
  ),
  "utf8"
);

describe("WeddingCode atomic pairing migration contract", () => {
  it("keeps retry identity unique while allowing legacy null submission ids", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS submission_id UUID/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS wedding_code_responses_submission_id_unique[\s\S]*WHERE submission_id IS NOT NULL/
    );
    expect(migration).toContain("WHERE response.submission_id = p_submission_id");
    expect(migration).toContain("wedding-code-submission:");
  });

  it("locks a submission retry before claiming a couple-token slot", () => {
    const functionStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.insert_wedding_code_response");
    const submissionLock = migration.indexOf("wedding-code-submission:", functionStart);
    const tokenLock = migration.indexOf("hashtextextended(p_couple_token::TEXT", submissionLock);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(submissionLock).toBeGreaterThan(functionStart);
    expect(tokenLock).toBeGreaterThan(submissionLock);
  });

  it("returns the immutable database snapshot on an ambiguous retry", () => {
    expect(migration).toContain("v_canonical_answers JSONB := p_answers");
    expect(migration).toContain("v_canonical_form_version");
    expect(migration).toContain("v_canonical_scoring_version");
    expect(migration).toContain("Return the immutable DB snapshot");
    expect(migration).not.toContain("wedding_code_submission_conflict");
  });

  it("returns an already-established canonical pair token to stale tabs", () => {
    expect(migration).toContain("RETURN QUERY SELECT v_pairing_status, v_existing_token");
    expect(migration).not.toContain("'different_token'::TEXT");
  });

  it("fills only the audited v0.5 family during a migration-first rollout", () => {
    expect(migration).toContain("CREATE TRIGGER wedding_code_set_scoring_version");
    expect(migration).toContain("'v0.5-candidate.4'");
    expect(migration).toContain("NEW.scoring_version := 'v0.5-scoring.1'");
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.insert_wedding_code_response\([\s\S]*TO service_role/);
  });
});
