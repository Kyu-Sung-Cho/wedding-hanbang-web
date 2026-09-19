import {
  WEDDING_CODE_FIRMNESS_LABEL,
  WEDDING_CODE_LEGEND,
  type WeddingCodeLetterSlot,
  type WeddingCodeLetters,
  type WeddingCodePole,
  type WeddingCodeSide,
} from "@/lib/weddingCode/profile/letters";

const surface = "rounded-[6px] border border-[var(--hb-hairline)] bg-white";

/**
 * 자리의 양쪽 끝이 쓰는 색.
 *
 * 색은 **어느 쪽인가**만 나타낸다. 좋고 나쁨이 아니다 — 그래서 성공(sage)·경고·위험 색을
 * 쓰지 않고, 브랜드의 두 색(유칼립투스 잉크 · 더스티 모브)을 한쪽씩 맡긴다. 두 색은
 * 색상과 밝기가 모두 달라 색을 구분하기 어려운 사람에게도 막대의 경계가 보인다.
 * 칩의 점, 막대 칸, 고른 쪽 칩의 테두리가 같은 색이라 범례 없이도 짝이 읽힌다.
 */
const POLE_TONE: Readonly<Record<WeddingCodeSide, { fill: string; chosen: string }>> = {
  left: {
    fill: "bg-[var(--color-noir-800)]",
    chosen: "border-[var(--color-noir-800)] bg-[var(--color-sage-pale)]",
  },
  right: {
    fill: "bg-[var(--color-rose-500)]",
    chosen: "border-[var(--color-rose-500)] bg-[var(--color-rose-pale)]",
  },
};

/**
 * 웨딩코드 네 글자와 그 읽는 법.
 *
 * 이름이 코드인데 코드가 없으면 이 제품은 이름값을 못 한다. 다만 MBTI가 하는 두 가지 중
 * **하나만** 한다 — 답을 네 글자로 요약하는 계산은 하고, 「이 유형은 이런 사람」이라는
 * 주장은 하지 않는다. 대신 MBTI가 숨기는 것을 드러낸다: 글자마다 몇 대 몇이었는지,
 * 그리고 어떤 글자가 답 하나로 바뀌는지.
 *
 * ## 왜 범례를 접어 두지 않나 (2026-09-17)
 *
 * 팀원이 결과를 보고 「VTFH 가 무슨 뜻인지, 각 자리의 다른 글자가 뭔지 모르겠다」고 했다.
 * 설명이 「자세히 보기」 안에 접혀 있었고, 펼친 뒤에도 고른 쪽 글자만 있었다. 그래서
 * 네 축 모두 **양쪽 글자와 이름**을 늘 펼쳐 두고, 고른 답의 수를 칸 막대로 그린다.
 *
 * ## 막대를 왜 칸으로 그리나
 *
 * 한 칸이 답한 한 장면이다. 너비를 비율로 계산하면 화면에 백분율이 생기고, 이 제품은
 * 백분율·점수를 쓰지 않는다(`page.test.tsx` 가 HTML 에서 숫자 뒤 퍼센트 기호를 찾는다).
 * 칸을 flex 로 같은 몫씩 나누면 숫자 없이 같은 그림이 나온다. 답하지 않은 장면은 칸이
 * 없다 — 안 고른 답을 그리지 않는다. 막대는 읽어주지 않고(`aria-hidden`), 같은 내용을
 * 셈 문장이 글로 말한다.
 */
