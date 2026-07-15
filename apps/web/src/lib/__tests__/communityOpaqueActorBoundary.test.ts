import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8").replace(/\r\n/g, "\n");

const migration = readRepo(
  "supabase/migrations/20260713118000_opaque_community_actor_ids.sql",
);

describe("opaque community actor identity boundary", () => {
  it("replaces public auth UUIDs with immutable random actor IDs", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS public_actor_id uuid DEFAULT extensions.gen_random_uuid()",
    );
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS author_public_id uuid");
    expect(migration).toContain("community_profiles_public_actor_id_key");
    expect(migration).toContain("community_posts_author_public_id_fkey");
    expect(migration).toContain("community_comments_author_public_id_fkey");
    expect(migration).toContain("CREATE TRIGGER sync_community_post_actor_id");
    expect(migration).toContain("CREATE TRIGGER sync_community_comment_actor_id");
    expect(migration).toContain("community_actor_identity_is_immutable");
    expect(migration).toMatch(
      /UPDATE public\.community_profiles AS profile[\s\S]*?FROM auth\.users AS auth_user[\s\S]*?auth_user\.id = profile\.public_actor_id/,
    );
    expect(migration).toMatch(
      /IF TG_OP = 'INSERT' THEN[\s\S]*?LOOP[\s\S]*?NEW\.public_actor_id := extensions\.gen_random_uuid\(\)[\s\S]*?FROM auth\.users AS auth_user[\s\S]*?auth_user\.id = NEW\.public_actor_id[\s\S]*?RETURN NEW/,
    );
    expect(migration).toContain(
      "community public actor ID exposes an auth UUID",
    );
    const dropLegacyMutePolicy = migration.indexOf(
      'DROP POLICY IF EXISTS "cp_select_public" ON public.community_posts',
    );
    const dropLegacyMuteFunction = migration.indexOf(
      "DROP FUNCTION IF EXISTS public.community_author_is_muted(uuid)",
    );
    const createPublicMuteFunction = migration.indexOf(
      "CREATE FUNCTION public.community_author_is_muted(p_author_public_id uuid)",
    );
    expect(dropLegacyMutePolicy).toBeGreaterThanOrEqual(0);
    expect(dropLegacyMuteFunction).toBeGreaterThan(dropLegacyMutePolicy);
    expect(createPublicMuteFunction).toBeGreaterThan(dropLegacyMuteFunction);
  });

  it("revokes raw ownership, rank, and badge columns from browser roles", () => {
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain("still has column mutation ACL");
    expect(migration).toContain("'TRUNCATE'");
    expect(migration).toContain("'TRIGGER'");
    expect(migration).toContain("'MAINTAIN'");
    expect(migration).toContain(
      "has_column_privilege(browser_role, 'public.community_profiles', 'user_id', 'SELECT')",
    );
    expect(migration).toContain(
      "has_column_privilege(browser_role, 'public.community_posts', 'author_id', 'SELECT')",
    );
    expect(migration).toContain(
      "has_column_privilege(browser_role, 'public.community_comments', 'author_id', 'SELECT')",
    );

    const profileGrant = migration.match(
      /GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.community_profiles TO anon, authenticated;/,
    )?.[1] ?? "";
    expect(profileGrant).toContain("public_actor_id");
    expect(profileGrant).not.toMatch(/\buser_id\b|\brank\b|\bbadge\b/);

    const postGrant = migration.match(
      /GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.community_posts TO anon, authenticated;/,
    )?.[1] ?? "";
    const commentGrant = migration.match(
      /GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.community_comments TO anon, authenticated;/,
    )?.[1] ?? "";
    expect(postGrant).toContain("author_public_id");
    expect(commentGrant).toContain("author_public_id");
    expect(postGrant).not.toMatch(/(^|\W)author_id(\W|$)/);
    expect(commentGrant).not.toMatch(/(^|\W)author_id(\W|$)/);
    expect(migration).toMatch(
      /GRANT SELECT\s+ON TABLE public\.community_comments\s+TO service_role/,
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE\s+ON TABLE public\.community_profiles\s+TO service_role/,
    );
    expect(migration).not.toMatch(
      /GRANT[^;]*DELETE[^;]*ON TABLE public\.community_profiles[^;]*TO service_role/,
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON TABLE public\.community_posts\s+TO service_role/,
    );
    expect(migration).toMatch(
      /GRANT UPDATE \(content, updated_at\)\s+ON TABLE public\.community_comments\s+TO service_role/,
    );
    expect(migration).toContain("service_role DML ACL mismatch on %");
    expect(migration).toContain(
      "service_role community comment column ACL is not exact",
    );
    expect(migration).toContain(
      "service_role direct table ACL is not exact on %",
    );
    expect(migration).toContain(
      "community actor direct column ACL is not exact",
    );
    expect(migration).toContain(
      "ARRAY['search_path=\"\"', 'row_security=off']::text[]",
    );
    expect(migration).toContain("community actor function ACL is not exact");
  });

  it("projects only opaque actor aliases into web and mobile DTOs", () => {
    const postSelect = readRepo("apps/web/src/lib/community/postSelect.ts");
    const commentSelect = readRepo("apps/web/src/lib/community/commentSelect.ts");
    const authorProfiles = readRepo("apps/web/src/lib/community/authorProfiles.ts");
    const ownerProfile = readRepo("apps/web/src/lib/community/profileSelect.ts");
    const publicTypes = readRepo("apps/web/src/types/community.types.ts");
    const mobilePayload = readRepo("apps/mobile/src/lib/communityPublicPayload.ts");

    expect(postSelect).toContain("author_id:author_public_id");
    expect(commentSelect).toContain("author_id:author_public_id");
    expect(authorProfiles).toContain("user_id:public_actor_id");
    expect(authorProfiles).toContain('.in("public_actor_id"');
    expect(ownerProfile).toContain("user_id:public_actor_id");
    expect(authorProfiles).not.toMatch(/\.select\([^)]*\brank\b/);
    expect(ownerProfile).not.toMatch(/\brank\b|\bbadge\b/);
    expect(publicTypes.match(/export interface PublicCommunityAuthor[\s\S]*?\n}/)?.[0]).not.toMatch(
      /^\s*(?:auth\w*|rank|badge)\??:/im,
    );
    expect(mobilePayload).toContain("actor.user_id === item.author_id");
    expect(mobilePayload).toContain("normalizeMobileCommunityAvatar");
  });

  it("rotates linkable aliases and removes tracking-capable avatars", () => {
    const nickname = readRepo("apps/web/src/lib/community/nickname.ts");

    expect(nickname).toContain('randomBytes(8).toString("hex")');
    expect(nickname).not.toContain("Math.imul");
    expect(migration).toContain("$rotate_linkable_community_nicknames$");
    expect(migration).toContain("community_profile.nickname) = pg_catalog.btrim(account_profile.name)");
    expect(migration).toContain("'^웨딩친구-[a-z0-9]{12}$'");
    expect(migration).toContain("community_profiles_public_nickname_nonempty");
    expect(migration).toContain("community_profiles_public_avatar_emoji_only");
    expect(migration).toContain("unsafe public community avatar remediation is incomplete");
  });

  it("keeps account profile edits physically separate from community identity", () => {
    const accountRoute = readRepo("apps/web/src/app/api/profile/route.ts");
    const webSettings = readRepo("apps/web/src/app/(app)/settings/page.tsx");
    const webSignup = readRepo("apps/web/src/app/(auth)/login/page.tsx");
    const mobileSettings = readRepo("apps/mobile/app/settings/index.tsx");

    expect(accountRoute).not.toContain('.from("community_profiles")');
    expect(accountRoute).toContain('unexpectedKey === "sync_community_nickname"');
    expect(webSettings).not.toContain("sync_community_nickname");
    expect(mobileSettings).not.toContain("sync_community_nickname");
    expect(webSignup).toContain("이름 또는 서로 부를 이름");
    expect(webSignup).toContain('autoComplete="nickname"');
    expect(mobileSettings).toContain("커뮤니티 별명과는 별개");
    expect(mobileSettings).not.toMatch(/실명을 입력|이름 \(실명\)/);
    expect(mobileSettings).toMatch(
      /if \(communityNicknameChanged\)[\s\S]*?\/api\/community\/profile/,
    );
  });
});
