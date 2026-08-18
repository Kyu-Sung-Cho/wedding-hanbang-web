import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "@/types/database.types";
import VendorToolCard from "./VendorToolCard";

const source = readFileSync(
  resolve(process.cwd(), "src/components/app/chat/VendorToolCard.tsx"),
  "utf8",
);

function render(result: ToolExecutionResult) {
  return renderToStaticMarkup(<VendorToolCard result={result} />);
}

describe("VendorToolCard source disclosure", () => {
  it("revalidates official public information and shows checked date, relationship, and limitation", () => {
    expect(source).toContain("parseAmoraSourceDisclosure");
    expect(source).toContain("업체 공개정보의 출처 표시를 확인하지 못했어요");
    expect(source).toContain("sourceDisclosure.badgeLabel");
    expect(source).toContain("sourceDisclosure.commercialRelationshipLabel");
    expect(source).toContain("sourceDisclosure.checkedAtLabel");
    expect(source).toContain("sourceDisclosure.limitation");
  });
});

describe("VendorToolCard booking projection state", () => {
  it("scopes every booking-card cancellation prompt to the Amora record", () => {
    expect(source).toContain("아모라 예약 요청 기록을 취소로 표시해줘");
    expect(source).toContain("아모라 안 기록만 취소로 표시할까요? 업체 취소는 별도예요.");
    expect(source).toContain("기록 취소 표시");
    expect(source).not.toContain("예약 취소해줘");
    expect(source).not.toContain("예약을 취소할까요?");
  });

  it("labels the request amount as a quote while schedule projection retries", () => {
    const html = render({
      toolName: "create_booking",
      toolInput: {},
      toolOutput: {
        bookingId: "30000000-0000-4000-8000-000000000001",
        vendorName: "Hanbang Studio",
        productName: "",
        staffName: "",
        date: "2099-07-20",
        time: "10:00",
        quotedAmount: 500_000,
        amountBasis: "quote",
        status: "pending",
        projectionStatus: "pending_retry",
      },
      success: true,
      displayMessage: "예약 접수 완료, 일정 반영 재시도 중",
    });

    expect(html).toContain("아모라 내부 후보 견적");
    expect(html).toContain("결제·지출 기록이 아니에요");
    expect(html).toContain("아모라에 예약 요청을 기록했어요");
    expect(html).toContain("업체에 전달되거나 확정된 상태가 아니에요");
    expect(html).toContain("기록 취소 표시");
    expect(html).not.toContain(">예약 취소<");
    expect(html).toContain("일정 반영 중");
    expect(html).toContain("같은 기록을 다시 만들 필요는 없어요");
  });

  it("shows that cancellation is complete while cleanup projection retries", () => {
    const html = render({
      toolName: "cancel_booking",
      toolInput: {},
      toolOutput: {
        bookingId: "30000000-0000-4000-8000-000000000001",
        vendorName: "Hanbang Studio",
        productName: "",
        date: "2099-07-20",
        time: "10:00",
        status: "cancelled",
        recordedSpendPreserved: true,
        refundStatus: "unknown",
        projectionStatus: "pending_retry",
      },
      success: true,
      displayMessage: "예약 취소 완료, 일정 취소 상태 반영 재시도 중",
    });

    expect(html).toContain("일정 취소 상태 반영 중");
    expect(html).toContain("기록된 실제 지출은 유지돼요");
    expect(html).toContain("아모라 예약 기록을 취소로 표시했어요");
    expect(html).toContain("업체 취소는 전달되거나 확정되지 않았어요");
    expect(html).toContain("환불 여부와 금액은 아직 확인되지 않았어요");
    expect(html).toContain("같은 취소 표시를 다시 보낼 필요는 없어요");
  });
});

