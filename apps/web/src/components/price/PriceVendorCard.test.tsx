// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceVendor } from "@/lib/price/catalog";
import { track } from "@/lib/analytics/track";

import { PriceVendorCard } from "./PriceVendorCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

describe("PriceVendorCard", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(track).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("renders every offer when one agency disclosed multiple items", async () => {
    const vendor: PriceVendor = {
      id: "vendor-1",
      slug: "vendor-1",
      name: "복수 공시 예식장",
      aliases: [],
      category: "hall",
      regionCode: "seoul_gangnam3",
      offers: [
        {
          id: "offer-1",
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
          id: "offer-2",
          itemName: "그랜드홀 식대",
          agencyId: "agency-1",
          agencyName: "대행사 하나",
          minimumKrw: 2_000_000,
          maximumKrw: 2_000_000,
          priceNote: null,
          baseSpec: null,
          options: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard
          vendor={vendor}
          isWishlisted={false}
          onToggleWishlist={() => {}}
        />,
      );
    });

    const comparison = container.querySelector('[aria-label="복수 공시 예식장 대행사별 공시가"]');
    expect(comparison?.textContent?.replace(/\s+/g, "")).toContain("100만원");
    expect(comparison?.textContent?.replace(/\s+/g, "")).toContain("200만원");
    expect(comparison?.textContent).toContain("그랜드홀 대관료");
    expect(comparison?.textContent).toContain("그랜드홀 식대");
    expect(container.textContent).toContain("서울 강남권");
  });

  it("renders only the vendor's own agencies when a multi-agency order is given", async () => {
    // 다중 대행사 선택 회귀(2026-07-23): 미보유 대행사를 "—" 컬럼으로 만들면
    // 진짜 가격이 가로 스크롤 밖으로 밀려 "선택했는데 안 보이는" 문제가 된다.
    const vendor: PriceVendor = {
      id: "vendor-2",
      slug: "vendor-2",
      name: "단일 대행 스튜디오",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      offers: [
        {
          id: "offer-b",
          agencyId: "agency-b",
          agencyName: "대행사 비",
          minimumKrw: 1_500_000,
          maximumKrw: 1_500_000,
          priceNote: null,
          baseSpec: null,
          options: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard
          vendor={vendor}
          agencyOrder={[
            { id: "agency-a", name: "대행사 에이" },
            { id: "agency-b", name: "대행사 비" },
          ]}
          isWishlisted={false}
          onToggleWishlist={() => {}}
        />,
      );
    });

    const comparison = container.querySelector('[aria-label="단일 대행 스튜디오 대행사별 공시가"]');
    expect(comparison?.textContent).toContain("대행사 비");
    expect(comparison?.textContent?.replace(/\s+/g, "")).toContain("150만원");
    expect(comparison?.textContent).not.toContain("대행사 에이");
    expect(comparison?.textContent).not.toContain("—");
  });

  it("lazy-loads slim-catalog options when the add-on details opens", async () => {
    // 전송 다이어트 계약(2026-07-23): 목록은 optionCount만 싣고,
    // 본문(원문 인용)은 펼침 시 /api/price/vendor-options로 가져온다.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      options: [{
        id: "opt-1",
        officialPriceId: "offer-slim",
        name: "지연 로드 옵션",
        minimumKrw: 110_000,
        maximumKrw: 110_000,
        unit: null,
        condition: null,
        rawText: "지연 로드 옵션 110,000원",
        isEffectivelyMandatory: false,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    const vendor: PriceVendor = {
      id: "vendor-slim",
      slug: "vendor-slim",
      name: "슬림 카탈로그 스튜디오",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      offers: [{
        id: "offer-slim",
        agencyId: "agency-s",
        agencyName: "대행사 슬림",
        minimumKrw: 1_000_000,
        maximumKrw: 1_000_000,
        priceNote: null,
        baseSpec: null,
        options: [],
        optionCount: 1,
      }],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    expect(container.textContent).toContain("추가금 1개");
    const details = container.querySelector("details")!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
      await Promise.resolve();
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/price/vendor-options?ids=offer-slim");
    expect(container.textContent).toContain("지연 로드 옵션");
    expect(container.textContent).toContain("공시 원문 · 지연 로드 옵션 110,000원");
    vi.unstubAllGlobals();
  });

  it("keeps an admin preview card read-only", async () => {
    const onToggleWishlist = vi.fn();
    const onOpenCombo = vi.fn();
    const vendor: PriceVendor = {
      id: "pending-vendor",
      slug: "pending-vendor",
      name: "검수 전 업체",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      offers: [{
        id: "pending-offer",
        agencyId: null,
        agencyName: "업체 직접 공시",
        minimumKrw: 1_000_000,
        maximumKrw: 1_000_000,
        priceNote: null,
        baseSpec: null,
        options: [{
          id: "pending-option",
          name: "추가 옵션",
          minimumKrw: 100_000,
          maximumKrw: 100_000,
          unit: null,
          condition: null,
          rawText: "",
          isEffectivelyMandatory: false,
        }],
      }],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard
          vendor={vendor}
          isWishlisted={false}
          onToggleWishlist={onToggleWishlist}
          onOpenCombo={onOpenCombo}
          preview
        />,
      );
    });

    expect(container.querySelector('a[href="/wedding/vendors/pending-vendor?preview=1"]'))
      .not.toBeNull();
    expect(container.querySelector('button[aria-label="검수 전 업체 찜하기"]')).toBeNull();
    expect(container.textContent).not.toContain("+ 조합에 담기");
    const details = container.querySelector<HTMLDetailsElement>("details");
    expect(details).not.toBeNull();
    await act(async () => {
      if (details) {
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
      }
      await Promise.resolve();
    });
    expect(track).not.toHaveBeenCalled();
    expect(onToggleWishlist).not.toHaveBeenCalled();
    expect(onOpenCombo).not.toHaveBeenCalled();
  });

  it("shows a policy badge and its sanitized content only when policies exist", async () => {
    const vendor: PriceVendor = {
      id: "policy-vendor",
      slug: "policy-vendor",
      name: "Policy vendor",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      offers: [],
      policies: [{
        id: "policy-1",
        type: "penalty",
        title: null,
        summary: null,
        content: "Cancellation fee applies after booking.",
      }],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard
          vendor={vendor}
          isWishlisted={false}
          onToggleWishlist={() => {}}
          preview
        />,
      );
    });

    expect(container.textContent).toContain("위약금 규정");
    expect(container.textContent).toContain("Cancellation fee applies after booking.");
  });

  it("keeps an explicit region placeholder when the source has no region", async () => {
    const vendor: PriceVendor = {
      id: "unknown-region-vendor",
      slug: "unknown-region-vendor",
      name: "지역 검수 업체",
      aliases: [],
      category: "dress",
      regionCode: null,
      offers: [],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard
          vendor={vendor}
          isWishlisted={false}
          onToggleWishlist={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("지역 미표기");
  });
});