export default function WeddingCodeBadge({ letters }: { letters: WeddingCodeLetters }) {
  return (
    <section className={`${surface} overflow-hidden`} data-wedding-code={letters.code}>
      <div className="bg-[var(--hb-primary)] px-5 py-8 text-center text-[var(--hb-on-primary)] sm:px-8">
        <p className="text-[12px] font-semibold text-[var(--hb-on-primary)]">내 웨딩코드</p>
        <div aria-label="내 코드와 글자별 뜻" className="mx-auto mt-5 grid max-w-[28rem] grid-cols-4 gap-2">
          {letters.slots.map((slot) => (
            <div key={slot.axis} data-code-summary={slot.axis} className="min-w-0">
            <span
              data-letter={slot.axis}
              data-firmness={slot.firmness}
              className={`block text-[40px] font-semibold leading-none sm:text-[56px] ${
                slot.firmness === "narrow" || slot.firmness === "unset"
                  ? "text-[var(--color-sage-pale)]"
                  : "text-[var(--hb-on-primary)]"
              }`}
            >
              {slot.letter}
            </span>
            <span data-code-summary-label="" className="mt-3 block break-keep text-[12px] font-semibold leading-[1.6] sm:text-[14px]">
              {slot.chosen ? slot[slot.chosen].short : slot.answered === 0 ? "답한 질문 없음" : "양쪽 답이 같음"}
            </span>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-4 max-w-[30rem] text-[13px] font-medium leading-[1.7] text-[var(--hb-on-primary)]">
          {WEDDING_CODE_LEGEND.note}
          {!letters.complete ? " 건너뛴 장면이나 빈 글자(·)가 있어서, 답한 만큼만 줄인 코드예요." : ""}
        </p>
      </div>

      <div data-code-legend="">
        <h2 className="px-5 pt-5 text-[15px] font-semibold text-[var(--hb-text-strong)] sm:px-8">
          {WEDDING_CODE_LEGEND.title}
        </h2>
        <ul className="mt-1 divide-y divide-[var(--hb-hairline)]">
          {letters.slots.map((slot) => (
            <LegendRow key={slot.axis} slot={slot} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function LegendRow({ slot }: { slot: WeddingCodeLetterSlot }) {
  return (
    <li
      data-legend-axis={slot.axis}
      data-firmness={slot.firmness}
      className="px-5 py-4 sm:px-8"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] font-semibold text-[var(--hb-success)]">{slot.axisLabel}</p>
        <p className="shrink-0 text-[12px] font-medium text-[var(--hb-text-muted)]">
          {WEDDING_CODE_FIRMNESS_LABEL[slot.firmness]}
        </p>
      </div>

      {/* 좁은 화면에서는 두 칩을 한 줄에, 막대를 그 아래 한 줄 전체에 둔다. 칩이 막대를 눌러 막대가 사라지지 않게. */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap sm:gap-3">
        <WeddingCodePoleChip side="left" pole={slot.left} chosen={slot.chosen === "left"} />
        <div className="order-last basis-full sm:order-none sm:min-w-0 sm:flex-1 sm:basis-auto">
          <CountBar slot={slot} />
        </div>
        <WeddingCodePoleChip side="right" pole={slot.right} chosen={slot.chosen === "right"} />
      </div>

      <p className="mt-3 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
        {slot.meaning}
      </p>
      <p className="mt-1 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
        {slot.countLine}
      </p>
      {slot.narrowCaution ? (
        <p data-narrow-caution="" className="mt-1 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
          {slot.narrowCaution}
        </p>
      ) : null}
    </li>
  );
}

/**
 * 한 자리의 한쪽 끝(글자 + 짧은 이름). 결과 화면 범례와 `/wedding-code/c/[code]` 가 같이
 * 써서, 코드만 받은 사람도 같은 모양으로 읽는다.
 */
export function WeddingCodePoleChip({
  side,
  pole,
  chosen,
}: {
  side: WeddingCodeSide;
  pole: Pick<WeddingCodePole, "letter" | "short">;
  chosen: boolean;
}) {
  const tone = POLE_TONE[side];
  // 넓은 화면에서는 칩 너비를 고정해 네 줄의 막대 시작점을 맞춘다(가장 긴 이름 「가족·하객까지」 기준).
  return (
    <span
      data-pole={side}
      data-pole-letter={pole.letter}
      data-pole-chosen={chosen ? "true" : "false"}
      className={`inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 sm:w-[8rem] sm:justify-center ${
        chosen
          ? `${tone.chosen} text-[var(--hb-text-strong)]`
          : "border-[var(--hb-hairline)] bg-white text-[var(--hb-text-muted)]"
      }`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${tone.fill}`} />
      <span className={`text-[15px] leading-none ${chosen ? "font-bold" : "font-semibold"}`}>
        {pole.letter}
      </span>
      <span className={`text-[13px] leading-none ${chosen ? "font-semibold" : "font-medium"}`}>
        {pole.short}
      </span>
    </span>
  );
}

function CountBar({ slot }: { slot: WeddingCodeLetterSlot }) {
  const segments: { side: WeddingCodeSide; key: string }[] = [
    ...Array.from({ length: slot.left.count }, (_, index) => ({ side: "left" as const, key: `left-${index}` })),
    ...Array.from({ length: slot.right.count }, (_, index) => ({ side: "right" as const, key: `right-${index}` })),
  ];
  return (
    <div
      aria-hidden="true"
      data-count-bar=""
      data-left-count={slot.left.count}
      data-right-count={slot.right.count}
      className="flex h-3 items-stretch gap-[3px]"
    >
      {segments.length === 0 ? (
        <span data-bar-empty="" className="my-auto block w-full border-t border-dashed border-[var(--color-paper-outline)]" />
      ) : (
        segments.map((segment) => (
          <span
            key={segment.key}
            data-segment={segment.side}
            className={`block flex-1 rounded-[3px] ${POLE_TONE[segment.side].fill}`}
          />
        ))
      )}
    </div>
  );
}
