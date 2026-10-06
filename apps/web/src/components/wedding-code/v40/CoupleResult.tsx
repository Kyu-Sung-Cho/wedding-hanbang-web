"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { FEATURE_SUMMARY_CLASS, SUMMARY_LABEL_CLASS } from "@/components/ui/featureSummaryStyles";
import { V40_STRENGTH, axisInfo } from "@/constants/weddingCodeV40";
import { V40_COPY, V40_COUPLE_SEND_EXTRA_COPY, legendRows, personName, type LegendLetterRow } from "@/lib/weddingCode/v40/copy";
import type { CoupleAxisRow as CoupleAxisRowData, CoupleResult as CoupleResultData, Perspective } from "@/lib/weddingCode/v40/types";
import { CoupleAxisRow, peopleInOrder } from "./CoupleAxisRow";
import { CouplePerspectiveSwitch } from "./CouplePerspectiveSwitch";
import { CoupleTalkList } from "./CoupleTalkList";
import { nicknameForCode } from "./nickname";
import type { ShareEnv, ShareSentEvent } from "./shareActions";
import { SectionHeading } from "./ShareBlock";
import { bodyText, buttonFocusFix, cx, noteText } from "./styles";
import { TwoPersonSendBlock } from "./TwoPersonSendBlock";
import { LetterDefinition } from "./LetterDefinition";
import { useWeddingCodeResultMetadata, useWeddingCodeResultVersion } from "./ResultEditionContext";
import { AnswerDistribution } from "./AnswerEvidence";
import { AxisReadingReason } from "./AxisReadingReason";
import { CouplePreparationReport } from "./CouplePreparationSection";
import { buildVerifiedCoupleIndividualResults, type CoupleReportSource } from "./couplePreparationReport";

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
  /**
   * 링크에 서로 짐작해 보기(4.1 단계 2)의 고른 쪽과 짐작이 든다는 한 줄. 주면 보내는 블록의 안내 묶음에 그린다.
   * 문구는 부모가 준다(이 화면은 트랙 폴더를 가져오지 않는다). 링크에 짐작이 없으면 주지 않는다.
   */
  readonly guessNote?: string;
}

export interface CoupleResultProps {
  /** 코어의 compareCouple 결과. 이 화면은 이 값을 합치거나 점수로 바꾸지 않는다. */
  readonly result: CoupleResultData;
  /** 실제 두 사람 결과에서 받은 원응답. 선택 장면과 각자의 개인 판정 이유를 검증해 읽는다. */
  readonly reportSource?: CoupleReportSource;
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
  /**
   * 「짐작과 답」 구역(서로 짐작해 보기, 4.1 단계 2). 이 기준(나 기준 전환의 지금 값, 모르면 null)을 받아 그릴 것을 돌려준다. 이 화면은 「이미 비슷하게 고른 질문」 목록 뒤,
   * 보내는 블록 앞에 그대로 놓고 안을 모른다. 그릴 것이 없으면 null 을 돌려준다(줄도 상자도 만들지 않는다). 없으면 그 자리를 그리지 않는다.
   */
  readonly guessSection?: (perspective: Perspective | null) => ReactNode;
  /**
   * 본인이 결과 전에 먼저 고른 글자(결과 전 글자 고르기, 4.1 단계 2)를 나란히 놓는 닫힌 카드. 「주제별 나란히 보기」 구역 바로 뒤에 놓는다.
   * 옆 사람이 같은 화면을 볼 수 있어서 부모가 기본으로 닫힌 카드를 주고, 그릴 줄이 없으면 아무것도 주지 않는다.
   */
  readonly ownLetterGuessSlot?: ReactNode;
}

