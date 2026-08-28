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

/**
 * 랜딩과 같은 종이 색.
 *
 * satori 는 CSS 변수를 못 읽으므로 리터럴로 적는다. 값의 출처는
 * `packages/design-tokens/src/colors.ts` 의 `paper` 그룹이고,
 * `globals.css` 의 `--color-paper-*` 와 같아야 한다. 여기만 바꾸면 카드와 화면이 갈린다.
 *
 * 2026-08-27 이전에는 짙은 유칼립투스 그라디언트였다. 링크를 받은 사람에게는 이 카드가
 * 제품의 첫 화면인데, 카드가 짙은 초록이고 누르면 크림색 노트가 나와 같은 제품으로
 * 안 읽혔다.
 */
const PAPER = {
  sheet: "#FDFCF7",
  ink: "#26251F",
  inkSoft: "#4A483F",
  inkFaint: "#605E54",
  pen: "#35638A",
} as const;

/** H1 정본의 줄바꿈. 소스에 리터럴로 적으면 편집 도구가 진짜 줄바꿈으로 바꿔 놓는다. */
const BREAK = String.fromCharCode(10);

export default async function OpenGraphImage() {
  // H1은 화면에서 두 덩어리로 끊긴다. 카드에서도 같은 자리에서 끊어 같은 문장으로 읽히게 한다.
  // 정본이 줄바꿈을 갖고 있으므로 그걸 그대로 쓴다 — 여기서 다시 나누면 두 곳이 갈린다.
  const [lead, tail] = landingContent.hero.title.split(BREAK);
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
          color: PAPER.ink,
          background: PAPER.sheet,
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
              background: PAPER.pen,
              color: PAPER.sheet,
              fontSize: 24,
            }}
          >
            한
          </div>
          웨딩한방
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", color: PAPER.pen, fontSize: 28 }}>
            둘이 함께 준비하는 결혼
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 58, lineHeight: 1.2, letterSpacing: -2 }}>
            <div style={{ display: "flex", color: PAPER.ink }}>{lead}</div>
            <div style={{ display: "flex", color: PAPER.pen }}>{tail}</div>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: PAPER.inkSoft }}>
            {lede}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", color: PAPER.inkFaint, fontSize: 23 }}>
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
