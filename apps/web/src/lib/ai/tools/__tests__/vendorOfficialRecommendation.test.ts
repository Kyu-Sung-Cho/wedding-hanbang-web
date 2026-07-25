import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecommendationCandidate } from "@/lib/vendors/recommendation";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createPublicClient: vi.fn(),
  loadRecommendationCandidates: vi.fn(),
  logRecommendationImpressions: vi.fn(),
  loadVendorProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

// 후보 조회는 공개 뷰다 — service_role은 vendor_enrichment_url_is_allowed()
// EXECUTE가 없어 42501로 거부되므로 공개 클라이언트로만 읽어야 한다.
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

vi.mock("@/lib/vendors/recommendationData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendors/recommendationData")>();
  return {
    ...actual,
    loadRecommendationCandidates: mocks.loadRecommendationCandidates,
    logRecommendationImpressions: mocks.logRecommendationImpressions,
  };
});

vi.mock("@/lib/vendors/vendorProfileData", () => ({
  loadVendorProfile: mocks.loadVendorProfile,
}));

import {
  executeGetVendorDetail,
  executeRecommendVendors,
  executeSearchVendors,
} from "../vendorTools";

function candidate(): RecommendationCandidate {
  return {
    id: "vendor-1",
    slug: "sample-studio",
    name: "샘플 스튜디오",
    category: "studio",
    regionCode: "seoul_gangnam3",
    status: "approved",
    attributes: { original_files_policy: "included" },
    tags: [{ slug: "studio-natural-light", label: "자연광" }],
    urls: { official: "https://vendor.example", instagram: null, naverPlace: null },
    price: {
      minKrw: 1_200_000,
      maxKrw: 1_400_000,
      periodLabel: "2026Q3",
      hasMarketData: false,
      isLatestSnapshot: true,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue({ from: vi.fn() });
  mocks.createPublicClient.mockReturnValue({ from: vi.fn() });
  mocks.loadRecommendationCandidates.mockResolvedValue([candidate()]);
  mocks.logRecommendationImpressions.mockResolvedValue(true);
  mocks.loadVendorProfile.mockResolvedValue(null);
});

describe("Amora official vendor recommendation", () => {
  it("keeps discovery, exact lookup, and official detail roles distinct in the tool contract", () => {
    const search = WEDDING_TOOLS.find(({ name }) => name === "search_vendors");
    const recommend = WEDDING_TOOLS.find(({ name }) => name === "recommend_vendors");
    const detail = WEDDING_TOOLS.find(({ name }) => name === "get_vendor_detail");

    expect(search?.description).toContain("정확한 업체명");
    expect(search?.description).toContain("recommend_vendors");
    expect(recommend?.description).toContain("공시 가격");
    expect(detail?.description).toContain("공시 근거");
  });

  it("uses the same explainable public-price engine as the internal API", async () => {
    const client = { from: vi.fn() };
    mocks.createPublicClient.mockReturnValue(client);

    const result = await executeRecommendVendors({
      category: "스튜디오",
      preferred_tags: ["자연광"],
      required_attrs: { original_files_policy: "included" },
      price_max: 1_500_000,
      location: "강남",
      limit: 3,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(mocks.loadRecommendationCandidates).toHaveBeenCalledWith(client, "studio");
    expect(mocks.logRecommendationImpressions).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      recommendationPolicy: "official_price_explainable_v1",
      vendors: [{
        id: "vendor-1",
        name: "샘플 스튜디오",
        link: "/price/vendor/sample-studio",
        reasons: expect.arrayContaining(["원본 제공 조건 충족"]),
      }],
    });
    expect(result.displayMessage).toContain("공시 가격과 확인된 조건을 기준");
  });

  it("does not bypass the official path because of harmless category whitespace or casing", async () => {
    const client = { from: vi.fn() };
    mocks.createPublicClient.mockReturnValue(client);

    const result = await executeRecommendVendors({
      category: " Studio ",
      limit: 1,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(mocks.loadRecommendationCandidates).toHaveBeenCalledWith(client, "studio");
    expect(result.toolOutput).toMatchObject({
      recommendationPolicy: "official_price_explainable_v1",
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("treats an available official dataset with zero candidates as a valid empty result", async () => {
    const client = { from: vi.fn() };
    mocks.createAdminClient.mockReturnValue(client);
    mocks.loadRecommendationCandidates.mockResolvedValue([]);

    const result = await executeRecommendVendors({
      category: "스튜디오",
      location: "강남",
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        recommendationPolicy: "official_price_explainable_v1",
        dataStatus: "available",
        vendors: [],
        count: 0,
      },
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("fails closed instead of ranking legacy vendors when official data is unavailable", async () => {
    const client = { from: vi.fn() };
    mocks.createAdminClient.mockReturnValue(client);
    mocks.loadRecommendationCandidates.mockRejectedValue(
      new Error("RECOMMENDATION_VENDOR_LIMIT"),
    );

    const result = await executeRecommendVendors({
      category: "드레스",
      location: "서초",
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        recommendationPolicy: "official_price_explainable_v1",
        dataStatus: "unavailable",
        error: "official_recommendation_unavailable",
      },
    });
    expect(result.displayMessage).toContain("공식 업체 정보를 불러오지 못했어요");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("does not confuse Seoul outside Gangnam with the Gangnam region", async () => {
    mocks.loadRecommendationCandidates.mockResolvedValue([
      candidate(),
      {
        ...candidate(),
        id: "vendor-seoul-etc",
        slug: "sample-seoul-etc-studio",
        name: "샘플 서울 기타 스튜디오",
        regionCode: "seoul_etc",
      },
    ]);

    const result = await executeRecommendVendors({
      category: "스튜디오",
      location: "서울(강남 외)",
      price_max: 1_500_000,
      limit: 1,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result.toolOutput).toMatchObject({
      coverageNote: "가격을 공개한 업체 기준 추천입니다.",
      vendors: [{ id: "vendor-seoul-etc" }],
    });
  });

  it("maps the Hongdae neighborhood to Seoul outside the Gangnam-three region", async () => {
    mocks.loadRecommendationCandidates.mockResolvedValue([
      candidate(),
      {
        ...candidate(),
        id: "vendor-hongdae",
        slug: "sample-hongdae-studio",
        name: "샘플 홍대 스튜디오",
        regionCode: "seoul_etc",
        price: { ...candidate().price!, minKrw: 1_400_000, maxKrw: 1_400_000 },
      },
    ]);

    const result = await executeRecommendVendors({
      category: "스튜디오",
      location: "홍대",
      price_max: 2_000_000,
      limit: 1,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result.toolOutput).toMatchObject({
      vendors: [{ id: "vendor-hongdae" }],
    });
  });

  it.each(["서초", "송파"])(
    "maps the %s district to the Seoul Gangnam-three region",
    async (location) => {
      mocks.loadRecommendationCandidates.mockResolvedValue([
        candidate(),
        {
          ...candidate(),
          id: "vendor-seoul-etc-cheaper",
          slug: "sample-seoul-etc-cheaper",
          name: "샘플 서울 기타 저가 스튜디오",
          regionCode: "seoul_etc",
          price: { ...candidate().price!, minKrw: 100_000, maxKrw: 100_000 },
        },
      ]);

      const result = await executeRecommendVendors({
        category: "스튜디오",
        location,
        price_max: 2_000_000,
        limit: 1,
      }, {
        coupleId: "couple-1",
        weddingContext: { budget: 50_000_000, progress: {} },
      });

      expect(result.toolOutput).toMatchObject({ vendors: [{ id: "vendor-1" }] });
    },
  );

  it("asks for clarification instead of treating an unrecognized nonempty location as nationwide", async () => {
    const result = await executeRecommendVendors({
      category: "메이크업",
      location: "달빛마을 근처",
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        dataStatus: "clarification_required",
        error: "unrecognized_recommendation_location",
      },
    });
    expect(result.displayMessage).toContain("시·도(예: 부산, 대구, 경기)나 동네 이름");
    expect(mocks.loadRecommendationCandidates).not.toHaveBeenCalled();
  });

  it("does not turn the total wedding budget into a hard category price ceiling", async () => {
    const result = await executeRecommendVendors({
      category: "스튜디오",
      limit: 1,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result.success).toBe(true);
    expect(result.toolOutput).not.toHaveProperty("estimatedBudget");
    expect(result.toolOutput).toMatchObject({
      vendors: [{ reasons: expect.not.arrayContaining([expect.stringContaining("예산 내")]) }],
    });
  });

  it("rejects an invalid explicit category ceiling instead of silently dropping it", async () => {
    const result = await executeRecommendVendors({
      category: "스튜디오",
      price_max: -1,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "invalid_official_recommendation_filters" },
    });
    expect(mocks.loadRecommendationCandidates).not.toHaveBeenCalled();
  });

  it("routes supported-category discovery from search_vendors through the official engine", async () => {
    const client = { from: vi.fn() };
    mocks.createPublicClient.mockReturnValue(client);

    const result = await executeSearchVendors({
      category: "예식장",
      location: "송파",
      price_max: 2_000_000,
      limit: 1,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(mocks.loadRecommendationCandidates).toHaveBeenCalledWith(client, "hall");
    expect(result).toMatchObject({
      toolName: "search_vendors",
      success: true,
      toolOutput: {
        recommendationPolicy: "official_price_explainable_v1",
      },
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("keeps supported-category search as an exact-name lookup without legacy ranking signals", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      limit: vi.fn(),
      or: vi.fn(),
      lte: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
      then: (
        resolve: (value: { data: unknown[]; error: null }) => unknown,
      ) => Promise.resolve(resolve({
        data: [{
          id: "vendor-1",
          slug: "sample-studio",
          name: "샘플 스튜디오",
          category: "studio",
          location: "서울",
          region: "강남",
          price_range: "120만원대",
          rating: 5,
          review_count: 999,
          tags: ["자연광"],
          ai_recommend: true,
        }],
        error: null,
      })),
    };
    for (const method of ["select", "eq", "limit", "or", "lte", "gte", "order"] as const) {
      query[method].mockReturnValue(query);
    }
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) });

    const result = await executeSearchVendors({
      category: "스튜디오",
      search: "샘플 스튜디오",
      location: "강남",
      price_min: 100_000,
      price_max: 2_000_000,
    }, {
      coupleId: "",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(query.eq).toHaveBeenCalledWith("name", "샘플 스튜디오");
    expect(query.or).not.toHaveBeenCalled();
    expect(query.lte).not.toHaveBeenCalled();
    expect(query.gte).not.toHaveBeenCalled();
    expect(query.order).toHaveBeenCalledWith("name", { ascending: true });
    expect(result.toolOutput).toMatchObject({
      lookupPolicy: "exact_name_lookup_v1",
      dataNotice: "업체명 확인 결과이며 가격·추천 근거는 공시 상세에서 확인합니다.",
      vendors: [{
        id: "vendor-1",
        name: "샘플 스튜디오",
        link: "/price/vendor/sample-studio",
      }],
    });
    expect(JSON.stringify(result.toolOutput)).not.toContain("rating");
    expect(JSON.stringify(result.toolOutput)).not.toContain("aiRecommend");
    expect(JSON.stringify(result.toolOutput)).not.toContain("priceRange");
    expect(result.displayMessage).not.toContain("120만원대");
  });

  it("does not expose a broad uncategorized legacy ranking through search_vendors", async () => {
    const client = { from: vi.fn() };
    mocks.createAdminClient.mockReturnValue(client);

    const result = await executeSearchVendors({ limit: 5 }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result).toMatchObject({
      success: false,
      toolOutput: { error: "vendor_search_scope_required" },
    });
    expect(result.displayMessage).toContain("업체명이나 카테고리");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("treats an uncategorized vendor-name search as exact identity lookup, not fuzzy ranking", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      limit: vi.fn(),
      or: vi.fn(),
      lte: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(resolve({
          data: [{
            id: "vendor-1",
            slug: "sample-vendor",
            name: "샘플 업체",
            category: "hanbok",
            location: "서울",
            region: null,
            price_range: "미확인 가격",
            rating: 5,
            review_count: 999,
            tags: [],
            ai_recommend: true,
          }],
          error: null,
        })),
    };
    for (const method of ["select", "eq", "limit", "or", "lte", "gte", "order"] as const) {
      query[method].mockReturnValue(query);
    }
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) });

    const result = await executeSearchVendors({ search: "샘플 업체" }, {
      coupleId: "",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(query.eq).toHaveBeenCalledWith("name", "샘플 업체");
    expect(query.or).not.toHaveBeenCalled();
    expect(query.order).toHaveBeenCalledWith("name", { ascending: true });
    expect(result.toolOutput).toMatchObject({ lookupPolicy: "exact_name_lookup_v1" });
    expect(JSON.stringify(result.toolOutput)).not.toContain("rating");
    expect(JSON.stringify(result.toolOutput)).not.toContain("priceRange");
  });

  it("makes the evidence-rich official profile primary and nests booking data as auxiliary", async () => {
    const officialProfile = {
      vendor: {
        id: "vendor-1",
        slug: "sample-studio",
        name: "샘플 스튜디오",
        category: "studio",
        region_code: "seoul_gangnam3",
        urls: {
          official: "https://vendor.example",
          instagram: null,
          naver_place: null,
        },
      },
      attributes: { original_files_policy: "included" },
      tags: [{ slug: "natural", label: "자연광", tag_group: "style" }],
      official_prices: [{
        id: "price-1",
        category: "studio",
        item_name: "기본 촬영",
        price_min_krw: 1_200_000,
        price_max_krw: 1_400_000,
        source_quote: "기본 촬영 120만원",
        period_label: "2026Q3",
        is_current: true,
        source: "한국소비자원 참가격 2026Q3 공시 기준",
        options: [],
      }],
      data_badges: ["공시가", "최신 공시", "태그 확인"],
      sources: ["한국소비자원 참가격 2026Q3 공시 기준"],
    };
    mocks.loadVendorProfile.mockResolvedValue(officialProfile);

    const resultByTable: Record<string, unknown[]> = {
      vendor_products: [{
        id: "product-1",
        name: "예약 상담",
        description: "예약 확인용",
        price: 0,
        discount_price: null,
        duration_minutes: 30,
        is_popular: false,
        includes: [],
      }],
      vendor_staff: [],
    };
    const admin = {
      from: vi.fn((table: string) => {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: resultByTable[table] ?? [], error: null })),
        };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        query.order.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        return query;
      }),
    };
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await executeGetVendorDetail({ vendor_id: "vendor-1" });

    expect(mocks.loadVendorProfile).toHaveBeenCalledWith(admin, "vendor-1");
    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "available",
        vendorId: "vendor-1",
        vendorName: "샘플 스튜디오",
        officialProfile,
        bookingData: {
          policy: "legacy_booking_auxiliary_v1",
          auxiliary: true,
          products: [{ id: "product-1", name: "예약 상담" }],
          staff: [],
        },
      },
    });
    expect(result.displayMessage).toContain("공시 가격 1건");
    expect(result.displayMessage).toContain("예약 보조 상품 1개");
  });

  it("bounds the evidence preview sent to the chat client and discloses omitted rows", async () => {
    const longText = "긴 공시 설명".repeat(300);
    mocks.loadVendorProfile.mockResolvedValue({
      vendor: {
        id: "vendor-1",
        slug: "sample-studio",
        name: "샘플 스튜디오",
        category: "studio",
        region_code: "seoul_gangnam3",
        urls: { official: null, instagram: null, naver_place: null },
      },
      attributes: {},
      tags: Array.from({ length: 14 }, (_, index) => ({
        slug: `tag-${index}`,
        label: `태그 ${index}`,
        tag_group: "style",
      })),
      official_prices: Array.from({ length: 8 }, (_, priceIndex) => ({
        id: `price-${priceIndex}`,
        category: "studio",
        item_name: longText,
        base_spec: longText,
        price_min_krw: 1_000_000 + priceIndex,
        price_max_krw: 1_200_000 + priceIndex,
        vat_note: longText,
        price_note: longText,
        period_label: "2026Q3",
        is_current: true,
        source: longText,
        options: Array.from({ length: 8 }, (_, optionIndex) => ({
          id: `option-${priceIndex}-${optionIndex}`,
          name: longText,
          price_min_krw: optionIndex * 10_000,
          price_max_krw: optionIndex * 10_000,
          unit: longText,
          condition: longText,
          raw_text: longText,
        })),
      })),
      data_badges: ["공시가", "최신 공시"],
      sources: Array.from({ length: 8 }, (_, index) => `source-${index}`),
    });

    const resultByTable: Record<string, unknown[]> = {
      vendor_products: [{
        id: "product-1",
        name: longText,
        description: longText,
        price: 0,
        discount_price: 0,
        duration_minutes: 0,
        is_popular: false,
        includes: Array.from({ length: 10 }, () => longText),
      }],
      vendor_staff: [{
        id: "staff-1",
        name: longText,
        role: longText,
        description: longText,
      }],
    };
    const admin = {
      from: vi.fn((table: string) => {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: resultByTable[table] ?? [], error: null })),
        };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        query.order.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        return query;
      }),
    };
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await executeGetVendorDetail({ vendor_id: "vendor-1" });
    const output = result.toolOutput as {
      officialProfile: {
        official_prices: Array<{
          item_name: string;
          options: Array<{ name: string; raw_text: string }>;
        }>;
        tags: unknown[];
        sources: unknown[];
        result_truncation: {
          policy: string;
          official_prices: { available: number; returned: number };
          official_price_options: { available: number; returned: number };
        };
      };
      bookingData: {
        products: Array<{
          name: string;
          description: string;
          discountPrice: number | null;
          duration: number | null;
          includes: string[];
        }>;
        staff: Array<{ name: string; role: string | null; description: string }>;
      };
    };

    expect(output.officialProfile.official_prices).toHaveLength(6);
    expect(output.officialProfile.official_prices[0].options).toHaveLength(6);
    expect(output.officialProfile.tags).toHaveLength(12);
    expect(output.officialProfile.sources).toHaveLength(6);
    expect(output.officialProfile.result_truncation).toMatchObject({
      policy: "amora_vendor_detail_preview_v1",
      official_prices: { available: 8, returned: 6 },
      official_price_options: { available: 64, returned: 36 },
    });
    expect(output.officialProfile.official_prices[0].item_name.length).toBeLessThanOrEqual(200);
    expect(output.officialProfile.official_prices[0].options[0].name.length).toBeLessThanOrEqual(200);
    expect(output.officialProfile.official_prices[0].options[0].raw_text.length).toBeLessThanOrEqual(500);
    expect(output.bookingData.products[0]).toMatchObject({
      discountPrice: 0,
      duration: 0,
    });
    expect(output.bookingData.products[0].name.length).toBeLessThanOrEqual(160);
    expect(output.bookingData.products[0].description.length).toBeLessThanOrEqual(80);
    expect(output.bookingData.products[0].includes).toHaveLength(8);
    expect(output.bookingData.products[0].includes.every((item) => item.length <= 120)).toBe(true);
    expect(output.bookingData.staff[0].name.length).toBeLessThanOrEqual(160);
    expect(output.bookingData.staff[0].role?.length).toBeLessThanOrEqual(120);
    expect(output.bookingData.staff[0].description.length).toBeLessThanOrEqual(60);
  });

  it("keeps the official profile available when auxiliary booking data fails", async () => {
    mocks.loadVendorProfile.mockResolvedValue({
      vendor: {
        id: "vendor-1",
        slug: "sample-studio",
        name: "샘플 스튜디오",
        category: "studio",
        region_code: "seoul_gangnam3",
        urls: { official: null, instagram: null, naver_place: null },
      },
      attributes: {},
      tags: [],
      official_prices: [],
      data_badges: [],
      sources: [],
    });
    const admin = {
      from: vi.fn(() => {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          then: (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.reject(new Error("LEGACY_BOOKING_UNAVAILABLE")).then(resolve, reject),
        };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        query.order.mockReturnValue(query);
        return query;
      }),
    };
    mocks.createAdminClient.mockReturnValue(admin);

    const result = await executeGetVendorDetail({ vendor_id: "vendor-1" });

    expect(result).toMatchObject({
      success: true,
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "available",
        bookingData: {
          policy: "legacy_booking_auxiliary_v1",
          dataStatus: "unavailable",
          auxiliary: true,
          products: [],
          staff: [],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("LEGACY_BOOKING_UNAVAILABLE");
  });

  it("does not replace a supported vendor's missing official profile with legacy product detail", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "vendor-1",
        name: "샘플 스튜디오",
        category: "studio",
        location: "서울",
        price_range: "120만원대",
      },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      single,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const admin = { from: vi.fn(() => query) };
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.loadVendorProfile.mockResolvedValue(null);

    const result = await executeGetVendorDetail({ vendor_id: "vendor-1" });

    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "unavailable",
        error: "official_vendor_profile_not_available",
      },
    });
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(result.displayMessage).toContain("공시 상세가 아직 준비되지 않았어요");
  });

  it("fails official detail closed without exposing loader errors or querying legacy tables", async () => {
    const admin = { from: vi.fn() };
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.loadVendorProfile.mockRejectedValue(new Error("PRIVATE_DATABASE_DETAIL"));

    const result = await executeGetVendorDetail({ vendor_id: "vendor-1" });

    expect(result).toMatchObject({
      success: false,
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "unavailable",
        error: "official_vendor_profile_unavailable",
      },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DATABASE_DETAIL");
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("understands common abbreviated province names", async () => {
    mocks.loadRecommendationCandidates.mockResolvedValue([
      {
        ...candidate(),
        id: "vendor-gyeongsang",
        slug: "sample-gyeongsang-studio",
        name: "샘플 경상권 스튜디오",
        regionCode: "gyeongsang",
      },
      {
        ...candidate(),
        id: "vendor-seoul-cheaper",
        slug: "sample-seoul-cheaper-studio",
        name: "샘플 서울 저가 스튜디오",
        price: { ...candidate().price!, minKrw: 100_000, maxKrw: 100_000 },
      },
    ]);

    const result = await executeRecommendVendors({
      category: "스튜디오",
      location: "경남 진주",
      price_max: 1_500_000,
      limit: 1,
    }, {
      coupleId: "couple-1",
      weddingContext: { budget: 50_000_000, progress: {} },
    });

    expect(result.toolOutput).toMatchObject({
      coverageNote: "가격을 공개한 업체 기준 추천입니다.",
      vendors: [{ id: "vendor-gyeongsang" }],
    });
  });
});
