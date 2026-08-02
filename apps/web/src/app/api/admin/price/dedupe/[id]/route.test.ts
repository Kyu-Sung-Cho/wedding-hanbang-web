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
import { PATCH } from "./route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000003";
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
    "content-type": "application/json",
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

describe("PATCH /api/admin/price/dedupe/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
    mocks.checkAdminMutationRateLimit.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an authenticated administrator without a signed step-up", async () => {
    const rpc = vi.fn();
    primeAdminBoundary({ rpc });

    const response = await PATCH(new Request(
      "https://hanbang.ai/api/admin/price/dedupe/00000000-0000-4000-8000-000000000001?kind=vendor",
      {
        method: "PATCH",
        headers: mutationHeaders(false),
        body: JSON.stringify({ decision: "different", preserved_vendor_id: null }),
      },
    ), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.checkAdminMutationRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires an explicit entity kind before opening the service client", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000001";
    primeAdminBoundary({ rpc: vi.fn() });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/price/dedupe/${candidateId}`,
      {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({ decision: "different", preserved_vendor_id: null }),
      },
    ), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("delegates a merge decision to the atomic dedupe RPC", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000001";
    const preservedId = "00000000-0000-4000-8000-000000000002";
    const rpc = vi.fn().mockResolvedValue({ error: null });
    primeAdminBoundary({ rpc });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/dedupe/${candidateId}?kind=vendor`, {
      method: "PATCH",
      headers: mutationHeaders(),
      body: JSON.stringify({ decision: "same", preserved_vendor_id: preservedId }),
    }), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("decide_vendor_dedupe_candidate", {
      p_candidate_id: candidateId,
      p_decision: "same",
      p_preserved_vendor_id: preservedId,
      p_decided_by: ADMIN_ID,
    });
  });

  it("delegates an explicit agency merge decision to the agency RPC", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000101";
    const preservedId = "00000000-0000-4000-8000-000000000102";
    const rpc = vi.fn().mockResolvedValue({ error: null });
    primeAdminBoundary({ rpc });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/price/dedupe/${candidateId}?kind=agency`,
      {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({ decision: "same", preserved_agency_id: preservedId }),
      },
    ), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("decide_agency_dedupe_candidate", {
      p_candidate_id: candidateId,
      p_decision: "same",
      p_preserved_agency_id: preservedId,
      p_decided_by: ADMIN_ID,
    });
  });

  it("does not accept a vendor preservation field for an agency decision", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000101";
    const rpc = vi.fn();
    primeAdminBoundary({ rpc });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/price/dedupe/${candidateId}?kind=agency`,
      {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({
          decision: "same",
          preserved_vendor_id: "00000000-0000-4000-8000-000000000102",
        }),
      },
    ), { params: Promise.resolve({ id: candidateId }) });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
