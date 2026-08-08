import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(() => {
    throw new Error("SUPABASE_CONFIG_MISSING");
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

import VendorPricePage, {
  generateMetadata,
  generateStaticParams,
  resolveRequestedPriceRegion,
} from "./page";

describe("vendor detail preview stub", () => {
  beforeEach(() => {
    mocks.createPublicClient.mockClear();
    mocks.notFound.mockClear();
    vi.stubEnv("CI", "false");
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns no static vendor routes without opening Supabase", async () => {
    await expect(generateStaticParams()).resolves.toEqual([]);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("returns empty metadata without opening Supabase", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({ slug: "preview-vendor" }),
    })).resolves.toEqual({});
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("resolves the preview page as not found without opening Supabase", async () => {
    await expect(VendorPricePage({
      params: Promise.resolve({ slug: "preview-vendor" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("keeps missing Supabase configuration fail-fast outside preview stub mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "false");

    await expect(generateStaticParams()).rejects.toThrow("SUPABASE_CONFIG_MISSING");
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
  });

  it("keeps only a supported region that belongs to the merged vendor", () => {
    const available = ["seoul_gangnam3", "gangwon"];

    expect(resolveRequestedPriceRegion("gangwon", available)).toBe("gangwon");
    expect(resolveRequestedPriceRegion("busan", available)).toBeNull();
    expect(resolveRequestedPriceRegion("not-a-region", available)).toBeNull();
    expect(resolveRequestedPriceRegion(["gangwon"], available)).toBeNull();
    expect(resolveRequestedPriceRegion(undefined, available)).toBeNull();
  });
});
