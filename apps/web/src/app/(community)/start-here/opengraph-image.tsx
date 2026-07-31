import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const alt = "결혼 준비 지금 뭐부터? — 결혼식 날짜로 보는 이번 순서";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

// satori(next/og)는 woff2를 지원하지 않는다 — ttf만 사용.
const paperlogyBold = readFile(join(
  process.cwd(),
  "public/fonts/paperlogy/Paperlogy-7Bold.ttf",
));

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "62px 72px", color: "#243832", background: "linear-gradient(135deg, #fffdf8 0%, #f5ece4 58%, #e7d7c8 100%)", fontFamily: "Paperlogy" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
          <div style={{ width: 52, height: 52, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#36534E", color: "white", fontSize: 24 }}>한</div>
          웨딩한방
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", color: "#8F6662", fontSize: 28 }}>
            결혼식 날짜만 넣으면 됩니다
          </div>
          <div style={{ display: "flex", fontSize: 72, lineHeight: 1.14, letterSpacing: -2 }}>결혼 준비, 지금 뭐부터?</div>
          <div style={{ display: "flex", fontSize: 31, color: "#4E6A62" }}>
            지금 열어야 하는 항목과 첫 걸음을 3가지로 정리해 드려요
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#4E6A62", fontSize: 23 }}>
          <div style={{ display: "flex" }}>로그인 없이 무료 · 입력한 날짜는 저장하지 않습니다</div>
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
