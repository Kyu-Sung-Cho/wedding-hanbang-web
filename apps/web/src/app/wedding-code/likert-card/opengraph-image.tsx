import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { CARD_FONT_FAMILY, weddingCodeCard } from "../ogCard";

/**
 * 30문항 기본 입구의 일반 공유 카드. 답은 fragment에 있으므로 그림에 담지 않는다.
 * page.tsx가 새 입구에만 이 주소를 지정하며, 명시 구판의 카드 계약은 유지한다.
 */
export const alt = "웨딩코드, 결혼을 준비하는 나의 언어를 찾아요";
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
      titleLines: ["결혼을 준비하는", "나의 언어를 찾아요"],
      detail: "둘 다 답한 뒤 두 사람 결과 링크를 직접 돌려주면 나란히 볼 수 있어요",
    }),
    {
      ...size,
      fonts: [{ name: CARD_FONT_FAMILY, data: await pretendardBold, style: "normal", weight: 700 }],
    },
  );
}
