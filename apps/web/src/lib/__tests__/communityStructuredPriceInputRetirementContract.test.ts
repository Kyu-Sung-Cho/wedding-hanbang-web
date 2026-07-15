import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("community structured price input retirement", () => {
  it("removes structured price state, draft persistence, UI, and payloads from the writer", () => {
    const writer = read("src/app/(community)/community/post/write/page.tsx");

    expect(writer).not.toContain("PriceQuestionForm");
    expect(writer).not.toContain("priceData");
    expect(writer).not.toContain("price_data");
    expect(
      existsSync(resolve(process.cwd(), "src/components/community/PriceQuestionForm.tsx")),
    ).toBe(false);
  });

  it("rejects retired price_data writes at both community post mutation APIs", () => {
    const createRoute = read("src/app/api/community/posts/route.ts");
    const updateRoute = read("src/app/api/community/posts/[id]/route.ts");

    for (const route of [createRoute, updateRoute]) {
      expect(route).toContain('Object.prototype.hasOwnProperty.call(body, "price_data")');
      expect(route).toContain("커뮤니티의 구조화 가격 입력은 중단되었습니다.");
    }

    expect(createRoute).not.toContain("price_data: null");
    expect(createRoute).not.toContain("rawPriceData");
    expect(createRoute).not.toContain("buildPriceContractCheck");
  });

  it("keeps legacy database fields out of every browser-facing type and component", () => {
    const types = read("src/types/community.types.ts");
    const createPostInput = types.slice(
      types.indexOf("export interface CreatePostInput"),
      types.indexOf("export interface UpdatePostInput"),
    );
    const postSelect = read("src/lib/community/postSelect.ts");

    expect(types).not.toMatch(/interface PriceData|price_data: PriceData|interface CostShareData/);
    expect(createPostInput).not.toContain("price_data");
    expect(postSelect).not.toMatch(/price_data|cost_data|ai_comment|rating|is_quick_review/);
    expect(
      existsSync(resolve(process.cwd(), "src/components/community/AiCommentBox.tsx")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/lib/community/priceComment.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/components/community/CostShareDisplay.tsx")),
    ).toBe(false);
  });

  it("blocks new database writes while allowing legacy price data to be cleared", () => {
    const migration = read(
      "../../supabase/migrations/20260713110000_retire_community_price_data_writes.sql",
    );

    expect(migration).toContain("community_price_data_is_retired");
    expect(migration).toContain("NEW.price_data IS NOT NULL");
    expect(migration).toContain("NEW.price_data IS DISTINCT FROM OLD.price_data");
    expect(migration).toContain("NEW.price_data IS NOT NULL");
    expect(migration).toContain("OLD.price_data IS NOT NULL");
    expect(migration).not.toContain("UPDATE public.community_posts");
  });

  it("documents the same retired write and legacy-read boundary", () => {
    const serviceDoc = read("../../WEDDINGHANBANG_SERVICE_DOC.md");
    const projectStatus = read("../../PROJECT_STATUS.md");

    for (const document of [serviceDoc, projectStatus]) {
      expect(document).toContain("price_data");
      expect(document).toContain("service_role");
      expect(document).toContain("신규");
      expect(document).toContain("삭제");
    }
  });
});
