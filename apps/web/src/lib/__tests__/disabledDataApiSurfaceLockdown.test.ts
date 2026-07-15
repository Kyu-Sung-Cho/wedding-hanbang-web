import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migrationPath = resolve(
  repoRoot,
  "supabase/migrations/20260713105000_close_disabled_browser_write_surfaces.sql",
);

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("disabled and server-owned Data API surfaces", () => {
  it("makes every disabled cohort relation service-only without deleting history", () => {
    const sql = readMigration();
    const cohortRelations = [
      "cohort_rooms",
      "cohort_members",
      "cohort_messages",
      "cohort_contracts",
      "cohort_timeline_events",
      "cohort_member_reports",
      "cohort_stats",
      "cohort_room_contributor_stats",
    ] as const;

    const cohortLockdown = sql.match(
      /-- Disabled cohort browser lockdown\.([\s\S]*?)-- End disabled cohort browser lockdown\./,
    );
    expect(cohortLockdown?.[1]).toBeTruthy();
    for (const relation of cohortRelations) {
      expect(cohortLockdown?.[1], relation).toContain(`('public', '${relation}')`);
    }
    expect(cohortLockdown?.[1]).toContain(
      "REVOKE ALL (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(cohortLockdown?.[1]).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(cohortLockdown?.[1]).toContain("DROP POLICY %I ON %I.%I");
    expect(cohortLockdown?.[1]).toContain(
      "GRANT SELECT, UPDATE ON TABLE\n  public.cohort_rooms,",
    );
    expect(sql).toContain(
      "('cohort_stats', ARRAY[]::text[], ARRAY[]::text[])",
    );
    expect(sql).toContain(
      "('cohort_room_contributor_stats', ARRAY[]::text[], ARRAY[]::text[])",
    );
    expect(cohortLockdown?.[1]).not.toMatch(
      /GRANT\s+SELECT[^;]*public\.cohort_(?:stats|room_contributor_stats)[^;]*TO\s+service_role/i,
    );
    expect(cohortLockdown?.[1]).toContain(
      "WHERE id = 'cohort-images';",
    );
    expect(cohortLockdown?.[1]).toContain(
      "ALTER PUBLICATION supabase_realtime DROP TABLE public.cohort_messages",
    );
    expect(cohortLockdown?.[1]).toContain(
      "REVOKE ALL ON FUNCTION public.is_cohort_member(uuid) FROM PUBLIC, anon, authenticated;",
    );
    expect(cohortLockdown?.[1]).toContain(
      "GRANT EXECUTE ON FUNCTION public.is_cohort_member(uuid) TO service_role;",
    );

    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("COMMIT;");
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(sql).not.toMatch(/^\s*DROP\s+TABLE\b/im);
  });

  it("keeps shared journeys readable while making every mutation server-owned", () => {
    const sql = readMigration();
    const journeyLockdown = sql.match(
      /-- Shared journey writes are server-owned\.([\s\S]*?)-- End shared journey write lockdown\./,
    );

    expect(journeyLockdown?.[1]).toBeTruthy();
    expect(journeyLockdown?.[1]).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.wedding_journeys FROM PUBLIC, anon, authenticated;",
    );
    expect(journeyLockdown?.[1]).toContain(
      "REVOKE ALL (%s) ON TABLE public.wedding_journeys FROM PUBLIC, anon, authenticated",
    );
    expect(journeyLockdown?.[1]).toContain(
      "policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')",
    );
    expect(journeyLockdown?.[1]).toContain(
      "GRANT SELECT ON TABLE public.wedding_journeys TO authenticated;",
    );
    expect(journeyLockdown?.[1]).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.wedding_journeys FROM PUBLIC, service_role;",
    );
    expect(journeyLockdown?.[1]).toContain(
      "GRANT SELECT, UPDATE ON TABLE public.wedding_journeys TO service_role;",
    );
  });

  it("closes legacy direct chat inserts and dormant persistent attachment writes", () => {
    const sql = readMigration();
    const chatLockdown = sql.match(
      /-- Legacy chat writes are closed\.([\s\S]*?)-- End legacy chat write lockdown\./,
    );

    expect(chatLockdown?.[1]).toBeTruthy();
    expect(chatLockdown?.[1]).toContain(
      "REVOKE INSERT ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated;",
    );
    expect(chatLockdown?.[1]).toContain(
      "REVOKE INSERT (%s) ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated",
    );
    expect(chatLockdown?.[1]).toContain(
      "policy_row.cmd IN ('INSERT', 'ALL')",
    );
    expect(chatLockdown?.[1]).toContain(
      "GRANT SELECT, INSERT, DELETE ON TABLE public.chat_messages TO service_role;",
    );
    expect(chatLockdown?.[1]).toContain(
      "WHERE id = 'chat-image';",
    );
    expect(chatLockdown?.[1]).toContain(
      "COALESCE(policy_row.with_check, '') LIKE '%chat-image%'",
    );
    expect(chatLockdown?.[1]).toContain(
      "DROP POLICY %I ON storage.objects",
    );
  });

  it("keeps community reads public while forcing every mutation and upload through server routes", () => {
    const sql = readMigration();
    const communityLockdown = sql.match(
      /-- Community writes are server-owned\.([\s\S]*?)-- End community browser-write lockdown\./,
    );
    const mutationTables = [
      "community_posts",
      "community_comments",
      "community_profiles",
      "community_votes",
      "community_bookmarks",
      "community_reports",
      "community_polls",
      "community_poll_options",
      "community_poll_votes",
      "community_xp_log",
      "community_streaks",
      "community_achievements",
    ] as const;

    expect(communityLockdown?.[1]).toBeTruthy();
    for (const table of mutationTables) {
      expect(communityLockdown?.[1], table).toContain(`('public', '${table}')`);
    }
    expect(communityLockdown?.[1]).toContain(
      "REVOKE INSERT (%s), UPDATE (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated",
    );
    expect(communityLockdown?.[1]).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM PUBLIC, anon, authenticated",
    );
    expect(communityLockdown?.[1]).toContain(
      "policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')",
    );
    expect(communityLockdown?.[1]).toContain(
      "CREATE POLICY community_bookmarks_select_own",
    );
    expect(communityLockdown?.[1]).toContain(
      "FOR SELECT TO authenticated USING (user_id = auth.uid())",
    );
    expect(communityLockdown?.[1]).toContain(
      "REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint) FROM PUBLIC, anon, authenticated;",
    );
    expect(communityLockdown?.[1]).toContain(
      "REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) FROM PUBLIC, anon, authenticated;",
    );
    expect(communityLockdown?.[1]).toContain(
      "REVOKE ALL ON FUNCTION public.community_record_login(uuid) FROM PUBLIC, anon, authenticated;",
    );
    expect(communityLockdown?.[1]).toContain(
      "policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')",
    );
    expect(communityLockdown?.[1]).toContain(
      "COALESCE(policy_row.qual, '') LIKE '%community-images%'",
    );
    expect(communityLockdown?.[1]).toContain(
      "COALESCE(policy_row.with_check, '') LIKE '%community-videos%'",
    );
    expect(communityLockdown?.[1]).not.toMatch(
      /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.community_/i,
    );
    expect(communityLockdown?.[1]).not.toContain(
      "WHERE id IN ('community-images', 'community-videos')",
    );
    expect(communityLockdown?.[1]).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_posts TO service_role;",
    );
    expect(communityLockdown?.[1]).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.community_profiles TO service_role;",
    );
    expect(communityLockdown?.[1]).toContain(
      "GRANT UPDATE (content, updated_at) ON TABLE public.community_comments TO service_role;",
    );
    expect(communityLockdown?.[1]).toContain(
      "GRANT SELECT, INSERT, DELETE ON TABLE public.community_bookmarks TO service_role;",
    );
    expect(communityLockdown?.[1]).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.community_reports TO service_role;",
    );
    expect(sql).not.toMatch(/GRANT\s+ALL(?:\s+PRIVILEGES)?[\s\S]*?TO\s+service_role/i);
    expect(sql).toContain("'MAINTAIN'");
    expect(sql).toContain("privilege_row.is_grantable");
    expect(sql).toContain("grantor_role.rolname <> 'postgres'");
    expect(sql).toContain("privilege_row.grantee = 0");
    expect(sql).toContain("disabled-surface service_role ACL provenance mismatch");
  });
});
