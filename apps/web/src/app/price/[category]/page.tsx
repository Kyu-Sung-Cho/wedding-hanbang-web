import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PriceAmoraBridge } from "@/components/price/PriceAmoraBridge";
import { PriceExplorer } from "@/components/price/PriceExplorer";
import {
  PRICE_CATEGORIES,
  slimPriceCatalogOptions,
  type PriceCatalog,
  type PriceCategory,
  type PriceVendor,
} from "@/lib/price/catalog";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import {
  buildPriceCategorySeo,
  buildPriceCategoryStructuredData,
  serializePriceCategoryJsonLd,
} from "@/lib/price/categoryJsonLd";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
import { disclosureRoundLabel } from "@/lib/price/period";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

export const revalidate = 86_400;
export const dynamicParams = false;

const loadCatalog = cache((category: PriceCategory): Promise<PriceCatalog> => (
  loadPriceCatalogWithBuildFallback(() => (
    loadPublicPriceCatalog(createPublicClient(), { optionCategories: [category] })
  ))
));

function isPriceCategory(value: string): value is PriceCategory {
  return PRICE_CATEGORIES.includes(value as PriceCategory);
}

// 비활성 카테고리 데이터의 유일한 소비자는 예산 조합 찾기(budgetFinder)이고,
// 거기서는 "허용된 대행사 중 최저가 오퍼 1건"만 읽는다. 그래서 대행사별 최저가만
// 남기고 나머지 오퍼는 전송하지 않는다 — 의미는 그대로, 바이트만 줄어든다.
function cheapestOfferPerAgency(offers: PriceVendor["offers"]): PriceVendor["offers"] {
  const cheapest = new Map<string, PriceVendor["offers"][number]>();
  for (const offer of offers) {
    if (offer.minimumKrw === null) continue;
    const key = offer.agencyId ?? "";
    const current = cheapest.get(key);
    if (!current || (current.minimumKrw ?? Number.POSITIVE_INFINITY) > offer.minimumKrw) {
      cheapest.set(key, offer);
    }
  }
  return [...cheapest.values()].map((offer) => ({
    id: offer.id,
    agencyId: offer.agencyId,
    agencyName: offer.agencyName,
    minimumKrw: offer.minimumKrw,
    maximumKrw: null,
    priceNote: null,
    baseSpec: null,
    options: [],
  }));
}

function catalogForBrowser(catalog: PriceCatalog, activeCategory: PriceCategory): PriceCatalog {
  const budgetCategories = new Set<PriceCategory>(["studio", "dress", "makeup"]);
  const categories = Object.fromEntries(PRICE_CATEGORIES.map((category) => {
    if (category === activeCategory) return [category, catalog.categories[category]];
    if (!budgetCategories.has(category)) return [category, []];
    return [category, catalog.categories[category].map((vendor) => ({
      ...vendor,
      aliases: [],
      regionCode: null,
      offers: cheapestOfferPerAgency(vendor.offers),
    }))];
  })) as PriceCatalog["categories"];
  return { ...catalog, categories };
}

export function generateStaticParams(): Array<{ category: PriceCategory }> {
  return PRICE_CATEGORIES.map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  if (!isPriceCategory(category)) return {};
  const catalog = await loadCatalog(category);
  const label = PRICE_CATEGORY_LABELS[category];
  const period = disclosureRoundLabel();
  const count = catalog.counts[category];
  const { title, description } = buildPriceCategorySeo({
    categoryLabel: label,
    period,
    vendorCount: count,
  });
  return {
    title,
    description,
    alternates: { canonical: `/price/${category}` },
    openGraph: {
      title,
      description,
      url: `/price/${category}`,
      type: "website",
    },
  };
}

export default async function PriceCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!isPriceCategory(category)) notFound();
  const catalog = await loadCatalog(category);
  const label = PRICE_CATEGORY_LABELS[category];
  const period = disclosureRoundLabel();
  const structuredData = buildPriceCategoryStructuredData({
    category,
    categoryLabel: label,
    periodLabel: catalog.periodLabel,
    period,
    vendorCount: catalog.counts[category],
  });

  return (
    <>
      {structuredData.map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializePriceCategoryJsonLd(data) }}
        />
      ))}
      {/* 옵션 본문(원문 인용 11k개)은 초기 전송에서 제외 — 카드 펼침 시 지연 로드. */}
      <PriceExplorer catalog={catalogForBrowser(slimPriceCatalogOptions(catalog), category)} category={category} />
      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <PriceAmoraBridge />
      </div>
    </>
  );
}
