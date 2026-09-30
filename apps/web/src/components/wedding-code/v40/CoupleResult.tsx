"use client";

import { useId, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { V40_COPY, V40_COUPLE_SEND_EXTRA_COPY, legendRows, type LegendLetterRow } from "@/lib/weddingCode/v40/copy";
import type { CoupleAxisRow as CoupleAxisRowData, CoupleResult as CoupleResultData, Perspective } from "@/lib/weddingCode/v40/types";
import { CoupleAxisRow } from "./CoupleAxisRow";
import { CouplePerspectiveSwitch } from "./CouplePerspectiveSwitch";
import { CoupleTalkList } from "./CoupleTalkList";
import type { ShareEnv, ShareSentEvent } from "./shareActions";
import { SectionHeading } from "./ShareBlock";
import { bodyText, buttonFocusFix, cx, noteText } from "./styles";
import { TwoPersonSendBlock } from "./TwoPersonSendBlock";

/**
 * 라운지 안(embedded)에서 쓰일 때 화면 맨 아래에 남기는 여백. 앱 셸의 하단 탭 막대(모바일에서만 보이고 아래에 고정)가
 * 마지막 블록을 가리지 않게 탭 높이와 기기 아래 여백을 더한다. 넓은 화면에는 하단 탭이 없어서 보통 여백으로 돌아간다.
 */
export const V40_EMBEDDED_BOTTOM_SPACE = "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8";

/** 두 사람의 답이 든 링크를 상대에게도 보내는 블록의 설정. 내가 이 화면에서 내 답을 마치고 두 사람 결과가 열렸을 때만 준다. */
export interface CoupleSendConfig {
  /** 먼저 답한 사람의 답이 앞, 나중에 답한 사람의 답이 뒤인 링크. 누를 때만 부른다. 만들 수 없으면 null. */
  readonly buildUrl: () => string | null;
  /** 링크를 실제로 보냈을 때. kind 가 copied 일 때만 이용 통계 wedding_code_share_copied 를 보낸다. */
  readonly onSent: (event: ShareSentEvent) => void;
  /** 시험용 공유 환경. */
  readonly env?: ShareEnv;
}

export interface CoupleResultProps {
  /** 코어의 compareCouple 결과. 이 화면은 이 값을 합치거나 점수로 바꾸지 않는다. */
  readonly result: CoupleResultData;
  /**
   * 이 기기에 저장된 본인 답이 링크의 a(first)나 b(second)와 같다고 부모가 알려 준 값(코어의 detectPerspective).
   * 맞는 것이 없으면 null이고, 그러면 누가 나인지 고르게 한다. 이 화면은 저장소를 읽지 않는다.
   */
  readonly detectedPerspective: Perspective | null;
  /**
   * 부모가 이미 아는 기준(예: 이 화면에서 방금 내 답을 마친 사람은 나중에 답한 사람). 처음 한 번만 읽는다.
   * 사람이 고른 것이 있으면 그것이, 없으면 이 값이, 그것도 없으면 detectedPerspective 가 기준이 된다.
   */
  readonly initialPerspective?: Perspective | null;
  /** 사람이 「나 기준으로 보기」를 골랐다. 저장은 이 기기에만 하고 링크에는 싣지 않는다(부모의 몫). */
  readonly onPerspectiveChange?: (perspective: Perspective) => void;
  /** 「이 결과를 상대에게도 보내기」 블록. 없으면 그리지 않는다(a 와 b 가 든 링크를 그대로 열었을 때는 주지 않는다). */
  readonly send?: CoupleSendConfig | null;
  /** 「내 웨딩코드 해 보기」 단추. 없으면 그리지 않는다. 누르면 이 결과 화면이 닫힌다는 안내가 단추 아래에 붙는다. */
  readonly onStartOwn?: () => void;
  /**
   * 고지 문장 바로 아래에 붙는 안내 한 줄(예: 새로고침하면 결과가 사라진다는 말). 제목과 고지보다 먼저 읽히지 않게 이 자리에 둔다.
   * 부모가 글을 정한다. 없으면 그리지 않는다.
   */
  readonly note?: ReactNode;
  /** 라운지 안에서 쓰이는가. 하단 탭 막대가 가리지 않게 맨 아래에 여백을 남긴다. */
  readonly embedded?: boolean;
  /** 한 화면 안에서 겹치지 않는 접두어. 없으면 자동. */
  readonly idPrefix?: string;
}

function LegendLetter({ row }: { readonly row: LegendLetterRow }) {
  return (
    <>
      <span className="block text-[13px] font-semibold text-[var(--hb-text-strong)]">
        <span className="text-base font-bold">{row.letter}</span> {row.name}
      </span>
      <span className="block text-xs text-[var(--hb-text-muted)]">{row.english}</span>
    </>
  );
}

/**
 * 글자 읽는 법 표(접히지 않음). 두 사람 화면에서는 누가 나인지 모를 수 있어서 「내 글자」 칸이 없다.
 * 글자 여덟 개가 정확히 한 번씩 나온다. 세기 낱말 셋의 풀이가 아래에 있다(숫자로 말하지 않는다).
 */
function CoupleLegend({ idPrefix, headingLevel }: { readonly idPrefix: string; readonly headingLevel: 2 | 3 }) {
  const titleId = `${idPrefix}-legend-title`;
  const legend = V40_COPY.legend;
  return (
    <section aria-labelledby={titleId} data-part="legend">
      <SectionHeading level={headingLevel} id={titleId}>
        {legend.title}
      </SectionHeading>
      <p className={cx(noteText, "mt-1")}>{legend.note}</p>
      <table aria-labelledby={titleId} className="mt-3 w-full table-fixed border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className="w-[30%] pb-2 pr-2 text-xs font-medium text-[var(--hb-text-muted)]">
              {legend.topicColumn}
            </th>
            <th scope="col" className="pb-2 pr-2 text-xs font-medium text-[var(--hb-text-muted)]">
              {legend.frontColumn}
            </th>
            <th scope="col" className="pb-2 text-xs font-medium text-[var(--hb-text-muted)]">
              {legend.backColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {legendRows().map((row) => (
            <tr key={row.axis} className="border-t border-[var(--hb-hairline)] align-top">
              <th scope="row" className="py-2 pr-2 text-left text-[13px] font-semibold text-[var(--hb-text-strong)]">
                {row.title}
              </th>
              <td className="py-2 pr-2">
                <LegendLetter row={row.front} />
              </td>
              <td className="py-2">
                <LegendLetter row={row.back} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul role="list" className={cx(noteText, "mt-3 space-y-1")}>
        <li>{legend.strengthGuide.clear}</li>
        <li>{legend.strengthGuide.lean}</li>
        <li>{legend.strengthGuide.even}</li>
      </ul>
    </section>
  );
}

/** 같은 글자 안내와 반반이에요 안내를 그 종류의 첫 줄에만 붙이도록, 줄마다 안내를 붙일지 정한다. */
function noteFlags(rows: readonly CoupleAxisRowData[]): readonly boolean[] {
  let sameSeen = false;
  let evenSeen = false;
  return rows.map((row) => {
    if (row.excluded) return false;
    if (row.tag === "same" && !sameSeen) {
      sameSeen = true;
      return true;
    }
    if (row.tag === "even" && !evenSeen) {
      evenSeen = true;
      return true;
    }
    return false;
  });
}

/**
 * 우리 둘의 웨딩코드(두 사람 결과). 링크 전용이라 서버 요청과 저장이 없고, 받은 데이터와 콜백만 다룬다.
 * 위에서 아래로: 제목과 고지(이 화면에서 한 번), 나 기준으로 보기, 글자 읽는 법 표(한 번), 주제별 나란히 보기(태그 셋뿐),
 * 먼저 이야기해 볼 질문(최대 셋), 이미 비슷하게 고른 질문(최대 셋), 이 결과를 상대에게도 보내기(주면).
 * 두 코드를 하나로 합치거나 점수로 바꾸지 않고, 같은 글자 개수도 세지 않는다. 글자를 못 정했거나 임시 글자인 주제는 비교에서 뺀다.
 * 누가 나인지 알면 나를 먼저 놓는다. 그래서 두 사람의 자리를 바꿔 넣고 기준도 바꾸면 화면이 똑같다.
 * 보내는 사람의 답은 받는 사람이 자기 답을 마친 뒤에야 이 화면에 들어온다(그 순서는 부모가 지킨다).
 */
export function CoupleResult({
  result,
  detectedPerspective,
  initialPerspective = null,
  onPerspectiveChange,
  send = null,
  onStartOwn,
  note,
  embedded = false,
  idPrefix,
}: CoupleResultProps) {
  const uid = useId();
  const prefix = idPrefix ?? `wc40-couple${uid}`;
  const titleId = `${prefix}-title`;
  const axesTitleId = `${prefix}-axes-title`;
  const startOwnNoteId = `${prefix}-start-own-note`;
  // 이 화면이 페이지의 첫 화면이면 제목이 h1 이다. 라운지 안(embedded)에서는 바깥 화면이 h1 을 가진다.
  // 제목 수준은 한 단계씩만 내려간다(제목 다음에 바로 소제목의 소제목이 오지 않는다): 제목 h1 이면 구역 h2, 주제 줄 h3. 라운지 안이면 한 단계씩 아래.
  const Title = embedded ? "h2" : "h1";
  const sectionLevel = embedded ? 3 : 2;
  const rowLevel = embedded ? 4 : 3;
  const sendRegionId = `${prefix}-send`;
  const [chosen, setChosen] = useState<Perspective | null>(initialPerspective);
  const perspective: Perspective | null = chosen ?? detectedPerspective;
  const flags = noteFlags(result.axes);

  const choosePerspective = (next: Perspective) => {
    setChosen(next);
    onPerspectiveChange?.(next);
  };

  // 화면 위쪽의 「상대에게 보내는 곳으로 가기」: 보내는 블록은 결과 맨 아래라서 단추로 초점과 스크롤을 옮겨 준다.
  const jumpToSend = () => {
    const region = document.getElementById(sendRegionId);
    if (region === null) return;
    region.focus({ preventScroll: true });
    region.scrollIntoView?.({ block: "start" });
  };

  return (
    <section aria-labelledby={titleId} className={cx("space-y-8", embedded && V40_EMBEDDED_BOTTOM_SPACE)} data-embedded={embedded ? "true" : undefined}>
      <header>
        <Title id={titleId} tabIndex={-1} className="text-xl font-semibold leading-snug text-[var(--hb-text-strong)] focus:outline-none">
          {V40_COPY.couple.title}
        </Title>
        <p className={cx(bodyText, "mt-2")}>{V40_COPY.couple.notice}</p>
        {note ? <div data-couple-note="" className={cx(noteText, "mt-2")}>{note}</div> : null}
        {send !== null ? (
          <div data-couple-return-step="" className="mt-3 space-y-2">
            <p className={noteText}>{V40_COPY.couple.returnStepNote}</p>
            <Button variant="secondary" size="sm" onClick={jumpToSend} className={buttonFocusFix}>
              {V40_COPY.couple.returnStepButton}
            </Button>
          </div>
        ) : null}
      </header>

      <CouplePerspectiveSwitch idPrefix={`${prefix}-perspective`} detected={detectedPerspective} value={perspective} onChange={choosePerspective} />

      <CoupleLegend idPrefix={prefix} headingLevel={sectionLevel} />

      <section aria-labelledby={axesTitleId} data-part="axes">
        <SectionHeading level={sectionLevel} id={axesTitleId}>
          {V40_COUPLE_SEND_EXTRA_COPY.axesHeading}
        </SectionHeading>
        <ul role="list" className="mt-3 space-y-3">
          {result.axes.map((row, index) => (
            <CoupleAxisRow key={row.axis} row={row} perspective={perspective} showNote={flags[index]} idPrefix={prefix} headingLevel={rowLevel} />
          ))}
        </ul>
      </section>

      <CoupleTalkList kind="talk" items={result.talk} perspective={perspective} idPrefix={prefix} headingLevel={sectionLevel} />
      <CoupleTalkList kind="similar" items={result.similar} perspective={perspective} idPrefix={prefix} headingLevel={sectionLevel} />

      {send !== null ? (
        <TwoPersonSendBlock
          headingLevel={sectionLevel}
          idPrefix={`${prefix}-send`}
          regionId={sendRegionId}
          buildUrl={send.buildUrl}
          onSent={send.onSent}
          env={send.env}
        />
      ) : null}

      {onStartOwn !== undefined ? (
        <div>
          <Button variant="secondary" fullWidth aria-describedby={startOwnNoteId} onClick={onStartOwn} className={buttonFocusFix}>
            {V40_COPY.couple.startOwnButton}
          </Button>
          <p id={startOwnNoteId} className={cx(noteText, "mt-2")}>
            {V40_COPY.couple.startOwnNote}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default CoupleResult;
