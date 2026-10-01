"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { V40_LETTER_GUESS_COPY } from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import { LetterGuessBody, LetterGuessHeading, type LetterGuessLinesProps } from "./LetterGuessLines";
import { cx, noteText } from "../styles";

const DEFAULT_ID_PREFIX = "wc40-letter-guess";

/**
 * 두 사람 결과(받는 사람의 화면)에서 「먼저 고른 글자와 나란히」를 담는 기본으로 닫힌 카드.
 *
 * 받는 사람은 혼자 보는 결과를 거치지 않고 두 사람 결과로 들어와서 옆 사람이 같은 화면을 볼 수 있다. 「내가 나를 다르게 골랐다」는 줄은
 * 본인의 자기 인식에 관한 사적인 줄이라 눌러서 열기 전에는 줄이 문서에 없다(숨기는 스타일이 아니라 아예 그리지 않는다).
 * 열린 동안에도 화면이 숨겨지면(탭을 바꾸거나 앱을 내림) 닫히고, Escape 로도 닫힌다. 「가리기」로 직접 닫을 수도 있다.
 * 요약이 none 이면 카드 전체를 그리지 않는다. 열림 상태는 이 컴포넌트 안의 메모리뿐이고 어디에도 저장하지 않는다.
 */
export function LetterGuessClosedCard({ summary, headingLevel, idPrefix = DEFAULT_ID_PREFIX }: LetterGuessLinesProps) {
  const [open, setOpen] = useState(false);
  const hasLines = summary.kind !== "none";
  // 보여 줄 줄이 없어지면 열림도 풀어 둔다(줄이 다시 생겨도 닫힌 채로 시작한다). 렌더 중 상태 맞추기: 조건이 참일 때만 한 번 부른다.
  if (open && !hasLines) setOpen(false);
  const shown = open && hasLines;

  useEffect(() => {
    if (!shown) return;
    const hideWhenBackgrounded = () => {
      if (document.visibilityState === "hidden") setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("visibilitychange", hideWhenBackgrounded);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("visibilitychange", hideWhenBackgrounded);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [shown]);

  if (!hasLines) return null;
  const copy = V40_LETTER_GUESS_COPY;
  const titleId = `${idPrefix}-title`;
  const bodyId = `${idPrefix}-body`;
  return (
    <section aria-labelledby={titleId} data-letter-guess="closed-card" data-letter-guess-open={shown ? "true" : "false"}>
      <LetterGuessHeading level={headingLevel} id={titleId}>
        {copy.lines.heading}
      </LetterGuessHeading>
      {shown ? null : <p className={cx(noteText, "mt-1")}>{copy.closedCard.note}</p>}
      <Button
        variant="secondary"
        size="md"
        aria-expanded={shown}
        aria-controls={shown ? bodyId : undefined}
        aria-describedby={titleId}
        onClick={() => setOpen((current) => !current)}
        className="mt-3 whitespace-normal!"
      >
        {shown ? copy.closedCard.closeButton : copy.closedCard.openButton}
      </Button>
      {shown ? (
        <div id={bodyId} data-letter-guess-body="">
          <LetterGuessBody summary={summary} />
        </div>
      ) : null}
    </section>
  );
}

export default LetterGuessClosedCard;
