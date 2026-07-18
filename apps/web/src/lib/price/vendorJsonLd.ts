import { PRICE_DISCLOSURE_FAQ_MAIN_ENTITY } from "./categoryJsonLd";

const BASE_URL = "https://hanbang.ai";

export interface PriceVendorStructuredDataInput {
  vendorName: string;
  vendorSlug: string;
  category: string;
  categoryLabel: string;
  periodLabel: string;
}

export function buildPriceVendorStructuredData({
  vendorName,
  vendorSlug,
  category,
  categoryLabel,
  periodLabel,
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
      temporalCoverage: periodLabel,
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
