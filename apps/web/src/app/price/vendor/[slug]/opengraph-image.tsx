import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { krwRangeLabel } from "@/lib/format/krw";
import { createPublicClient } from "@/lib/supabase/public";
import { loadPublicVendorPriceProfile } from "@/lib/vendors/publicVendorPriceData";

export const alt = "웨딩한방 업체 공시 가격 카드";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

// satori(next/og)는 woff2를 지원하지 않는다 — ttf만 사용 (2026-07-23, OG 500 수리).
const paperlogyBold = readFile(join(
  process.cwd(),
  "public/fonts/paperlogy/Paperlogy-7Bold.ttf",
));

const CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  hall: "예식장",
};

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = /^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)
    ? await loadPublicVendorPriceProfile(createPublicClient(), slug).catch(() => null)
    : null;
  const currentPrices = profile?.prices.filter((price) => price.is_current) ?? [];
  const minimums = currentPrices.flatMap((price) => (
    price.price_min_krw === null ? [] : [price.price_min_krw]
  ));
  const maximums = currentPrices.flatMap((price) => (
    price.price_max_krw === null ? [] : [price.price_max_krw]
  ));
  const range = krwRangeLabel(
    minimums.length > 0 ? Math.min(...minimums) : null,
    maximums.length > 0 ? Math.max(...maximums) : null,
  );
  const name = profile?.vendor.name ?? "웨딩 업체 공시가";
  const category = profile
    ? CATEGORY_LABELS[profile.vendor.category] ?? "웨딩 업체"
    : "공시 가격 비교";
  const period = currentPrices[0]?.period_label ?? "최신 발행분";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "62px 72px",
          color: "#241b1c",
          background: "linear-gradient(135deg, #fffaf8 0%, #f8e9e7 55%, #ead6d2 100%)",
          fontFamily: "Paperlogy",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#9d625f",
                color: "white",
                fontSize: 24,
              }}
            >
              한
            </div>
            웨딩한방
          </div>
          <div
            style={{
              display: "flex",
              padding: "12px 22px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.72)",
              color: "#704846",
              fontSize: 24,
            }}
          >
            {period} 공시 기준
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", color: "#8b5a57", fontSize: 28 }}>{category}</div>
          <div style={{ display: "flex", fontSize: 66, lineHeight: 1.16, letterSpacing: -2 }}>
            {name}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
            <div style={{ display: "flex", fontSize: 30, color: "#76514f" }}>공시 가격</div>
            <div style={{ display: "flex", fontSize: 54, color: "#9d514d" }}>{range}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", color: "#735e5c", fontSize: 23 }}>
          <div style={{ display: "flex" }}>대행사별 기본가와 추가금을 한눈에 비교하세요</div>
          <div style={{ display: "flex" }}>hanbang.ai</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{
        name: "Paperlogy",
        data: await paperlogyBold,
        style: "normal",
        weight: 700,
      }],
    },
  );
}
