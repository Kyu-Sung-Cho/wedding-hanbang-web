// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  list: vi.fn(),
  readRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/admin/adminReadBoundary", () => ({
  checkAdminReadRateLimit: mocks.readRateLimit,
}));
vi.mock("@/lib/admin/priceUploadConfirmations", () => ({
  listPendingPriceUploadConfirmations: mocks.list,
}));

import { ADMIN_STEP_UP_COOKIE, createAdminStepUpToken } from "@/lib/auth/adminStepUp";
import { GET } from "./route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000090";
const ADMIN_PASSWORD = "admin-bootstrap-secret-longer-than-32-characters";

function serviceClient() {
  const single = vi.fn().mockResolvedValue({ data: { is_admin: true } });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return { service: true, from: vi.fn(() => ({ select })) };
}

function signedRequest() {
  const token = createAdminStepUpToken(ADMIN_ID);
  expect(token).not.toBeNull();
  return new Request("https://example.test/api/admin/price/upload/confirmations", {
    headers: { cookie: `${ADMIN_STEP_UP_COOKIE}=${token}` },
  });
}

describe("GET /api/admin/price/upload/confirmations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: ADMIN_ID } } }),
      },
    });
    mocks.createAdminClient.mockReturnValue(serviceClient());
    mocks.readRateLimit.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an administrator without the signed step-up before reading the queue", async () => {
    const response = await GET(new Request("https://example.test/api/admin/price/upload/confirmations"));
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.readRateLimit).not.toHaveBeenCalled();
  });

  it("returns the safe pending queue with private no-store caching", async () => {
    const client = serviceClient();
    mocks.createAdminClient.mockReturnValue(client);
    mocks.list.mockResolvedValue([{
      confirmation_id: "confirmation-1",
      category: "studio",
      regionCode: "seoul_gangnam3",
      candidates: [{
        vendorId: "vendor-1",
        category: "studio",
        regionCode: "seoul_gangnam3",
      }],
    }]);
    const response = await GET(signedRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      confirmations: [{
        confirmation_id: "confirmation-1",
        category: "studio",
        regionCode: "seoul_gangnam3",
        candidates: [{
          vendorId: "vendor-1",
          category: "studio",
          regionCode: "seoul_gangnam3",
        }],
      }],
    });
    expect(JSON.stringify(payload)).not.toContain("source_object_key");
    expect(mocks.list).toHaveBeenCalledWith(client);
    expect(mocks.readRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      ADMIN_ID,
      "price-upload-confirmations",
    );
  });
});
