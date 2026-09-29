import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeDiscoverProviders } from "../providerDiscoveryTools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { BETA_SAFE_TOOLS, BETA_DISABLED_TOOL_NAMES } from "@/lib/ai/tools";
import { selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { PROVIDER_CATEGORIES } from "@/lib/providers/contracts";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({ rpc: mocks.rpc }) }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function provider(n = 1, kind = "individual", status = "eligible") {
  return {
    id: id(n), kind, name: `합성 제공자 ${n}`, categories: ["photography"], regions: ["서울"],
    introduction: "합성 소개", website: null, instagram: null, updated_at: "2026-09-28T10:00:00Z",
    owner_id: "must-not-leak", contact_email: "private@example.invalid", media: [],
    offerings: [{
      id: id(n + 100), provider_id: id(n), name: "합성 촬영 서비스", category: "photography", description: "합성 서비스",
      base_price_krw: 300_000, price_unit: "2시간", includes: ["원본"], extra_charges: "출장비 별도", conditions: "일정 확인",
      is_active: true, review_status: "approved", recommendation_status: status, reviewed_at: "2026-09-27T10:00:00Z", updated_at: "2026-09-27T10:00:00Z",
    }],
  };
}
const response = (providers: ReturnType<typeof provider>[], next_cursor: string | null = null) => ({ data: { providers, next_cursor }, error: null });
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue(response([provider()])); });

