import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();
const repoRoot = resolve(webRoot, "../..");
const readWeb = (path: string) => readFileSync(resolve(webRoot, path), "utf8");
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const FORBIDDEN_PUBLIC_COLUMNS = [
  "images",
  "slides",
  "price_data",
  "cost_data",
  "ai_comment",
  "cohort_room_id",
  "vendor_tags",
  "rating",
  "is_quick_review",
  "is_verified_review",
  "verification_doc_url",
  "search_vector",
] as const;

describe("community legacy payload boundary", () => {
  it("keeps every public API query on the explicit text-only projection", () => {
    const projection = readWeb("src/lib/community/postSelect.ts");
    const createRoute = readWeb("src/app/api/community/posts/route.ts");
    const updateRoute = readWeb("src/app/api/community/posts/[id]/route.ts");

    for (const column of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(projection, column).not.toContain(column);
    }
    expect(createRoute).toContain(".select(COMMUNITY_POST_PUBLIC_SELECT)");
    expect(updateRoute).toContain(".select(COMMUNITY_POST_PUBLIC_SELECT)");
    expect(createRoute).not.toMatch(/\.insert\(\{[\s\S]*?(images|slides|price_data|cost_data|vendor_tags|rating|is_quick_review):/);
  });

  it("does not probe the revoked search_vector or fall back after a planned error", () => {
    const searchRoute = readWeb("src/app/api/community/search/route.ts");
    expect(searchRoute).not.toMatch(/\.textSearch\(|search_vector\"/);
    expect(searchRoute).not.toMatch(/fallbackQuery|fallbackPosts|Community search fallback/);
    expect(searchRoute).toContain("checkRateLimitPersistent");
    expect(searchRoute).toContain("title.ilike");
    expect(searchRoute).toContain("content.ilike");
  });

  it("removes full-row Postgres Changes from the browser runtime", () => {
    const landing = readWeb("src/components/community/CommunityLandingClient.tsx");
    const migration = readRepo(
      "supabase/migrations/20260713115000_close_community_legacy_payload_exposure.sql",
    );

    expect(existsSync(resolve(webRoot, "src/hooks/useCommunityRealtime.ts"))).toBe(false);
    expect(landing).not.toMatch(/useCommunityRealtime|postgres_changes/);
    expect(migration).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE public.community_posts");
    expect(migration).toContain("community_posts remains in supabase_realtime");
  });

  it("revokes every browser column grant before granting only the safe projection", () => {
    const originalClosure = readRepo(
      "supabase/migrations/20260713104000_close_public_vendor_catalog_data_api.sql",
    );
    const finalClosure = readRepo(
      "supabase/migrations/20260713115000_close_community_legacy_payload_exposure.sql",
    );
    const originalGrant = originalClosure.slice(
      originalClosure.indexOf("GRANT SELECT (", originalClosure.indexOf("Historical posts")),
      originalClosure.indexOf(") ON TABLE public.community_posts TO anon, authenticated"),
    );

    for (const column of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(originalGrant, column).not.toContain(column);
      expect(finalClosure, column).toContain(`'${column}'`);
    }
    expect(finalClosure).toContain("REVOKE SELECT (%s), INSERT (%s), UPDATE (%s)");
    expect(finalClosure).toContain("has_column_privilege");
    expect(finalClosure).toContain("block_retired_community_structured_fields");
    expect(finalClosure).toContain("community_rich_links_retired");
  });

  it("does not render historical AI or vendor enrichment", () => {
    const detail = readWeb("src/app/(community)/community/post/[id]/page.tsx");
    expect(detail).not.toMatch(/AiCommentBox|post\.ai_comment|vendor_details/);
    expect(existsSync(resolve(webRoot, "src/components/community/AiCommentBox.tsx"))).toBe(false);
    expect(existsSync(resolve(webRoot, "src/components/community/VendorTagPicker.tsx"))).toBe(false);
  });

  it("keeps browser-facing TypeScript contracts as narrow as the public API", () => {
    const types = readWeb("src/types/community.types.ts");
    const publicAuthor = types.slice(
      types.indexOf("export interface PublicCommunityAuthor"),
      types.indexOf("export interface PublicCommunityPost"),
    );
    const publicPost = types.slice(
      types.indexOf("export interface PublicCommunityPost"),
      types.indexOf("export interface PostWithAuthor"),
    );
    const postDetail = types.slice(
      types.indexOf("export interface PostDetail"),
      types.indexOf("export interface PollOption"),
    );

    expect(types).toContain("export interface PostWithAuthor extends PublicCommunityPost");
    expect(types).toContain("author: PublicCommunityAuthor;");
    expect(types).toContain("export interface CommentWithAuthor extends CommunityComment");
    expect(publicAuthor).not.toMatch(/wedding_year|wedding_month|region|warning_count|is_suspended/);
    for (const column of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(publicPost, column).not.toContain(column);
    }
    expect(postDetail).not.toContain("vendor_details");
  });
});
