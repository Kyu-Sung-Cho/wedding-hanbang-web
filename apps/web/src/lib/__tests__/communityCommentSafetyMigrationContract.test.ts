import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260713117000_atomic_community_comment_safety.sql"),
  "utf8",
);

describe("atomic community comment safety migration", () => {
  it("locks one actor-owned comment and makes repeat deletion count-safe", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.community_soft_delete_comment\(\s*p_actor_id uuid,\s*p_comment_id uuid\s*\)/,
    );
    expect(migration).toContain("comment.author_id = p_actor_id");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toMatch(
      /IF COALESCE\(v_is_deleted, false\) THEN[\s\S]*?RETURN QUERY SELECT p_comment_id, v_post_id, v_author_id, false;[\s\S]*?RETURN;/,
    );
    expect(migration).toMatch(
      /UPDATE public\.community_comments AS comment[\s\S]*?comment\.id = p_comment_id[\s\S]*?comment\.author_id = p_actor_id[\s\S]*?NOT COALESCE\(comment\.is_deleted, false\)/,
    );
    const postLock = migration.indexOf(
      "FROM public.community_posts AS post\n  WHERE post.id = v_post_id\n  FOR UPDATE;",
    );
    const commentLock = migration.indexOf(
      "AND comment.post_id = v_post_id\n   FOR UPDATE;",
    );
    expect(postLock).toBeGreaterThanOrEqual(0);
    expect(commentLock).toBeGreaterThan(postLock);
  });

  it("updates post and profile counts inside the same transaction", () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toMatch(
      /UPDATE public\.community_posts AS post[\s\S]*?comment_count = GREATEST\(0, COALESCE\(post\.comment_count, 0\) - 1\)/,
    );
    expect(migration).toMatch(
      /UPDATE public\.community_profiles AS profile[\s\S]*?comment_count = GREATEST\(0, COALESCE\(profile\.comment_count, 0\) - 1\)/,
    );
  });

  it("keeps the definer function service-only with an empty search path and exact ACL assertion", () => {
    expect(migration).toMatch(
      /SECURITY DEFINER\s+SET search_path = ''/,
    );
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(migration).toContain(
      "ALTER FUNCTION public.community_soft_delete_comment(uuid, uuid) OWNER TO postgres;",
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.community_soft_delete_comment\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.community_soft_delete_comment\(uuid, uuid\)\s+TO service_role;/,
    );
    expect(migration).toContain(
      "ARRAY['search_path=\"\"', 'row_security=off']::text[]",
    );
    expect(migration).toContain("privilege_row.grantee = 0");
    expect(migration).toContain("granted_role.rolname NOT IN ('postgres', 'service_role')");
    expect(migration).toContain("granted_role.rolname = 'service_role'");
    expect(migration).toContain("grantor_role.rolname = 'postgres'");
    expect(migration).toContain("NOT privilege_row.is_grantable");
  });
});
