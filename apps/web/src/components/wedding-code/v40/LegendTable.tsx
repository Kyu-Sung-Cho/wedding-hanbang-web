import { Check } from "lucide-react";
import { V40_COPY, legendRows, myLetterCell, type CodeLineEntry, type LegendLetterRow } from "@/lib/weddingCode/v40/copy";
import type { Letter } from "@/lib/weddingCode/v40/types";
import { cardSelected, cx, noteText, srOnly } from "./styles";
import { bodyLine, sectionTitle } from "./resultStyles";

/** 표시 칸에 적는 것 하나. 혼자 보는 결과에서는 줄마다 하나, 두 사람 화면에서는 줄마다 둘이 될 수 있다. */
export interface LegendMark {
  /** 이 줄에서 강조할 글자(앞 글자나 뒤 글자). 글자를 못 정한 줄이면 null이고 어느 글자도 강조하지 않는다. */
  readonly letter: Letter | null;
  /** 표시 칸에 적을 글. 혼자 보는 결과에서는 myLetterCell 이 만든 「내 글자 S · 기울어요」다. */
  readonly text: string;
}

/**
 * 혼자 보는 결과에서 쓰는 표시: 주제 순서 네 줄, 줄마다 표시 하나.
 * 글자를 못 정한 주제는 「정하지 못했어요」만 적고 어느 글자도 강조하지 않는다.
 */
export function legendMarksFromEntries(entries: readonly CodeLineEntry[]): readonly (readonly LegendMark[])[] {
  return entries.map((entry) =>
    entry.letter === null || entry.band === null
      ? [{ letter: null, text: V40_COPY.legend.notSetLabel }]
      : [{ letter: entry.letter, text: myLetterCell(entry.letter, entry.band, entry.provisional) }],
  );
}

export interface LegendTableProps {
  /**
   * 주제 순서 네 줄의 표시. 주지 않으면 표시 칸 없이 글자와 뜻만 보인다(나, 상대를 아직 모르는 화면).
   * 두 사람 화면은 줄마다 표시를 둘 줄 수 있다.
   */
  readonly marks?: readonly (readonly LegendMark[])[];
  /** 표시 칸의 머리글. 기본은 「내 글자」. */
  readonly markColumnLabel?: string;
  /** 세기 낱말을 풀어 쓴 한 줄씩. 기본은 보인다. */
  readonly showStrengthGuide?: boolean;
  /** 한 화면에서 이 표가 둘 이상일 때 서로 겹치지 않는 접두어. */
  readonly idPrefix?: string;
}

const WITH_MARKS = "sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)]";
const WITHOUT_MARKS = "sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]";

function LetterCell({ row, mine }: { readonly row: LegendLetterRow; readonly mine: boolean }) {
  return (
    <div
      role="cell"
      data-legend-letter={row.letter}
      data-mine={mine ? "true" : undefined}
      className={cx("min-w-0 rounded-lg border border-[var(--hb-hairline)] px-3 py-2", mine && cardSelected)}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold leading-none text-[var(--hb-text-strong)]">{row.letter}</span>{" "}
        <span className="min-w-0 break-keep text-sm font-semibold leading-snug text-[var(--hb-text-strong)]">{row.name}</span>
        {mine ? <Check aria-hidden="true" className="ml-auto size-4 shrink-0 self-center text-[var(--hb-selected-text)]" /> : null}
      </div>
      <span className="mt-0.5 block text-[11px] leading-tight tracking-wide text-[var(--hb-text-muted)]">{row.english}</span>
      {mine ? <span className={srOnly}>{V40_COPY.legend.mineColumn}</span> : null}
    </div>
  );
}

