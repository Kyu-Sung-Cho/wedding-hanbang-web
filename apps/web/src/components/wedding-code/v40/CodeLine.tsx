import { V40_STRENGTH, V40_UNSET_LETTER_MARK, letterInfo } from "@/constants/weddingCodeV40";
import { V40_COPY, codeLineAccessibleName, type CodeLineEntry } from "@/lib/weddingCode/v40/copy";
import type { AxisResult, V40Result } from "@/lib/weddingCode/v40/types";
import { noteText } from "./styles";
import { pill } from "./resultStyles";
import { LetterDefinition } from "./LetterDefinition";
import { AnswerDistribution } from "./AnswerEvidence";
import { AxisReadingReason } from "./AxisReadingReason";

/**
 * 힌트(위치 반복, 건너뜀)가 이 주제의 세기를 기울어요에서 반반이에요로 낮췄는가.
 * 이런 주제는 낮추기 전에는 한쪽으로 기울어 있었으므로 「어느 쪽으로도 크게 기울지 않았어요」라고 하면 보여 주는 답과 어긋난다.
 * (뚜렷해요에서 기울어요로 낮춘 주제는 기울어요 문장이 그대로 참이라 여기에 들지 않는다.)
 */
export function isLoweredToEven(axis: AxisResult): boolean {
  return axis.letter !== null && axis.band === "lean" && axis.shownBand === "even";
}

/**
 * 결과에서 코드 줄, 글자 읽는 법, 「답을 모아 보니」, 코드 복사가 함께 읽는 주제별 한 줄 요약.
 * 세기는 힌트를 반영한 뒤의 shownBand 이고, 글자를 못 정한 주제는 letter 와 band 가 모두 null 이다.
 * 힌트가 기울어요를 반반이에요로 낮춘 주제에만 lowered 가 붙는다.
 */
export function codeLineEntries(result: V40Result): readonly CodeLineEntry[] {
  return result.axes.map((axis) => ({
    axis: axis.axis,
    letter: axis.letter,
    band: axis.letter === null ? null : axis.shownBand,
    provisional: axis.provisional,
    ...(isLoweredToEven(axis) ? { lowered: true as const } : {}),
  }));
}

export interface CodeLineProps {
  /** 주제 순서 네 개(돈, 준비, 정하는 사람, 지쳤을 때). */
  readonly entries: readonly CodeLineEntry[];
  /** 실제 응답 분포와 판정 이유. 코드 요약만 있는 화면은 생략할 수 있다. */
  readonly axes?: readonly AxisResult[];
}

/**
 * 코드 줄: 큰 글자 네 개, 각 글자 위에 작은 주제 이름, 각 글자 아래에 그 글자의 이름(「조건 먼저」처럼, 글자 읽는 법 표를 내려가 보지 않아도 뜻이 보이게),
 * 반반이에요 글자에는 그 아래 「반반」 표시.
 * 코드 줄 전체에 낭독용 이름표 하나를 붙이고 안쪽은 낭독기에서 빼서(같은 말을 두 번 읽지 않게) 이름표가 코드 줄의 뜻을 모두 말한다.
 * 임시 글자는 「반반」과 「임시」 표시를 함께 달고, 글자를 못 정한 주제는 가운뎃점과 그 사실을 적는다.
 * 반반이에요 글자가 하나라도 있으면 줄 아래에 한 줄 안내가 붙는다. 뜻은 색이 아니라 글과 모양으로 전한다.
 */
export function CodeLine({ entries, axes }: CodeLineProps) {
  const hasEven = entries.some((entry) => entry.letter !== null && entry.band === "even");
  const hasLowered = entries.some((entry) => entry.lowered === true);
  // 글자 아래 표시(반반, 임시, 정하지 못했어요)가 하나도 없으면 그 줄의 높이를 남겨 두지 않는다(글자 밑이 텅 비어 코드 줄이 끝나지 않은 것처럼 보였다).
  return (
    <section data-result-section="code">
      <div
        role="img"
        aria-label={codeLineAccessibleName(entries)}
        className="grid grid-cols-4 gap-0"
      >
        {entries.map((entry) => (
          <div
            key={entry.axis}
            data-code-axis={entry.axis}
            className="flex min-w-0 flex-col items-center gap-2 border-l border-[var(--hb-summary-line)] px-1 text-center first:border-l-0 sm:gap-3 sm:px-4"
          >
            <span className="flex min-h-8 items-end justify-center break-keep text-xs font-semibold leading-tight text-[var(--hb-summary-label)] sm:text-sm">
              {V40_COPY.result.topicLabels[entry.axis]}
            </span>
            <span
              data-code-letter={entry.letter ?? V40_UNSET_LETTER_MARK}
              className="text-[clamp(3rem,10vw,6.5rem)] font-semibold leading-none tracking-tight text-[var(--hb-text-strong)]"
            >
              {entry.letter ?? V40_UNSET_LETTER_MARK}
            </span>
            <span
              data-code-letter-name=""
              className="flex min-h-8 items-start justify-center break-keep text-xs font-semibold leading-tight text-[var(--hb-text-body)] sm:text-base"
            >
              {entry.letter === null ? null : letterInfo(entry.letter).name}
            </span>
            <span className="flex min-h-8 flex-col items-center gap-1">
              {entry.letter === null ? (
                <span className="break-keep text-[11px] leading-tight text-[var(--hb-text-muted)]">
                  {V40_COPY.result.unsetLetterLabel}
                </span>
              ) : (
                <>
                    {entry.band !== null ? <span className={pill}>{entry.band === "even" ? V40_COPY.result.evenMark : V40_STRENGTH[entry.band].label}</span> : null}
                  {entry.provisional ? <span className={pill}>{V40_COPY.result.provisionalMark}</span> : null}
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      {hasEven ? (
        <p className={`${noteText} mt-3 text-center`}>{hasLowered ? V40_COPY.result.evenCodeNoteLowered : V40_COPY.result.evenCodeNote}</p>
      ) : null}
      <p className={`${noteText} mt-7`}>{V40_COPY.result.letterReadingNote}</p>
      {axes ? <div className={`${noteText} mt-3 space-y-1`}><p>{V40_COPY.evidence.summaryNote}</p><p>{V40_COPY.evidence.precisionNote}</p></div> : null}
      <ul aria-label={V40_COPY.result.letterReadingLabel} className="mt-4 grid gap-x-8 sm:grid-cols-2">
        {entries.map((entry) => {
          const answerAxis = axes?.find((axis) => axis.axis === entry.axis);
          return (
          <li key={entry.axis} data-code-reading-axis={entry.axis} className="min-w-0 border-t border-[var(--hb-summary-line)] py-4">
            <p className="mb-2 text-xs text-[var(--hb-summary-label)]">{V40_COPY.result.topicLabels[entry.axis]}</p>
            {entry.letter === null ? (
              <p className={noteText}>{V40_COPY.result.unsetLetterLabel}</p>
            ) : (
              <>
                <LetterDefinition letter={entry.letter} />
                <p className="mt-2 text-xs text-[var(--hb-text-muted)]">
                  {entry.band !== null ? V40_STRENGTH[entry.band].label : null}
                  {entry.provisional ? ` · ${V40_COPY.result.provisionalMark}` : ""}
                </p>
              </>
            )}
            {answerAxis ? <><AnswerDistribution axis={entry.axis} counts={answerAxis} compact /><AxisReadingReason axis={answerAxis} /></> : null}
          </li>
          );
        })}
      </ul>
    </section>
  );
}

export default CodeLine;
