import type { ReactElement } from "react";

/**
 * 웨딩코드 공유 카드(1200x630)의 틀. 판마다 바뀌는 글은 두 가지뿐이다: 큰 글(줄마다 따로)과 그 아래 작은 글 한 줄.
 * 그 밖의 것(브랜드 줄, 「웨딩코드」 라벨, 아래 줄의 「로그인 없이 시작해요」와 주소)은 어느 판에서나 같은 말이라 여기서 한 번만 적는다.
 *
 * 쓰는 곳: `opengraph-image.tsx`(기본 카드)와 `v40-card/opengraph-image.tsx`(v4 카드).
 * 글꼴 파일은 각 카드 파일이 `process.cwd()` 기준으로 직접 읽는다(다른 카드 파일들과 같은 모양이어야 배포 때 글꼴이 함께 실린다).
 *
 * 이 함수는 컴포넌트가 아니라 JSX 를 만들어 주는 함수다. satori(next/og)에 넘기는 나무가 이전 파일에 그대로 쓰여 있던 나무와
 * 같아야 기본 카드의 PNG 가 한 바이트도 달라지지 않는다(`opengraph-image.test.tsx` 가 그림에 든 글자를 지킨다. 틀을 손볼 때는 기본 카드 PNG 의
 * 해시를 전후로 견줘 본다).
 */

/** 카드 파일이 ImageResponse 의 fonts 옵션에 같은 이름으로 글꼴을 실어야 한다. */
export const CARD_FONT_FAMILY = "Pretendard Variable";

/**
 * 웨딩코드 화면과 같은 종이 색. satori 는 CSS 변수를 못 읽으므로 리터럴로 적는다.
 * 값의 출처는 `globals.css` 의 `--hb-surface-page`, `--hb-text-strong`,
 * `--hb-text-body`, `--hb-primary`, `--hb-hairline` 이다.
 */
export const PAPER = {
  sheet: "#FDFCF7",
  ink: "#3A2A27",
  inkSoft: "#5A4742",
  accent: "#8F6662",
  line: "#E2DED2",
} as const;

export interface WeddingCodeCardText {
  /** 큰 글. 한 항목이 한 줄이다(줄 바꿈 자리는 글을 쓰는 쪽이 정한다). */
  readonly titleLines: readonly string[];
  /** 큰 글 아래 작은 글 한 줄. */
  readonly detail: string;
}

export function weddingCodeCard({ titleLines, detail }: WeddingCodeCardText): ReactElement {
  return (
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
        fontFamily: CARD_FONT_FAMILY,
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
          {titleLines.map((line) => (
            <div key={line} style={{ display: "flex" }}>{line}</div>
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: PAPER.inkSoft }}>
          {detail}
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
  );
}
