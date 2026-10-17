// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceOffer, PriceVendor } from "@/lib/price/catalog";
import { track } from "@/lib/analytics/track";

import { PriceVendorCard } from "./PriceVendorCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

function disclosureOffer(overrides: Partial<PriceOffer> = {}): PriceOffer {
  return {
    id: "qa-offer", agencyId: null, agencyName: "업체 직접 공시",
    minimumKrw: 57_000, maximumKrw: 57_000,
    priceNote: null, baseSpec: null, options: [], ...overrides,
  };
}

function disclosureVendor(category: PriceVendor["category"], offers: PriceOffer[]): PriceVendor {
  return {
    id: "qa-vendor", slug: "qa-vendor", name: "QA 공시 업체", aliases: [],
    category, regionCode: "seoul_etc", offers,
  };
}

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

  it("keeps meal and venue rental prices separate instead of presenting them as one hall price range", async () => {
    const vendor: PriceVendor = {
      id: "hall-mixed-units",
      slug: "hall-mixed-units",
      name: "QA 항목별 공시 예식장",
      aliases: [],
      category: "hall",
      regionCode: "seoul_etc",
      offers: [
        {
          id: "hall-food",
          itemName: "뷔페 식대",
          agencyId: null,
          agencyName: "업체 직접 공시",
          minimumKrw: 57_000,
          maximumKrw: 57_000,
          priceNote: "1인 기준",
          baseSpec: null,
          options: [],
        },
        {
          id: "hall-rental",
          itemName: "대관료",
          agencyId: null,
          agencyName: "업체 직접 공시",
          minimumKrw: 3_300_000,
          maximumKrw: 3_300_000,
          priceNote: "예식 1회 기준",
          baseSpec: null,
          options: [],
        },
      ],
    };
    await act(async () => root.render(
      <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
    ));
    const summary = container.querySelector('[aria-label="QA 항목별 공시 예식장 공시 가격 요약"]');
    expect(summary?.textContent).toContain("항목별 공시 확인");
    expect(summary?.textContent).not.toContain("5.7~330만원");
    const breakdown = container.querySelector<HTMLDetailsElement>('details[data-price-breakdown="true"]');
    expect(breakdown).not.toBeNull();
    await act(async () => { if (breakdown) breakdown.open = true; });
    expect(breakdown?.textContent).toContain("뷔페 식대");
    expect(breakdown?.textContent).toContain("5.7만원");
    expect(breakdown?.textContent).toContain("1인 기준");
    expect(breakdown?.textContent).toContain("대관료");
    expect(breakdown?.textContent).toContain("330만원");
    expect(breakdown?.textContent).toContain("예식 1회 기준");
  });

  it("does not merge hall units in the agency comparison either", async () => {
    const vendor = disclosureVendor("hall", [
      disclosureOffer({ id: "food", agencyId: "agency-1", agencyName: "대행사 A", itemName: "식대" }),
      disclosureOffer({ id: "rental", agencyId: "agency-2", agencyName: "대행사 B", itemName: "대관료", minimumKrw: 3_300_000, maximumKrw: 3_300_000 }),
    ]);
    await act(async () => root.render(
      <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
    ));
    const agency = container.querySelector('[aria-label="QA 공시 업체 대행사별 공시가"]');
    expect(agency?.textContent).toContain("항목별 공시 확인");
    expect(agency?.textContent).toContain("대행사 2곳");
    expect(agency?.textContent).toContain("식대");
    expect(agency?.textContent).toContain("대관료");
    expect(agency?.textContent).toContain("5.7만원");
    expect(agency?.textContent).toContain("330만원");
    expect(container.textContent).not.toContain("5.7~330만원");
  });

  it.each([{ offers: [] }, { offers: [disclosureOffer({ minimumKrw: null, maximumKrw: null })] }])(
    "keeps an unpriced hall unknown instead of claiming an item price: %j", async ({ offers }) => {
      await act(async () => root.render(
        <PriceVendorCard vendor={disclosureVendor("hall", offers)} isWishlisted={false} onToggleWishlist={() => {}} />,
      ));
      const summary = container.querySelector('[aria-label="QA 공시 업체 공시 가격 요약"]');
      expect(summary?.textContent).toContain("가격 확인 필요");
      expect(summary?.textContent).not.toContain("항목별 공시 확인");
    },
  );

  it("preserves an option-only hall disclosure and its source text", async () => {
    const vendor = disclosureVendor("hall", [disclosureOffer({
      minimumKrw: null, maximumKrw: null,
      options: [{ id: "option", name: "QA 선택 옵션", minimumKrw: 100_000, maximumKrw: 100_000,
        unit: "1회", condition: "선택 시", rawText: "QA 선택 옵션 10만원", isEffectivelyMandatory: false }],
    })]);
    await act(async () => root.render(
      <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
    ));
    const summary = container.querySelector('[aria-label="QA 공시 업체 공시 가격 요약"]');
    expect(summary?.textContent).toContain("추가금 1개 공시");
    expect(summary?.textContent).not.toContain("항목별 공시 확인");
    expect(container.textContent).toContain("QA 선택 옵션 10만원");
    expect(container.textContent).toContain("선택 시");
  });

  it.each([
    { category: "studio", minimumKrw: 1_000_000, maximumKrw: 2_000_000, expected: "100~200만원" },
    { category: "dress", minimumKrw: null, maximumKrw: 1_000_000, expected: "최대 100만원" },
    { category: "makeup", minimumKrw: 1_000_000, maximumKrw: null, expected: "100만원부터" },
  ] as const)("preserves the normal $category price direction", async ({ category, minimumKrw, maximumKrw, expected }) => {
    await act(async () => root.render(
      <PriceVendorCard vendor={disclosureVendor(category, [disclosureOffer({ minimumKrw, maximumKrw })])}
        isWishlisted={false} onToggleWishlist={() => {}} />,
    ));
    const summary = container.querySelector('[aria-label="QA 공시 업체 공시 가격 요약"]');
    expect(summary?.textContent).toContain(expected);
    expect(summary?.textContent).not.toContain("항목별 공시 확인");
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
    const details = container.querySelector<HTMLDetailsElement>(
      'details[data-add-on-breakdown="true"]',
    )!;
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

  it("keeps a fixed header while long names and aliases remain recoverable", async () => {
    const longName = "LongUnbrokenVendorNameWithoutAnyNaturalWrapOpportunity1234567890";
    const longAlias = "LongUnbrokenAlternateLabelWithoutAnyNaturalWrapOpportunity0987654321";
    const vendor: PriceVendor = {
      id: "long-header-vendor",
      slug: "long-header-vendor",
      name: longName,
      aliases: [longAlias],
      category: "studio",
      regionCode: "seoul_etc",
      regionCodes: ["seoul_etc", "seoul_gangnam3", "busan"],
      offers: [],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    const header = container.querySelector<HTMLElement>('[data-card-header="true"]');
    const nameLink = container.querySelector<HTMLAnchorElement>(`a[title="${longName}"]`);
    const alias = container.querySelector<HTMLElement>('[data-card-alias="true"]');
    expect(header?.className).toContain("h-32");
    expect(header?.className).toContain("overflow-hidden");
    expect(nameLink?.className).toContain("line-clamp-2");
    expect(nameLink?.className).toContain("[overflow-wrap:anywhere]");
    expect(alias?.className).toContain("min-h-4");
    expect(alias?.className).toContain("truncate");
    expect(alias?.getAttribute("title")).toBe(`다른 표기 · ${longAlias}`);

    const denseHeaderClassName = header?.className;
    await act(async () => {
      root.render(
        <PriceVendorCard
          vendor={{ ...vendor, name: "짧은 이름", aliases: [], regionCodes: undefined }}
          isWishlisted={false}
          onToggleWishlist={() => {}}
        />,
      );
    });

    const sparseHeader = container.querySelector<HTMLElement>('[data-card-header="true"]');
    const emptyAlias = container.querySelector<HTMLElement>('[data-card-alias="true"]');
    expect(sparseHeader?.className).toBe(denseHeaderClassName);
    expect(emptyAlias).not.toBeNull();
    expect(emptyAlias?.textContent).toBe("");
  });

  it("접어서 보여주고 펼치면 대행사 전부가 나온다", async () => {
    // 병합 뒤 한 업체가 대행사 9곳까지 간다. 전부 세우면 카드가 너무 길고,
    // 가로 컬럼으로 되돌리면 375px에서 대부분이 화면 밖으로 밀린다.
    // 기본은 싼 곳 3개만, 나머지는 버튼으로 펼친다.
    const vendor: PriceVendor = {
      id: "vendor-many",
      slug: "vendor-many",
      name: "다대행 스튜디오",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      regionCodes: ["seoul_etc", "seoul_gangnam3"],
      offers: ["가", "나", "다", "라", "마"].map((label, index) => ({
        id: `offer-${index}`,
        agencyId: `agency-${index}`,
        agencyName: `대행사 ${label}`,
        // 일부러 역순으로 넣어 싼 곳이 위로 올라오는지 본다.
        minimumKrw: (5 - index) * 1_000_000,
        maximumKrw: (5 - index) * 1_000_000,
        priceNote: null,
        baseSpec: null,
        options: [],
      })),
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    // 첫 지역만 배지로 두고 나머지는 개수로 접지만, 전체 지역 의미는
    // 스크린리더 이름과 툴팁에 그대로 남긴다.
    const regions = container.querySelector<HTMLElement>('[data-card-regions="true"]');
    expect(regions?.children[0]?.textContent).toBe("서울 강남 외");
    expect(regions?.children[1]?.textContent).toBe("외 1곳");
    expect(regions?.textContent).not.toContain("서울 강남권");
    expect(regions?.getAttribute("aria-label")).toBe(
      "공시 지역: 서울 강남 외, 서울 강남권",
    );
    expect(regions?.getAttribute("title")).toBe("서울 강남 외, 서울 강남권");
    // 가격 폭이 먼저 보인다.
    expect(container.textContent).toContain("대행사 5곳");
    // 기본은 3곳만, 가장 싼 "대행사 마"(100만원)가 먼저.
    expect(container.textContent).toContain("대행사 마");
    expect(container.textContent).not.toContain("대행사 가");
    const toggle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("더 보기"));
    expect(toggle?.textContent).toContain("2곳 더 보기");

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("대행사 가");
  });

  it("keeps information-heavy and sparse cards on the same compact collapsed structure", async () => {
    const vendor: PriceVendor = {
      id: "vendor-compact",
      slug: "vendor-compact",
      name: "정보량 비교 스튜디오",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      offers: ["가", "나", "다"].map((label, index) => ({
        id: `compact-offer-${index}`,
        agencyId: `compact-agency-${index}`,
        agencyName: `대행사 ${label}`,
        minimumKrw: (index + 1) * 1_000_000,
        maximumKrw: (index + 1) * 1_000_000,
        priceNote: `${label} 대행사의 아주 긴 구성 설명`.repeat(20),
        baseSpec: null,
        options: [],
      })),
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    expect(container.querySelector("article")?.className).toContain("flex");
    expect(container.querySelector("article")?.className).not.toContain("h-full");
    const compactSummary = container.querySelector<HTMLElement>(
      '[aria-label="정보량 비교 스튜디오 공시 가격 요약"]',
    );
    expect(compactSummary?.textContent).toContain("100~300만원");
    expect(compactSummary?.className).toContain("h-28");
    expect(container.textContent).toContain("대행사 3곳 공시");

    const priceDetails = container.querySelector<HTMLDetailsElement>(
      'details[data-price-breakdown="true"]',
    );
    expect(priceDetails).not.toBeNull();
    expect(priceDetails?.open).toBe(false);
    expect(priceDetails?.textContent).toContain("가격 항목 3개 보기");
    expect(priceDetails?.textContent).toContain("아주 긴 구성 설명");
    expect(container.querySelector('[data-card-actions="true"]')?.className).toContain("mt-auto");
  });

  it("preserves a hall upper bound in its item without guessing the unspecified unit", async () => {
    const vendor: PriceVendor = {
      id: "vendor-upper-bound",
      slug: "vendor-upper-bound",
      name: "상한가 공시 업체",
      aliases: [],
      category: "hall",
      regionCode: "busan",
      offers: [{
        id: "offer-upper-bound",
        agencyId: null,
        agencyName: "업체 직접 공시",
        minimumKrw: null,
        maximumKrw: 1_000_000,
        priceNote: null,
        baseSpec: null,
        options: [],
      }],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    const summary = container.querySelector('[role="group"][aria-label="상한가 공시 업체 공시 가격 요약"]');
    expect(summary?.textContent).toContain("항목별 공시 확인");
    expect(summary?.textContent).not.toContain("1인");
    expect(container.querySelector('details[data-price-breakdown="true"]')?.textContent).toContain("최대 100만원");
  });

  it("separates agency prices from a direct disclosure while summarizing both paths", async () => {
    const vendor: PriceVendor = {
      id: "vendor-mixed-source",
      slug: "vendor-mixed-source",
      name: "혼합 경로 공시 업체",
      aliases: [],
      category: "studio",
      regionCode: "seoul_gangnam3",
      offers: [
        {
          id: "offer-agency-a",
          agencyId: "agency-a",
          agencyName: "대행사 A",
          minimumKrw: 1_000_000,
          maximumKrw: 1_000_000,
          priceNote: null,
          baseSpec: null,
          options: [],
        },
        {
          id: "offer-agency-b",
          agencyId: "agency-b",
          agencyName: "대행사 B",
          minimumKrw: 2_000_000,
          maximumKrw: 2_000_000,
          priceNote: null,
          baseSpec: null,
          options: [],
        },
        {
          id: "offer-direct",
          agencyId: null,
          agencyName: "업체 직접 공시",
          minimumKrw: 5_000_000,
          maximumKrw: 5_000_000,
          priceNote: null,
          baseSpec: null,
          options: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    const summary = container.querySelector('[role="group"][aria-label="혼합 경로 공시 업체 공시 가격 요약"]');
    // 요약은 대행사 오퍼(100~200만)만으로 만든다. 이 단언은 한동안 "100~500만원"이었고,
    // 그 500만은 대행사를 거치지 않은 행에서 왔다 — 예식장 패키지처럼 기준이 다른
    // 행을 같은 범위에 넣으면 실제로 살 수 없는 상한이 만들어진다. 그 행은 아래
    // "대행사를 거치지 않은 공시" 블록에 원문 그대로 남는다.
    expect(summary?.textContent).toContain("100~200만원");
    expect(summary?.textContent).toContain("대행사 2곳 + 직접 공시");

    const agencyBreakdown = container.querySelector(
      '[aria-label="혼합 경로 공시 업체 대행사별 공시가"]',
    );
    expect(agencyBreakdown?.textContent).toContain("100~200만원");
    expect(agencyBreakdown?.textContent).not.toContain("500만원");
  });

  it("labels merged spellings as alternate labels instead of claiming they are former names", async () => {
    const vendor: PriceVendor = {
      id: "vendor-alias",
      slug: "vendor-alias",
      name: "가을",
      aliases: ["가을스튜디오"],
      category: "studio",
      regionCode: "seoul_gangnam3",
      offers: [],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    expect(container.textContent).toContain("다른 표기 · 가을스튜디오");
    expect(container.textContent).not.toContain("구. 가을스튜디오");
  });

  it("states a missing add-on disclosure without claiming that add-ons do not exist", async () => {
    const vendor: PriceVendor = {
      id: "vendor-no-options",
      slug: "vendor-no-options",
      name: "추가금 미공시 스튜디오",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      offers: [{
        id: "offer-no-options",
        agencyId: "agency-no-options",
        agencyName: "대행사 없음표시",
        minimumKrw: 1_000_000,
        maximumKrw: 1_000_000,
        priceNote: null,
        baseSpec: null,
        options: [],
      }],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    expect(container.textContent).toContain("추가금 공시 항목 없음");
    expect(container.textContent).toContain("추가금이 없다는 뜻은 아니에요");
  });

  it("adds the active region to both detail links without changing the canonical default", async () => {
    const vendor: PriceVendor = {
      id: "vendor-region-link",
      slug: "vendor-region-link",
      name: "지역 링크 스튜디오",
      aliases: [],
      category: "studio",
      regionCode: "seoul_etc",
      regionCodes: ["seoul_etc", "busan"],
      offers: [],
    };

    await act(async () => {
      root.render(
        <PriceVendorCard vendor={vendor} isWishlisted={false} onToggleWishlist={() => {}} />,
      );
    });

    const canonicalLinks = container.querySelectorAll<HTMLAnchorElement>(
      'a[href="/price/vendor/vendor-region-link"]',
    );
    expect(canonicalLinks).toHaveLength(2);

    await act(async () => {
      root.render(
        <PriceVendorCard
          vendor={vendor}
          activeRegionCode="busan"
          isWishlisted={false}
          onToggleWishlist={() => {}}
        />,
      );
    });

    const regionalLinks = container.querySelectorAll<HTMLAnchorElement>(
      'a[href="/price/vendor/vendor-region-link?region=busan"]',
    );
    expect(regionalLinks).toHaveLength(2);
    expect(container.querySelector('a[href="/price/vendor/vendor-region-link"]')).toBeNull();
  });
});
