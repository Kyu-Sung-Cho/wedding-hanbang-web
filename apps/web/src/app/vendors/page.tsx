import type { Metadata } from "next";
import { cache } from "react";

import AuthenticatedAppShell from "@/app/(app)/AuthenticatedAppShell";
import { PriceExplorer } from "@/components/price/PriceExplorer";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import {
  PRICE_CATEGORIES,
  type PriceCategory,
} from "@/lib/price/catalog";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

export const metadata: Metadata = {
  title: "업체 탐색",
  description: "공식 공시 가격을 기준으로 웨딩 업체를 비교하고 저장하세요.",
  robots: { index: false, follow: false },
};

const loadCatalog = cache((category: PriceCategory) => (
  loadPriceCatalogWithBuildFallback(() => (
    loadPublicPriceCatalog(createPublicClient(), { optionCategories: [category] })
  ))
));

function requestedCategory(value: string | string[] | undefined): PriceCategory {
  const raw = Array.isArray(value) ? value[0] : value;
  return PRICE_CATEGORIES.includes(raw as PriceCategory) ? raw as PriceCategory : "studio";
}

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const category = requestedCategory((await searchParams).category);
  const catalog = await loadCatalog(category);

  return (
    <AuthenticatedAppShell>
      <PriceExplorer catalog={catalog} category={category} surface="app" />
    </AuthenticatedAppShell>
  );
}
