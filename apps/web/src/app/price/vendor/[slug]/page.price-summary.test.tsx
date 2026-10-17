// @vitest-environment node

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const images: ReactElement[] = [];
  return { loadProfile: vi.fn(), images };
});

vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({}) }));
vi.mock("@/lib/vendors/publicVendorPriceData", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/vendors/publicVendorPriceData")>(),
  loadPublicVendorPriceProfile: mocks.loadProfile,
}));
vi.mock("next/og", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/og")>();
  class CapturingImageResponse extends actual.ImageResponse {
    constructor(element: ReactElement, options: ConstructorParameters<typeof actual.ImageResponse>[1]) {
      mocks.images.push(element);
      super(element, options);
    }
  }
  return { ...actual, ImageResponse: CapturingImageResponse };
});

import { assemblePublicVendorPriceProfile } from "@/lib/vendors/publicVendorPriceData";
import { generateMetadata } from "./page";
import OpenGraphImage from "./opengraph-image";

function publicProfile(category = "hall") {
  const isHall = category === "hall" || category === "venue";
  return assemblePublicVendorPriceProfile({
    id: "qa-vendor", slug: "qa-vendor", name: "QA 공시 업체", category,
    region_code: "seoul_etc", aliases: [], official_url: null, instagram_url: null,
    naver_place_url: null, attributes: {}, tags: [],
  }, [
    { id: "meal", period_label: "2026Q3", price_category: category, item_name: isHall ? "뷔페 식대" : "기본 상품 A",
      base_spec: null, price_min_krw: isHall ? 57_000 : 1_000_000, price_max_krw: isHall ? 57_000 : 1_000_000, vat_note: null,
      price_note: isHall ? "1인 기준" : null, source_label: "한국소비자원 참가격 · 2026Q3", is_current: true },
    { id: "rental", period_label: "2026Q3", price_category: category, item_name: isHall ? "대관료" : "기본 상품 B",
      base_spec: null, price_min_krw: isHall ? 3_300_000 : 2_000_000, price_max_krw: isHall ? 3_300_000 : 2_000_000, vat_note: null,
      price_note: isHall ? "예식 1회 기준" : null, source_label: "한국소비자원 참가격 · 2026Q3", is_current: true },
  ], []);
}

async function shareImageText() {
  const response = await OpenGraphImage({ params: Promise.resolve({ slug: "qa-vendor" }) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(response.headers.get("content-type")).toContain("image/png");
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const element = mocks.images.at(-1);
  if (!element) throw new Error("Expected the actual vendor share image JSX");
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  mocks.loadProfile.mockReset();
  mocks.images.splice(0);
  mocks.loadProfile.mockResolvedValue(publicProfile());
  vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("vendor detail price metadata and share image", () => {
  it("does not advertise a meal-to-rental range in the actual hall metadata", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "qa-vendor" }) });
    expect(metadata.description).toContain("항목별 공시 확인");
    expect(metadata.openGraph?.description).toContain("항목별 공시 확인");
    expect(JSON.stringify(metadata)).not.toContain("5.7~330만원");
    expect(metadata.alternates?.canonical).toBe("/price/vendor/qa-vendor");
  });

  it("renders the actual hall PNG with item guidance instead of the mixed-unit range", async () => {
    const html = await shareImageText();
    expect(html).toContain("항목별 공시 확인");
    expect(html).not.toContain("5.7~330만원");
  }, 60_000);

  it("uses the established public disclosure round instead of the internal snapshot label in the PNG", async () => {
    const html = await shareImageText();
    expect(html).toContain("2025년 11월");
    expect(html).not.toContain("2026Q3");
  }, 60_000);

  it.each(["studio", "dress", "makeup"])("preserves %s metadata and PNG price ranges", async (category) => {
    mocks.loadProfile.mockResolvedValue(publicProfile(category));
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "qa-vendor" }) });
    const html = await shareImageText();
    expect(metadata.description).toContain("100~200만원");
    expect(metadata.openGraph?.description).toContain("100~200만원");
    expect(html).toContain("100~200만원");
    expect(html).toContain("2025년 11월");
    expect(html).not.toContain("항목별 공시 확인");
  }, 60_000);

  it.each([
    { minimum: null, maximum: 1_000_000, expected: "최대 100만원" },
    { minimum: 1_000_000, maximum: null, expected: "100만원부터" },
  ])("preserves a non-hall price bound: $expected", async ({ minimum, maximum, expected }) => {
    const profile = publicProfile("studio");
    profile.prices = [{ ...profile.prices[0], price_min_krw: minimum, price_max_krw: maximum }];
    mocks.loadProfile.mockResolvedValue(profile);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "qa-vendor" }) });
    expect(metadata.description).toContain(expected);
    expect(await shareImageText()).toContain(expected);
  }, 60_000);

  it("does not infer a per-person unit when the hall item name is unknown", async () => {
    const profile = publicProfile("venue");
    profile.prices = [{ ...profile.prices[0], item_name: "미분류 항목", price_note: null,
      price_min_krw: null, price_max_krw: 1_000_000 }];
    mocks.loadProfile.mockResolvedValue(profile);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "qa-vendor" }) });
    const html = await shareImageText();
    expect(metadata.description).toContain("항목별 공시 확인");
    expect(html).toContain("항목별 공시 확인");
    expect(html).not.toContain("1인");
    expect(html).not.toContain("최대 100만원");
  }, 60_000);

  it("keeps an unpriced hall unknown even when an option is disclosed", async () => {
    const profile = publicProfile();
    profile.prices = [{ ...profile.prices[0], price_min_krw: null, price_max_krw: null,
      options: [{ id: "option", official_price_id: "meal", name: "선택 옵션", price_min_krw: 100_000,
        price_max_krw: 100_000, unit: "1회", condition: null, raw_text: "선택 옵션 10만원",
        is_effectively_mandatory: false, sort_order: 0 }] }];
    mocks.loadProfile.mockResolvedValue(profile);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "qa-vendor" }) });
    const html = await shareImageText();
    expect(metadata.description).toContain("가격 확인 필요");
    expect(html).toContain("가격 확인 필요");
    expect(html).not.toContain("항목별 공시 확인");
    expect(html).not.toContain("10만원");
  }, 60_000);

  it("does not advertise historical-only prices as current metadata or an image range", async () => {
    const profile = publicProfile();
    profile.prices = profile.prices.map((price) => ({ ...price, is_current: false }));
    mocks.loadProfile.mockResolvedValue(profile);
    await expect(generateMetadata({ params: Promise.resolve({ slug: "qa-vendor" }) })).resolves.toEqual({});
    const html = await shareImageText();
    expect(html).toContain("가격 확인 필요");
    expect(html).not.toContain("항목별 공시 확인");
    expect(html).not.toContain("2026Q3");
    expect(html).not.toContain("2025년 11월");
  }, 60_000);

  it("keeps a missing vendor on the existing unknown-price image fallback", async () => {
    mocks.loadProfile.mockResolvedValue(null);
    await expect(generateMetadata({ params: Promise.resolve({ slug: "qa-vendor" }) })).resolves.toEqual({});
    const html = await shareImageText();
    expect(html).toContain("가격 확인 필요");
    expect(html).not.toContain("항목별 공시 확인");
    expect(html).not.toContain("2025년 11월");
  }, 60_000);
});
