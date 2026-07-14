import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260714101000_idempotent_court_public_comments.sql",
  ),
  "utf8",
);

function between(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe("idempotent public Court comment migration", () => {
  it("uses a fail-fast expand/backfill/validate/contract sequence", () => {
    expect(migration).toContain("SET lock_timeout = '5s';");
    expect(migration).toContain("SET statement_timeout = '90s';");
    expect(migration).not.toMatch(/\b(?:BEGIN|COMMIT)\s*;/iu);
    expect(migration).toContain(
      "ADD COLUMN submission_request_id uuid DEFAULT pg_catalog.gen_random_uuid();",
    );
    expect(migration).toContain(
      "CHECK (submission_request_id IS NOT NULL) NOT VALID",
    );
    expect(migration).toContain(
      "VALIDATE CONSTRAINT court_comments_submission_request_id_present;",
    );
    expect(migration).toContain("ALTER COLUMN submission_request_id SET NOT NULL;");
    expect(migration).toContain(
      "UNIQUE (user_id, submission_request_id)",
    );
    expect(migration).toContain("ALTER COLUMN submission_request_id DROP DEFAULT;");
  });

  it("serializes each user, returns exact replays, and rejects request-key payload changes", () => {
    const create = between(
      "CREATE OR REPLACE FUNCTION public.create_court_public_comment(\n  p_public_post_id uuid,\n  p_user_id uuid,\n  p_submission_request_id uuid,",
      "CREATE OR REPLACE FUNCTION public.create_court_public_comment(\n  p_public_post_id uuid,\n  p_user_id uuid,\n  p_comment_type text,",
    );

    expect(create).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(create).toContain("p_submission_request_id IS NULL");
    expect(create).toContain(
      "char_length(v_body) NOT BETWEEN 2 AND 500",
    );
    expect(create).toContain(
      "p_comment_type NOT IN ('empathy', 'experience', 'practical_advice', 'question')",
    );
    expect(create).toContain("profile.account_deleting_at IS NULL");
    expect(create).toContain("profile.id = p_user_id");
    expect(create).toContain("FOR UPDATE;");
    expect(create).toContain("comment.user_id = p_user_id");
    expect(create).toContain(
      "comment.submission_request_id = p_submission_request_id",
    );
    expect(create).toContain(
      "v_comment.public_post_id IS DISTINCT FROM p_public_post_id",
    );
    expect(create).toContain(
      "v_comment.comment_type IS DISTINCT FROM p_comment_type",
    );
    expect(create).toContain("v_comment.body IS DISTINCT FROM v_body");
    expect(create).toContain("court_comment_submission_request_mismatch");
    expect(create).toContain("'reused', true");
    expect(create).toContain("'reused', false");

    const profileLock = create.indexOf("profile.id = p_user_id");
    const replayLookup = create.indexOf("comment.submission_request_id = p_submission_request_id");
    const postLock = create.indexOf("post.id = p_public_post_id");
    const insert = create.indexOf("INSERT INTO public.court_comments");
    expect(profileLock).toBeLessThan(replayLookup);
    expect(replayLookup).toBeLessThan(postLock);
    expect(postLock).toBeLessThan(insert);
    expect(create.match(/INSERT INTO public\.court_case_events/gu)).toHaveLength(1);
  });

  it("keeps the four-argument RPC as a compatibility wrapper while locking both overloads", () => {
    const wrapper = between(
      "CREATE OR REPLACE FUNCTION public.create_court_public_comment(\n  p_public_post_id uuid,\n  p_user_id uuid,\n  p_comment_type text,",
      "ALTER FUNCTION public.create_court_public_comment(uuid, uuid, uuid, text, text)",
    );
    expect(wrapper).toContain("pg_catalog.gen_random_uuid()");
    expect(wrapper).toContain("public.create_court_public_comment(");

    for (const signature of [
      "public.create_court_public_comment(uuid, uuid, uuid, text, text)",
      "public.create_court_public_comment(uuid, uuid, text, text)",
    ]) {
      expect(migration).toContain(`ALTER FUNCTION ${signature}\n  OWNER TO postgres;`);
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`,
      );
    }
  });

  it("provides a service-only read-only replay path for rate-limit bypass", () => {
    const replay = between(
      "CREATE FUNCTION public.replay_court_public_comment(",
      "CREATE OR REPLACE FUNCTION public.create_court_public_comment(\n  p_public_post_id uuid,\n  p_user_id uuid,\n  p_comment_type text,",
    );
    expect(replay).toContain("profile.account_deleting_at IS NULL");
    expect(replay).toContain("comment.submission_request_id = p_submission_request_id");
    expect(replay).toContain("'found', false");
    expect(replay).toContain("court_comment_submission_request_mismatch");
    expect(replay).not.toContain("INSERT INTO public.court_comments");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.replay_court_public_comment(uuid, uuid, uuid, text, text)\n  FROM PUBLIC, anon, authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.replay_court_public_comment(uuid, uuid, uuid, text, text)\n  TO service_role;",
    );
  });

  it("does not entangle comment idempotency with provider deletion handoff state", () => {
    expect(migration).not.toContain("court_provider_deletion_handoffs");
    expect(migration).not.toContain("court_provider_reservations");
    expect(migration).not.toContain("court_provider_audit_logs");
  });

  it("keeps the request identity out of authenticated owner projections on upgrades", () => {
    expect(migration).toContain(
      "REVOKE SELECT ON TABLE public.court_comments\n  FROM PUBLIC, anon, authenticated;",
    );
    const grant = between(
      "GRANT SELECT (\n  id, public_post_id, comment_type, body, moderation_status, created_at, updated_at\n) ON TABLE public.court_comments TO authenticated;",
      "CREATE OR REPLACE FUNCTION public.create_court_public_comment(",
    );
    expect(grant).not.toContain("submission_request_id");
  });
});
