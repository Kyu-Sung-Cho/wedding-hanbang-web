import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import { PRICE_CATEGORIES, type PriceCatalog } from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
import { disclosureRoundLabel } from "@/lib/price/period";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "스드메·예식장 공시 가격 — 업체별 기본가와 추가금";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

// satori(next/og)는 woff2를 지원하지 않는다 — ttf만 사용.
const paperlogyBold = readFile(join(
  process.cwd(),
  "public/fonts/paperlogy/Paperlogy-7Bold.ttf",
));

export default async function OpenGraphImage() {
  let catalog: PriceCatalog | null = null;
  try {
    catalog = await loadPriceCatalogWithBuildFallback(() => (
      loadPublicPriceCatalog(createPublicClient(), { optionCategories: [] })
    ));
  } catch {
    // 데이터 장애 중에도 공유 카드는 정직한 일반 문구로 남는다.
  }
  const period = catalog ? disclosureRoundLabel() : "최신 발행분";
  const total = catalog
    ? PRICE_CATEGORIES.reduce((sum, category) => sum + (catalog.counts[category] ?? 0), 0)
    : 0;

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
          <div style={{ display: "flex", fontSize: 66, lineHeight: 1.14, letterSpacing: -2 }}>스드메·예식장 공시 가격</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            {total > 0 && (
              <div style={{ display: "flex", fontSize: 50, color: "#8F5150" }}>{total.toLocaleString()}곳</div>
            )}
            <div style={{ display: "flex", fontSize: 31, color: "#4E6A62" }}>의 기본가와 추가금을 한 화면에서</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#4E6A62", fontSize: 23 }}>
          <div style={{ display: "flex", gap: 16 }}>
            {PRICE_CATEGORIES.map((category) => (
              <div key={category} style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: "rgba(255,255,255,0.7)" }}>
                {PRICE_CATEGORY_LABELS[category]}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>hanbang.ai</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Paperlogy", data: await paperlogyBold, style: "normal", weight: 700 }],
    },
  );
}
