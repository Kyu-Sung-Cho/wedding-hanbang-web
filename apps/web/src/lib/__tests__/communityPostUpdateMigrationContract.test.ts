import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713121000_atomic_community_post_update.sql",
  ),
  "utf8",
);
const detailRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/posts/[id]/route.ts"),
  "utf8",
);
const patchRoute = detailRoute
  .split("export async function PATCH")[1]
  ?.split("export async function DELETE")[0] ?? "";

describe("atomic community post update", () => {
  it("exposes only the exact service-only RPC contract", () => {
    expect(migration).toContain("public.community_update_post(");
    expect(migration).toContain("p_actor_id uuid");
    expect(migration).toContain("p_post_id uuid");
    expect(migration).toContain("p_patch jsonb");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.community_update_post(uuid, uuid, jsonb)",
    );
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.community_update_post(uuid, uuid, jsonb)",
    );
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("COMMUNITY_POST_UPDATE_FUNCTION_ACL_NOT_EXACT");
    expect(migration).toContain("COMMUNITY_POST_UPDATE_SERVICE_EXECUTE_GRANT_MISSING");
  });

  it("locks first and checks current author or current admin permission", () => {
    expect(migration).toMatch(
      /FROM public\.community_posts AS post[\s\S]*?FOR UPDATE;/,
    );
    expect(migration).toMatch(
      /target_post\.author_id IS DISTINCT FROM p_actor_id[\s\S]*?FROM public\.profiles AS profile[\s\S]*?FOR SHARE;/,
    );
    expect(migration).toContain("community post update forbidden");
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toMatch(
      /UPDATE public\.community_posts AS post[\s\S]*?WHERE post\.id = p_post_id[\s\S]*?post\.author_id = target_post\.author_id/,
    );
  });

  it("accepts exactly the seven active patch fields and validates every value", () => {
    const allowedFieldList = migration.match(
      /WHERE patch_key\.key NOT IN \(([\s\S]*?)\)\s*\n\s*\) THEN/,
    )?.[1] ?? "";
    for (const field of [
      "title",
      "content",
      "category",
      "visibility",
      "tags",
      "ad_disclosure",
      "sponsorship_detail",
    ]) {
      expect(allowedFieldList).toContain(`'${field}'`);
    }
    for (const retired of [
      "price_data",
      "cost_data",
      "ai_comment",
      "cohort_room_id",
      "vendor_tags",
      "rating",
      "is_quick_review",
      "is_verified_review",
      "verification_doc_url",
      "images",
      "slides",
      "poll",
    ]) {
      expect(allowedFieldList).not.toContain(`'${retired}'`);
    }
    expect(migration).toContain("pg_catalog.jsonb_typeof");
    expect(migration).toContain("pg_catalog.jsonb_array_length");
    expect(migration).toContain("unsupported community post update field");
    expect(migration).toContain("sponsorship detail requires sponsored disclosure");
  });

  it("serializes concurrent changes and makes exact retries no-ops", () => {
    expect(migration).toContain("FOR UPDATE");
    expect(migration.match(/IS NOT DISTINCT FROM/g)?.length).toBeGreaterThanOrEqual(7);
    expect(migration).toContain(
      "RETURN QUERY SELECT p_post_id, false, target_post.author_id = p_actor_id",
    );
    expect(migration).toContain("GET DIAGNOSTICS changed_rows = ROW_COUNT");
    expect(migration).toContain("community post update conflict");
  });

  it("routes mutations only through the RPC and never pre-reads raw ownership", () => {
    expect(patchRoute).toContain('rpc("community_update_post"');
    expect(patchRoute).not.toContain("isAdmin(user.id)");
    expect(patchRoute).not.toContain(
      '.select("author_id, ad_disclosure, sponsorship_detail")',
    );
    expect(patchRoute).not.toMatch(/\.from\("community_posts"\)[\s\S]*?\.update\(/);
    expect(patchRoute).toContain("COMMUNITY_POST_PUBLIC_SELECT");
    expect(patchRoute).toContain("result.viewer_is_author");
  });
});
