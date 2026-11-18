import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import { invitationPalette } from "@hanbang/design-tokens";
import { START_COPY } from "@hanbang/shared/invitation";

/**
 * 공유 카드.
 *
 * 옛 `/images/landing-social-card.webp` 에는 "축하의 온도와 기준의 정밀함"이 구워져 있었다.
 * PRINCIPLES.md P5가 금지하는 정확성 보장 표현이었고, 이미지는 코드 리뷰를 통과하지 않으므로
 * 페이지가 바뀌어도 조용히 남았다. 그래서 카드는 생성물이고, 문구는 페이지와 같은 정본에서
 * 읽는다 — 카드가 H1과 다른 말을 하려면 H1을 먼저 바꿔야 한다.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩이 시작 화면이 됐다.
 * 그 화면의 정본은 `START_COPY`(앱과 같이 쓴다)이고, 색은 같은 아티팩트의 팔레트다.
 * satori 는 CSS 변수를 못 읽으므로 디자인 토큰 값을 그대로 넘긴다.
 *
 * 글꼴은 Pretendard 다. satori 는 ttf 만 읽는데 고운바탕·Cormorant 는 next/font 가 빌드 때
 * 받아 오는 woff2 뿐이고 저장소에는 Pretendard ttf 만 있다.
 */

export const alt = `웨딩한방 | ${START_COPY.headingLines.join(" ")}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

// satori(next/og)는 woff2를 지원하지 않는다 — ttf만 사용.
const pretendardBold = readFile(join(
  process.cwd(),
  "public/fonts/pretendard/Pretendard-Bold.ttf",
));

export default async function OpenGraphImage() {
  // 화면의 H1 두 줄을 같은 자리에서 끊는다. 정본이 줄을 나눠 갖고 있으므로 그대로 쓴다.
  const [lead, tail] = START_COPY.headingLines;

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
          color: invitationPalette.ink,
          background: invitationPalette.blush,
          fontFamily: "Pretendard Variable",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: invitationPalette.body }}>
          <div style={{ display: "flex" }}>웨딩한방</div>
          <div style={{ display: "flex" }}>hanbang.ai</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontSize: 28, color: invitationPalette.muted }}>
            {`${START_COPY.wordmark} · ${START_COPY.tagline}`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 60, lineHeight: 1.3, letterSpacing: -1 }}>
            <div style={{ display: "flex" }}>{lead}</div>
            <div style={{ display: "flex" }}>{tail}</div>
          </div>
          <div style={{ display: "flex", maxWidth: 1000, fontSize: 28, lineHeight: 1.5, color: invitationPalette.body }}>
            {START_COPY.body}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Pretendard Variable", data: await pretendardBold, style: "normal", weight: 700 }],
    },
  );
}
