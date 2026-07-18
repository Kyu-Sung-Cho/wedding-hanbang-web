import { describe, expect, it } from "vitest";

import {
  buildPriceCategorySeo,
  buildPriceCategoryStructuredData,
  serializePriceCategoryJsonLd,
} from "@/lib/price/categoryJsonLd";

describe("price category SEO", () => {
  it("uses the disclosure title and dynamic period/vendor-count description from the product contract", () => {
    expect(buildPriceCategorySeo({
      categoryLabel: "스튜디오",
      period: "2026년 3분기",
      vendorCount: 12,
    })).toEqual({
      title: "스드메 공시가 비교 — 스튜디오 | 웨딩한방",
      description: "2026년 3분기 기준 가격을 공개한 스튜디오 12곳의 공시 가격을 비교하세요.",
    });
  });

  it("builds the required breadcrumb and disclosure Dataset with the official source", () => {
    const [breadcrumb, dataset] = buildPriceCategoryStructuredData({
      category: "studio",
      categoryLabel: "스튜디오",
      periodLabel: "2026Q3",
      period: "2026년 3분기",
      vendorCount: 12,
    });

    expect(breadcrumb).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "웨딩한방",
          item: "https://hanbang.ai",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "공시가 비교",
          item: "https://hanbang.ai/price/studio",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "스튜디오",
          item: "https://hanbang.ai/price/studio",
        },
      ],
    });
    expect(dataset).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "결혼서비스 공시 가격 비교 데이터",
      description: "2026년 3분기 기준 가격을 공개한 스튜디오 12곳의 공시 가격을 비교하세요.",
      temporalCoverage: "2026Q3",
      url: "https://hanbang.ai/price/studio",
      creator: {
        "@type": "Organization",
        name: "한국소비자원",
      },
      citation: "한국소비자원 참가격",
    });
  });

  it("uses all three FAQ questions and answers verbatim", () => {
    const [, , faq] = buildPriceCategoryStructuredData({
      category: "dress",
      categoryLabel: "드레스",
      periodLabel: "2026Q3",
      period: "2026년 3분기",
      vendorCount: 9,
    });

    expect(faq).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "공시 가격이 무엇인가요?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "결혼서비스 가격표시제에 따라 예식장과 결혼준비대행업체가 공개한 기본금·선택품목 가격입니다. 웨딩한방은 한국소비자원 참가격에 공개된 정보를 기준으로 정리해 보여드립니다.",
          },
        },
        {
          "@type": "Question",
          name: "실제 계약 가격과 왜 다를 수 있나요?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "공시 가격은 기준 시점의 기본 조건 가격입니다. 계약 시점, 시즌, 선택 옵션, 프로모션에 따라 실제 금액은 달라질 수 있으니 계약 전 업체에 직접 확인하세요.",
          },
        },
        {
          "@type": "Question",
          name: "왜 일부 업체만 나오나요?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "가격을 공개한 업체만 표시하기 때문입니다. 공개 업체는 분기마다 업데이트됩니다.",
          },
        },
      ],
    });
  });

  it("serializes every schema as parseable JSON without leaving script-breaking angle brackets", () => {
    const schemas = buildPriceCategoryStructuredData({
      category: "makeup",
      categoryLabel: "메이크업 </script><script>alert(1)</script>",
      periodLabel: "2026Q3",
      period: "2026년 3분기",
      vendorCount: 4,
    });

    for (const schema of schemas) {
      const serialized = serializePriceCategoryJsonLd(schema);
      expect(serialized).not.toContain("<");
      expect(JSON.parse(serialized)).toEqual(schema);
    }
  });
});
