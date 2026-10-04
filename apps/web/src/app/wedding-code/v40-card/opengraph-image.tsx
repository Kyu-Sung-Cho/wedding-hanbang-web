import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { V40_COPY } from "@/lib/weddingCode/v40/copy";

import { CARD_FONT_FAMILY, weddingCodeCard } from "../ogCard";

/**
 * `/wedding-code?v=v4.0-tendency` 링크를 대화창에 붙였을 때 나오는 공유 카드(v4.0-tendency 입구 전용).
 *
 * 이 폴더에는 화면이 없다. 카드 이미지만 두는 곳이고, `/wedding-code/page.tsx` 의 `generateMetadata` 가 v4 입구일 때만
 * 이 주소(`/wedding-code/v40-card/opengraph-image`)를 `openGraph.images` 와 `twitter.images` 에 적는다. 파일 규약 이미지는 쿼리를 읽을 수
 * 없어서(받는 것이 `params` 뿐이다) 같은 폴더의 기본 카드로는 판을 가를 수 없기 때문이다.
 *
 * 카드의 글은 이 입구 화면이 이미 하는 말만 옮긴다.
 * - 큰 글: 입구 제목(`V40_COPY.intro.title`). 제목이 바뀌면 카드도 함께 바뀐다.
 * - 작은 글: 입구 첫 문단(`V40_COPY.intro.lede`)의 첫 문장, 곧 어떤 때를 묻는지.
 * - 아래 줄: 「로그인 없이 시작해요」와 주소. 기본 카드와 같은 말이고 `ogCard.tsx` 한 곳에 있다.
 * 정확하다는 말, 점수, 숫자, 네 글자 예시, 둘의 답이 저절로 비교된다는 약속은 싣지 않는다.
 *
 * 한계: 판이 `#` 뒤에만 있는 옛 v4 답 링크(`/wedding-code#v=v4.0-tendency&a=…`)는 서버가 모르므로 이 카드가 나가지 않고 기본 카드가
 * 나간다. 지금 만드는 답 링크는 쿼리에도 판 이름을 실어(`/wedding-code?v=v4.0-tendency#v=…`) 이 카드가 나간다. 대화앱은 카드 그림을 주소별로 오래 기억한다. 글을 바꿀 때는 `page.tsx` 의 이미지 주소 끝에 `?c=2` 처럼 꼬리를 붙여 새 주소로 만든다.
 */

export const alt = `웨딩코드, ${V40_COPY.intro.title}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

/** 입구 제목을 쉼표 뒤에서 두 줄로 나눈다(「결혼을 준비할 때,」 / 「나는 어느 쪽으로 기울까요?」). 쉼표가 없으면 한 줄이다. */
const TITLE_LINES: readonly string[] = V40_COPY.intro.title.split(/(?<=,) /u);

/** 입구 첫 문단의 첫 문장(어떤 때를 묻는지). 마침표 앞까지만 쓴다. */
const DETAIL: string = V40_COPY.intro.lede.split(". ")[0];

// satori(next/og)는 woff2를 지원하지 않는다. ttf만 사용.
const pretendardBold = readFile(join(
  process.cwd(),
  "public/fonts/pretendard/Pretendard-Bold.ttf",
));

export default async function OpenGraphImage() {
  return new ImageResponse(
    weddingCodeCard({ titleLines: TITLE_LINES, detail: DETAIL }),
    {
      ...size,
      fonts: [{ name: CARD_FONT_FAMILY, data: await pretendardBold, style: "normal", weight: 700 }],
    },
  );
}
