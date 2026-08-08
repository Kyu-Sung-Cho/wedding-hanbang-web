import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  sendVendorApprovalEmail: vi.fn(),
  sendVendorRejectionEmail: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("@/lib/resend", () => ({
  sendVendorApprovalEmail: mocks.sendVendorApprovalEmail,
  sendVendorRejectionEmail: mocks.sendVendorRejectionEmail,
}));

import { PATCH } from "./route";

describe("admin vendor mutation trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a cross-site request before admin verification, body parsing, service writes, or email", async () => {
    const request = new Request(
      "https://hanbang.ai/api/admin/vendors/00000000-0000-4000-8000-000000000001",
      {
        method: "PATCH",
        headers: {
          "content-type": "text/plain",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: "not-json",
      },
    );
    const jsonSpy = vi.spyOn(request, "json");

    const response = await PATCH(request, {
      params: Promise.resolve({
        id: "00000000-0000-4000-8000-000000000001",
      }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.sendVendorApprovalEmail).not.toHaveBeenCalled();
    expect(mocks.sendVendorRejectionEmail).not.toHaveBeenCalled();
  });
});
