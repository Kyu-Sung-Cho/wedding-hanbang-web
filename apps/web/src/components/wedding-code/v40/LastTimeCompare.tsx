import { axisInfo, type Axis } from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  historyCell,
  historyChangedLine,
  historyLead,
  koreanDateLabel,
} from "@/lib/weddingCode/v40/copy";
import type { HistoryAxis, HistoryEntry, V40Result } from "@/lib/weddingCode/v40/types";
import { cx, noteText } from "./styles";
import { bodyLine, panel, sectionTitle } from "./resultStyles";

export interface LastTimeCompareProps {
  /** 이번 결과(힌트를 반영한 세기를 쓴다). */
  readonly result: V40Result;
  /**
   * 지난번 기록 한 건. 이번 결과를 위해 방금 남긴 기록은 빼고 그 앞의 것을 준다. 없으면 아무것도 그리지 않는다.
   * 답은 들어 있지 않고 글자와 세기, 시각뿐이다.
   */
  readonly previous: HistoryEntry | null | undefined;
  readonly idPrefix?: string;
}

type Tag = "changed" | "same" | "unstable" | "excluded";

interface CompareRow {
  readonly axis: Axis;
  readonly previous: HistoryAxis;
  readonly current: HistoryAxis;
  readonly tag: Tag;
}

/**
 * 주제 하나의 꼬리표.
 * 한쪽이라도 글자를 못 정했거나 임시 글자였으면 비교에서 뺀다(excluded).
 * 두 번 모두 기울어요 이상이면 글자가 다를 때 다르게 나왔어요, 같을 때 같은 글자예요.
 * 반반이에요가 낀 주제는 글자가 달라 보여도 다르게 나왔다고 하지 않고 반반이라 달라질 수 있다고만 적는다.
 */
function tagOf(previous: HistoryAxis, current: HistoryAxis): Tag {
  if (previous.letter === null || current.letter === null || previous.provisional || current.provisional) return "excluded";
  const settled = (band: HistoryAxis["band"]) => band === "clear" || band === "lean";
  if (!settled(previous.band) || !settled(current.band)) return "unstable";
  return previous.letter === current.letter ? "same" : "changed";
}

const TAG_TEXT: Readonly<Record<Tag, string>> = {
  changed: V40_COPY.history.changedTag,
  same: V40_COPY.history.sameTag,
  unstable: V40_COPY.history.unstableTag,
  excluded: V40_COPY.history.excludedTag,
};

/**
 * 지난번과 비교(이 기기에 기록이 있을 때만). 주제마다 지난번과 이번의 글자와 세기만 나란히 적는다. 답은 비교하지 않는다.
 * 첫 줄은 달라진 글자가 있는지 말하고, 달라진 주제는 「돈을 정할 때는 V에서 S로 바뀌었어요」처럼 한 줄씩 적는다.
 * 달라졌다고 볼 만한 것이 없으면 「글자가 같아요」라고 하지 않는다: 반반이에요가 낀 주제는 바뀌기 쉬워서 같다고 말할 수 없다.
 */
export function LastTimeCompare({ result, previous, idPrefix = "wc40-history" }: LastTimeCompareProps) {
  if (!previous) return null;
  const rows: CompareRow[] = result.axes.map((axis, index) => {
    const before = previous.axes[index];
    const now: HistoryAxis = { letter: axis.letter, band: axis.letter === null ? null : axis.shownBand, provisional: axis.provisional };
    return { axis: axis.axis, previous: before, current: now, tag: tagOf(before, now) };
  });
  const changedLines = rows.flatMap((row) =>
    row.tag === "changed" && row.previous.letter !== null && row.current.letter !== null
      ? [{ axis: row.axis, text: historyChangedLine(row.axis, row.previous.letter, row.current.letter) }]
      : [],
  );
  const hasUnstable = rows.some((row) => row.tag === "unstable");
  const hasExcluded = rows.some((row) => row.tag === "excluded");
  const titleId = `${idPrefix}-title`;
  return (
    <section data-result-section="history" aria-labelledby={titleId} className={cx(panel, "space-y-3")}>
      <h2 id={titleId} className={sectionTitle}>
        {V40_COPY.history.title}
      </h2>
      <div className="space-y-1">
        <p className={bodyLine}>{historyLead(koreanDateLabel(previous.at), changedLines.length > 0)}</p>
        {changedLines.map((line) => (
          <p key={line.axis} data-history-changed={line.axis} className={bodyLine}>
            {line.text}
          </p>
        ))}
      </div>
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="text-xs font-medium text-[var(--hb-text-muted)]">
            <th scope="col" className="w-[34%] py-1 pr-2 font-medium">
              {V40_COPY.history.topicColumn}
            </th>
            <th scope="col" className="w-[33%] py-1 pr-2 font-medium">
              {V40_COPY.history.previousColumn}
            </th>
            <th scope="col" className="w-[33%] py-1 font-medium">
              {V40_COPY.history.currentColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.axis} data-history-row={row.axis} data-history-tag={row.tag} className="border-t border-[var(--hb-hairline)] align-top">
              <th scope="row" className="break-keep py-2 pr-2 text-sm font-semibold leading-snug text-[var(--hb-text-strong)]">
                {axisInfo(row.axis).title}
              </th>
              <td className="break-keep py-2 pr-2 text-sm leading-snug text-[var(--hb-text-body)]">
                {historyCell(row.previous.letter, row.previous.band, row.previous.provisional)}
              </td>
              <td className="break-keep py-2 text-sm leading-snug text-[var(--hb-text-body)]">
                <span className="block">{historyCell(row.current.letter, row.current.band, row.current.provisional)}</span>
                <span className="mt-1 block text-xs font-medium leading-snug text-[var(--hb-text-strong)]">{TAG_TEXT[row.tag]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasUnstable ? <p className={noteText}>{V40_COPY.history.unstableNote}</p> : null}
      {hasExcluded ? <p className={noteText}>{V40_COPY.history.excludedNote}</p> : null}
    </section>
  );
}

export default LastTimeCompare;
