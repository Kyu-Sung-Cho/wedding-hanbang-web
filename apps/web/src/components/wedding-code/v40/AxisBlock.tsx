"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { axisInfo, letterInfo, type Letter, type StrengthBand } from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  evenOneSidedLine,
  evenSideAnswersHeading,
  legendLetterCell,
  letterHeading,
  meaningLine,
  oppositeMeaningLine,
  selfChoiceParts,
  strengthSentence,
  talkLine,
  tryLine,
} from "@/lib/weddingCode/v40/copy";
import { QUOTE_LIMITS } from "@/lib/weddingCode/v40/quote";
import type { Axis, AxisQuotes, AxisResult, QuoteItem, SelfLine } from "@/lib/weddingCode/v40/types";
import { isLoweredToEven } from "./CodeLine";
import { buttonFocusFix, cx, noteText } from "./styles";
import { bodyLine, bulletList, emphasisLine, panel, sectionTitle, subTitle } from "./resultStyles";

export interface AxisBlockProps {
  /** 힌트를 반영한 뒤의 한 주제 결과(V40Result.axes 의 하나). */
  readonly axis: AxisResult;
  /** 그 주제의 인용(quote.pickQuotes). 세기와 맞지 않는 종류가 오면 인용 없이 그린다. */
  readonly quotes: AxisQuotes;
  /**
   * 내가 마지막 정리에서 고른 쪽 줄(score.selfLine). 주면 사실 한 줄로 적는다(뚜렷해요·기울어요는 세기 문장 아래, 반반이에요는 두 글자의 뜻 아래). 없거나 null 이면 그리지 않는다.
   * 이 화면도 한 번 더 지킨다: 그 주제에 직접 고른 쪽 대비가 있으면(같은 사실을 대비 문장이 말한다) 그리지 않고,
   * 다른 주제의 줄도 그리지 않는다. 글자를 못 정한 주제의 본문에는 줄 자리가 없다.
   */
  readonly selfLine?: SelfLine | null;
  /** 「이 주제 답 다시 보기」. 그 주제 질문을 다시 여는 것은 부모가 한다. */
  readonly onReview: (axis: Axis) => void;
  /** 한 화면에 블록이 여럿일 때 서로 겹치지 않는 접두어(주제 이름이 뒤에 붙는다). */
  readonly idPrefix?: string;
}

/**
 * 인용 한 묶음. 코어가 이미 개수를 줄여 주지만(quote.pickQuotes) 화면이 「최대 몇 줄」을 스스로 지킨다:
 * 글자 쪽 답 셋, 반대로 고른 답 둘, 반반이에요는 방향마다 둘.
 */
