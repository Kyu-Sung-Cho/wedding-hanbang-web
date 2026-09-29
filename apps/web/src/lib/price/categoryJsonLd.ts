export interface PriceCategorySeoInput {
  categoryLabel: string;
  period: string;
  vendorCount: number;
}

interface PriceCategoryStructuredDataInput extends PriceCategorySeoInput {
  category: "studio" | "dress" | "makeup" | "hall";
}

import { DISCLOSURE_ROUND } from "./period";

const BASE_URL = "https://hanbang.ai";

export const PRICE_DISCLOSURE_FAQ_MAIN_ENTITY = [
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
] as const;

export function buildPriceCategorySeo({
  categoryLabel,
  period,
  vendorCount,
}: PriceCategorySeoInput) {
  return {
    title: `스드메 공시가 비교 — ${categoryLabel} | 웨딩한방`,
    description: `${period} 기준 가격을 공개한 ${categoryLabel} ${vendorCount}곳의 공시 가격을 비교하세요.`,
  };
}

export function buildPriceCategoryStructuredData({
  category,
  categoryLabel,
  period,
  vendorCount,
}: PriceCategoryStructuredDataInput) {
  const { description } = buildPriceCategorySeo({
    categoryLabel,
    period,
    vendorCount,
  });
  const categoryUrl = `${BASE_URL}/price/${category}`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "웨딩한방", item: BASE_URL },
        {
          "@type": "ListItem",
          position: 2,
          name: "공시가 비교",
          item: `${BASE_URL}/price`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: categoryLabel,
          item: categoryUrl,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "결혼서비스 공시 가격 비교 데이터",
      description,
      // 화면 문구와 같은 이유로 확인된 공시 라운드를 쓴다(ISO 8601 연-월).
      temporalCoverage: DISCLOSURE_ROUND,
      url: categoryUrl,
      creator: { "@type": "Organization", name: "한국소비자원" },
      citation: "한국소비자원 참가격",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: PRICE_DISCLOSURE_FAQ_MAIN_ENTITY,
    },
  ];
}

export function serializePriceCategoryJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
