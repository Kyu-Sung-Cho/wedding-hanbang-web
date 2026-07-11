import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const QUOTE_ID = "12345678-1234-4234-9234-123456789abc";

function mockPublicRead(data: unknown) {
  const eqCalls: Array<[string, unknown]> = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  const admin = { from: vi.fn(() => query) };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>
  );
  return { query, eqCalls };
}

function request() {
  return new NextRequest(`http://localhost/api/amora/quote-check/${QUOTE_ID}/public`);
}

function context() {
  return { params: Promise.resolve({ id: QUOTE_ID }) };
}

describe("/api/amora/quote-check/[id]/public GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires explicit publication and returns only the redacted projection", async () => {
    const db = mockPublicRead({
      id: QUOTE_ID,
      category: "studio",
      region: "seoul",
      quote_price_manwon: 300,
      created_at: "2026-07-11T12:00:00.000Z",
      analysis: {
        category: "studio",
        quotePriceManwon: 300,
        marketMedianManwon: 280,
        marketComparatorLabel: "공공 통계 평균",
        priceDiffPercent: 7,
        missingCriticalCount: 1,
        missingHighCount: 2,
        missingMediumCount: 3,
        summaryTitle: "확인할 항목이 있어요",
        summaryText: "계약 전에 확인해보세요.",
        sourceNote: "공공 통계 참고",
        vendorName: "절대 공개되면 안 됨",
        memo: "절대 공개되면 안 됨",
        contractQuestions: ["비공개 질문"],
      },
    });

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.eqCalls).toEqual([
      ["id", QUOTE_ID],
      ["is_public", true],
    ]);
    expect(db.query.select).toHaveBeenCalledWith(
      "id, category, region, quote_price_manwon, analysis, created_at"
    );
    expect(body.analysis.vendorName).toBeUndefined();
    expect(body.analysis.memo).toBeUndefined();
    expect(body.analysis.contractQuestions).toBeUndefined();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("returns 404 when no explicitly public row matches", async () => {
    mockPublicRead(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
  });
});