function LegendLetter({ row }: { readonly row: LegendLetterRow }) {
  const { letterInfo } = useWeddingCodeResultMetadata();
  return (
    <>
      <span className="block text-[13px] font-semibold text-[var(--hb-text-strong)]">
        <span className="text-base font-bold">{row.letter}</span> {row.name}
      </span>
      <span lang="en" className="mt-1 block text-xs text-[var(--hb-text-muted)]">{row.english}</span>
      <p className="mt-2 break-keep text-sm leading-relaxed text-[var(--hb-text-body)]">{letterInfo(row.letter).meaning}</p>
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
      <table aria-labelledby={titleId} className="mt-5 block w-full text-left sm:table sm:table-fixed sm:border-collapse">
        <thead className="sr-only sm:table-header-group">
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
        <tbody className="block sm:table-row-group">
          {legendRows().map((row) => (
            <tr key={row.axis} className="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-[var(--hb-hairline)] py-3 align-top min-[520px]:grid-cols-2 sm:table-row sm:py-0">
              <th scope="row" className="pb-2 text-left text-sm font-semibold text-[var(--hb-text-strong)] min-[520px]:col-span-2 sm:table-cell sm:py-3 sm:pr-2">
                {row.title}
              </th>
              <td className="min-w-0 sm:py-3 sm:pr-2">
                <LegendLetter row={row.front} />
              </td>
              <td className="min-w-0 sm:py-3">
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
 * 위에서 아래로: 제목과 고지(이 화면에서 한 번), 두 사람의 코드, 나 기준으로 보기, 준비 리포트, 대화 장면, 주제별 나란히 보기, 글자 읽는 법 표,
 * 먼저 이야기해 볼 질문(최대 셋), 이미 비슷하게 고른 질문(최대 셋), 이 결과를 상대에게도 보내기(주면).
 * 두 코드를 하나로 합치거나 점수로 바꾸지 않고, 같은 글자 개수도 세지 않는다. 글자를 못 정했거나 임시 글자인 주제는 비교에서 뺀다.
 * 누가 나인지 알면 나를 먼저 놓는다. 그래서 두 사람의 자리를 바꿔 넣고 기준도 바꾸면 화면이 똑같다.
 * 보내는 사람의 답은 받는 사람이 자기 답을 마친 뒤에야 이 화면에 들어온다(그 순서는 부모가 지킨다).
 */
export function CoupleResult({
  result,
  reportSource,
  detectedPerspective,
  initialPerspective = null,
  onPerspectiveChange,
  send = null,
  onStartOwn,
  note,
  embedded = false,
  idPrefix,
  guessSection,
  ownLetterGuessSlot,
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
  const [talkStep, setTalkStep] = useState(0);
  const perspective: Perspective | null = chosen ?? detectedPerspective;
  const flags = noteFlags(result.axes);
  const version = useWeddingCodeResultVersion();
  const individualResults = useMemo(() => buildVerifiedCoupleIndividualResults(result, reportSource, version), [result, reportSource, version]);
  const conversationItems = result.talk.length > 0 ? result.talk : result.similar;
  const usingSimilar = result.talk.length === 0 && result.similar.length > 0;
  const activeTalkIndex = Math.min(talkStep, Math.max(0, conversationItems.length - 1));
  const activeTalk = conversationItems[activeTalkIndex];
  const personCodes = peopleInOrder(perspective).map((person) => {
    const code = result.axes.map((row) => row[person].letter ?? "·").join("");
    const provisional = result.axes.some((row) => row[person].provisional);
    const allExcluded = result.axes.every((row) => row.excluded);
    const meanings = result.axes.map((row) => ({
      axis: row.axis,
      letter: row[person].letter,
      band: row[person].shownBand,
      provisional: row[person].provisional,
      counts: row[person],
      excluded: row.excluded,
      reasonAxis: individualResults?.[person].axes.find((axis) => axis.axis === row.axis) ?? null,
    }));
    return { person, code, meanings, nickname: provisional || allExcluded ? null : nicknameForCode(code) };
  });

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

  const jumpToAxes = () => {
    const region = document.getElementById(`${prefix}-axes-region`);
    if (region === null) return;
    region.focus({ preventScroll: true });
    region.scrollIntoView?.({ block: "start" });
  };

  const jumpToReport = () => {
    const region = document.getElementById(`${prefix}-preparation-region`);
    if (region === null) return;
    region.focus({ preventScroll: true });
    region.scrollIntoView?.({ block: "start" });
  };

  return (
    <section aria-labelledby={titleId} className={cx("space-y-10 sm:space-y-14", embedded && V40_EMBEDDED_BOTTOM_SPACE)} data-embedded={embedded ? "true" : undefined}>
      <div className="space-y-6 sm:space-y-8">
      <header className="border-b border-[var(--hb-hairline)] pb-6 sm:pb-8">
        <Title id={titleId} tabIndex={-1} className="text-3xl font-semibold leading-tight tracking-tight text-[var(--hb-text-strong)] focus:outline-none sm:text-4xl">
          {V40_COPY.couple.title}
        </Title>
        <p className={cx(bodyText, "mt-4 max-w-3xl sm:text-[15px]")}>{V40_COPY.couple.notice}</p>
        {note ? <div data-couple-note="" className={cx(noteText, "mt-2")}>{note}</div> : null}
        {send !== null ? (
          <div data-couple-return-step="" className="mt-5 rounded-xl bg-[var(--hb-summary-surface)] p-4 sm:p-5">
            <p className={noteText}>{V40_COPY.couple.returnStepNote}</p>
            <Button variant="primary" size="sm" onClick={jumpToSend} className={cx(buttonFocusFix, "mt-3")}>
              {V40_COPY.couple.returnStepButton}
            </Button>
          </div>
        ) : null}
      </header>

      <section aria-label="두 사람의 네 글자" data-couple-codes="">
        <p className={cx(SUMMARY_LABEL_CLASS, "mb-4")}>각자의 준비 방식부터 읽어 볼까요?</p>
        <p className={cx(noteText, "mb-5")}>{V40_COPY.result.letterReadingNote}</p>
        <div className={cx(noteText, "mb-5 space-y-1")}><p>{V40_COPY.evidence.summaryNote}</p><p>{V40_COPY.evidence.precisionNote}</p></div>
        {individualResults === null ? <p data-couple-reasons-unavailable="" className={cx(noteText, "mb-5")}>각자의 원응답을 확인하지 못해 글자가 나온 계산 이유는 표시하지 않았어요.</p> : null}
        <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={jumpToReport} className={buttonFocusFix}>
          우리 둘의 준비 리포트 보기
        </Button>
        <Button variant="secondary" size="sm" onClick={jumpToAxes} className={buttonFocusFix}>
          {V40_COUPLE_SEND_EXTRA_COPY.axesHeading}
        </Button>
        </div>
        <div className="grid gap-4 min-[760px]:grid-cols-2 lg:gap-6">
          {personCodes.map(({ person, code, meanings, nickname }) => (
            <div key={person} data-couple-code={person} className={cx(FEATURE_SUMMARY_CLASS, "min-w-0 px-5 py-7 sm:px-7 sm:py-8")}>
              <p className={SUMMARY_LABEL_CLASS}>{V40_COPY.couple.perspective.meLabel === personName(perspective, person) ? "내 웨딩코드" : `${personName(perspective, person)}의 웨딩코드`}</p>
              <p className="mt-5 break-all text-[clamp(3rem,8vw,5rem)] font-semibold leading-none tracking-wide text-[var(--hb-text-strong)]">{code}</p>
              <ul className="mt-7 grid gap-x-5 gap-y-0 text-sm text-[var(--hb-text-body)] min-[480px]:grid-cols-2" aria-label={`${personName(perspective, person)}의 글자 뜻`}>
                {meanings.map(({ axis, letter, band, provisional, counts, excluded, reasonAxis }) => (
                  <li key={axis} className="min-w-0 break-keep border-t border-[var(--hb-summary-line)] py-3">
                    <span className="mb-1 block text-xs text-[var(--hb-summary-label)]">{axisInfo(axis).topic}</span>
                    {letter === null ? <p className="font-semibold text-[var(--hb-text-strong)]">{V40_COPY.legend.notSetLabel}</p> : <LetterDefinition letter={letter} />}
                    {letter !== null && band !== null ? <span className="mt-2 block text-xs text-[var(--hb-text-muted)]">{V40_STRENGTH[band].label}{provisional ? " · 임시" : ""}</span> : null}
                    <AnswerDistribution axis={axis} counts={counts} compact />
                    {reasonAxis ? <AxisReadingReason axis={reasonAxis} /> : null}
                    {excluded ? <p className={cx(noteText, "mt-3")}>{V40_COPY.evidence.excludedComparisonNote}</p> : null}
                  </li>
                ))}
              </ul>
              {nickname ? <p className="mt-3 border-t border-[var(--hb-summary-line)] pt-4 text-sm text-[var(--hb-text-body)]">재미 별칭 · <b className="text-lg font-semibold text-[var(--hb-text-strong)]">{nickname}</b></p> : null}
            </div>
          ))}
        </div>
        <p className={cx(noteText, "mt-4")}>별칭은 놀이로 붙인 이름이에요. 여덟 글자의 뜻은 아래 표에서, 실제 선택 방향은 주제별 줄에서 더 살펴볼 수 있어요.</p>
      </section>

      <CouplePerspectiveSwitch idPrefix={`${prefix}-perspective`} detected={detectedPerspective} value={perspective} onChange={choosePerspective} />
      </div>

      <CouplePreparationReport result={result} source={reportSource} perspective={perspective} idPrefix={prefix} headingLevel={sectionLevel} />

      <section aria-labelledby={`${prefix}-first-conversation-title`} data-couple-first-conversation="" className="rounded-2xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] p-5 [&_h2]:text-2xl [&_h3]:text-2xl sm:p-8 lg:p-10">
        <SectionHeading level={sectionLevel} id={`${prefix}-first-conversation-title`}>대화를 시작할 장면</SectionHeading>
        {activeTalk ? (
          <>
            {usingSimilar ? <p className={cx(noteText, "mt-2")}>먼저 이야기할 다른 답이 뽑히지 않아, 비슷하게 고른 답에서 대화를 시작해 볼게요.</p> : null}
            <p className="mt-6 text-sm font-semibold text-[var(--hb-text-muted)]" aria-live="polite">{axisInfo(activeTalk.axis).title} · {activeTalk.caption}</p>
            <div data-couple-talk-prompt="" className="mt-3 max-w-3xl space-y-2 text-lg font-medium leading-relaxed text-[var(--hb-text-strong)] sm:text-xl">
              {activeTalk.prompt.map((line, index) => <p key={`${activeTalk.itemId}-${index}`} className="break-keep">{line}</p>)}
            </div>
            {activeTalk.prompt.some((line) => line.includes("상대")) || activeTalk.firstText.includes("상대") || activeTalk.secondText.includes("상대") ? (
              <p className={cx(noteText, "mt-1")}>{V40_COPY.couple.viewpointNote}</p>
            ) : null}
            <div className="mt-7 grid gap-x-8 gap-y-2 md:grid-cols-2">
              {peopleInOrder(perspective).map((person) => (
                <div key={person} className="min-w-0 border-t border-[var(--hb-hairline)] py-4">
                  <p className="text-xs font-semibold text-[var(--hb-text-muted)]">{personName(perspective, person)}의 선택</p>
                  <p className="mt-2 break-keep text-base font-medium leading-relaxed text-[var(--hb-text-strong)]">{person === "first" ? activeTalk.firstText : activeTalk.secondText}</p>
                </div>
              ))}
            </div>
            <p className={cx(noteText, "mt-2")}>{V40_COPY.couple.talk.opening[activeTalk.axis]}</p>
            <p className={cx(noteText, "mt-1")}>각자 왜 그 문장을 골랐는지, 상황이 바뀌면 언제 다른 쪽을 고를지도 물어보세요.</p>
            <div className="mt-6 flex gap-2 border-t border-[var(--hb-hairline)] pt-5">
              <Button variant="secondary" size="sm" disabled={activeTalkIndex === 0} onClick={() => setTalkStep(activeTalkIndex - 1)} className={buttonFocusFix}>이전 장면</Button>
              <Button variant="secondary" size="sm" disabled={activeTalkIndex === conversationItems.length - 1} onClick={() => setTalkStep(activeTalkIndex + 1)} className={buttonFocusFix}>다음 장면</Button>
            </div>
            <p className={cx(noteText, "mt-2")} data-current-scene="" aria-live="polite">현재 장면 {activeTalkIndex + 1} / {conversationItems.length}</p>
          </>
        ) : (
          <p className={cx(noteText, "mt-2")}>이번 응답에서 먼저 이야기할 질문이 뽑히지 않았어요. 주제별 장면을 아래에서 함께 살펴볼 수 있어요.</p>
        )}
      </section>

      <section id={`${prefix}-axes-region`} tabIndex={-1} aria-labelledby={axesTitleId} data-part="axes" className="scroll-mt-6 focus:outline-none [&_h2]:text-2xl [&_h3]:text-2xl">
        <SectionHeading level={sectionLevel} id={axesTitleId}>
          {V40_COUPLE_SEND_EXTRA_COPY.axesHeading}
        </SectionHeading>
        <p className={cx(noteText, "mt-2")}>
          같은 글자여도 장면 묶음별 선택은 다를 수 있어요. 각자의 묶음을 펼쳐 비교해 보세요.
        </p>
        <p className={cx(noteText, "mt-1")}>
          각 비율은 그 사람이 이 주제에서 답한 문항 수를 분모로 센 선택 방향이에요. 반올림 때문에 합계가 조금 다를 수 있어요. 글자는 선택 강도와 묶음별 비중을 반영해 비율이 큰 쪽과 달라질 수 있어요. 글자가 바뀔 가능성이나 두 사람의 관계를 수치로 나타낸 값은 아니에요.
        </p>
        <ul role="list" className="mt-6 space-y-5">
          {result.axes.map((row, index) => (
            <CoupleAxisRow key={row.axis} row={row} perspective={perspective} showNote={flags[index]} idPrefix={prefix} headingLevel={rowLevel} />
          ))}
        </ul>
      </section>

      <CoupleLegend idPrefix={prefix} headingLevel={sectionLevel} />

      {ownLetterGuessSlot}

      <details className="rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] p-4">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-[var(--hb-text-strong)]">다르게 고른 답과 비슷하게 고른 답 더 보기</summary>
        <div className="mt-3 space-y-6">
          <CoupleTalkList kind="talk" items={result.talk} perspective={perspective} idPrefix={prefix} headingLevel={sectionLevel} />
          <CoupleTalkList kind="similar" items={result.similar} perspective={perspective} idPrefix={prefix} headingLevel={sectionLevel} />
        </div>
      </details>

      {guessSection?.(perspective)}

      {send !== null ? (
        <TwoPersonSendBlock
          headingLevel={sectionLevel}
          idPrefix={`${prefix}-send`}
          regionId={sendRegionId}
          buildUrl={send.buildUrl}
          onSent={send.onSent}
          env={send.env}
          guessNote={send.guessNote}
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
