import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PriceDisclosureFooter } from "./PriceDisclosureFooter";
import { PriceEmptyState } from "./PriceEmptyState";
import { PriceVendorCard } from "./PriceVendorCard";
import { AuthGateModal } from "./AuthGateModal";
import { BudgetFinderModal } from "./BudgetFinderModal";
import { AddToComboModal } from "./AddToComboModal";
import { ComboBar } from "./ComboBar";
import { PriceExplorer } from "./PriceExplorer";

describe("consumer price presentation", () => {
  it("introduces the comparison with the exact disclosure title, period badge and scope copy", () => {
    const html = renderToStaticMarkup(
      <PriceExplorer
        category="studio"
        catalog={{
          periodLabel: "2026Q3",
          categories: { studio: [], dress: [], makeup: [], hall: [] },
          counts: { studio: 0, dress: 0, makeup: 0, hall: 0 },
          agencies: [],
        }}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("사진·드레스·메이크업·결혼식장 공시 가격 비교");
    // 소비자 화면의 기준 시점은 확인된 공시 라운드(2025-11)다 — 내부 스냅샷 이름이 아니다.
    expect(html).toContain("2025년 11월 공시 기준");
    expect(html).not.toContain("2026년 3분기");
    expect(html).toContain("가격표시제에 따라 가격을 공개한 업체만 표시됩니다.");
    // 카테고리 nav는 가로 스크롤이 아니라 줄바꿈이다 — 375px에서 네 번째 탭(웨딩홀)이
    // 화면 밖에 놓여 스크롤 힌트도 없이 사라졌던 회귀(`15eca917`) 때문이다.
    // `scrollbar-hide`·`overflow-x-auto`로 되돌리지 말 것.
    expect(html).toContain('class="mt-7 flex flex-wrap gap-2" aria-label="가격 카테고리"');
    expect(html).not.toContain("scrollbar-hide");
    // DB alias는 이전 상호뿐 아니라 띄어쓰기·접미사 차이도 담는다. 검색 힌트가
    // 모든 경우를 정직하게 포괄해야 한다.
    expect(html).toContain('placeholder="업체명 또는 다른 표기 검색"');
    // 비슷한 이름을 자동 병합하면 다른 지점의 가격이 섞인다. 확인된 동일 업체만
    // 합친다는 보수적 신원 경계를 소비자 화면에서도 설명한다.
    expect(html).toContain("이름이 같거나 같은 업체로 확인된 표기는 한 카드로 모았어요.");
    expect(html).toContain("지점·동명 업체로 확인된 표기는 따로 보여드려요.");
  });

  it("renders the required zero-result recovery path and exact disclosure copy", () => {
    const html = renderToStaticMarkup(
      <>
        <PriceEmptyState />
        <PriceDisclosureFooter />
      </>,
    );

    // 2026-07-23: 빈 결과 문구를 "왜 비었는지 + 다음 경로"로 정직화한 계약.
    expect(html).toContain("이 조건에 맞는 공시 업체가 아직 없어요.");
    expect(html).toContain("공시는 업체가 직접 공개한 것만 표시돼요.");
    expect(html).toContain("받은 견적 공유하고 다른 커플 돕기");
    expect(html).toContain("/wedding/community/quote-check");
    expect(html).toContain("가격 출처: 한국소비자원 참가격 · 2025년 11월 공시 기준");
    expect(html).toContain("본 정보는 공시 기준이며 실제 계약 조건·시점에 따라 달라질 수 있습니다. 계약 전 업체에 직접 확인하세요.");
  });

  it("keeps empty-state recovery inside the app surface and preserves preview", () => {
    const html = renderToStaticMarkup(
      <PriceEmptyState category="studio" surface="app" preview />,
    );

    expect(html).toContain("/wedding/vendors?category=dress&amp;preview=1");
    expect(html).not.toContain('href="/price/dress"');
    expect(html).toContain("min-h-11");
  });

  it("shows agency prices, source option text and mandatory-add-on guidance on a card", () => {
    const html = renderToStaticMarkup(
      <PriceVendorCard
        vendor={{
          id: "vendor-sample",
          slug: "sample-studio",
          name: "샘플 스튜디오",
          aliases: ["샘플 옛 상호"],
          category: "studio",
          regionCode: "seoul_etc",
          offers: [{
            id: "offer-sample",
            agencyId: "agency-sample",
            agencyName: "샘플 대행사",
            minimumKrw: 1_000_000,
            maximumKrw: 1_000_000,
            priceNote: "샘플 조건부 원문",
            baseSpec: "샘플 기본 구성",
            options: [{
              id: "option-sample",
              name: "샘플 지정비",
              minimumKrw: 100_000,
              maximumKrw: 100_000,
              unit: null,
              condition: null,
              rawText: "샘플 지정비 10만원",
              isEffectivelyMandatory: true,
            }],
          }],
        }}
        isWishlisted={false}
        onToggleWishlist={() => undefined}
        onOpenCombo={() => undefined}
      />,
    );

    expect(html).toContain("샘플 스튜디오");
    expect(html).toContain("다른 표기 · 샘플 옛 상호");
    expect(html).toContain("샘플 대행사");
    expect(html).toContain("100만원");
    expect(html).toContain("샘플 지정비 10만원");
    expect(html).toContain("사실상 필수");
    expect(html).toContain("+ 조합에 담기");
    expect(html).toContain("/price/vendor/sample-studio");
  });

  it("keeps agency order, drops agencies the vendor lacks and separates direct disclosure", () => {
    const html = renderToStaticMarkup(
      <PriceVendorCard
        vendor={{
          id: "vendor-aligned",
          slug: "aligned-studio",
          name: "정렬 스튜디오",
          aliases: [],
          category: "studio",
          regionCode: null,
          offers: [
            {
              id: "offer-agency-b",
              agencyId: "agency-b",
              agencyName: "대행사 B 원문명",
              minimumKrw: 2_000_000,
              maximumKrw: 2_000_000,
              priceNote: null,
              baseSpec: null,
              options: [],
            },
            {
              id: "offer-direct",
              agencyId: null,
              agencyName: "원문 직접 라벨",
              minimumKrw: 1_500_000,
              maximumKrw: 1_500_000,
              priceNote: null,
              baseSpec: null,
              options: [],
            },
          ],
        }}
        agencyOrder={[
          { id: "agency-a", name: "대행사 A" },
          { id: "agency-b", name: "대행사 B" },
        ]}
        isWishlisted={false}
        onToggleWishlist={() => undefined}
      />,
    );

    // 2026-07-23 회귀: 미보유 대행사(A)는 "—" 컬럼 대신 아예 렌더하지 않는다 —
    // 대시 컬럼이 진짜 가격을 가로 스크롤 밖으로 밀어내던 문제의 계약 반전.
    const agencyB = html.indexOf("대행사 B");
    // 2026-08-07: 라벨을 "업체 직접 공시" → "대행사를 거치지 않은 공시"로 고쳤다.
    // 그 행은 실측상 예식장 공시에서 온 패키지 구성이라 업체가 직접 낸 가격이 아니다.
    const direct = html.indexOf("대행사를 거치지 않은 공시");
    expect(html).not.toContain("대행사 A");
    expect(html).not.toContain("—");
    expect(agencyB).toBeGreaterThan(-1);
    expect(html.slice(agencyB, direct)).toContain("200만원");
    expect(direct).toBeGreaterThan(agencyB);
    expect(html.slice(direct)).toContain("150만원");
    // 2026-07-26: 대행사별 가격은 가로 컬럼이 아니라 세로 목록이다. 병합 뒤에는
    // 한 업체가 대행사 9곳까지 가는데(최소폭 168px × 9 = 1,512px) 375px 화면에서
    // 대부분이 화면 밖으로 밀린다 — 같은 함정을 공시가 탭·커뮤니티 카테고리에서
    // 이미 두 번 고쳤다. 가로 스크롤이 되살아나면 이 테스트가 막는다.
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("grid-flow-col");
    expect(html).toContain("min-w-0");
  });

  it("keeps the default comparison card scoped to agencies that actually offer that vendor", () => {
    const offer = (id: string, agencyId: string, agencyName: string, price: number) => ({
      id,
      agencyId,
      agencyName,
      minimumKrw: price,
      maximumKrw: price,
      priceNote: null,
      baseSpec: null,
      options: [],
    });
    const html = renderToStaticMarkup(
      <PriceExplorer
        category="studio"
        catalog={{
          periodLabel: "2026Q3",
          categories: {
            studio: [
              {
                id: "vendor-a",
                slug: "vendor-a",
                name: "A 보유 업체",
                aliases: [],
                category: "studio",
                regionCode: null,
                offers: [offer("offer-a", "agency-a", "대행사 A", 1_000_000)],
              },
              {
                id: "vendor-b",
                slug: "vendor-b",
                name: "B 전용 업체",
                aliases: [],
                category: "studio",
                regionCode: null,
                offers: [offer("offer-b", "agency-b", "대행사 B", 2_000_000)],
              },
            ],
            dress: [],
            makeup: [],
            hall: [],
          },
          counts: { studio: 2, dress: 0, makeup: 0, hall: 0 },
          agencies: [
            { id: "agency-a", name: "대행사 A" },
            { id: "agency-b", name: "대행사 B" },
          ],
        }}
      />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const comparison = host.querySelector('[aria-label="B 전용 업체 대행사별 공시가"]');

    expect(comparison?.textContent?.replace(/\s+/g, "")).toContain("대행사B200만원");
    expect(comparison?.textContent).not.toContain("대행사 A");
  });

  it("explains the authentication boundary before asking the user to sign in", () => {
    const html = renderToStaticMarkup(
      <AuthGateModal open redirectPath="/price/studio" onClose={() => undefined} />,
    );

    expect(html).toContain("저장하려면 로그인이 필요해요");
    expect(html).toContain("찜과 조합을 저장하고, 가격이 바뀌면 알림을 받아보세요.");
    expect(html).toContain("로그인하고 계속하기");
    expect(html).toContain("/login?redirect=%2Fprice%2Fstudio");
  });

  it("fails closed before putting a backslash network path into the login link", () => {
    const html = renderToStaticMarkup(
      <AuthGateModal
        open
        redirectPath="/\\attacker.example/steal"
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("/login?redirect=%2Fprice%2Fstudio");
    expect(html).not.toContain("attacker.example");
  });

  it("keeps the budget finder honest about published minimum prices", () => {
    const html = renderToStaticMarkup(
      <BudgetFinderModal
        open
        catalog={{ studio: [], dress: [], makeup: [] }}
        agencies={[]}
        onClose={() => undefined}
        onChoose={() => undefined}
      />,
    );

    expect(html).toContain("내 예산으로 조합 찾기");
    expect(html).toContain("공시 최저가 기준의 참고 조합이에요. 옵션·날짜·계약 조건에 따라 실제 금액은 달라질 수 있어요.");
    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
  });

  it("shows all three combo slots and their current total", () => {
    const html = renderToStaticMarkup(
      <ComboBar
        selections={{
          studio: {
            vendorId: "vendor-sample",
            vendorSlug: "sample-studio",
            vendorName: "샘플 스튜디오",
            agencyId: null,
            agencyName: "업체 직접 공시",
            baseKrw: 1_000_000,
            selectedOptions: [],
            customKrw: null,
          },
          dress: null,
          makeup: null,
        }}
        totalKrw={1_000_000}
        onClear={() => undefined}
        onSave={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(html).toContain("사진·드레스·메이크업 조합 · 1/3");
    expect(html).toContain("총 100만원");
    expect(html).toContain("스튜디오");
    expect(html).toContain("드레스");
    expect(html).toContain("메이크업");
    expect(html).toContain("저장");
  });

  it("disables repeat combo saves while one request is in flight", () => {
    const html = renderToStaticMarkup(
      <ComboBar
        selections={{
          studio: {
            vendorId: "vendor-sample",
            vendorSlug: "sample-studio",
            vendorName: "샘플 스튜디오",
            agencyId: null,
            agencyName: "업체 직접 공시",
            baseKrw: 1_000_000,
            selectedOptions: [],
            customKrw: null,
          },
          dress: null,
          makeup: null,
        }}
        totalKrw={1_000_000}
        saving
        onClear={() => undefined}
        onSave={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("저장 중");
  });

  it("fails closed when a hall is offered to the three-slot combo modal", () => {
    const html = renderToStaticMarkup(
      <AddToComboModal
        vendor={{
          id: "hall-sample",
          slug: "sample-hall",
          name: "샘플 웨딩홀",
          aliases: [],
          category: "hall",
          regionCode: "seoul_etc",
          offers: [],
        }}
        onClose={() => undefined}
        onAdd={() => undefined}
      />,
    );

    expect(html).toBe("");
  });
});
