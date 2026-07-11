import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const QUOTE_ID = "12345678-1234-4234-9234-123456789abc";

function mockPublicRead(data: unknown, error: unknown = null) {
  const eqCalls: Array<[string, unknown]> = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
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
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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
        unconfirmedItemCount: 4,
        summaryTitle: "악의적인 과거 제목: 필수 가격 판정",
        summaryText: "항목별 평균 999만원",
        sourceNote: "출처 없는 과거 메모",
        sourceUrl: "https://example.invalid",
        marketMedianManwon: 280,
        marketComparatorLabel: "공공 통계 평균",
        priceDiffPercent: 7,
        missingCriticalCount: 1,
        missingHighCount: 2,
        missingMediumCount: 3,
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
    expect(body.analysis.unconfirmedItemCount).toBe(4);
    expect(body.analysis.summaryTitle).toBe("4개 항목의 포함 여부를 더 확인해보세요");
    expect(body.analysis.sourceUrl).toMatch(/^https:\/\/www\.kca\.go\.kr\//);
    expect(body.analysis.marketMedianManwon).toBeUndefined();
    expect(body.analysis.marketComparatorLabel).toBeUndefined();
    expect(body.analysis.priceDiffPercent).toBeUndefined();
    expect(JSON.stringify(body.analysis)).not.toContain("999만원");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("과거 저장 결과의 중요도 카운트는 안전한 확인 필요 개수로만 변환한다", async () => {
    mockPublicRead({
      id: QUOTE_ID,
      category: "studio",
      region: "seoul",
      quote_price_manwon: 300,
      created_at: "2026-07-11T12:00:00.000Z",
      analysis: {
        missingCriticalCount: 1,
        missingHighCount: 2,
        missingMediumCount: 3,
        marketMedianManwon: 999,
      },
    });

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis.unconfirmedItemCount).toBe(6);
    expect(body.analysis).not.toHaveProperty("missingCriticalCount");
    expect(body.analysis).not.toHaveProperty("marketMedianManwon");
  });

  it("returns 404 when no explicitly public row matches", async () => {
    mockPublicRead(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
  });

  it("redacts database errors from both the response and server log", async () => {
    const sensitiveMessage = "row contains user@example.com";
    mockPublicRead(null, { message: sensitiveMessage, code: "XX000" });

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "결과를 불러올 수 없습니다.",
      code: "quote_check_unavailable",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sensitiveMessage);
  });

  it("redacts unexpected exceptions", async () => {
    const sensitiveMessage = "configuration included secret-value";
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error(sensitiveMessage);
    });

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("quote_check_unavailable");
    expect(JSON.stringify(body)).not.toContain(sensitiveMessage);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(sensitiveMessage);
  });
});
