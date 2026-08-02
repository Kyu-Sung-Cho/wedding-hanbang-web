import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkAdminReadRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/admin/adminReadBoundary", () => ({
  checkAdminReadRateLimit: mocks.checkAdminReadRateLimit,
}));

import {
  ADMIN_STEP_UP_COOKIE,
  createAdminStepUpToken,
} from "@/lib/auth/adminStepUp";
import { GET } from "./route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
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

function adminRequest(url: string, includeStepUp = true): Request {
  const headers: Record<string, string> = {};
  if (includeStepUp) {
    const token = createAdminStepUpToken(ADMIN_ID);
    if (!token) throw new Error("admin step-up test token was not created");
    headers.cookie = `${ADMIN_STEP_UP_COOKIE}=${token}`;
  }
  return new Request(url, { headers });
}

function queryReturning(data: unknown[]) {
  const limit = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn(() => ({ limit }));
  const secondOrder = vi.fn(() => ({ eq }));
  const firstOrder = vi.fn(() => ({ order: secondOrder }));
  const select = vi.fn(() => ({ order: firstOrder }));
  const from = vi.fn(() => ({ select }));
  primeAdminBoundary({ from });
  return { from, eq };
}

describe("GET /api/admin/price/dedupe", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
    mocks.checkAdminReadRateLimit.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects an authenticated administrator without a signed step-up", async () => {
    const from = vi.fn();
    primeAdminBoundary({ from });

    const response = await GET(adminRequest(
      "https://hanbang.ai/api/admin/price/dedupe?kind=vendor",
      false,
    ));

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.checkAdminReadRateLimit).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("requires an explicit dedupe entity kind", async () => {
    primeAdminBoundary({ from: vi.fn() });

    const response = await GET(adminRequest("https://hanbang.ai/api/admin/price/dedupe"));

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown entity kind before opening the service client", async () => {
    primeAdminBoundary({ from: vi.fn() });

    const response = await GET(adminRequest(
      "https://hanbang.ai/api/admin/price/dedupe?kind=package",
    ));

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("keeps the vendor candidate queue working with kind=vendor", async () => {
    const { from } = queryReturning([{
      id: "00000000-0000-4000-8000-000000000001",
      status: "pending",
      similarity: 0.9,
      left_vendor: { id: "00000000-0000-4000-8000-000000000002", name: "샘플 업체 A" },
      right_vendor: { id: "00000000-0000-4000-8000-000000000003", name: "샘플 업체 B" },
    }]);

    const response = await GET(adminRequest(
      "https://hanbang.ai/api/admin/price/dedupe?kind=vendor&status=pending",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("vendor_dedupe_candidates");
    expect(body.candidates[0].entity_kind).toBe("vendor");
  });

  it("lists same-region agency candidates without exposing source paths", async () => {
    const { from } = queryReturning([{
      id: "00000000-0000-4000-8000-000000000101",
      status: "pending",
      similarity: 0.94,
      reason: "정규화 이름 유사",
      left_agency: { id: "00000000-0000-4000-8000-000000000102", name: "샘플 광주행복웨딩", normalized_name: "샘플행복웨딩", corporate_name: null, aliases: [], region_code: "gwangju" },
      right_agency: { id: "00000000-0000-4000-8000-000000000103", name: "샘플 행복웨딩", normalized_name: "샘플행복웨딩", corporate_name: null, aliases: [], region_code: "gwangju" },
    }]);

    const response = await GET(adminRequest(
      "https://hanbang.ai/api/admin/price/dedupe?kind=agency&status=pending",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("agency_dedupe_candidates");
    expect(body.candidates[0]).toMatchObject({ entity_kind: "agency" });
    expect(JSON.stringify(body)).not.toContain("source_file");
  });
});
