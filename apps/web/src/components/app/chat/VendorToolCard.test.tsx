import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "@/types/database.types";
import VendorToolCard from "./VendorToolCard";

function render(result: ToolExecutionResult) {
  return renderToStaticMarkup(<VendorToolCard result={result} />);
}

describe("VendorToolCard booking projection state", () => {
  it("shows that a created booking is safe while schedule/budget projection retries", () => {
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
        amount: 500_000,
        status: "pending",
        projectionStatus: "pending_retry",
      },
      success: true,
      displayMessage: "예약 접수 완료, 일정·예산 반영 재시도 중",
    });

    expect(html).toContain("일정·예산 반영 중");
    expect(html).toContain("예약을 다시 만들 필요는 없어요");
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
        projectionStatus: "pending_retry",
      },
      success: true,
      displayMessage: "예약 취소 완료, 일정·예산 정리 재시도 중",
    });

    expect(html).toContain("일정·예산 정리 중");
    expect(html).toContain("취소 요청을 다시 보낼 필요는 없어요");
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
