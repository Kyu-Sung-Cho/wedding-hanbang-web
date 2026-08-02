import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createClientFromRequest: vi.fn(),
  publicMaybeSingle: vi.fn(),
  upsert: vi.fn(),
  deleteResult: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string, _request: Request, userId?: string) =>
    `${scope}:${userId ?? "guest"}`,
}));

import { DELETE, GET, POST } from "./route";
import { MOBILE_BRIDGE_RESPONSE_BYTES_HEADER } from "@/lib/mobile/boundedJsonResponse";

const USER_ID = "40000000-0000-4000-8000-000000000001";
const VENDOR_ID = "10000000-0000-4000-8000-000000000001";

function request(body: unknown, method = "POST", headers: HeadersInit = {}) {
  return new Request("https://hanbang.ai/api/price/alerts", {
    method,
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": `${Math.floor(Math.random() * 200) + 1}.1.1.1`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function deleteChain() {
  let eqCount = 0;
  const value: Record<string, unknown> = {};
  value.eq = vi.fn(() => {
    eqCount += 1;
    return eqCount === 2 ? mocks.deleteResult() : value;
  });
  return value;
}

function chain(maybeSingle: () => Promise<unknown>) {
  const value: Record<string, unknown> = {};
  value.select = vi.fn(() => value);
  value.eq = vi.fn(() => value);
  value.limit = vi.fn(() => value);
  value.maybeSingle = maybeSingle;
  return value;
}

function alertListClient(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: vi.fn().mockReturnValue({ select }),
    },
    limit,
  };
}

describe("GET /api/price/alerts", () => {
  it("returns a complete bounded alert membership list", async () => {
    const database = alertListClient({ data: [{ vendor_id: VENDOR_ID }], error: null });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(new Request("https://hanbang.ai/api/price/alerts"));

    expect(response.status).toBe(200);
    expect(database.limit).toHaveBeenCalledWith(501);
    await expect(response.json()).resolves.toEqual({ vendorIds: [VENDOR_ID] });
    expect(response.headers.get(MOBILE_BRIDGE_RESPONSE_BYTES_HEADER)).toMatch(/^[1-9][0-9]*$/);
  });

  it("fails explicitly instead of returning a silently incomplete alert list", async () => {
    const database = alertListClient({
      data: Array.from({ length: 501 }, (_, index) => ({ vendor_id: String(index) })),
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(new Request("https://hanbang.ai/api/price/alerts"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PRICE_ALERTS_LIMIT_EXCEEDED",
    });
  });
});

describe("POST /api/price/alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.publicMaybeSingle.mockResolvedValue({ data: { vendor_id: VENDOR_ID }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.deleteResult.mockResolvedValue({ error: null });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from: vi.fn((table: string) => {
        if (table === "v_public_prices") return chain(mocks.publicMaybeSingle);
        if (table === "price_alerts") {
          return {
            upsert: mocks.upsert,
            delete: vi.fn(deleteChain),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    });
  });

  it("injects the authenticated owner when subscribing", async () => {
    const response = await POST(request({ vendorId: VENDOR_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subscribed: true });
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, vendor_id: VENDOR_ID },
      { ignoreDuplicates: true, onConflict: "user_id,vendor_id" },
    );
  });

  it("removes the subscription idempotently with DELETE", async () => {
    const [first, second] = await Promise.all([
      DELETE(request({ vendorId: VENDOR_ID }, "DELETE")),
      DELETE(request({ vendorId: VENDOR_ID }, "DELETE")),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ subscribed: false });
    await expect(second.json()).resolves.toEqual({ subscribed: false });
    expect(mocks.deleteResult).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-site mutations before authentication", async () => {
    const response = await POST(request(
      { vendorId: VENDOR_ID },
      "POST",
      { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    ));

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("accepts a native Bearer mutation without browser origin metadata", async () => {
    const response = await DELETE(new Request("https://hanbang.ai/api/price/alerts", {
      method: "DELETE",
      headers: {
        authorization: "Bearer native-session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ vendorId: VENDOR_ID }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.createClientFromRequest).toHaveBeenCalledOnce();
    expect(mocks.deleteResult).toHaveBeenCalledOnce();
  });

  it("rejects unpublished or stale vendors", async () => {
    mocks.publicMaybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await POST(request({ vendorId: VENDOR_ID }));
    expect(response.status).toBe(404);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects unexpected identity fields", async () => {
    const response = await POST(request({ vendorId: VENDOR_ID, userId: USER_ID }));
    expect(response.status).toBe(400);
    expect(mocks.publicMaybeSingle).not.toHaveBeenCalled();
  });

  it("enforces the byte limit even without a content-length header", async () => {
    const response = await POST(request({
      vendorId: VENDOR_ID,
      padding: "x".repeat(5_000),
    }));
    expect(response.status).toBe(413);
    expect(mocks.publicMaybeSingle).not.toHaveBeenCalled();
  });

  it("rejects stale-account subscribe and remove mutations before database access", async () => {
    const headers = { "x-hanbang-expected-actor": "50000000-0000-4000-8000-000000000001" };
    const [subscribe, remove] = await Promise.all([
      POST(request({ vendorId: VENDOR_ID }, "POST", headers)),
      DELETE(request({ vendorId: VENDOR_ID }, "DELETE", headers)),
    ]);

    expect(subscribe.status).toBe(409);
    expect(remove.status).toBe(409);
    expect(mocks.publicMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.deleteResult).not.toHaveBeenCalled();
  });
});
