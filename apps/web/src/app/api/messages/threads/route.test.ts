import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  loadOwnedVendorWithServiceRole: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/vendors/serverOwnership", () => ({
  loadOwnedVendorWithServiceRole: mocks.loadOwnedVendorWithServiceRole,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test-user`,
}));

import { GET } from "./route";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const VENDOR_ID = "10000000-0000-4000-8000-000000000001";

function authenticatedClient(from: ReturnType<typeof vi.fn>) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER_ID } } }),
    },
    from,
  };
}

describe("GET /api/messages/threads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("builds approved vendor threads only from server-provenance messages", async () => {
    const row = {
      id: "20000000-0000-4000-8000-000000000001",
      vendor_id: VENDOR_ID,
      customer_id: CUSTOMER_ID,
      server_provenance_version: 1,
      sender_type: "customer",
      content: "trusted inquiry",
      is_read: false,
      booking_id: null,
      created_at: "2026-08-02T00:00:00.000Z",
    };
    const limit = vi.fn().mockResolvedValue({ data: [row], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const vendorEq = vi.fn().mockReturnValue({ order });
    const provenanceEq = vi.fn().mockReturnValue({ eq: vendorEq });
    const select = vi.fn().mockReturnValue({ eq: provenanceEq });
    const from = vi.fn().mockReturnValue({ select });
    const admin = { from: vi.fn() };
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.loadOwnedVendorWithServiceRole.mockResolvedValue({
      id: VENDOR_ID,
      name: "승인 업체",
    });

    const response = await GET(new NextRequest("https://hanbang.ai/api/messages/threads"));

    expect(response.status).toBe(200);
    expect(provenanceEq).toHaveBeenCalledWith("server_provenance_version", 1);
    expect(vendorEq).toHaveBeenCalledWith("vendor_id", VENDOR_ID);
    expect(mocks.loadOwnedVendorWithServiceRole).toHaveBeenCalledWith(admin, OWNER_ID);
    await expect(response.json()).resolves.toEqual({
      isVendor: true,
      threads: [{
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
        vendorName: "승인 업체",
        customerName: "고객",
        lastMessage: "trusted inquiry",
        lastMessageAt: "2026-08-02T00:00:00.000Z",
        unreadCount: 1,
      }],
    });
  });

  it("does not grant vendor-thread access when approved ownership is absent", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const customerEq = vi.fn().mockReturnValue({ order });
    const provenanceEq = vi.fn().mockReturnValue({ eq: customerEq });
    const select = vi.fn().mockReturnValue({ eq: provenanceEq });
    const from = vi.fn().mockReturnValue({ select });
    const admin = { from: vi.fn() };
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.loadOwnedVendorWithServiceRole.mockResolvedValue(null);

    const response = await GET(new NextRequest("https://hanbang.ai/api/messages/threads"));

    expect(response.status).toBe(200);
    expect(provenanceEq).toHaveBeenCalledWith("server_provenance_version", 1);
    expect(customerEq).toHaveBeenCalledWith("customer_id", OWNER_ID);
    expect(admin.from).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      isVendor: false,
      threads: [],
    });
  });
});
