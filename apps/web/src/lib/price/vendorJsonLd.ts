import { PRICE_DISCLOSURE_FAQ_MAIN_ENTITY } from "./categoryJsonLd";
import { DISCLOSURE_ROUND } from "./period";

const BASE_URL = "https://hanbang.ai";

export interface PriceVendorStructuredDataInput {
  vendorName: string;
  vendorSlug: string;
  category: string;
  categoryLabel: string;
}

export function buildPriceVendorStructuredData({
  vendorName,
  vendorSlug,
  category,
  categoryLabel,
}: PriceVendorStructuredDataInput) {
  const categoryUrl = `${BASE_URL}/price/${category}`;
  const vendorUrl = `${BASE_URL}/price/vendor/${vendorSlug}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "웨딩한방", item: BASE_URL },
        { "@type": "ListItem", position: 2, name: `${categoryLabel} 공시가`, item: categoryUrl },
        { "@type": "ListItem", position: 3, name: vendorName, item: vendorUrl },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${vendorName} 공시 가격`,
      url: vendorUrl,
      isPartOf: { "@type": "WebSite", name: "웨딩한방", url: BASE_URL },
      about: { "@type": "Organization", name: vendorName },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${vendorName} 결혼서비스 공시 가격`,
      // 검색엔진에 하는 공개 선언이다. 내부 스냅샷 이름(2026Q3)을 넣으면
      // 2025-11 공시를 2026년 3분기 데이터라고 기계가 읽는다. ISO 8601 연-월로 준다.
      temporalCoverage: DISCLOSURE_ROUND,
      creator: { "@type": "Organization", name: "한국소비자원" },
      publisher: { "@type": "Organization", name: "웨딩한방" },
      citation: "한국소비자원 참가격",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: PRICE_DISCLOSURE_FAQ_MAIN_ENTITY,
    },
  ];
}
