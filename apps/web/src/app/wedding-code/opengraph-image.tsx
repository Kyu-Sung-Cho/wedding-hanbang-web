import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { CARD_FONT_FAMILY, weddingCodeCard } from "./ogCard";

/**
 * `/wedding-code` 링크를 대화창에 붙였을 때 나오는 공유 카드.
 *
 * 이 파일이 없을 때는 루트 layout 의 카드(아모라 문구, `og:url=/landing`)를 물려받아서,
 * 웨딩코드를 보냈는데 받는 사람에게는 아모라 소개가 보였다.
 *
 * 카드에는 이곳이 무엇을 하는 곳인지만 적는다. 네 글자 예시나 사람을 설명하는 말은
 * 넣지 않는다. 답이 담긴 링크도 답은 `#` 뒤에 있어서 서버가 읽지 못하므로, 모든
 * 링크가 같은 일반 카드를 쓴다. 다만 주소의 쿼리가 `?v=v4.0-tendency` 인 입구는 `page.tsx` 가 `v40-card/opengraph-image.tsx`
 * 의 카드를 적어서 이 카드를 쓰지 않는다(이 파일은 쿼리를 읽을 수 없어 판을 가리지 못한다). `#` 뒤에 판이 실린 v4 링크는 서버가
 * 판을 모르므로 여전히 이 카드가 나간다.
 *
 * 그림의 틀(배치, 종이 색)은 v4 카드와 함께 쓰는 `ogCard.tsx` 에 있고, 이 파일은 이 카드의 글만 정한다.
 *
 * 하위 경로는 자기 metadata 에서 openGraph 를 정하는 순간 이 이미지를 물려받지 못한다. 그래서
 * `/wedding-code/together` 와 `/wedding-code/taste` 는 이 이미지 주소(`/wedding-code/opengraph-image`)를
 * 직접 가리킨다. `/wedding-code/c/[code]` 는 이전 판 화면이라 이 이미지를 붙이지 않는다(그 페이지가
 * openGraph 를 정하므로 부모 이미지는 따라오지 않는다). openGraph 를 정하지 않는 하위 경로는 루트 카드의
 * 제목·설명·`og:url=/landing` 에 이 그림만 붙은 섞인 카드가 된다(`opengraph-image.test.tsx` 가 막는다).
 */

export const alt = "웨딩코드, 내가 원하는 결혼식과 준비 방식을 살펴보는 곳";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

// satori(next/og)는 woff2를 지원하지 않는다. ttf만 사용.
const pretendardBold = readFile(join(
  process.cwd(),
  "public/fonts/pretendard/Pretendard-Bold.ttf",
));

export default async function OpenGraphImage() {
  return new ImageResponse(
    weddingCodeCard({
      titleLines: ["내가 원하는 결혼식과", "준비 방식을 살펴봐요"],
      detail: "혼자서도 결과를 볼 수 있고, 상대와 나눠 보면 나란히 볼 수 있어요.",
    }),
    {
      ...size,
      fonts: [{ name: CARD_FONT_FAMILY, data: await pretendardBold, style: "normal", weight: 700 }],
    },
  );
}
