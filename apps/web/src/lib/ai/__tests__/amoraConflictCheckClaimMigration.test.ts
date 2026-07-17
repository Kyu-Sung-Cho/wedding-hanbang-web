// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716103000_amora_conflict_check_claim.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const DIGEST = "a".repeat(64);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claim.role', true)
    $$;
    CREATE TABLE public.couples (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id)
    );
    INSERT INTO public.couples (id) VALUES ('${COUPLE_ID}');
    INSERT INTO public.profiles (id, couple_id) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}'),
      ('${GROOM_ID}', '${COUPLE_ID}'),
      ('${OUTSIDER_ID}', NULL);
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  `);
  await db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  await db.exec("SET ROLE service_role");
  await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
  return db;
}

describe("Amora conflict-check claim migration", () => {
  it("claims a message digest once across both partners and replays the durable no-conflict result", async () => {
    const db = await createDatabase();
    try {
      const first = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, BRIDE_ID],
      );
      expect(first.rows[0]?.value).toMatchObject({ action: "acquired", attempt_count: 1 });

      const concurrent = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, GROOM_ID],
      );
      expect(concurrent.rows[0]?.value).toMatchObject({ action: "in_progress" });

      const result = {
        triggered: false,
        score: 4,
        reason: "low_score",
        llmVerified: false,
      };
      const claimToken = String(first.rows[0]?.value.claim_token);
      const completed = await db.query<{ value: boolean }>(
        "SELECT public.complete_amora_conflict_check($1, $2, $3, $4::jsonb) AS value",
        [COUPLE_ID, DIGEST, claimToken, JSON.stringify(result)],
      );
      expect(completed.rows[0]?.value).toBe(true);

      const replay = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, GROOM_ID],
      );
      expect(replay.rows[0]?.value).toEqual({
        action: "completed",
        attempt_count: 1,
        result,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("reclaims only an expired or failed check and rejects a non-member", async () => {
    const db = await createDatabase();
    try {
      const first = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, BRIDE_ID],
      );
      const staleToken = String(first.rows[0]?.value.claim_token);
      const checkpoint = {
        stage: "detection_complete",
        triggered: true,
        score: 7,
        reason: "verified conflict",
        conflictContext: "message one / message two",
        llmVerified: true,
      };
      const checkpointed = await db.query<{ value: boolean }>(
        "SELECT public.checkpoint_amora_conflict_check($1, $2, $3, $4::jsonb) AS value",
        [COUPLE_ID, DIGEST, staleToken, JSON.stringify(checkpoint)],
      );
      expect(checkpointed.rows[0]?.value).toBe(true);
      await db.query(`
        UPDATE public.amora_conflict_check_claims
        SET claimed_at = now() - interval '7 minutes'
        WHERE couple_id = $1 AND message_digest = $2
      `, [COUPLE_ID, DIGEST]);
      const reclaimed = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, GROOM_ID],
      );
      expect(reclaimed.rows[0]?.value).toMatchObject({
        action: "acquired",
        attempt_count: 2,
        checkpoint,
        reclaimed: true,
      });
      const currentToken = String(reclaimed.rows[0]?.value.claim_token);

      const staleCheckpoint = await db.query<{ value: boolean }>(
        "SELECT public.checkpoint_amora_conflict_check($1, $2, $3, $4::jsonb) AS value",
        [COUPLE_ID, DIGEST, staleToken, JSON.stringify(checkpoint)],
      );
      expect(staleCheckpoint.rows[0]?.value).toBe(false);

      const staleCompletion = await db.query<{ value: boolean }>(
        "SELECT public.complete_amora_conflict_check($1, $2, $3, $4::jsonb) AS value",
        [COUPLE_ID, DIGEST, staleToken, JSON.stringify({ triggered: true })],
      );
      expect(staleCompletion.rows[0]?.value).toBe(false);

      const failed = await db.query<{ value: boolean }>(
        "SELECT public.fail_amora_conflict_check($1, $2, $3, $4) AS value",
        [COUPLE_ID, DIGEST, currentToken, "PROVIDER_FAILED"],
      );
      expect(failed.rows[0]?.value).toBe(true);
      const afterFailure = await db.query<{ value: Record<string, unknown> }>(
        "SELECT public.claim_amora_conflict_check($1, $2, $3) AS value",
        [COUPLE_ID, DIGEST, BRIDE_ID],
      );
      expect(afterFailure.rows[0]?.value).toMatchObject({
        action: "acquired",
        attempt_count: 3,
        checkpoint,
        reclaimed: true,
      });

      await expect(db.query(
        "SELECT public.claim_amora_conflict_check($1, $2, $3)",
        [COUPLE_ID, "b".repeat(64), OUTSIDER_ID],
      )).rejects.toThrow(/AMORA_CONFLICT_CHECK_SCOPE_DENIED/);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("does not grant the claim functions to browser roles", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        authenticated_claim: boolean;
        service_claim: boolean;
        authenticated_complete: boolean;
        authenticated_checkpoint: boolean;
      }>(`
        SELECT
          has_function_privilege('authenticated', 'public.claim_amora_conflict_check(uuid,text,uuid)', 'EXECUTE') AS authenticated_claim,
          has_function_privilege('service_role', 'public.claim_amora_conflict_check(uuid,text,uuid)', 'EXECUTE') AS service_claim,
          has_function_privilege('authenticated', 'public.complete_amora_conflict_check(uuid,text,uuid,jsonb)', 'EXECUTE') AS authenticated_complete,
          has_function_privilege('authenticated', 'public.checkpoint_amora_conflict_check(uuid,text,uuid,jsonb)', 'EXECUTE') AS authenticated_checkpoint
      `);
      expect(privileges.rows[0]).toEqual({
        authenticated_claim: false,
        service_claim: true,
        authenticated_complete: false,
        authenticated_checkpoint: false,
      });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });
});
