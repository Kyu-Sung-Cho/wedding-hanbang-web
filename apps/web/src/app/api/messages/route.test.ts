// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const USER = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";
const MESSAGE = { id: "message", vendor_id: VENDOR, customer_id: USER, sender_type: "vendor", content: "private message", is_read: false, created_at: "2026-09-28T00:00:00Z" };
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), read: vi.fn(), update: vi.fn(), owner: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({
  auth: { getUser: mocks.getUser },
  from: () => {
    const query = { select: () => query, eq: () => query, order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.read()).then(resolve), update: mocks.update };
    return query;
  },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/vendors/serverOwnership", () => ({ loadOwnedVendorWithServiceRole: mocks.owner }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "fake" }));
vi.mock("@/lib/previewStub", () => ({ isPreviewStubMode: () => false }));
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: () => NextResponse.next() }));

import { GET, HEAD } from "./route";
import { proxy } from "@/proxy";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mocks.owner.mockResolvedValue(null);
  mocks.read.mockReturnValue({ data: [MESSAGE], error: null });
  mocks.update.mockReturnValue({ in: async () => ({ data: null, error: null }) });
});

describe("vendor message read receipts require a trusted, intentional GET", () => {
  it.each<Record<string, string>>([
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
    { origin: "https://outside.example" },
    { "sec-fetch-site": "same-site" },
    {},
    { authorization: "Basic invalid" },
  ])("does not acknowledge via untrusted browser metadata %j", async headers => {
    const request = new NextRequest(`https://hanbang.ai/api/messages?vendorId=${VENDOR}`, { headers });
    expect((await proxy(request)).status).toBe(200);
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect((await response.json()).messages).toHaveLength(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it.each<Record<string, string>>([
    { "sec-fetch-site": "same-origin" },
    { origin: "https://hanbang.ai" },
    { authorization: "Bearer synthetic.jwt.token" },
  ])("keeps existing browser and native read receipts %j", async headers => {
    const response = await GET(new Request(`https://hanbang.ai/api/messages?vendorId=${VENDOR}`, { headers }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ is_read: true });
  });

  it.each<Record<string, string>>([{}, { "sec-fetch-site": "same-origin" }, { authorization: "Bearer synthetic.jwt.token" }])("HEAD does not acknowledge or return the private body %j", async headers => {
    const response = await HEAD(new Request(`https://hanbang.ai/api/messages?vendorId=${VENDOR}`, { method: "HEAD", headers }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("preserves the authentication and vendor ownership gates", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await GET(new Request(`https://hanbang.ai/api/messages?vendorId=${VENDOR}`))).status).toBe(401);
    expect((await GET(new Request(`https://hanbang.ai/api/messages?vendorId=${VENDOR}&customerId=${USER}`))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
