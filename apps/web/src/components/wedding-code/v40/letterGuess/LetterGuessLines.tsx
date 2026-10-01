"use client";

import type { ReactNode } from "react";
import { V40_LETTER_GUESS_COPY, letterGuessLineText } from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import type { LetterGuessSummary } from "@/lib/weddingCode/v40/letterGuess/types";
import { bodyLine, sectionTitle } from "../resultStyles";
import { cx, noteText } from "../styles";

export interface LetterGuessLinesProps {
  /** summarizeLetterGuess 가 낸 요약. none 이면 아무것도 그리지 않는다. */
  readonly summary: LetterGuessSummary;
  /** 제목 수준. 혼자 결과의 구역은 2, 두 사람 결과 안에서는 2 또는 3. */
  readonly headingLevel: 2 | 3;
  /** 한 화면 안에서 겹치지 않는 접두어(제목 id). */
  readonly idPrefix?: string;
}

const DEFAULT_ID_PREFIX = "wc40-letter-guess";

const headingClass = {
  2: sectionTitle,
  3: "text-base font-semibold leading-snug text-[var(--hb-text-strong)]",
} as const;

/** 구역 제목. 수준만 다르고 모양은 화면의 다른 구역 제목과 같다. */
export function LetterGuessHeading({ level, id, children }: { readonly level: 2 | 3; readonly id: string; readonly children: ReactNode }) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag id={id} className={headingClass[level]}>
      {children}
    </Tag>
  );
}

/**
 * 구역 안쪽: 요약 한 가지의 사실 줄과 끝 줄. 열린 구역(LetterGuessLines)과 닫힌 카드를 연 뒤(LetterGuessClosedCard)가 같은 글을 그린다.
 * none 이면 null. 줄은 먼저 고른 글자와 결과 글자가 다른 주제만 사실로 적고 같은 주제는 말하지 않는다.
 * 맞혔다, 틀렸다, 개수, 칭찬, 책망, 까닭이 없다. 끝 줄이 「다른 날에는 다르게」 한계를 말하고 이야기해 봐도 좋다고 한다.
 */
export function LetterGuessBody({ summary }: { readonly summary: LetterGuessSummary }) {
  if (summary.kind === "none") return null;
  const copy = V40_LETTER_GUESS_COPY;
  return (
    <>
      {summary.kind === "lines" ? (
        <ul role="list" className={cx(bodyLine, "mt-2 space-y-1.5")}>
          {summary.lines.map((line) => (
            <li key={line.axis} data-letter-guess-axis={line.axis}>
              {letterGuessLineText(line)}
            </li>
          ))}
        </ul>
      ) : (
        <p className={cx(bodyLine, "mt-2")} data-letter-guess-sentence={summary.kind}>
          {summary.kind === "same" ? copy.lines.same : copy.lines.unsettledOnly}
        </p>
      )}
      <p className={cx(noteText, "mt-3")} data-letter-guess-closing="">
        {copy.lines.closing}
      </p>
    </>
  );
}

/**
 * 결과 화면의 「먼저 고른 글자와 나란히」 구역(혼자 결과에서 열린 채). 주제 블록 앞, 「답을 모아 보니」 바로 아래에 놓인다.
 * 요약이 none 이면 구역 전체를 그리지 않는다(고르지 않았거나, 건너뛰었거나, 관문이 닫혔을 때).
 * 이 구역에는 고지 문장이 없다(결과 화면의 고지가 이미 한 번 있다). 이 컴포넌트는 저장소도 통계도 만지지 않는다.
 */
export function LetterGuessLines({ summary, headingLevel, idPrefix = DEFAULT_ID_PREFIX }: LetterGuessLinesProps) {
  if (summary.kind === "none") return null;
  const titleId = `${idPrefix}-title`;
  return (
    <section aria-labelledby={titleId} data-letter-guess="lines" data-letter-guess-kind={summary.kind}>
      <LetterGuessHeading level={headingLevel} id={titleId}>
        {V40_LETTER_GUESS_COPY.lines.heading}
      </LetterGuessHeading>
      <LetterGuessBody summary={summary} />
    </section>
  );
}

export default LetterGuessLines;
