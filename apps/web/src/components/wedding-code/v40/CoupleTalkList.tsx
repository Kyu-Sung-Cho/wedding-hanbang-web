"use client";

import { V40_COPY, personName, withoutQuoteQualifier } from "@/lib/weddingCode/v40/copy";
import { V40_LAYOUT_BY_ID } from "@/lib/weddingCode/v40/layout";
import type { Axis, CoupleItemPair, Perspective } from "@/lib/weddingCode/v40/types";
import { peopleInOrder } from "./CoupleAxisRow";
import { SectionHeading } from "./ShareBlock";
import { bodyText, captionText, card, cx, noteText } from "./styles";

/** talk = 먼저 이야기해 볼 질문(다르게 고른 질문), similar = 이미 비슷하게 고른 질문. */
export type CoupleListKind = "talk" | "similar";

export interface CoupleTalkListProps {
  readonly kind: CoupleListKind;
  /** 코어의 compareCouple 이 낸 목록(최대 세 개, 이미 순서가 정해져 있다). */
  readonly items: readonly CoupleItemPair[];
  /** 누가 나인지. 모르면 null. */
  readonly perspective: Perspective | null;
  /** 한 화면 안에서 겹치지 않는 접두어. */
  readonly idPrefix: string;
  /** 제목 레벨. 기본 3. */
  readonly headingLevel?: 2 | 3;
  /**
   * 「고른 문장에는 좋은 점과 아쉬운 점이 함께 들어 있어요」 안내를 이 목록 위에 붙일까. 기본 true.
   * 한 화면에 목록이 둘이면 먼저 나오는 목록 위에 한 번만 붙이도록 부모가 뒤의 목록에 false 를 준다.
   */
  readonly showCostNote?: boolean;
}

const PARTNER_WORD = "상대";

/**
 * 「질문에 나오는 상대는 각자 자기 곁의 사람」 안내가 필요한 목록인가. 이럴 때 내 마음 질문뿐 아니라 다른 형식의 질문이나 고른 보기 글에
 * 「상대」가 들어 있어도 「나는 …, 상대는 …상대는 …」처럼 읽힐 수 있다.
 */
function needsViewpointNote(items: readonly CoupleItemPair[]): boolean {
  return items.some(
    (item) =>
      V40_LAYOUT_BY_ID.get(item.itemId)?.fmt === "react" ||
      item.caption.includes(PARTNER_WORD) ||
      item.firstText.includes(PARTNER_WORD) ||
      item.secondText.includes(PARTNER_WORD),
  );
}

/**
 * 두 사람이 같은 보기를 골랐는가. 글이 같거나, 「아주 가까워요」 「조금 가까워요」 덧말만 다르면(같은 보기를 다른 세기로 골랐다) 같은 보기다.
 * 덧말 때문에 같은 글이 두 번 나오지 않게 한다.
 */
function pickedSameOption(item: CoupleItemPair): boolean {
  return item.firstText === item.secondText || withoutQuoteQualifier(item.firstText) === withoutQuoteQualifier(item.secondText);
}

/**
 * 두 사람이 고른 질문 목록. 문항 제목과 각자 고른 보기 원문을 그대로 보여 주고 해석을 덧붙이지 않는다. 값이나 차이는 내지 않는다.
 * - talk: 목록 위에 「이 질문에서는 두 사람이 다르게 골랐어요」 한 줄, 질문이 뽑힌 주제마다 그 주제의 여는 질문을 처음 나온 항목에만 한 번 붙인다.
 * - similar: 「같은 쪽으로 골랐어요」 한 줄. 여는 질문은 없다.
 * - 한 화면에서 먼저 나오는 목록의 한 줄 안내 아래에 「고른 문장에는 그 방식의 좋은 점과 아쉬운 점이 함께 들어 있어요」 안내를 한 번 붙인다(상대를 탓하는 말로 읽지 않게).
 *   뒤의 목록에는 부모가 showCostNote={false} 를 준다.
 * - 이럴 때 내 마음 질문이 들어 있으면 목록 위에 「질문에 나오는 상대는 각자 자기 곁의 사람」 안내를 한 번 붙인다
 *   (「나는 …, 상대는 상대가 …」처럼 읽히는 혼동을 막는다).
 * - 비었으면 없었다고만 말한다.
 * 각 사람은 보기 원문 위의 작은 이름표로 부른다: 「나」 「상대」(기준을 알 때, 나가 먼저) 또는 「먼저 답한 사람」 「나중에 답한 사람」(모를 때).
 * 이름표에 조사를 붙여 보기 앞에 이어 쓰지 않는다(「나는 …순간」처럼 명사로 끝나는 보기나 남의 이야기 보기가 어색한 문장이 된다).
 */
export function CoupleTalkList({ kind, items, perspective, idPrefix, headingLevel = 3, showCostNote = true }: CoupleTalkListProps) {
  const copy = kind === "talk" ? V40_COPY.couple.talk : V40_COPY.couple.similar;
  const titleId = `${idPrefix}-${kind}-title`;
  const people = peopleInOrder(perspective);
  const openedAxes = new Set<Axis>();

  return (
    <section aria-labelledby={titleId} data-list={kind}>
      <SectionHeading level={headingLevel} id={titleId}>
        {copy.title}
      </SectionHeading>
      {items.length === 0 ? (
        <p className={cx(bodyText, "mt-2")}>{copy.none}</p>
      ) : (
        <>
          <p className={cx(bodyText, "mt-2")}>{copy.lead}</p>
          {showCostNote ? <p data-choice-cost-note="" className={cx(noteText, "mt-1")}>{V40_COPY.couple.choiceCostNote}</p> : null}
          {needsViewpointNote(items) ? <p className={cx(noteText, "mt-1")}>{V40_COPY.couple.viewpointNote}</p> : null}
          <ul role="list" className="mt-3 space-y-3">
            {items.map((item) => {
              const showOpening = kind === "talk" && !openedAxes.has(item.axis);
              openedAxes.add(item.axis);
              return (
                <li key={item.itemId} className={cx(card, "list-none p-4")} data-item={item.itemId}>
                  <p className={captionText}>{item.caption}</p>
                  <div className="mt-2 space-y-3">
                    {pickedSameOption(item) ? (
                      // 두 사람이 같은 보기를 골랐으면 같은 글을 두 번 읽히지 않고 「둘 다」 이름표 아래 한 번만 적는다.
                      <div data-both-same="">
                        <p className={captionText}>{V40_COPY.couple.bothTopic}</p>
                        <p className={cx(bodyText, "mt-0.5 text-[var(--hb-text-strong)]")}>{withoutQuoteQualifier(item.firstText)}</p>
                      </div>
                    ) : (
                      people.map((person) => (
                        <div key={person}>
                          <p className={captionText}>{personName(perspective, person)}</p>
                          <p className={cx(bodyText, "mt-0.5 text-[var(--hb-text-strong)]")}>{person === "first" ? item.firstText : item.secondText}</p>
                        </div>
                      ))
                    )}
                  </div>
                  {showOpening ? <p className={cx(noteText, "mt-3")}>{V40_COPY.couple.talk.opening[item.axis]}</p> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export default CoupleTalkList;
