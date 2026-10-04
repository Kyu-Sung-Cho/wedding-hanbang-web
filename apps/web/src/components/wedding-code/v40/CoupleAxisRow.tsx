"use client";

import { V40_COPY, coupleTagNote, evenCellCodeNote, letterBandCell, personName } from "@/lib/weddingCode/v40/copy";
import { V40_STRENGTH, axisInfo } from "@/constants/weddingCodeV40";
import type { CoupleAxisRow as CoupleAxisRowData, CoupleSideInfo, Perspective } from "@/lib/weddingCode/v40/types";
import { bodyText, captionText, card, cx, noteText } from "./styles";

/**
 * 두 사람을 화면에 놓는 순서. 누가 나인지 알면(first 또는 second) 나를 먼저, 상대를 다음에 놓는다.
 * 아직 모르면(null) 먼저 답한 사람, 나중에 답한 사람 순서다. 그래서 두 사람의 자리를 바꿔 넣고 기준도 바꾸면 화면이 똑같다.
 */
export function peopleInOrder(perspective: Perspective | null): readonly ["first", "second"] | readonly ["second", "first"] {
  return perspective === "second" ? ["second", "first"] : ["first", "second"];
}

export interface CoupleAxisRowProps {
  readonly row: CoupleAxisRowData;
  /** 누가 나인지. 모르면 null. */
  readonly perspective: Perspective | null;
  /**
   * 같은 글자 안내와 반반이에요 안내를 이 줄에 붙일까. 같은 말이 줄마다 되풀이되지 않도록 부모가 그 종류의 첫 줄에만 true 를 준다.
   * 다른 글자 안내는 주제마다 말이 달라서, 비교에서 뺀 자리의 안내는 그 줄의 사정이라서 이 값과 상관없이 늘 붙는다.
   */
  readonly showNote: boolean;
  /** 한 화면 안에서 겹치지 않는 접두어. */
  readonly idPrefix: string;
  /** 주제 제목의 수준. 화면 제목 아래 구역 제목이 2 이면 3, 3 이면(라운지 안) 4. 기본 4. */
  readonly headingLevel?: 3 | 4;
}

function PersonCell({ label, side }: { readonly label: string; readonly side: CoupleSideInfo }) {
  const text = letterBandCell(side.letter, side.shownBand, side.provisional);
  const letter = side.letter;
  // 반반이에요 칸은 글자를 크고 굵게 나란히 놓지 않는다. 반반이에요의 글자는 코드 칸을 채우려고 적은 것이라, 두 사람의 글자가 달라 보여도 다르다는 뜻이 아니다.
  // 세기 낱말을 앞에 두고 글자는 작은 글씨로 밝힌다.
  if (letter !== null && side.shownBand === "even") {
    return (
      <div className="min-w-0 rounded-lg bg-[var(--hb-surface-hover)] px-3 py-2" data-even-cell="">
        <p className={captionText}>{label}</p>
        <p className={cx(bodyText, "mt-1 break-keep font-medium text-[var(--hb-text-strong)]")}>
          {V40_STRENGTH.even.label}
          {side.provisional ? ` · ${V40_COPY.result.provisionalMark}` : ""}
        </p>
        <p className={cx(noteText, "mt-0.5 break-keep")}>{evenCellCodeNote(letter)}</p>
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-lg bg-[var(--hb-surface-hover)] px-3 py-2">
      <p className={captionText}>{label}</p>
      <p className={cx(bodyText, "mt-1 break-keep font-medium text-[var(--hb-text-strong)]")}>
        {letter !== null ? (
          <>
            <span className="text-xl font-bold">{letter}</span>
            {text.slice(letter.length)}
          </>
        ) : (
          text
        )}
      </p>
    </div>
  );
}

/**
 * 주제 하나에서 두 사람을 나란히 놓은 줄(목록의 항목이라 ul 안에 놓는다).
 * 두 사람의 글자와 이름과 세기 문구, 태그는 셋뿐이다: 같은 글자, 다른 글자, 한쪽 또는 둘 다 반반이에요.
 * 글자를 못 정했거나 임시 글자라서 비교에서 뺀 주제(excluded)는 태그 없이 뺐다는 안내만 붙인다
 * (글자를 못 정한 쪽에 「반반이에요」 태그를 붙이면 사실과 어긋난다). 두 코드를 합치거나 점수로 바꾸지 않는다.
 */
export function CoupleAxisRow({ row, perspective, showNote, idPrefix, headingLevel = 4 }: CoupleAxisRowProps) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const titleId = `${idPrefix}-${row.axis}-title`;
  const people = peopleInOrder(perspective);
  const noteVisible = row.excluded || row.tag === "different" || showNote;
  return (
    <li className={cx(card, "list-none p-4")} data-axis={row.axis} data-tag={row.excluded ? "excluded" : row.tag}>
      <Heading id={titleId} className="text-sm font-semibold text-[var(--hb-text-strong)]">
        {axisInfo(row.axis).title}
      </Heading>
      <div className="mt-2 grid grid-cols-1 gap-2 min-[375px]:grid-cols-2">
        {people.map((person) => (
          <PersonCell key={person} label={personName(perspective, person)} side={row[person]} />
        ))}
      </div>
      {row.excluded ? null : (
        <p className="mt-3">
          {/* 테두리 있는 알약은 누를 수 있는 단추처럼 보여서 테두리 없는 색 바탕으로 그린다(뜻은 색이 아니라 글이 전한다). */}
          <span
            data-couple-tag=""
            className="inline-flex min-h-7 items-center rounded-full bg-[var(--hb-surface-hover)] px-3 text-xs font-semibold text-[var(--hb-text-strong)]"
          >
            {V40_COPY.couple.tagLabels[row.tag]}
          </span>
        </p>
      )}
      {noteVisible ? <p className={cx(noteText, "mt-2")}>{coupleTagNote(row.axis, row.tag, row.excluded)}</p> : null}
    </li>
  );
}

export default CoupleAxisRow;
