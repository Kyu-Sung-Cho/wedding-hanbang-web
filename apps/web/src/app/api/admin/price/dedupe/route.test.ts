import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyAdmin: vi.fn(), getServiceClient: vi.fn() }));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET } from "./route";

function queryReturning(data: unknown[]) {
  const limit = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn(() => ({ limit }));
  const secondOrder = vi.fn(() => ({ eq }));
  const firstOrder = vi.fn(() => ({ order: secondOrder }));
  const select = vi.fn(() => ({ order: firstOrder }));
  const from = vi.fn(() => ({ select }));
  mocks.getServiceClient.mockReturnValue({ from });
  return { from, eq };
}

describe("GET /api/admin/price/dedupe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an explicit dedupe entity kind", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });

    const response = await GET(new Request("https://hanbang.ai/api/admin/price/dedupe"));

    expect(response.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("rejects an unknown entity kind before opening the service client", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/dedupe?kind=package",
    ));

    expect(response.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("keeps the vendor candidate queue working with kind=vendor", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const { from } = queryReturning([{
      id: "00000000-0000-4000-8000-000000000001",
      status: "pending",
      similarity: 0.9,
      left_vendor: { id: "00000000-0000-4000-8000-000000000002", name: "샘플 업체 A" },
      right_vendor: { id: "00000000-0000-4000-8000-000000000003", name: "샘플 업체 B" },
    }]);

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/dedupe?kind=vendor&status=pending",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("vendor_dedupe_candidates");
    expect(body.candidates[0].entity_kind).toBe("vendor");
  });

  it("lists same-region agency candidates without exposing source paths", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const { from } = queryReturning([{
      id: "00000000-0000-4000-8000-000000000101",
      status: "pending",
      similarity: 0.94,
      reason: "정규화 이름 유사",
      left_agency: { id: "00000000-0000-4000-8000-000000000102", name: "샘플 광주행복웨딩", normalized_name: "샘플행복웨딩", corporate_name: null, aliases: [], region_code: "gwangju" },
      right_agency: { id: "00000000-0000-4000-8000-000000000103", name: "샘플 행복웨딩", normalized_name: "샘플행복웨딩", corporate_name: null, aliases: [], region_code: "gwangju" },
    }]);

    const response = await GET(new Request(
      "https://hanbang.ai/api/admin/price/dedupe?kind=agency&status=pending",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("agency_dedupe_candidates");
    expect(body.candidates[0]).toMatchObject({ entity_kind: "agency" });
    expect(JSON.stringify(body)).not.toContain("source_file");
  });
});