/**
 * 글자 읽는 법 표(접히지 않는다): 줄마다 주제 이름 | 왼쪽 글자와 이름 | 오른쪽 글자와 이름 | 내 글자와 세기, 글자마다 작은 영어 낱말.
 * 글자 여덟 개가 표에 정확히 한 번씩 나오고 한 글자는 이 표의 이름과 뜻 하나만 가진다. 상대 결과와 두 사람 화면도 같은 표를 쓴다.
 * 내 글자는 색이 아니라 굵은 테두리, 확인 표식, 「내 글자」 글로 표시한다. 좁은 화면에서는 줄이 세로로 쌓이고 머리글은 낭독기에만 읽힌다.
 * 표 아래에 세기 낱말 세 개를 풀어 쓴 줄이 있다. 숫자로 세기를 말하지 않는다.
 */
export function LegendTable({ marks, markColumnLabel, showStrengthGuide = true, idPrefix = "wc40-legend" }: LegendTableProps) {
  const rows = legendRows();
  const hasMarks = marks !== undefined;
  const titleId = `${idPrefix}-title`;
  const descId = `${idPrefix}-desc`;
  const gridColumns = hasMarks ? WITH_MARKS : WITHOUT_MARKS;
  return (
    <section data-result-section="legend" aria-labelledby={titleId}>
      <h2 id={titleId} className={sectionTitle}>
        {V40_COPY.legend.title}
      </h2>
      <p className={cx(noteText, "mt-1")}>{V40_COPY.legend.note}</p>
      {hasMarks ? (
        <p id={descId} className={srOnly}>
          {V40_COPY.a11y.legendDescription}
        </p>
      ) : null}
      <div role="table" aria-labelledby={titleId} aria-describedby={hasMarks ? descId : undefined} className="mt-3">
        <div role="row" className={cx("sr-only sm:not-sr-only sm:mb-1 sm:grid sm:gap-2 sm:px-3", gridColumns)}>
          <div role="columnheader" className="text-xs font-medium text-[var(--hb-text-muted)]">
            {V40_COPY.legend.topicColumn}
          </div>
          <div role="columnheader" className="text-xs font-medium text-[var(--hb-text-muted)]">
            {V40_COPY.legend.frontColumn}
          </div>
          <div role="columnheader" className="text-xs font-medium text-[var(--hb-text-muted)]">
            {V40_COPY.legend.backColumn}
          </div>
          {hasMarks ? (
            <div role="columnheader" className="text-xs font-medium text-[var(--hb-text-muted)]">
              {markColumnLabel ?? V40_COPY.legend.mineColumn}
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          {rows.map((row, index) => {
            const rowMarks = marks?.[index] ?? [];
            const mineLetters = new Set(rowMarks.flatMap((mark) => (mark.letter === null ? [] : [mark.letter])));
            return (
              <div
                key={row.axis}
                role="row"
                data-legend-row={row.axis}
                className={cx(
                  "grid grid-cols-2 gap-2 rounded-xl border border-paper-outline bg-[var(--hb-surface-raised)] p-3 sm:items-center",
                  gridColumns,
                )}
              >
                <div role="rowheader" className="col-span-2 text-sm font-semibold leading-snug text-[var(--hb-text-strong)] sm:col-span-1">
                  {row.title}
                </div>
                <LetterCell row={row.front} mine={mineLetters.has(row.front.letter)} />
                <LetterCell row={row.back} mine={mineLetters.has(row.back.letter)} />
                {hasMarks ? (
                  <div role="cell" data-legend-mark className="col-span-2 space-y-0.5 text-sm font-medium leading-snug text-[var(--hb-text-strong)] sm:col-span-1">
                    {rowMarks.map((mark) => (
                      <p key={`${mark.letter ?? "none"}-${mark.text}`}>{mark.text}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {showStrengthGuide ? (
        <ul data-legend-strength className={cx(bodyLine, "mt-3 space-y-1")}>
          <li>{V40_COPY.legend.strengthGuide.clear}</li>
          <li>{V40_COPY.legend.strengthGuide.lean}</li>
          <li>{V40_COPY.legend.strengthGuide.even}</li>
        </ul>
      ) : null}
    </section>
  );
}

export default LegendTable;
