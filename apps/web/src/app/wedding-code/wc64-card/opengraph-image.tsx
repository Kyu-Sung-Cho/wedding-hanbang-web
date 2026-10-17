import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { CARD_FONT_FAMILY, weddingCodeCard } from "../ogCard";

/**
 * 64문항(wc64) 입구의 일반 공유 카드. 답은 이 브라우저에만 있으므로 그림에 어떤 답이나 결과도 담지 않는다.
 * 폴더에 화면(page.tsx)은 두지 않고, page.tsx 의 metadata 가 wc64 입구에만 이 주소를 적는다.
 * 2026-10-17 파운더 결정으로 결과 화면의 메인이 네 글자에 붙인 이름(형용사 + 동물)이 되어, 큰 글도 글자와 이름을 함께 말한다.
 * 큰 글의 옛 '그 이름'은 '그'가 가리킬 말이 카드 안에 없어 '이름'으로 줄였다(2026-10-17 점검).
 * 어느 유형의 이름도 예로 싣지 않는다(카드는 누구의 결과도 담지 않는다).
 */
export const alt = "웨딩코드, 우리의 결혼 준비 성향";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

// satori(next/og)는 woff2를 지원하지 않는다. 기존 카드와 같은 한글 ttf를 사용한다.
const pretendardBold = readFile(join(
  process.cwd(),
  "public/fonts/pretendard/Pretendard-Bold.ttf",
));

export default async function OpenGraphImage() {
  return new ImageResponse(
    weddingCodeCard({
      titleLines: ["네 글자와 이름으로 보는", "결혼 준비 성향"],
      detail: "64문항에 답하고, 답은 이 브라우저에만 남아요",
    }),
    {
      ...size,
      fonts: [{ name: CARD_FONT_FAMILY, data: await pretendardBold, style: "normal", weight: 700 }],
    },
  );
}
