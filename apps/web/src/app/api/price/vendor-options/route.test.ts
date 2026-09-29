import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicOptionRow } from "@/lib/price/publicListData";

const mocks = vi.hoisted(() => ({ createPublicClient: vi.fn() }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: mocks.createPublicClient }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "test" }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));

import { GET } from "./route";

const PRICE_ID = "10000000-0000-4000-8000-000000000001";

function rows(count: number): PublicOptionRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `option-${index}`,
    official_price_id: PRICE_ID,
    name: `추가금 ${index}`,
    price_min_krw: index * 1000,
    price_max_krw: null,
    unit: null,
    condition: null,
    raw_text: `공개 추가금 ${index}`,
    is_effectively_mandatory: false,
    sort_order: index,
  }));
}

function database(data: PublicOptionRow[], options: { pageCap?: number; failFrom?: number } = {}) {
  const range = vi.fn(async (from: number, to: number) => (
    options.failFrom !== undefined && from >= options.failFrom
      ? { data: null, error: { message: "unavailable" } }
      : { data: data.slice(from, Math.min(to + 1, from + (options.pageCap ?? 1000))), error: null }
  ));
  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range,
  };
  mocks.createPublicClient.mockReturnValue({ from: vi.fn(() => chain) });
  return chain;
}

function request(ids = PRICE_ID) {
  return new Request(`https://hanbang.ai/api/price/vendor-options?ids=${ids}`);
}

describe("public vendor options completeness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns every option beyond the database's 1,000-row response limit", async () => {
    const chain = database(rows(1001));
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.options).toHaveLength(1001);
    expect(body.options.at(-1)).toMatchObject({ id: "option-1000", officialPriceId: PRICE_ID });
    expect(chain.range.mock.calls.length).toBeGreaterThan(1);
    expect(chain.order.mock.calls).toEqual(expect.arrayContaining([
      ["official_price_id", { ascending: true }],
      ["sort_order", { ascending: true, nullsFirst: false }],
      ["id", { ascending: true }],
    ]));
  });

  it("continues after a short server-capped page until the result is empty", async () => {
    database(rows(251), { pageCap: 100 });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).options).toHaveLength(251);
  });

  it("does not return or cache a partial success when a later page fails", async () => {
    database(rows(1001), { failFrom: 1000 });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).not.toHaveProperty("options");
  });

  it("fails explicitly when the bounded catalog limit is exceeded", async () => {
    database(rows(20_001));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).not.toHaveProperty("options");
  });

  it("allows a complete catalog exactly at the limit", async () => {
    database(rows(20_000));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).options).toHaveLength(20_000);
  });

  it("keeps empty results distinct from errors", async () => {
    database([]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ options: [] });
  });

  it("rejects more than 60 parent ids before querying", async () => {
    const ids = Array.from({ length: 61 }, (_, index) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const response = await GET(request(ids.join(",")));
    expect(response.status).toBe(400);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });
});
