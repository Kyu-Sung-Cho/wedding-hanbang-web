import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * `/wedding-code` 링크를 대화창에 붙였을 때 나오는 공유 카드.
 *
 * 이 파일이 없을 때는 루트 layout 의 카드(아모라 문구, `og:url=/landing`)를 물려받아서,
 * 웨딩코드를 보냈는데 받는 사람에게는 아모라 소개가 보였다.
 *
 * 카드에는 이곳이 무엇을 하는 곳인지만 적는다. 네 글자 예시나 사람을 설명하는 말은
 * 넣지 않는다. 답이 담긴 링크도 답은 `#` 뒤에 있어서 서버가 읽지 못하므로, 모든
 * 링크가 같은 일반 카드를 쓴다. `/wedding-code/together` 와 `/wedding-code/c/[code]` 는
 * 자기 metadata 에서 이 이미지 주소(`/wedding-code/opengraph-image`)를 직접 가리킨다.
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

/**
 * 웨딩코드 화면과 같은 종이 색. satori 는 CSS 변수를 못 읽으므로 리터럴로 적는다.
 * 값의 출처는 `globals.css` 의 `--hb-surface-page`, `--hb-text-strong`,
 * `--hb-text-body`, `--hb-primary`, `--hb-hairline` 이다.
 */
const PAPER = {
  sheet: "#FDFCF7",
  ink: "#3A2A27",
  inkSoft: "#5A4742",
  accent: "#8F6662",
  line: "#E2DED2",
} as const;

export default async function OpenGraphImage() {
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
          fontFamily: "Pretendard Variable",
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
              background: PAPER.accent,
              color: PAPER.sheet,
              fontSize: 24,
            }}
          >
            한
          </div>
          웨딩한방
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", color: PAPER.accent, fontSize: 30 }}>웨딩코드</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 64, lineHeight: 1.2, letterSpacing: -2 }}>
            <div style={{ display: "flex" }}>내가 원하는 결혼식과</div>
            <div style={{ display: "flex" }}>준비 방식을 살펴봐요</div>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: PAPER.inkSoft }}>
            상대도 답하면 둘이 고른 답을 나란히 볼 수 있어요
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 22,
            borderTop: `2px solid ${PAPER.line}`,
            color: PAPER.inkSoft,
            fontSize: 23,
          }}
        >
          <div style={{ display: "flex" }}>로그인 없이 시작해요</div>
          <div style={{ display: "flex" }}>hanbang.ai</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Pretendard Variable", data: await pretendardBold, style: "normal", weight: 700 }],
    },
  );
}
