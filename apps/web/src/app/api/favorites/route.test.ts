import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createClientFromRequest: vi.fn(),
  hasSignedDemoSessionFromCookieHeader: vi.fn(),
  recordDecision: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: mocks.recordDecision,
}));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: mocks.hasSignedDemoSessionFromCookieHeader,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: (scope: string, _request: Request, userId?: string) => `${scope}:${userId ?? "guest"}`,
}));

import { DELETE, GET, POST } from "./route";
import { MOBILE_BRIDGE_RESPONSE_BYTES_HEADER } from "@/lib/mobile/boundedJsonResponse";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDOR_ID = "11111111-1111-4111-8111-111111111111";

function deleteRequest(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://hanbang.ai/api/favorites", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function postRequest(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://hanbang.ai/api/favorites", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function getRequest(): NextRequest {
  return new NextRequest("https://hanbang.ai/api/favorites");
}

function favoriteAddClient(
  error: unknown = null,
  publicPriceResult: { data: unknown; error: unknown } = {
    data: {
      vendor_id: VENDOR_ID,
      vendor_name: "샘플업체A",
      category: "studio",
    },
    error: null,
  },
) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const publicMaybeSingle = vi.fn().mockResolvedValue(publicPriceResult);
  const publicLimit = vi.fn().mockReturnValue({ maybeSingle: publicMaybeSingle });
  const publicOrder = vi.fn().mockReturnValue({ limit: publicLimit });
  const publicCurrentEq = vi.fn().mockReturnValue({ order: publicOrder });
  const publicVendorEq = vi.fn().mockReturnValue({ eq: publicCurrentEq });
  const publicSelect = vi.fn().mockReturnValue({ eq: publicVendorEq });
  const profileMaybeSingle = vi.fn().mockResolvedValue({ data: { couple_id: null } });
  const profileEq = vi.fn().mockReturnValue({ maybeSingle: profileMaybeSingle });
  const profileSelect = vi.fn().mockReturnValue({ eq: profileEq });
  const from = vi.fn((table: string) => {
    if (table === "vendor_favorites") return { upsert };
    if (table === "v_public_prices") return { select: publicSelect };
    if (table === "profiles") return { select: profileSelect };
    throw new Error(`unexpected table ${table}`);
  });
  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from,
    },
    from,
    publicMaybeSingle,
    upsert,
  };
}

function authenticatedClient(error: unknown = null) {
  const vendorEq = vi.fn().mockResolvedValue({ error });
  const userEq = vi.fn().mockReturnValue({ eq: vendorEq });
  const remove = vi.fn().mockReturnValue({ eq: userEq });
  const from = vi.fn().mockReturnValue({ delete: remove });
  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from,
    },
    from,
    remove,
    userEq,
    vendorEq,
  };
}

function favoritesListClient(result: { data: unknown; error: unknown }) {
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
    select,
  };
}

