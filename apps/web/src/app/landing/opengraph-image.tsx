import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { landingContent } from "@/components/landing/redesign/landingContent";

/**
 * 공유 카드를 정적 파일에서 생성으로 바꾼다.
 *
 * 기존 `/images/landing-social-card.webp`에는 "축하의 온도와 기준의 정밀함"이
 * 구워져 있었다. PRINCIPLES.md P5가 금지하는 정확성 보장 표현이고, 같이 박힌
 * 헤드라인("우리, 정말 결혼하는구나.")도 지금 랜딩이 하는 약속이 아니라 이전
 * 방향이었다. 이미지는 코드 리뷰를 통과하지 않으므로 페이지가 바뀌어도 조용히
 * 남는다 — 실제로 그렇게 남아 있었다.
 *
 * 그래서 문구를 페이지와 같은 출처(`landingContent`)에서 읽어 그린다. 카드가
 * H1과 다른 말을 하려면 이제 H1을 먼저 바꿔야 한다.
 */

export const alt = `웨딩한방 — ${landingContent.hero.title}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

// satori(next/og)는 woff2를 지원하지 않는다 — ttf만 사용.
const paperlogyBold = readFile(join(
  process.cwd(),
  "public/fonts/paperlogy/Paperlogy-7Bold.ttf",
));

export default async function OpenGraphImage() {
  // H1은 화면에서 세 줄로 끊긴다. 카드에서도 같은 자리에서 끊어 같은 문장으로 읽히게 한다.
  const [lead, ...rest] = landingContent.hero.title.split(", ");
  const tail = rest.join(", ");
  // 본문 두 문장을 다 넣으면 1200px에서 두 줄로 넘쳐 "요."만 남는 고아 줄이 생긴다.
  // 첫 문장이 "무엇을 넣으면 무엇이 나오는지"를 이미 말하므로 거기까지만 쓴다.
  const lede = `${landingContent.hero.body.split(". ")[0]}.`;

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
          color: "white",
          background: "linear-gradient(135deg, #243832 0%, #243832 52%, #2C433C 100%)",
          fontFamily: "Paperlogy",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#8F6662",
              color: "white",
              fontSize: 24,
            }}
          >
            한
          </div>
          웨딩한방
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", color: "#E2D3C8", fontSize: 28 }}>
            {landingContent.hero.aiRole}
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 74, lineHeight: 1.14, letterSpacing: -2.5 }}>
            <div style={{ display: "flex", color: "rgba(255,255,255,0.88)" }}>{lead},</div>
            <div style={{ display: "flex", color: "#E2D3C8" }}>{tail}</div>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "rgba(255,255,255,0.82)" }}>
            {lede}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(255,255,255,0.72)", fontSize: 23 }}>
          <div style={{ display: "flex" }}>로그인·결제 없이 지금 확인</div>
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
