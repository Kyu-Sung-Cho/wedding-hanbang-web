import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

function setStoredAnalysis(analysis: Record<string, unknown>) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: "10000000-0000-4000-8000-000000000001",
      category: "studio",
      region: "seoul",
      quote_price_manwon: 320,
      analysis,
      created_at: "2026-07-19T00:00:00.000Z",
    },
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mocks.createAdminClient.mockReturnValue({ from });
}

describe("GET /api/amora/quote-check/[id]/public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not republish legacy medians, comparison copy, or source claims", async () => {
    setStoredAnalysis({
      quotePriceManwon: 320,
      marketMedianManwon: 250,
      marketComparatorLabel: "서울 스튜디오 중위가",
      priceDiffPercent: 28,
      missingCriticalCount: 1,
      missingHighCount: 2,
      missingMediumCount: 0,
      summaryTitle: "서울 평균보다 비싼 견적이에요",
      summaryText: "과거 중위가 비교 설명",
      sourceNote: "과거 고정 시세 기준",
    });

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/amora/quote-check/10000000-0000-4000-8000-000000000001/public"),
      { params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis).toMatchObject({
      marketMedianManwon: 0,
      marketComparatorLabel: "업체별 최신 공시가 확인 필요",
      priceDiffPercent: 0,
      summaryTitle: "핵심 확인 항목 1개가 견적서에서 확인되지 않았어요",
    });
    expect(body.analysis.sourceNote).toContain("가격의 적정성을 판정하지 않습니다");
    expect(JSON.stringify(body)).not.toContain("과거 고정 시세");
    expect(JSON.stringify(body)).not.toContain("과거 중위가 비교");
  });

  it("returns 404 for malformed compatibility JSON", async () => {
    setStoredAnalysis({ quotePriceManwon: 320 });

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/amora/quote-check/10000000-0000-4000-8000-000000000001/public"),
      { params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(404);
  });
});
