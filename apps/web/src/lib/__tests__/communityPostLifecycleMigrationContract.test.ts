import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260713119000_atomic_community_post_lifecycle.sql"),
  "utf8",
);
const createRoute = readFileSync(
  resolve(root, "apps/web/src/app/api/community/posts/route.ts"),
  "utf8",
);
const detailRoute = readFileSync(
  resolve(root, "apps/web/src/app/api/community/posts/[id]/route.ts"),
  "utf8",
);

describe("atomic community post lifecycle", () => {
  it("counts every post insert/delete in the same database transaction", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.maintain_community_profile_post_count\(\)[\s\S]*?RETURNS trigger[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/,
    );
    expect(migration).toMatch(
      /IF TG_OP = 'INSERT' THEN[\s\S]*?post_count = COALESCE\(profile\.post_count, 0\) \+ 1[\s\S]*?updated_rows <> 1[\s\S]*?ERRCODE = '23503'/,
    );
    expect(migration).toMatch(
      /IF TG_OP = 'DELETE' THEN[\s\S]*?post_count = GREATEST\(0, COALESCE\(profile\.post_count, 0\) - 1\)/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER maintain_community_profile_post_count\s+AFTER INSERT OR DELETE ON public\.community_posts\s+FOR EACH ROW/,
    );
    expect(migration).toContain("trigger_row.tgtype = 13");
  });

  it("reconciles historical counts and retires both manual counter RPCs", () => {
    expect(migration).toMatch(
      /UPDATE public\.community_profiles AS profile[\s\S]*?SELECT pg_catalog\.count\(\*\)::integer[\s\S]*?post\.author_id = profile\.user_id/,
    );
    expect(migration).toMatch(
      /ALTER COLUMN post_count SET DEFAULT 0,\s*ALTER COLUMN post_count SET NOT NULL/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.community_increment_profile_count\(uuid, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.community_decrement_profile_count\(uuid, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toContain("LEGACY_COMMUNITY_PROFILE_COUNTER_STILL_CALLABLE");
  });

  it("counts every physical active-comment delete, including post cascades", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.maintain_community_counts_after_comment_delete\(\)[\s\S]*?RETURNS trigger[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/,
    );
    expect(migration).toMatch(
      /FROM deleted_community_comments AS deleted_comment[\s\S]*?NOT COALESCE\(deleted_comment\.is_deleted, false\)[\s\S]*?UPDATE public\.community_posts AS post[\s\S]*?comment_count = GREATEST/,
    );
    expect(migration).toMatch(
      /FROM deleted_community_comments AS deleted_comment[\s\S]*?GROUP BY deleted_comment\.author_id[\s\S]*?ORDER BY deleted_comment\.author_id[\s\S]*?UPDATE public\.community_profiles AS profile[\s\S]*?comment_count = GREATEST/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER maintain_community_counts_after_comment_delete\s+AFTER DELETE ON public\.community_comments\s+REFERENCING OLD TABLE AS deleted_community_comments\s+FOR EACH STATEMENT/,
    );
    expect(migration).toContain("trigger_row.tgtype = 8");
    expect(migration).toContain(
      "trigger_row.tgoldtable = 'deleted_community_comments'",
    );
    expect(migration).toContain(
      "COMMUNITY_COMMENT_DELETE_TRIGGER_FUNCTION_CONTRACT_MISMATCH",
    );
    expect(migration).toContain(
      "COMMUNITY_PROFILE_COMMENT_COUNT_RECONCILIATION_FAILED",
    );
    expect(migration).toContain(
      "COMMUNITY_POST_COMMENT_COUNT_RECONCILIATION_FAILED",
    );
  });

  it("row-locks hard deletion and permits only the author or a current explicit admin", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.community_hard_delete_post\(\s*p_actor_id uuid,\s*p_post_id uuid\s*\)/,
    );
    expect(migration).toMatch(
      /SELECT post\.author_id[\s\S]*?post\.id = p_post_id[\s\S]*?FOR UPDATE/,
    );
    expect(migration).toMatch(
      /IF NOT FOUND THEN[\s\S]*?RETURN QUERY SELECT p_post_id, NULL::uuid, false/,
    );
    expect(migration).toMatch(
      /target_author_id IS DISTINCT FROM p_actor_id[\s\S]*?profile\.is_admin[\s\S]*?IF NOT COALESCE\(actor_is_admin, false\)[\s\S]*?ERRCODE = '42501'/,
    );
    expect(migration).toMatch(
      /DELETE FROM public\.community_posts AS post[\s\S]*?post\.author_id = target_author_id[\s\S]*?target_author_id = p_actor_id[\s\S]*?actor_is_admin/,
    );
  });

  it("keeps trigger execution internal and deletion RPC service-only with exact ACL checks", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.maintain_community_profile_post_count\(\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.community_hard_delete_post\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;\s*GRANT EXECUTE[\s\S]*?TO service_role/,
    );
    expect(migration).toContain(
      "ARRAY['search_path=\"\"', 'row_security=off']::text[]",
    );
    expect(migration).toContain("COMMUNITY_POST_LIFECYCLE_FUNCTION_ACL_NOT_EXACT");
    expect(migration).toContain("COMMUNITY_POST_DELETE_SERVICE_EXECUTE_GRANT_MISSING");
  });

  it("contains no route-level manual counter mutation that could double count the trigger", () => {
    expect(createRoute).not.toContain('rpc("community_increment_profile_count"');
    expect(detailRoute).not.toContain('rpc("community_decrement_profile_count"');
    expect(detailRoute).toContain('rpc("community_hard_delete_post"');
  });
});