function QuoteGroup({
  heading,
  items,
  limit,
  empty,
}: {
  readonly heading: string;
  readonly items: readonly QuoteItem[];
  readonly limit: number;
  readonly empty: string;
}) {
  const shown = items.slice(0, limit);
  return (
    <div data-quote-group>
      <h3 className={subTitle}>{heading}</h3>
      {shown.length === 0 ? (
        <p className={cx(bodyLine, "mt-1")}>{empty}</p>
      ) : (
        <ul className={cx(bulletList, "mt-1")}>
          {shown.map((item) => (
            <li key={item.itemId} data-quote-item={item.itemId}>
              <span className="font-semibold text-[var(--hb-text-strong)]">{item.caption}</span>: {item.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 「더 보기」로 접히는 부분. 접힌 동안에도 글은 문서에 있고(hidden) 낭독기와 화면에서만 빠진다.
 * 단추 이름은 더 보기와 접기가 번갈아 나오고 aria-expanded 가 상태를 말한다. 어느 주제의 것인지는 주제 제목을 설명으로 가리킨다.
 * 단추는 테두리와 화살표가 있는 모양이다(테두리 없는 글자만 있으면 설명 글처럼 보여 눌러 볼 것으로 읽히지 않는다).
 */
function Fold({ id, describedBy, children }: { readonly id: string; readonly describedBy: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="border-t border-[var(--hb-hairline)] pt-3" data-fold>
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={describedBy}
        onClick={() => setOpen((previous) => !previous)}
        className={cx(buttonFocusFix, "w-full sm:w-auto")}
      >
        {open ? V40_COPY.block.lessToggle : V40_COPY.block.moreToggle}
        <Chevron aria-hidden="true" className="size-4 shrink-0" />
      </Button>
      <div id={id} hidden={!open} className="mt-3 space-y-4">
        {children}
      </div>
    </div>
  );
}

/**
 * 내가 마지막 정리에서 고른 쪽: 「D 나눠 하기」 · 아주 가까워요. 본인이 고른 것만 적는 사실 한 줄이다.
 * 시스템이 말하는 세기 문장(본문 글씨)과 같은 무게로 읽히지 않게 작고 흐린 메모 글씨로 적는다.
 * 글자 이름과 세기 낱말은 줄바꿈 없이 붙이고, 두 줄로 접히면 줄 길이를 고르게 한다(폭 320에서도 낱말이 갈라지지 않는다).
 */
function SelfLineRow({ line }: { readonly line: SelfLine | null }) {
  if (line === null) return null;
  const parts = selfChoiceParts(line);
  return (
    <p data-self-line={line.axis} className={cx(noteText, "text-balance")}>
      {parts.label} <span className="whitespace-nowrap">{parts.pick}</span> <span className="whitespace-nowrap">{parts.level}</span>
    </p>
  );
}

function ReviewButton({ onClick, describedBy }: { readonly onClick: () => void; readonly describedBy: string }) {
  return (
    <Button variant="secondary" size="sm" aria-describedby={describedBy} onClick={onClick} className={buttonFocusFix}>
      {V40_COPY.block.reviewAxisButton}
    </Button>
  );
}

interface BodyProps {
  readonly axis: AxisResult;
  readonly quotes: AxisQuotes;
  /** 이미 걸러진 줄(AxisBlock 이 조건을 확인한 뒤 넘긴다). */
  readonly selfLine: SelfLine | null;
  readonly onReview: (axis: Axis) => void;
  readonly foldId: string;
  readonly titleId: string;
}

/** 뚜렷해요, 기울어요: 글자 쪽을 앞에 두고 반대쪽 뜻과 반대로 고른 답도 함께 적는다. */
function SettledBody({
  axis,
  letter,
  band,
  quotes,
  selfLine,
  onReview,
  foldId,
  titleId,
}: BodyProps & { readonly letter: Letter; readonly band: "clear" | "lean" }) {
  const own = quotes.kind === "settled" ? quotes.own : [];
  const opposite = quotes.kind === "settled" ? quotes.opposite : [];
  const info = letterInfo(letter);
  return (
    <>
      <p data-axis-heading className={emphasisLine}>
        {letterHeading(letter, band, axis.provisional)}
      </p>
      <p className={bodyLine}>{meaningLine(letter)}</p>
      <p className={bodyLine}>{oppositeMeaningLine(letter)}</p>
      <p className={bodyLine}>{strengthSentence(axis.axis, letter, band)}</p>
      <SelfLineRow line={selfLine} />
      <QuoteGroup heading={V40_COPY.block.answersMineHeading} items={own} limit={QUOTE_LIMITS.own} empty={V40_COPY.block.noAnswersLine} />
      <QuoteGroup
        heading={V40_COPY.block.answersOppositeHeading}
        items={opposite}
        limit={QUOTE_LIMITS.opposite}
        empty={V40_COPY.block.noOppositeLine}
      />
      <Fold id={foldId} describedBy={titleId}>
        <div>
          <h3 className={subTitle}>{V40_COPY.block.appearancesHeading}</h3>
          <ul className={cx(bulletList, "mt-1")}>
            {info.appearances.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <p className={bodyLine}>{talkLine(letter)}</p>
        <p className={bodyLine}>{tryLine(letter)}</p>
        <ReviewButton onClick={() => onReview(axis.axis)} describedBy={titleId} />
      </Fold>
    </>
  );
}

/**
 * 반반이에요(임시 글자 포함): 어느 쪽도 사실로 적지 않는다. 두 글자의 뜻, 두 방향으로 고른 답, 모습과 대화 제안을 같은 무게로 나란히 둔다.
 * 코드에 적은 글자는 제목 줄과 세기 문장에서 그대로 밝히되 「다른 날에는 반대 글자가 나올 수 있어요」를 함께 적는다.
 */
function EvenBody({ axis, letter, quotes, selfLine, onReview, foldId, titleId }: BodyProps & { readonly letter: Letter }) {
  const info = axisInfo(axis.axis);
  const front = letterInfo(info.front);
  const back = letterInfo(info.back);
  const frontQuotes = quotes.kind === "even" ? quotes.front : [];
  const backQuotes = quotes.kind === "even" ? quotes.back : [];
  const lowered = isLoweredToEven(axis);
  // 답이 한쪽에만 있는 반반이에요(힌트가 낮춘 주제가 아님)는 한쪽 목록만 채워져서 세기 문장과 어긋나 보이므로 한 줄로 풀어 준다.
  const oneSided = !lowered && (frontQuotes.length === 0) !== (backQuotes.length === 0);
  const oneSidedLetter = frontQuotes.length > 0 ? front.letter : back.letter;
  return (
    <>
      <p data-axis-heading className={emphasisLine}>
        {letterHeading(letter, "even", axis.provisional)}
      </p>
      <p className={bodyLine}>{strengthSentence(axis.axis, letter, "even", lowered)}</p>
      {oneSided ? (
        <p data-even-one-sided="" className={bodyLine}>
          {evenOneSidedLine(oneSidedLetter)}
        </p>
      ) : null}
      <p className={bodyLine}>{meaningLine(front.letter)}</p>
      <p className={bodyLine}>{meaningLine(back.letter)}</p>
      {/* 「코드에는 한 글자만 …」 문장에서 떨어뜨려 두 글자의 뜻 아래에 둔다(그 문장의 이유나 모순으로 읽히지 않게). */}
      <SelfLineRow line={selfLine} />
      <div className="grid gap-4 sm:grid-cols-2">
        <QuoteGroup
          heading={evenSideAnswersHeading(front.letter)}
          items={frontQuotes}
          limit={QUOTE_LIMITS.evenEach}
          empty={V40_COPY.block.noSideAnswersLine}
        />
        <QuoteGroup
          heading={evenSideAnswersHeading(back.letter)}
          items={backQuotes}
          limit={QUOTE_LIMITS.evenEach}
          empty={V40_COPY.block.noSideAnswersLine}
        />
      </div>
      <Fold id={foldId} describedBy={titleId}>
        <div>
          <h3 className={subTitle}>{V40_COPY.block.appearancesHeading}</h3>
          <p className={cx(noteText, "mt-1")}>{V40_COPY.block.evenAppearancesNote}</p>
          <ul className={cx(bulletList, "mt-1")}>
            {[front, back].map((each) => (
              <li key={each.letter}>
                <span className="font-semibold text-[var(--hb-text-strong)]">{legendLetterCell(each.letter)}</span>: {each.appearances[0]}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[front, back].map((each) => (
            <div key={each.letter} className="space-y-1">
              <p className={subTitle}>{legendLetterCell(each.letter)}</p>
              <p className={bodyLine}>{talkLine(each.letter)}</p>
              <p className={bodyLine}>{tryLine(each.letter)}</p>
            </div>
          ))}
        </div>
        <ReviewButton onClick={() => onReview(axis.axis)} describedBy={titleId} />
      </Fold>
    </>
  );
}

/**
 * 주제 블록 하나. 기본으로 보이는 것: 주제 이름, 글자와 이름과 세기, 뜻 한 줄과 반대쪽 뜻 한 줄, 세기 문장,
 * 내가 마지막 정리에서 고른 쪽 한 줄(selfLine 을 받았고 대비가 없을 때만, 반반이에요는 두 글자의 뜻 아래),
 * 내가 고른 답(글자 쪽 최대 세 줄)과 반대로 고른 답(최대 두 줄, 보여 줄 것이 없으면 그렇다고 적음).
 * 「더 보기」로 접히는 것: 이렇게 나타날 수 있어요, 둘이 이야기해 봐요, 이렇게 해 봐요, 이 주제 답 다시 보기.
 * 글자를 못 정한 주제는 이유를 되풀이하지 않고 다시 볼 수 있다는 말과 「이 주제 답 다시 보기」만 접지 않고 보인다.
 * 세기는 힌트를 반영한 shownBand 를 쓴다. 숫자, 점수, 막대, 색 등급을 쓰지 않는다.
 */
export function AxisBlock({ axis, quotes, selfLine = null, onReview, idPrefix = "wc40-block" }: AxisBlockProps) {
  const info = axisInfo(axis.axis);
  const titleId = `${idPrefix}-${axis.axis}-title`;
  const foldId = `${idPrefix}-${axis.axis}-more`;
  const letter = axis.letter;
  const band: StrengthBand | null = axis.shownBand;
  // 대비가 있는 주제는 대비 문장이 같은 사실을 말하고, 다른 주제의 줄은 순서가 어긋난 것이라 그리지 않는다.
  // 글자를 못 정한 주제는 아래에서 줄 자리가 없는 본문(unusableNote)을 그리므로 따로 거르지 않는다.
  const shownSelfLine = selfLine !== null && selfLine.axis === axis.axis && axis.contrast === null ? selfLine : null;
  let body: ReactNode;
  if (letter === null || band === null) {
    body = (
      <>
        <p className={bodyLine}>{axis.skipped > 0 ? V40_COPY.block.unusableNote : V40_COPY.block.unusableNoteNotApplicable}</p>
        <ReviewButton onClick={() => onReview(axis.axis)} describedBy={titleId} />
      </>
    );
  } else if (band === "even") {
    body = <EvenBody axis={axis} letter={letter} quotes={quotes} selfLine={shownSelfLine} onReview={onReview} foldId={foldId} titleId={titleId} />;
  } else {
    body = (
      <SettledBody axis={axis} letter={letter} band={band} quotes={quotes} selfLine={shownSelfLine} onReview={onReview} foldId={foldId} titleId={titleId} />
    );
  }
  return (
    <section
      data-result-section="axis"
      data-axis-block={axis.axis}
      data-band={band ?? "none"}
      aria-labelledby={titleId}
      className={panel}
    >
      <h2 id={titleId} className={sectionTitle}>
        {info.title}
      </h2>
      <div className="mt-2 space-y-3">{body}</div>
    </section>
  );
}

export default AxisBlock;
