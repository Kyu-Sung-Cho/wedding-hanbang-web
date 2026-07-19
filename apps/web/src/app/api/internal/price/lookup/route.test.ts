// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/admin/priceUploadLookup", () => ({
  lookupPublishedVendorPrices: mocks.lookup,
}));

import { GET } from "./route";

const secret = "s".repeat(32);

function request(query = "샘플스튜디오", token = secret) {
  const url = new URL("https://example.test/api/internal/price/lookup");
  url.searchParams.set("q", query);
  url.searchParams.set("category", "studio");
  return new Request(url, { headers: { "X-Internal-Token": token } });
}

describe("GET /api/internal/price/lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INTERNAL_API_TOKEN", secret);
    delete process.env.VENDOR_INTERNAL_TOKEN;
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an invalid internal token before constructing a service client", async () => {
    const response = await GET(request("샘플스튜디오", "wrong"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it.each([
    ["missing q", "https://example.test/api/internal/price/lookup?category=studio"],
    ["invalid category", "https://example.test/api/internal/price/lookup?q=sample&category=other"],
  ])("rejects %s before database access", async (_name, url) => {
    const response = await GET(new Request(url, {
      headers: { "X-Internal-Token": secret },
    }));

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("returns typo-tolerant published matches with no-store caching", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table !== "events") throw new Error(`unexpected table: ${table}`);
      return { insert };
    });
    const client = { from };
    const vendorId = "00000000-0000-4000-8000-000000000001";
    const lookupResult = {
      matches: [{
        vendor: {
          id: vendorId,
          slug: "sample-studio-a",
          name: "샘플스튜디오가",
          category: "studio",
          region_code: "seoul_gangnam3",
        },
        period_label: "2026Q3",
        prices: [{
          agency: "샘플대행사",
          price_min_krw: 1_000_000,
          price_max_krw: 1_200_000,
          price_note: null,
          options: [],
        }],
        detail_url: "/price/vendor/sample-studio-a",
      }],
      disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
    };
    mocks.createAdminClient.mockReturnValue(client);
    mocks.lookup.mockResolvedValue(lookupResult);

    const response = await GET(request("샘플스튜됴"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual(lookupResult);
    expect(mocks.lookup).toHaveBeenCalledWith(client, {
      query: "샘플스튜됴",
      category: "studio",
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("events");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      anon_id: "amora",
      vendor_id: vendorId,
      surface: "amora",
      event_type: "vendor_detail_view",
      weight: 2,
      context: {
        category: "studio",
        surface: "amora",
        zero_result: false,
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("logs exactly one zero-result event for a successful empty lookup", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ insert })),
    });
    mocks.lookup.mockResolvedValue({
      matches: [],
      disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
    });

    const response = await GET(request("없는업체"));

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      anon_id: "amora",
      vendor_id: null,
      surface: "amora",
      event_type: "vendor_detail_view",
      weight: 2,
      context: expect.objectContaining({ zero_result: true }),
    }));
  });

  it("returns verified prices when optional event persistence fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const insert = vi.fn().mockResolvedValue({ error: { code: "42501" } });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ insert })),
    });
    mocks.lookup.mockResolvedValue({
      matches: [{
        vendor: {
          id: "00000000-0000-4000-8000-000000000001",
          slug: "sample-studio-a",
          name: "샘플스튜디오가",
          category: "studio",
          region_code: "seoul_gangnam3",
        },
        period_label: "2026Q3",
        prices: [],
        detail_url: "/price/vendor/sample-studio-a",
      }],
      disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      matches: [expect.objectContaining({
        vendor: expect.objectContaining({ slug: "sample-studio-a" }),
      })],
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      "[internal price lookup] analytics event unavailable",
    );
    warning.mockRestore();
  });
});
