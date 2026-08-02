// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  mutationRateLimit: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/admin/adminReadBoundary", () => ({
  checkAdminMutationRateLimit: mocks.mutationRateLimit,
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
import { ADMIN_STEP_UP_COOKIE, createAdminStepUpToken } from "@/lib/auth/adminStepUp";
import { PATCH } from "./route";

const CONFIRMATION_ID = "00000000-0000-4000-8000-000000000099";
const VENDOR_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000090";
const ADMIN_PASSWORD = "admin-bootstrap-secret-longer-than-32-characters";

function serviceClient() {
  const single = vi.fn().mockResolvedValue({ data: { is_admin: true } });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return { service: true, from: vi.fn(() => ({ select })) };
}

function request(body: unknown, options: { signed?: boolean; sameOrigin?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.signed !== false) {
    const token = createAdminStepUpToken(ADMIN_ID);
    expect(token).not.toBeNull();
    headers.cookie = `${ADMIN_STEP_UP_COOKIE}=${token}`;
  }
  if (options.sameOrigin !== false) {
    headers.origin = "https://example.test";
    headers["sec-fetch-site"] = "same-origin";
  }
  return new Request(`https://example.test/api/admin/price/upload/confirmations/${CONFIRMATION_ID}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/price/upload/confirmations/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: ADMIN_ID } } }),
      },
    });
    mocks.createAdminClient.mockReturnValue(serviceClient());
    mocks.mutationRateLimit.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects a mutation without the signed step-up or same-origin evidence", async () => {
    const body = { vendor_id: VENDOR_ID, expected_version: 0 };
    const context = { params: Promise.resolve({ id: CONFIRMATION_ID }) };

    const missingStepUp = await PATCH(request(body, { signed: false }), context);
    expect(missingStepUp.status).toBe(401);

    const missingOrigin = await PATCH(request(body, { sameOrigin: false }), context);
    expect(missingOrigin.status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.mutationRateLimit).not.toHaveBeenCalled();
  });

  it("resolves only an exact candidate/version body as the authenticated admin", async () => {
    const client = serviceClient();
    mocks.createAdminClient.mockReturnValue(client);
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
    expect(mocks.mutationRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      ADMIN_ID,
      "price-upload-confirmation",
    );
  });

  it("maps a stale or different retry to 409 without leaking database details", async () => {
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
