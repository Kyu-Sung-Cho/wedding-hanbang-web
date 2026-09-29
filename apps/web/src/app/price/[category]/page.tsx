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
import { catalogForPriceBrowser } from "@/lib/price/savedComboRestore";
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
      <PriceExplorer catalog={catalogForPriceBrowser(slimPriceCatalogOptions(catalog), category)} category={category} />
      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <PriceAmoraBridge />
      </div>
    </>
  );
}
