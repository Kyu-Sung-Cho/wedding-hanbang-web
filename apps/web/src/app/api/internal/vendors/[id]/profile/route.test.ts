// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadVendorProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/vendors/vendorProfileData", () => ({
  loadVendorProfile: mocks.loadVendorProfile,
}));

import { GET } from "./route";

const secret = "p".repeat(32);
const vendorId = "123e4567-e89b-42d3-a456-426614174000";

function request(token = secret) {
  return new Request(`https://example.test/api/internal/vendors/${vendorId}/profile`, {
    headers: { "X-Internal-Token": token },
  });
}

function context(id = vendorId) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VENDOR_INTERNAL_TOKEN", secret);
  mocks.createAdminClient.mockReturnValue({ from: vi.fn() });
  mocks.loadVendorProfile.mockResolvedValue({
    vendor: { id: vendorId, slug: "sample", name: "샘플", category: "studio" },
    attributes: {},
    tags: [],
    official_prices: [],
    data_badges: [],
    sources: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/internal/vendors/{id}/profile", () => {
  it("rejects an incorrect internal token before constructing a service client", async () => {
    const response = await GET(request("wrong"), context());

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed vendor id before constructing a service client", async () => {
    const response = await GET(request(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns the complete approved profile with no-store caching", async () => {
    const client = { from: vi.fn() };
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.vendor.id).toBe(vendorId);
    expect(mocks.loadVendorProfile).toHaveBeenCalledWith(client, vendorId);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 for a missing or non-approved vendor", async () => {
    mocks.loadVendorProfile.mockResolvedValue(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Vendor profile not found" });
  });

  it("contains database errors", async () => {
    mocks.loadVendorProfile.mockRejectedValue(new Error("private database detail"));

    const response = await GET(request(), context());
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(raw).toBe('{"error":"Vendor profile unavailable"}');
    expect(raw).not.toContain("private database detail");
  });
});
