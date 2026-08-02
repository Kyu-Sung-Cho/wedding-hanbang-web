// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));
vi.mock("@/lib/admin/priceUploadConfirmations", () => {
  class PriceUploadConfirmationError extends Error {
    constructor(readonly kind: string) {
      super(kind);
    }
  }
  return {
    PriceUploadConfirmationError,
    resolvePendingPriceUploadConfirmation: mocks.resolve,
  };
});

import { PriceUploadConfirmationError } from "@/lib/admin/priceUploadConfirmations";
import { PATCH } from "./route";

const CONFIRMATION_ID = "00000000-0000-4000-8000-000000000099";
const VENDOR_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000090";

function request(body: unknown) {
  return new Request(`https://example.test/api/admin/price/upload/confirmations/${CONFIRMATION_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/price/upload/confirmations/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves only an exact candidate/version body as the authenticated admin", async () => {
    const client = { service: true };
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ADMIN_ID });
    mocks.getServiceClient.mockReturnValue(client);
    mocks.resolve.mockResolvedValue({
      confirmation_id: CONFIRMATION_ID,
      snapshot_id: "00000000-0000-4000-8000-000000000030",
      staged_prices: 1,
      version: 1,
      already_resolved: false,
    });

    const response = await PATCH(request({ vendor_id: VENDOR_ID, expected_version: 0 }), {
      params: Promise.resolve({ id: CONFIRMATION_ID }),
    });

    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(client, {
      confirmationId: CONFIRMATION_ID,
      selectedVendorId: VENDOR_ID,
      expectedVersion: 0,
      resolvedBy: ADMIN_ID,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps a stale or different retry to 409 without leaking database details", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ADMIN_ID });
    mocks.getServiceClient.mockReturnValue({ service: true });
    mocks.resolve.mockRejectedValue(new PriceUploadConfirmationError("conflict"));

    const response = await PATCH(request({ vendor_id: VENDOR_ID, expected_version: 0 }), {
      params: Promise.resolve({ id: CONFIRMATION_ID }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("PRICE_UPLOAD_CONFIRMATION_CONFLICT");
    expect(JSON.stringify(body)).not.toContain("ALREADY_RESOLVED_DIFFERENT_VENDOR");
  });
});