describe("public provider discovery", () => {
  it("uses the public RPC and returns provider pricing provenance without private data", async () => {
    const result = await executeDiscoverProviders({ category: "photography", region: "서울", budget_max_krw: 400_000 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("provider_search_catalog", {
      p_category: "photography", p_region: "서울", p_query: null, p_after: null,
      p_limit: 3, p_recommendation_only: true, p_max_base_price_krw: 400_000,
    });
    expect(result.success).toBe(true);
    expect(result.toolOutput.providers).toEqual([expect.objectContaining({
      organization_type: "individual", base_price_krw: 300_000, price_source: "provider_submitted",
      price_independently_verified_at: null, operator_reviewed_at: "2026-09-27T10:00:00Z",
      availability_status: "unknown", suitability_status: "needs_confirmation", profile_url: `/providers/${id(1)}`,
    })]);
    expect(JSON.stringify(result.toolOutput)).not.toMatch(/owner_id|contact_email|must-not-leak|private@example/);
  });

  it("excludes services awaiting review, blocked services and absent review evidence", async () => {
    const unapproved = provider(2); unapproved.offerings[0].review_status = "pending";
    const missingReview = { ...provider(3), offerings: [{ ...provider(3).offerings[0], reviewed_at: null }] };
    const inactive = provider(6); inactive.offerings[0].is_active = false;
    mocks.rpc.mockResolvedValue({ data: { providers: [provider(), unapproved, missingReview, provider(4, "team", "unreviewed"), provider(5, "company", "blocked"), inactive], next_cursor: null }, error: null });
    const result = await executeDiscoverProviders({ category: "photography", limit: 5 });
    expect(result.toolOutput.count).toBe(1);
  });

  it("does not broaden region, category or budget when no verified candidate matches", async () => {
    for (const input of [
      { category: "photography", region: "서울 강남" },
      { category: "photography", budget_max_krw: 299_999 },
      { category: "venue", region: "서울" },
    ]) {
      const result = await executeDiscoverProviders(input);
      expect(result.success).toBe(true); expect(result.toolOutput.providers).toEqual([]);
      expect(result.toolOutput.coverage_note).toContain("조건을 먼저 적용");
      expect(result.toolOutput.empty_reason).toBe("no_verified_candidate_for_requested_filters");
    }
  });

  it("leaves date, total price and other hard requirements unresolved", async () => {
    const result = await executeDiscoverProviders({ category: "photography", requested_date: "2027-04-17", budget_max_krw: 400_000, required_conditions: ["수용인원 80명", "동일 작가 직접 수행"] });
    expect(result.toolOutput.providers).toEqual([expect.objectContaining({
      requested_date: "2027-04-17", availability_status: "unknown", suitability_status: "needs_confirmation",
      unresolved_requirements: expect.arrayContaining(["사용자가 지정한 추가 필수 조건 전부", "추가금을 포함한 최종 총액의 예산 충족 여부"]),
    })]);
    expect(result.toolOutput.required_conditions_status).toBe("not_verified");
    expect(result.toolOutput.next_step).toContain("필수 조건이 미확인이면 충족한다고 추천하지 말고");
  });

  it("keeps category, active eligibility and ceiling on the same service", async () => {
    const row = provider();
    row.offerings[0].base_price_krw = 500_000;
    row.offerings.push({ ...row.offerings[0], id: id(200), category: "makeup", base_price_krw: 100_000 });
    mocks.rpc.mockResolvedValue(response([row]));
    const result = await executeDiscoverProviders({ category: "photography", budget_max_krw: 300_000 });
    expect(result.toolOutput.providers).toEqual([]);
  });

  it("queries the filtered catalog, preserves a zero ceiling, and discloses remaining matches", async () => {
    const row = provider(); row.offerings[0].base_price_krw = 0; row.regions = ["서울 강남"];
    mocks.rpc.mockResolvedValue(response([row], row.id));
    const result = await executeDiscoverProviders({ category: "photography", region: " 서울강남 ", budget_max_krw: 0, limit: 1 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("provider_search_catalog", {
      p_category: "photography", p_region: "서울강남", p_query: null, p_after: null,
      p_limit: 1, p_recommendation_only: true, p_max_base_price_krw: 0,
    });
    expect(result.toolOutput).toMatchObject({ count: 1, filtered_profile_count: 1, has_more_candidates: true });
    expect(result.toolOutput.coverage_note).not.toMatch(/최신|100개/);
  });

  it("keeps ordering independent of organization type", async () => {
    const rows = [provider(3, "company"), provider(1, "individual"), provider(2, "team")];
    mocks.rpc.mockResolvedValue(response(rows));
    const before = await executeDiscoverProviders({ category: "photography", limit: 5 });
    rows[0].kind = "individual"; rows[1].kind = "company";
    const after = await executeDiscoverProviders({ category: "photography", limit: 5 });
    const ids = (value: unknown) => (value as { provider_id: string }[]).map((row) => row.provider_id);
    expect(ids(before.toolOutput.providers)).toEqual([id(1), id(2), id(3)]);
    expect(ids(after.toolOutput.providers)).toEqual(ids(before.toolOutput.providers));
  });

  it("fails closed on unavailable or malformed catalog, without a legacy fallback", async () => {
    for (const response of [{ data: null, error: { message: "private SQL detail" } }, { data: [{ id: "broken" }], error: null }]) {
      mocks.rpc.mockResolvedValue(response);
      const result = await executeDiscoverProviders({ category: "photography" });
      expect(result.success).toBe(false); expect(result.toolOutput.providers).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("private SQL detail");
    }
  });

  it("retains a complete feedback envelope for maximum-length terms", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => provider(index + 1));
    for (const row of rows) {
      row.name = "합".repeat(120); row.regions = Array.from({ length: 20 }, () => "서".repeat(100));
      row.offerings[0].name = "촬".repeat(120); row.offerings[0].price_unit = "단".repeat(80);
      row.offerings[0].includes = Array.from({ length: 30 }, () => "포".repeat(200));
      row.offerings[0].extra_charges = "추".repeat(3000); row.offerings[0].conditions = "조".repeat(5000);
    }
    mocks.rpc.mockResolvedValue(response(rows));
    const result = await executeDiscoverProviders({ category: "photography", limit: 5, required_conditions: Array.from({ length: 8 }, () => "필".repeat(160)) });
    expect(JSON.stringify(result.toolOutput).length).toBeLessThan(4000);
    expect(result.toolOutput.providers).toEqual([expect.objectContaining({ details_excerpted: true, suitability_status: "needs_confirmation" })]);
    expect(result.toolOutput.disclaimer).toContain("최종 견적");
  });

  it("rejects invalid arguments before lookup", async () => {
    for (const input of [{ category: "unknown" }, { category: "venue", budget_max_krw: -1 }, { category: "venue", requested_date: "2027-02-30" }, { category: "venue", organization_type: "company" }, { category: "venue", limit: 99 }]) {
      expect((await executeDiscoverProviders(input)).success).toBe(false);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("is callable through the existing readonly executor", async () => {
    const result = await executeTool("discover_providers", { category: "photography" }, {
      coupleId: id(900), weddingContext: { weddingDate: null, budget: 50_000_000, venue: null, progress: {} },
    });
    expect(result.success).toBe(true); expect(result.toolName).toBe("discover_providers");
    expect(isMutatingTool("discover_providers")).toBe(false);
  });

  it("shares category schema and opens only for explicit service discovery without legacy booking tools", () => {
    const definition = BETA_SAFE_TOOLS.find((tool) => tool.name === "discover_providers")!;
    expect(definition.input_schema).toMatchObject({ required: ["category"], additionalProperties: false, properties: { category: { enum: [...PROVIDER_CATEGORIES] } } });
    for (const userText of ["서울에서 개인 포토그래퍼 추천해줘", "부산 메이크업 팀 찾아줘", "서울 전시장 대관 후보 찾아줘"]) {
      const selected = selectAmoraTools({ availableTools: BETA_SAFE_TOOLS, userText, specialistType: "general" });
      expect(filterAmoraToolsByQuestionScope(selected, classifyAmoraQuestionScope({ userText })).map((tool) => tool.name)).toContain("discover_providers");
    }
    expect(selectAmoraTools({ availableTools: BETA_SAFE_TOOLS, userText: "메이크업이 걱정돼", specialistType: "general" }).map((tool) => tool.name)).not.toContain("discover_providers");
    expect(BETA_DISABLED_TOOL_NAMES.has("recommend_vendors")).toBe(true);
    expect(BETA_SAFE_TOOLS.some((tool) => tool.name === "create_booking")).toBe(false);
  });
});
