import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { krwRangeLabel } from "@/lib/format/krw";
import { PRICE_CATEGORIES, type PriceCatalog, type PriceCategory } from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
import { formatDisclosurePeriod } from "@/lib/price/period";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "웨딩한방 결혼서비스 공시 가격 비교";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

const paperlogyBold = readFile(join(
  process.cwd(),
  "public/fonts/paperlogy/Paperlogy-7Bold.woff2",
));

function isPriceCategory(value: string): value is PriceCategory {
  return PRICE_CATEGORIES.includes(value as PriceCategory);
}

function priceRange(catalog: PriceCatalog, category: PriceCategory): string {
  const offers = catalog.categories[category].flatMap((vendor) => vendor.offers);
  const minimums = offers.flatMap((offer) => offer.minimumKrw === null ? [] : [offer.minimumKrw]);
  const maximums = offers.flatMap((offer) => offer.maximumKrw === null ? [] : [offer.maximumKrw]);
  return krwRangeLabel(
    minimums.length > 0 ? Math.min(...minimums) : null,
    maximums.length > 0 ? Math.max(...maximums) : null,
  );
}

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const raw = (await params).category;
  const category: PriceCategory = isPriceCategory(raw) ? raw : "studio";
  let catalog: PriceCatalog | null = null;
  try {
    catalog = await loadPublicPriceCatalog(createPublicClient(), { optionCategories: [category] });
  } catch {
    // Social previews keep a truthful generic fallback during a data outage.
  }
  const label = PRICE_CATEGORY_LABELS[category];
  const period = catalog ? formatDisclosurePeriod(catalog.periodLabel) : "최신 발행분";
  const count = catalog?.counts[category] ?? 0;
  const range = catalog ? priceRange(catalog, category) : "공시가 확인";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "62px 72px", color: "#243832", background: "linear-gradient(135deg, #fffdf8 0%, #f5ece4 58%, #e7d7c8 100%)", fontFamily: "Paperlogy" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
            <div style={{ width: 52, height: 52, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#36534E", color: "white", fontSize: 24 }}>한</div>
            웨딩한방
          </div>
          <div style={{ display: "flex", padding: "12px 22px", borderRadius: 999, background: "rgba(255,255,255,0.75)", color: "#8F6662", fontSize: 24 }}>{period}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", color: "#8F6662", fontSize: 28 }}>한국소비자원 참가격 공시</div>
          <div style={{ display: "flex", fontSize: 68, lineHeight: 1.14, letterSpacing: -2 }}>{label} 가격 비교</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
            <div style={{ display: "flex", fontSize: 31, color: "#4E6A62" }}>{count}개 업체</div>
            <div style={{ display: "flex", fontSize: 50, color: "#8F5150" }}>{range}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#4E6A62", fontSize: 23 }}>
          <div style={{ display: "flex" }}>기본가와 추가금을 원문 근거로 한눈에</div>
          <div style={{ display: "flex" }}>hanbang.ai</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Paperlogy", data: await paperlogyBold, style: "normal", weight: 700 }],
    },
  );
}
