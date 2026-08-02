// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  getServiceClient: vi.fn(),
  sendVendorApprovalEmail: vi.fn(),
  sendVendorRejectionEmail: vi.fn(),
  verifyAdmin: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  getServiceClient: mocks.getServiceClient,
  verifyAdmin: mocks.verifyAdmin,
}));
vi.mock("@/lib/resend", () => ({
  sendVendorApprovalEmail: mocks.sendVendorApprovalEmail,
  sendVendorRejectionEmail: mocks.sendVendorRejectionEmail,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:admin-user`,
}));

import { PATCH } from "./route";

const VENDOR_ID = "10000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: VENDOR_ID }) };

function request(action: string) {
  return new Request(`https://hanbang.ai/api/admin/vendors/${VENDOR_ID}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://hanbang.ai",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ action }),
  });
}

function updateQuery(vendor: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: vendor, error: null }));
  return chain;
}

describe("admin vendor status mutation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-user" });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.sendVendorApprovalEmail.mockResolvedValue(undefined);
    mocks.sendVendorRejectionEmail.mockResolvedValue(undefined);
  });

  it("does not resend an email when the requested status is already applied", async () => {
    const query = updateQuery(null);
    mocks.getServiceClient.mockReturnValue({ from: vi.fn(() => query) });

    const response = await PATCH(request("approve"), context);

    expect(response.status).toBe(409);
    expect(query.neq).toHaveBeenCalledWith("status", "approved");
    expect(mocks.sendVendorApprovalEmail).not.toHaveBeenCalled();
  });

  it("sends one notification for the single successful state transition", async () => {
    const vendor = {
      id: VENDOR_ID,
      name: "Safe Vendor",
      email: "vendor@example.test",
      status: "approved",
    };
    const query = updateQuery(vendor);
    mocks.getServiceClient.mockReturnValue({ from: vi.fn(() => query) });

    const response = await PATCH(request("approve"), context);

    expect(response.status).toBe(200);
    expect(mocks.sendVendorApprovalEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendVendorApprovalEmail).toHaveBeenCalledWith(
      "vendor@example.test",
      "Safe Vendor",
    );
  });

  it("rate-limits before the status update and email provider call", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );

    const response = await PATCH(request("approve"), context);

    expect(response.status).toBe(429);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.sendVendorApprovalEmail).not.toHaveBeenCalled();
  });

  it("limits repeated transitions for one vendor before sending another email", async () => {
    mocks.checkRateLimitPersistent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "target limited" }), { status: 429 }),
      );

    const response = await PATCH(request("approve"), context);

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(2);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.sendVendorApprovalEmail).not.toHaveBeenCalled();
  });
});
