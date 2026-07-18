import type { Metadata } from "next";
import { cache } from "react";

import { PriceWishlist } from "@/components/price/PriceWishlist";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "찜한 공식 가격 업체",
  description: "찜한 스튜디오·드레스·메이크업·웨딩홀의 공식 공개 가격을 한곳에서 비교하세요.",
  robots: { index: false, follow: false },
};

const loadCatalog = cache(() => loadPriceCatalogWithBuildFallback(() => (
  loadPublicPriceCatalog(createPublicClient())
)));

export default async function PriceWishlistPage() {
  const catalog = await loadCatalog();
  return <PriceWishlist catalog={catalog} />;
}
