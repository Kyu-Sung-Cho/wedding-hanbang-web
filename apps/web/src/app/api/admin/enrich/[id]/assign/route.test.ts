import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkAdminMutationRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/admin/adminReadBoundary", () => ({
  checkAdminMutationRateLimit: mocks.checkAdminMutationRateLimit,
}));

import {
  ADMIN_STEP_UP_COOKIE,
  createAdminStepUpToken,
} from "@/lib/auth/adminStepUp";
import { POST } from "./route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const ADMIN_PASSWORD = "admin-bootstrap-secret-longer-than-32-characters";

function primeAdminBoundary(businessClient: unknown) {
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: ADMIN_ID } },
      }),
    },
  });
  mocks.createAdminClient
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { is_admin: true } }),
          })),
        })),
      })),
    })
    .mockReturnValueOnce(businessClient);
}

function mutationHeaders(includeStepUp = true): Record<string, string> {
  const headers: Record<string, string> = {
    origin: "https://hanbang.ai",
    "sec-fetch-site": "same-origin",
  };
  if (!includeStepUp) return headers;

  const token = createAdminStepUpToken(ADMIN_ID);
  if (!token) throw new Error("admin step-up test token was not created");
  return {
    ...headers,
    cookie: `${ADMIN_STEP_UP_COOKIE}=${token}`,
  };
}

describe("POST /api/admin/enrich/:id/assign", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
    mocks.checkAdminMutationRateLimit.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an authenticated administrator without a signed step-up", async () => {
    const rpc = vi.fn();
    primeAdminBoundary({ rpc });

    const response = await POST(
      new Request(`https://hanbang.ai/api/admin/enrich/${ADMIN_ID}/assign`, {
        method: "POST",
        headers: mutationHeaders(false),
      }),
      { params: Promise.resolve({ id: ADMIN_ID }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.checkAdminMutationRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("assigns through the transactional service-only RPC", async () => {
    const vendorId = "00000000-0000-4000-8000-000000000001";
    const rpc = vi.fn().mockResolvedValue({ error: null });
    primeAdminBoundary({ rpc });

    const response = await POST(
      new Request(`https://hanbang.ai/api/admin/enrich/${vendorId}/assign`, {
        method: "POST",
        headers: mutationHeaders(),
      }),
      { params: Promise.resolve({ id: vendorId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("assign_vendor_enrichment", {
      p_vendor_id: vendorId,
      p_actor_id: ADMIN_ID,
    });
  });
});