describe("VendorToolCard availability boundary", () => {
  it("shows internal candidates and never renders diagnostic ids", () => {
    const html = render({
      toolName: "get_available_slots",
      toolInput: {},
      toolOutput: {
        vendorId: "internal-vendor-secret",
        vendorName: "Hanbang Studio",
        productId: "internal-product-secret",
        staffId: "internal-staff-secret",
        slots: [],
        fallbackSlots: [],
        filterLabel: "2027-03-20",
        _debug: {
          slotSource: "staff",
          slotsLoaded: 0,
          rangeStart: "2027-03-20",
          rangeEnd: "2027-03-20",
        },
      },
      success: true,
      displayMessage: "후보 없음",
    });

    expect(html).toContain("아모라에 등록된 가능 시간 후보가 없습니다");
    expect(html).toContain("최종 확정은 업체에 별도로 확인");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("internal-vendor-secret");
    expect(html).not.toContain("internal-product-secret");
    expect(html).not.toContain("internal-staff-secret");
  });
});

describe("VendorToolCard official recommendation evidence", () => {
  it("renders public-price evidence without fake ratings or undefined legacy fields", () => {
    const html = render({
      toolName: "recommend_vendors",
      toolInput: {},
      toolOutput: {
        recommendationPolicy: "official_price_explainable_v1",
        vendors: [{
          id: "vendor-1",
          name: "샘플 스튜디오",
          location: "서울 강남권",
          priceRange: "1,200,000원 ~ 1,400,000원",
          rating: null,
          reviewCount: null,
          tags: ["자연광"],
          reasons: ["선호 태그 1/1 일치: 자연광", "공시 기본가 120만원으로 예산 내"],
          dataBadges: ["공시가", "최신 공시"],
          link: "/price/vendor/sample-studio",
        }],
        coverageNote: "가격을 공개한 업체 기준 추천입니다.",
        disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
      },
      success: true,
      displayMessage: "공시 가격 기준 추천",
    });

    expect(html).toContain("공시가");
    expect(html).toContain("샘플 스튜디오");
    expect(html).toContain("서울 강남권");
    expect(html).toContain("1,200,000원 ~ 1,400,000원");
    expect(html).toContain("선호 태그 1/1 일치");
    expect(html).toContain("예산 내");
    expect(html).toContain("/price/vendor/sample-studio");
    expect(html).toContain("실제 계약 조건");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("renders the official detail evidence before clearly auxiliary booking data", () => {
    const html = render({
      toolName: "get_vendor_detail",
      toolInput: { vendor_id: "vendor-1" },
      toolOutput: {
        profilePolicy: "official_disclosure_profile_v1",
        dataStatus: "available",
        vendorId: "vendor-1",
        vendorName: "샘플 스튜디오",
        location: "서울 강남권",
        profileLink: "/price/vendor/sample-studio",
        officialProfile: {
          vendor: { id: "vendor-1", slug: "sample-studio", name: "샘플 스튜디오" },
          attributes: {},
          tags: [{ slug: "natural", label: "자연광", tag_group: "style" }],
          official_prices: [{
            id: "price-1",
            item_name: "기본 촬영",
            price_min_krw: 1_200_000,
            price_max_krw: 1_400_000,
            private_source_quote: "기본 촬영 120만원부터",
            period_label: "2026Q3",
            source: "한국소비자원 참가격 2026Q3 공시 기준",
            options: [],
          }],
          data_badges: ["공시가", "최신 공시"],
          sources: ["한국소비자원 참가격 2026Q3 공시 기준"],
        },
        bookingData: {
          policy: "legacy_booking_auxiliary_v1",
          auxiliary: true,
          notice: "예약용 등록 정보이며 공시 가격의 근거 또는 추천 순위로 사용하지 않습니다.",
          products: [{
            id: "product-1",
            name: "예약 상담",
            description: "예약 확인용",
            price: 0,
            discountPrice: null,
            duration: 30,
            isPopular: false,
            includes: [],
          }],
          staff: [],
        },
      },
      success: true,
      displayMessage: "공시 상세",
    });

    expect(html).toContain("확인된 공시 정보");
    expect(html).toContain("공시가");
    expect(html).toContain("기본 촬영");
    expect(html).toContain("120만원");
    expect(html).not.toContain("기본 촬영 120만원부터");
    expect(html).toContain("한국소비자원 참가격 2026Q3 공시 기준");
    expect(html).toContain("예약 보조 정보");
    expect(html).toContain("공시 가격의 근거 또는 추천 순위로 사용하지 않습니다");
    expect(html).toContain("예약 상담");
    expect(html).toContain("/price/vendor/sample-studio");
  });
});
