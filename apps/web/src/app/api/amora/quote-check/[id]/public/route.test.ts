import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/http/publicServiceReadRateLimit", () => ({
  checkPublicServiceReadRateLimit: vi.fn().mockResolvedValue(null),
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
  const not = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ not }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mocks.createAdminClient.mockReturnValue({ from });
  return { from, select, eq, not, maybeSingle };
}

function setPrivateResult() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const not = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ not }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mocks.createAdminClient.mockReturnValue({ from });
  return { not };
}

describe("GET /api/amora/quote-check/[id]/public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not republish legacy medians, comparison copy, or source claims", async () => {
    const query = setStoredAnalysis({
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
    expect(body).not.toHaveProperty("createdAt");
    expect(query.select).toHaveBeenCalledWith("id, category, region, analysis");
    expect(query.not).toHaveBeenCalledWith("published_at", "is", null);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("returns 404 for a private result and never marks the miss cacheable", async () => {
    const query = setPrivateResult();

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/amora/quote-check/10000000-0000-4000-8000-000000000001/public"),
      { params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(404);
    expect(query.not).toHaveBeenCalledWith("published_at", "is", null);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("returns 404 for malformed compatibility JSON", async () => {
    setStoredAnalysis({ quotePriceManwon: 320 });

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/amora/quote-check/10000000-0000-4000-8000-000000000001/public"),
      { params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(404);
  });

  it("rejects a malformed UUID before creating a service-role client", async () => {
    const response = await GET(
      new NextRequest("https://hanbang.ai/api/amora/quote-check/not-a-uuid/public"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
