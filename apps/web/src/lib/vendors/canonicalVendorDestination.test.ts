import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

import { resolveCanonicalVendorDestination } from "./canonicalVendorDestination";

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  return chain;
}

describe("resolveCanonicalVendorDestination", () => {
  beforeEach(() => mocks.createPublicClient.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("resolves a published UUID through the public official-price view", async () => {
    const from = vi.fn((table: string) => {
      if (table === "v_public_official_prices") {
        return query({ data: { vendor_slug: "studio & one", vendor_category: "studio" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.createPublicClient.mockReturnValue({ from });

    await expect(resolveCanonicalVendorDestination(VENDOR_ID))
      .resolves.toBe("/price/vendor/studio%20%26%20one");
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("falls back only to the approved public category when no price is published", async () => {
    const from = vi.fn((table: string) => {
      if (table === "v_public_official_prices") return query({ data: null, error: null });
      if (table === "v_public_vendors") return query({ data: { category: "venue" }, error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.createPublicClient.mockReturnValue({ from });

    await expect(resolveCanonicalVendorDestination(VENDOR_ID)).resolves.toBe("/price/hall");
  });

  it("rejects malformed IDs before creating any database client", async () => {
    await expect(resolveCanonicalVendorDestination("not-a-uuid")).resolves.toBe("/price/studio");
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("keeps legacy UUID links safe and Supabase-free in Preview stub mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");

    await expect(resolveCanonicalVendorDestination(VENDOR_ID)).resolves.toBe("/price/studio");
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("fails closed when a public resolver view is unavailable", async () => {
    mocks.createPublicClient.mockReturnValue({
      from: () => query({ data: null, error: { message: "unavailable" } }),
    });

    await expect(resolveCanonicalVendorDestination(VENDOR_ID))
      .rejects.toThrow("LEGACY_VENDOR_DESTINATION_UNAVAILABLE");
  });
});
