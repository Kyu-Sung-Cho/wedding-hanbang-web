// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  createRepository: vi.fn(),
  persistEvidence: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("@/lib/admin/priceUploadSupabase", () => ({
  createSupabasePriceUploadRepository: mocks.createRepository,
}));

vi.mock("@/lib/admin/priceUploadEvidence", () => ({
  persistAdminJsonEvidence: mocks.persistEvidence,
}));

import { POST } from "./route";

describe("POST /api/admin/price/upload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-admin requests before constructing a service client", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await POST(new Request("https://example.test/api/admin/price/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("returns bounded Zod issues for an invalid upload without writing", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });

    const response = await POST(new Request("https://example.test/api/admin/price/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period_label: "2026Q3", entries: [] }),
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid price upload");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues.length).toBeLessThanOrEqual(20);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("rejects duplicate logical price rows before evidence or database writes", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    const price = {
      agency_slug: "sample-agency-a",
      price_min_krw: 1_000_000,
      price_max_krw: 1_200_000,
      price_note: null,
      base_spec: "Base package",
      options: [],
    };

    const response = await POST(new Request("https://example.test/api/admin/price/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        period_label: "2026Q3",
        source: "mixed",
        source_note: "operator upload",
        collected_at: "2026-07-18",
        entries: [{
          vendor_name: "Sample Studio A",
          category: "studio",
          region_code: "seoul_gangnam3",
          aliases: [],
          prices: [price, price],
        }],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.persistEvidence).not.toHaveBeenCalled();
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("rejects an over-budget entry count before evidence or database writes", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    const entry = {
      vendor_name: "Sample Studio",
      category: "studio",
      region_code: "seoul_gangnam3",
      aliases: [],
      prices: [{
        agency_slug: "sample-agency-a",
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        price_note: null,
        base_spec: "Base package",
        options: [],
      }],
    };
    const response = await POST(new Request("https://example.test/api/admin/price/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        period_label: "2026Q3",
        source: "mixed",
        source_note: "operator upload",
        collected_at: "2026-07-18",
        entries: Array.from({ length: 51 }, (_, index) => ({
          ...entry,
          vendor_name: `Sample Studio ${index}`,
        })),
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.persistEvidence).not.toHaveBeenCalled();
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("returns the matching and staging report for a valid upload", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    const client = { service: true };
    mocks.getServiceClient.mockReturnValue(client);
    mocks.persistEvidence.mockResolvedValue({
      bytes: 1_024,
      objectKey: `${"a".repeat(64)}.json`,
      sha256: "a".repeat(64),
    });
    mocks.createRepository.mockReturnValue({
      findAgencies: async () => [{ id: "agency-1", slug: "sample-agency-a" }],
      findVendorCandidatesBatch: async () => [{
        entryIndex: 0,
        candidates: [{
          vendorId: "vendor-1",
          vendorName: "샘플스튜디오가",
          vendorSlug: "sample-studio-a",
          aliases: [],
          similarity: 1,
          matchKind: "exact_name",
        }],
      }],
      commitUpload: async () => ({
        snapshot_id: "snapshot-1",
        counts: {
          auto_matched: 1,
          newly_created: 0,
          needs_confirmation: 0,
          errors: 0,
          staged_prices: 1,
        },
        details: {
          auto_matched: [{
            entry_index: 0,
            vendor_id: "vendor-1",
            vendor_name: "Sample Studio A",
          }],
          newly_created: [],
          needs_confirmation: [],
          errors: [],
        },
      }),
    });
    const response = await POST(new Request("https://example.test/api/admin/price/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        period_label: "2026Q3",
        source: "mixed",
        source_note: "수동 공시 자료",
        collected_at: "2026-07-18",
        entries: [{
          vendor_name: "샘플스튜디오가",
          category: "studio",
          region_code: "seoul_gangnam3",
          aliases: [],
          prices: [{
            agency_slug: "sample-agency-a",
            price_min_krw: 1_000_000,
            price_max_krw: 1_200_000,
            price_note: null,
            base_spec: "샘플 기본 구성",
            options: [],
          }],
        }],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      snapshot_id: "snapshot-1",
      counts: { auto_matched: 1, staged_prices: 1, errors: 0 },
    });
    expect(mocks.createRepository).toHaveBeenCalledWith(client);
    expect(mocks.persistEvidence).toHaveBeenCalledWith(client, expect.stringContaining("mixed"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not stage anything when immutable evidence storage fails", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    mocks.getServiceClient.mockReturnValue({ service: true });
    mocks.persistEvidence.mockRejectedValue(new Error("PRICE_UPLOAD_EVIDENCE_STORE_FAILED"));
    const response = await POST(new Request("https://example.test/api/admin/price/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        period_label: "2026Q3",
        source: "kca_tprice",
        source_note: "샘플 수동 업로드",
        collected_at: "2026-07-18",
        entries: [{
          vendor_name: "샘플스튜디오A",
          category: "studio",
          region_code: "seoul_gangnam3",
          aliases: [],
          prices: [{
            agency_slug: "sample-agency-a",
            price_min_krw: 1_000_000,
            price_max_krw: 1_000_000,
            price_note: null,
            base_spec: "샘플 기본 구성",
            options: [],
          }],
        }],
      }),
    }));

    expect(response.status).toBe(500);
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized upload before constructing a service client", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-1" });
    const request = new Request("https://example.test/api/admin/price/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 1),
      },
      body: "{}",
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });
});
