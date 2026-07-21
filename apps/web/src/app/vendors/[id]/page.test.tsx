import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  loadAdminPreviewVendor: vi.fn(),
  resolveCanonicalVendorDestination: vi.fn(),
  noStore: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));
vi.mock("@/lib/price/adminPreviewData", () => ({
  loadAdminPreviewVendor: mocks.loadAdminPreviewVendor,
}));
vi.mock("@/lib/vendors/canonicalVendorDestination", () => ({
  resolveCanonicalVendorDestination: mocks.resolveCanonicalVendorDestination,
}));

import LegacyVendorDetailPage, { metadata } from "./page";

describe("admin pending vendor detail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails closed before reading pending detail for a non-admin", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    await expect(LegacyVendorDetailPage({
      params: Promise.resolve({ id: "vendor-1" }),
      searchParams: Promise.resolve({ preview: "1" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.loadAdminPreviewVendor).not.toHaveBeenCalled();
    expect(mocks.resolveCanonicalVendorDestination).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("renders a service-only pending profile with preview navigation for an admin", async () => {
    const serviceClient = { boundary: "service-only" };
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    mocks.getServiceClient.mockReturnValue(serviceClient);
    mocks.loadAdminPreviewVendor.mockResolvedValue({
      periodLabel: "2026Q3",
      vendor: {
        id: "vendor-1",
        slug: "pending-hall",
        name: "검수 중 예식장",
        aliases: [],
        category: "hall",
        regionCode: "seoul_gangnam3",
        offers: [
          {
            id: "price-1",
            itemName: "그랜드홀 대관료",
            agencyId: "agency-1",
            agencyName: "대행사 하나",
            minimumKrw: 1_000_000,
            maximumKrw: 1_000_000,
            priceNote: null,
            baseSpec: null,
            options: [],
          },
          {
            id: "price-2",
            itemName: "그랜드홀 식대",
            agencyId: "agency-1",
            agencyName: "대행사 하나",
            minimumKrw: 80_000,
            maximumKrw: 80_000,
            priceNote: null,
            baseSpec: null,
            options: [],
          },
        ],
      },
    });

    const page = await LegacyVendorDetailPage({
      params: Promise.resolve({ id: "vendor-1" }),
      searchParams: Promise.resolve({ preview: "1" }),
    });
    const markup = renderToStaticMarkup(page);

    expect(mocks.loadAdminPreviewVendor).toHaveBeenCalledWith(serviceClient, "vendor-1");
    expect(mocks.resolveCanonicalVendorDestination).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("관리자 전용 미리보기 — 자동 추출·검수 전·정확성 미보장");
    expect(markup).toContain("업체·가격·연결 정보는 자동 추출 결과이며 정확성이 보장되지 않습니다.");
    expect(markup).toContain("자동 추출 가격 (검수 전)");
    expect(markup).toContain("검수 중 예식장");
    expect(markup).toContain("그랜드홀 대관료");
    expect(markup).toContain("그랜드홀 식대");
    expect(markup).toContain("/wedding/vendors?category=hall&amp;preview=1");
    expect(markup).toContain("ph-no-capture");
  });

  it("opts only pending detail out of caching and indexing", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: "admin-id" });
    mocks.getServiceClient.mockReturnValue({ boundary: "service-only" });
    mocks.loadAdminPreviewVendor.mockResolvedValue({
      periodLabel: "2026Q3",
      vendor: {
        id: "vendor-1",
        slug: "pending-studio",
        name: "검수 중 스튜디오",
        aliases: [],
        category: "studio",
        regionCode: null,
        offers: [],
      },
    });

    await LegacyVendorDetailPage({
      params: Promise.resolve({ id: "vendor-1" }),
      searchParams: Promise.resolve({ preview: "1" }),
    });

    expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
    expect(mocks.noStore).toHaveBeenCalledTimes(1);
  });

  it("keeps the ordinary UUID resolver outside the preview auth and no-store branch", async () => {
    mocks.resolveCanonicalVendorDestination.mockResolvedValue("/price/vendor/published-vendor");

    await expect(LegacyVendorDetailPage({
      params: Promise.resolve({ id: "vendor-1" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.resolveCanonicalVendorDestination).toHaveBeenCalledWith("vendor-1");
    expect(mocks.redirect).toHaveBeenCalledWith("/price/vendor/published-vendor");
    expect(mocks.verifyAdmin).not.toHaveBeenCalled();
    expect(mocks.noStore).not.toHaveBeenCalled();
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
    expect(mocks.loadAdminPreviewVendor).not.toHaveBeenCalled();
  });
});