describe("GET /api/favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSignedDemoSessionFromCookieHeader.mockReturnValue(false);
  });

  it("returns a private non-cacheable owner-scoped list", async () => {
    const database = favoritesListClient({
      data: [{ vendor_id: VENDOR_ID, created_at: "2026-07-18T00:00:00.000Z" }],
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(database.select).toHaveBeenCalledWith("vendor_id");
    expect(database.limit).toHaveBeenCalledWith(501);
    expect(response.headers.get(MOBILE_BRIDGE_RESPONSE_BYTES_HEADER)).toMatch(/^[1-9][0-9]*$/);
    await expect(response.json()).resolves.toEqual({ vendorIds: [VENDOR_ID] });
  });

  it("fails closed instead of presenting a database error as an empty list", async () => {
    const database = favoritesListClient({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("fails explicitly instead of returning a silently incomplete wishlist", async () => {
    const database = favoritesListClient({
      data: Array.from({ length: 501 }, (_, index) => ({
        vendor_id: `${index}`.padStart(36, "0"),
      })),
      error: null,
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await GET(getRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "FAVORITES_LIMIT_EXCEEDED",
    });
  });
});

describe("DELETE /api/favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.hasSignedDemoSessionFromCookieHeader.mockReturnValue(false);
  });

  it("sets the favorite state to absent and remains absent when the request is repeated", async () => {
    const database = authenticatedClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const [first, second] = await Promise.all([
      DELETE(deleteRequest({ vendorId: VENDOR_ID })),
      DELETE(deleteRequest({ vendorId: VENDOR_ID })),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ isFavorite: false });
    await expect(second.json()).resolves.toEqual({ isFavorite: false });
    expect(database.from).toHaveBeenNthCalledWith(1, "vendor_favorites");
    expect(database.from).toHaveBeenNthCalledWith(2, "vendor_favorites");
    expect(database.remove).toHaveBeenCalledTimes(2);
    expect(database.userEq).toHaveBeenNthCalledWith(1, "user_id", USER_ID);
    expect(database.userEq).toHaveBeenNthCalledWith(2, "user_id", USER_ID);
    expect(database.vendorEq).toHaveBeenNthCalledWith(1, "vendor_id", VENDOR_ID);
    expect(database.vendorEq).toHaveBeenNthCalledWith(2, "vendor_id", VENDOR_ID);
  });

  it("rejects a cross-site mutation before authentication or database access", async () => {
    const crossSite = DELETE(deleteRequest(
      { vendorId: VENDOR_ID },
      { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    ));
    const noOriginProof = DELETE(new Request("https://hanbang.ai/api/favorites", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendorId: VENDOR_ID }),
    }));
    const [crossSiteResponse, noOriginProofResponse] = await Promise.all([
      crossSite,
      noOriginProof,
    ]);

    expect(crossSiteResponse.status).toBe(403);
    expect(noOriginProofResponse.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("accepts a native Bearer mutation without browser origin metadata", async () => {
    const database = authenticatedClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);
    const response = await DELETE(new Request("https://hanbang.ai/api/favorites", {
      method: "DELETE",
      headers: {
        authorization: "Bearer native-session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ vendorId: VENDOR_ID }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.createClientFromRequest).toHaveBeenCalledOnce();
    expect(database.remove).toHaveBeenCalledOnce();
  });

  it("requires an authenticated user before starting deletion", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const response = await DELETE(deleteRequest({ vendorId: VENDOR_ID }));

    expect(response.status).toBe(401);
  });

  it("rejects an invalid vendor id without starting a deletion", async () => {
    const database = authenticatedClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await DELETE(deleteRequest({ vendorId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("rejects an oversized body even without a content-length header", async () => {
    const database = authenticatedClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await DELETE(deleteRequest({
      vendorId: VENDOR_ID,
      padding: "x".repeat(5_000),
    }));

    expect(response.status).toBe(413);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("does not confirm removal when the user-scoped RLS deletion fails", async () => {
    const database = authenticatedClient({ code: "42501", message: "permission denied" });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await DELETE(deleteRequest({ vendorId: VENDOR_ID }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.hasSignedDemoSessionFromCookieHeader.mockReturnValue(false);
  });

  it("sets the favorite state to present and remains present when repeated", async () => {
    const database = favoriteAddClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const [first, second] = await Promise.all([
      POST(postRequest({ vendorId: VENDOR_ID })),
      POST(postRequest({ vendorId: VENDOR_ID })),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ isFavorite: true });
    await expect(second.json()).resolves.toEqual({ isFavorite: true });
    expect(database.upsert).toHaveBeenCalledTimes(2);
    expect(database.upsert).toHaveBeenNthCalledWith(
      1,
      { user_id: USER_ID, vendor_id: VENDOR_ID },
      { ignoreDuplicates: true, onConflict: "user_id,vendor_id" },
    );
  });

  it("rejects a cross-site add before authentication or database access", async () => {
    const response = await POST(postRequest(
      { vendorId: VENDOR_ID },
      { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    ));

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("does not confirm addition when the user-scoped RLS write fails", async () => {
    const database = favoriteAddClient({ code: "42501", message: "permission denied" });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ vendorId: VENDOR_ID }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("does not create an invisible favorite for a vendor without a current public price", async () => {
    const database = favoriteAddClient(null, { data: null, error: null });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ vendorId: VENDOR_ID }));

    expect(response.status).toBe(404);
    expect(database.upsert).not.toHaveBeenCalled();
  });

  it("reports public-catalog lookup outages without pretending the vendor is absent", async () => {
    const database = favoriteAddClient(null, {
      data: null,
      error: { code: "57014", message: "catalog unavailable" },
    });
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ vendorId: VENDOR_ID }));

    expect(response.status).toBe(503);
    expect(database.upsert).not.toHaveBeenCalled();
  });

  it("rejects unexpected identity fields before vendor lookup", async () => {
    const database = favoriteAddClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({ vendorId: VENDOR_ID, userId: USER_ID }));

    expect(response.status).toBe(400);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("rejects an oversized body even without a content-length header", async () => {
    const database = favoriteAddClient();
    mocks.createClientFromRequest.mockResolvedValue(database.client);

    const response = await POST(postRequest({
      vendorId: VENDOR_ID,
      padding: "x".repeat(5_000),
    }));

    expect(response.status).toBe(413);
    expect(database.from).not.toHaveBeenCalled();
  });
});
