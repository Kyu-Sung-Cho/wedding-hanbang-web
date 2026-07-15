import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();
const repoRoot = resolve(webRoot, "../..");
const readWeb = (path: string) => readFileSync(resolve(webRoot, path), "utf8");
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("community author mute boundary", () => {
  it("stores mutes as an owner-only service boundary", () => {
    const migration = readRepo(
      "supabase/migrations/20260713116000_add_community_user_mutes.sql",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.community_user_mutes");
    expect(migration).toContain("CHECK (muter_id <> muted_user_id)");
    expect(migration).toContain("REVOKE ALL ON TABLE public.community_user_mutes FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT, INSERT, DELETE ON TABLE public.community_user_mutes TO service_role");
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.community_author_is_muted");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("NOT public.community_author_is_muted(author_id)");
    expect(migration).toContain("NOT public.community_author_is_muted(community_comments.author_id)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.community_author_is_muted(uuid) FROM PUBLIC");
    expect(migration).toContain(
      "ALTER PUBLICATION supabase_realtime DROP TABLE public.community_user_mutes",
    );
  });

  it("exposes only authenticated, durable, reversible API operations", () => {
    const route = readWeb("src/app/api/community/mutes/route.ts");
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function POST");
    expect(route).toContain("export async function DELETE");
    expect(route).toContain("checkRateLimitPersistent");
    expect(route).toContain("createClientFromRequest");
    expect(route).toContain("createAdminClient");
    expect(route).not.toMatch(/\.select\(\"\*\"\)|email|phone|wedding_date|role/);
  });

  it("filters muted authors on every public post and historical comment read", () => {
    const paths = [
      "src/app/api/community/posts/route.ts",
      "src/app/api/community/posts/[id]/route.ts",
      "src/app/api/community/posts/voted/route.ts",
      "src/app/api/community/search/route.ts",
      "src/app/api/community/comments/route.ts",
    ];
    for (const path of paths) {
      const source = readWeb(path);
      expect(source, path).toContain("getMutedActorIds");
      expect(source, path).toMatch(/mutedActorIds|mutedActors/);
    }

    const voted = readWeb("src/app/api/community/posts/voted/route.ts");
    expect(voted).toContain("community_posts!inner");
    expect(voted).toContain('.not("community_posts.author_public_id", "in", mutedActors)');
  });

  it("provides mute and unmute controls instead of an irreversible dead end", () => {
    const detail = readWeb("src/app/(community)/community/post/[id]/page.tsx");
    const management = readWeb("src/app/(community)/community/my/muted/page.tsx");
    const userMenu = readWeb("src/components/community/UserMenu.tsx");
    expect(detail).toContain("작성자 글 숨기기");
    expect(detail).toContain("/api/community/mutes");
    expect(management).toContain("숨긴 작성자");
    expect(management).toContain('method: "DELETE"');
    expect(userMenu).toContain("/community/my/muted");
    expect(existsSync(resolve(webRoot, "src/app/api/community/mutes/route.ts"))).toBe(true);
  });

  it("never hydrates a signed-in reader from an anonymous unfiltered SSR feed", () => {
    const page = readWeb("src/app/(community)/community/page.tsx");
    expect(page).toContain("createClient");
    expect(page).toContain("auth.getUser");
    expect(page).toContain("!authError && !user");
  });
});
