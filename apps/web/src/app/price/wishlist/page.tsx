import type { Metadata } from "next";
import { cache } from "react";

import { PriceWishlist } from "@/components/price/PriceWishlist";
import { slimPriceCatalogOptions } from "@/lib/price/catalog";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "찜한 공식 가격 업체",
  description: "찜한 스튜디오·드레스·메이크업·웨딩홀의 공식 공개 가격을 한곳에서 비교하세요.",
  robots: { index: false, follow: false },
};

// 옵션 본문까지 실으면 4MB가 되는 페이지 — 개수만 남기고 본문은 카드 펼침 시
// 지연 로드한다(slimPriceCatalogOptions). 빌드 시 조회는 유지되지만 전송은 슬림.
const loadCatalog = cache(async () => slimPriceCatalogOptions(
  await loadPriceCatalogWithBuildFallback(() => (
    loadPublicPriceCatalog(createPublicClient())
  )),
));

export default async function PriceWishlistPage() {
  const catalog = await loadCatalog();
  return <PriceWishlist catalog={catalog} />;
}
