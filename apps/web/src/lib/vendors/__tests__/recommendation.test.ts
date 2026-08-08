import { describe, expect, it } from "vitest";

import {
  rankVendorRecommendations,
  type RecommendationCandidate,
  type VendorRecommendationRequest,
} from "../recommendation";

function candidate(
  overrides: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
  return {
    id: "vendor-a",
    slug: "sample-studio",
    name: "샘플 스튜디오",
    category: "studio",
    regionCode: "seoul_gangnam3",
    status: "approved",
    attributes: {
      shoot_locations: ["indoor"],
      original_files_policy: "included",
      parents_shot: true,
      pet_friendly: false,
      price_band: "mid",
    },
    tags: [
      { slug: "natural-light", label: "자연광" },
      { slug: "film-mood", label: "필름감성" },
    ],
    urls: {
      official: "https://vendor.example",
      instagram: null,
      naverPlace: null,
    },
    price: {
      minKrw: 1_200_000,
      maxKrw: 1_400_000,
      periodLabel: "2026Q3",
      hasMarketData: false,
      isLatestSnapshot: true,
    },
    ...overrides,
  };
}

const baseRequest: VendorRecommendationRequest = {
  category: "studio",
  region_codes: ["seoul_gangnam3"],
  budget_max_krw: 1_500_000,
  preferred_tags: ["자연광", "필름감성"],
  required_attrs: { original_files_policy: "included" },
  wedding_month: "2026-11",
  limit: 5,
};

describe("rankVendorRecommendations", () => {
  it("applies the documented score weights and returns human-readable evidence", () => {
    const response = rankVendorRecommendations(baseRequest, [candidate()]);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      vendor: {
        id: "vendor-a",
        slug: "sample-studio",
        category: "studio",
        region_code: "seoul_gangnam3",
      },
      score: 0.84,
      price_summary: {
        min_krw: 1_200_000,
        max_krw: 1_400_000,
        period_label: "2026Q3",
        has_market_data: false,
      },
      data_badges: expect.arrayContaining(["공시가"]),
      detail_url: "/price/vendor/sample-studio",
    });
    expect(response.results[0].match_reasons).toEqual(
      expect.arrayContaining([
        "선호 태그 2/2 일치: 자연광, 필름감성",
        "공시 기본가 120만원으로 예산 내",
        "촬영한 전체 사진 파일 받기 조건 충족",
        "최신 공시 가격 기준",
      ]),
    );
    expect(response.disclaimer).toBe(
      "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
    );
  });

  it("hard-filters a known required-attribute mismatch but keeps unknown values with a warning", () => {
    const mismatch = candidate({
      id: "mismatch",
      attributes: { original_files_policy: "paid" },
    });
    const unknown = candidate({
      id: "unknown",
      name: "확인 필요 스튜디오",
      attributes: { original_files_policy: "unknown" },
    });
    const missing = candidate({
      id: "missing",
      name: "미입력 스튜디오",
      attributes: {},
    });

    const response = rankVendorRecommendations(baseRequest, [mismatch, unknown, missing]);

    expect(response.results.map((result) => result.vendor.id)).toEqual([
      "missing",
      "unknown",
    ]);
    for (const result of response.results) {
      expect(result.match_reasons).toContain(
        "촬영한 전체 사진 파일 받기 확인 필요",
      );
    }
  });

  it("requires a proven public minimum price when a budget is supplied", () => {
    const overBudget = candidate({
      id: "over",
      price: {
        minKrw: 1_500_001,
        maxKrw: 1_600_000,
        periodLabel: "2026Q3",
        hasMarketData: false,
        isLatestSnapshot: true,
      },
    });
    const noPrice = candidate({ id: "no-price", price: null });
    const withinBudget = candidate({ id: "within" });

    const response = rankVendorRecommendations(baseRequest, [
      overBudget,
      noPrice,
      withinBudget,
    ]);

    expect(response.results.map((result) => result.vendor.id)).toEqual(["within"]);
  });

  it("never emits a result without an approved public price summary", () => {
    const response = rankVendorRecommendations({
      ...baseRequest,
      budget_max_krw: undefined,
    }, [candidate({ price: null })]);

    expect(response.results).toEqual([]);
  });

  it("relaxes region to nationwide only when local coverage is below the requested threshold", () => {
    const local = candidate({ id: "local", name: "로컬", tags: [] });
    const nationwideA = candidate({
      id: "national-a",
      name: "전국 A",
      regionCode: "busan",
    });
    const nationwideB = candidate({
      id: "national-b",
      name: "전국 B",
      regionCode: "jeju",
    });

    const response = rankVendorRecommendations(baseRequest, [
      local,
      nationwideA,
      nationwideB,
    ]);

    expect(response.results).toHaveLength(3);
    expect(response.coverage_note).toBe(
      "가격을 공개한 업체 기준 추천입니다. 요청 지역의 결과가 적어 검색 범위를 전국으로 넓혔습니다.",
    );
  });

  it("is deterministic and cannot be influenced by advertising or commission-shaped extra data", () => {
    const left = {
      ...candidate({ id: "a", name: "가 업체" }),
      advertising_bid: 0,
      commission_rate: 0,
    } as RecommendationCandidate;
    const right = {
      ...candidate({ id: "b", name: "나 업체" }),
      advertising_bid: 999_999,
      commission_rate: 99,
    } as RecommendationCandidate;

    const first = rankVendorRecommendations(baseRequest, [right, left]);
    const second = rankVendorRecommendations(baseRequest, [left, right]);

    expect(first).toEqual(second);
    expect(first.results.map((result) => result.vendor.id)).toEqual(["a", "b"]);
  });

  it("uses the documented fixed budget factor when no budget was requested", () => {
    const request = {
      ...baseRequest,
      budget_max_krw: undefined,
      region_codes: [],
      preferred_tags: [],
      required_attrs: {},
    };
    const response = rankVendorRecommendations(request, [
      candidate({
        attributes: {},
        tags: [],
        urls: { official: null, instagram: null, naverPlace: null },
        price: {
          minKrw: 1_200_000,
          maxKrw: 1_200_000,
          periodLabel: "2026Q3",
          hasMarketData: false,
          isLatestSnapshot: false,
        },
      }),
    ]);

    expect(response.results[0].score).toBe(0.02);
  });
});
