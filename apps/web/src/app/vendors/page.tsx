import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { cache } from "react";

import AuthenticatedAppShell from "@/app/(app)/AuthenticatedAppShell";
import { PriceExplorer } from "@/components/price/PriceExplorer";
import { loadAdminPreviewPriceCatalog } from "@/lib/price/adminPreviewData";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import {
  PRICE_CATEGORIES,
  type PriceCategory,
} from "@/lib/price/catalog";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

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
  searchParams: Promise<{
    category?: string | string[];
    preview?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const category = requestedCategory(resolvedSearchParams.category);
  const previewValue = Array.isArray(resolvedSearchParams.preview)
    ? resolvedSearchParams.preview[0]
    : resolvedSearchParams.preview;
  const preview = previewValue === "1";
  if (preview) {
    noStore();
    const admin = await verifyAdmin(new Request("http://localhost/wedding/vendors?preview=1"));
    if (!admin.authorized) notFound();
  }
  const catalog = preview
    ? await loadAdminPreviewPriceCatalog(getServiceClient())
    : await loadCatalog(category);

  return (
    <AuthenticatedAppShell>
      <PriceExplorer
        catalog={catalog}
        category={category}
        surface="app"
        preview={preview}
      />
    </AuthenticatedAppShell>
  );
}
