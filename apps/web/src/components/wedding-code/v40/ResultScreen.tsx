"use client";

import type { ReactNode } from "react";
import { FEATURE_SUMMARY_CLASS, SUMMARY_LABEL_CLASS } from "@/components/ui/featureSummaryStyles";
import { V40_COPY, codeCopyText } from "@/lib/weddingCode/v40/copy";
import type { Axis, AxisQuotes, HistoryEntry, SelfLine, V40Result } from "@/lib/weddingCode/v40/types";
import { AxisBlock } from "./AxisBlock";
import { CodeLine, codeLineEntries } from "./CodeLine";
import { GatheredSentences } from "./GatheredSentences";
import { LastTimeCompare } from "./LastTimeCompare";
import { LegendTable, legendMarksFromEntries } from "./LegendTable";
import { GateNotice, QualityNotes } from "./QualityNotes";
import { RestartBlock } from "./RestartBlock";
import { ResultHeader } from "./ResultHeader";
import { SelfContrast } from "./SelfContrast";
import { TasteCard } from "./TasteCard";
import { cx, noticeBox, noticeText } from "./styles";
import { nicknameForCode } from "./nickname";

export interface ResultScreenProps {
  /** 코어가 저장된 답에서 다시 계산한 결과(score.buildResult). 글자, 세기, 관문, 품질 안내가 모두 여기서 온다. */
  readonly result: V40Result;
  /** 주제 순서 네 개의 인용(quote.pickQuotes). result.axes 와 같은 순서. */
  readonly quotes: readonly AxisQuotes[];
  /**
   * 주제 순서 네 개의 「내가 마지막에 직접 고른 쪽」 줄(score.selfLine). result.axes 와 같은 순서이고 줄이 없는 주제는 null 이다.
   * 주지 않으면 그 줄을 그리지 않는다. 직접 고른 쪽 대비가 있는 주제는 이 화면(AxisBlock)이 줄을 그리지 않는다.
   */
  readonly selfLines?: readonly (SelfLine | null)[];
  /**
   * 지난번 기록 한 건(HistoryEntry). 이 기기에 지난 기록이 있을 때만 준다. 이번 결과를 위해 방금 남긴 기록은 빼고 그 앞의 것이다.
   * 없거나 null이면 지난번과 비교 구역을 그리지 않는다.
   */
  readonly previous?: HistoryEntry | null;
  /**
   * 코드 복사. 글을 받아 클립보드에 넣고 실제로 복사했는지 돌려준다. true 를 돌려준 뒤에만 복사했다고 말한다.
   * 복사 성공 이벤트(이용 통계)를 보낼지는 부모가 정한다. 이 화면은 통계를 보내지 않는다.
   */
  readonly onCopyCode: (text: string) => boolean | Promise<boolean>;
  /** 「이 주제 답 다시 보기」. 그 주제 질문 열여섯 개를 다시 여는 것은 부모가 한다. */
  readonly onReviewAxis: (axis: Axis) => void;
  /** 넘어간 질문 다시 보기. 다시 보여 줄 질문이 있을 때만 준다(flow.skippedReviewIds 가 비어 있지 않을 때). */
  readonly onReviewSkipped?: () => void;
  /** 확인 창에서 지우고 다시 하기를 고른 뒤 부른다. */
  readonly onRestart: () => void;
  /** 확인 창에서 저장 지우기를 고른 뒤 부른다. 실제로 지웠으면 true. */
  readonly onClearStorage: () => boolean | Promise<boolean>;
  /** 취향 카드를 눌렀을 때(이용 통계와 이동은 부모가 한다). */
  readonly onOpenTaste: () => void;
  /** 코드와 분리한 취향 2부 주소. 주면 링크로 그린다. */
  readonly tasteHref?: string;
  /**
   * 상대에게 보내기 블록(다른 빌더의 화면). 지난번과 비교 뒤, 취향 카드 앞에 그대로 놓는다.
   * 코드가 없는 결과(관문)에서는 링크를 만들지 않으므로 이 자리를 그리지 않는다.
   */
  readonly sendSlot?: ReactNode;
  /**
   * 「먼저 고른 글자와 나란히」 구역(4.1 단계 2, 결과 전에 본인이 고른 글자와 결과 글자를 나란히 놓는 선택 구역). 내 답 요약 뒤, 주제 블록 앞에 놓는다.
   * 부모는 그릴 줄이 있을 때만 준다(없는데 주면 빈 상자가 흐름 간격만 남긴다). 코드가 없는 결과(관문)에서는 그리지 않는다.
   */
  readonly letterGuessSlot?: ReactNode;
  /** 라운지(/preparation-style) 안에서 쓰는가. 앱 셸 하단 탭 막대에 가리지 않게 끝에 여백을 둔다. */
  readonly embedded?: boolean;
  /**
   * 받은 링크를 열었다가 새로고침해서 링크의 답이 사라진 채 다시 열린 화면이면 그 사정을 알리는 한 줄(문구는 부모가 준다).
   * 두 사람 결과를 기다린 사람이 왜 혼자 보는 결과를 보고 있는지 알 수 있게 제목과 고지 바로 아래에 놓는다. 없으면 그리지 않는다.
   */
  readonly linkLostNote?: string;
}

const NO_QUOTES: AxisQuotes = { kind: "none" };

/**
 * 혼자 보는 결과 화면. 뜻·비율·판정 이유를 코드 아래서 읽고, 내 답 요약과 직접 고른 쪽의 차이, 주제별 근거, 전체 글자표 순서로 내려간다.
 * 주제별 근거는 응답 방향 비율, 글자 계산에 힘을 실은 장면, 실제로 고른 문장과 계산 상세를 함께 담는다.
 * 세기를 낮춘 이유(위치 반복, 건너뜀 힌트)는 모든 글자 옆 세기에 영향을 주므로 설계 5절과 계약 7.1절의 「결과 맨 위에 한 줄」대로 코드 줄 앞에 놓고
 * 아래 품질 안내에는 나머지 안내(넘어간 질문, 글자를 못 정한 주제, 임시 글자)를 둔다.
 * 코드가 없는 결과(관문)는 제목과 고지, 관문 안내, 다시 하기만 보인다. 글자 읽는 법과 링크 보내기는 만들지 않는다.
 * 이 화면은 데이터와 콜백만 받는다: 저장소, 이용 통계, 라우터, 주소를 만지지 않는다.
 */
export function ResultScreen({
  result,
  quotes,
  selfLines,
  previous = null,
  onCopyCode,
  onReviewAxis,
  onReviewSkipped,
  onRestart,
  onClearStorage,
  onOpenTaste,
  tasteHref,
  sendSlot,
  letterGuessSlot,
  embedded = false,
  linkLostNote,
}: ResultScreenProps) {
  const entries = codeLineEntries(result);
  const closed = result.gate.closed || result.code === null;
  const nickname = result.axes.some((axis) => axis.provisional) ? null : nicknameForCode(result.code);
  return (
    <div
      data-wedding-code-result
      data-embedded={embedded ? "true" : undefined}
      className={cx("flex flex-col gap-10 sm:gap-14", embedded ? "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8" : "pb-8")}
    >
      <div className="space-y-6 sm:space-y-8">
      <ResultHeader
        copyText={closed ? null : codeCopyText(entries)}
        onCopyCode={onCopyCode}
        headingLevel={embedded ? 2 : 1}
        // 글자가 없는 결과에서는 「다시 하면 글자가 달라질 수 있어요」가 맞지 않아서 글자 이야기가 없는 고지를 쓴다.
        notice={closed ? V40_COPY.receive.notice : undefined}
      />
      {linkLostNote ? (
        <p role="note" data-result-section="link-lost" className={cx(noticeBox, noticeText)}>
          {linkLostNote}
        </p>
      ) : null}
      {closed ? <GateNotice gate={result.gate} onReviewSkipped={onReviewSkipped} /> : <QualityNotes notes={result.notes} placement="top" />}
      {!closed ? (
          <div className={cx(FEATURE_SUMMARY_CLASS, "px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12")}>
            <p className={cx(SUMMARY_LABEL_CLASS, "mb-6 sm:mb-9")}>이번 답으로 만든 내 웨딩코드</p>
            <CodeLine entries={entries} axes={result.axes} />
            {nickname ? (
              <div data-result-nickname="" className="mt-8 flex flex-col gap-1 border-t border-[var(--hb-summary-line)] pt-6 sm:mt-10 sm:flex-row sm:items-baseline sm:gap-5 sm:pt-7">
                <p className={SUMMARY_LABEL_CLASS}>재미 별칭</p>
                <div>
                  <p className="text-2xl font-semibold leading-tight text-[var(--hb-text-strong)] sm:text-3xl">{nickname}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-muted)]">놀이로 붙인 이름이에요. 실제로 고른 답과 선택 방향은 아래에서 살펴볼 수 있어요.</p>
                </div>
              </div>
            ) : null}
          </div>
      ) : null}
      </div>
      {!closed ? (
        <>
          <GatheredSentences entries={entries} />
          <SelfContrast axes={result.axes} />
          {letterGuessSlot ? <div data-result-section="letter-guess">{letterGuessSlot}</div> : null}
          <div className="flex flex-col gap-6 sm:gap-8" data-axis-blocks>
            <div><p className="text-xl font-semibold text-[var(--hb-text-strong)]">{V40_COPY.evidence.professionalReportLabel}</p><p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-muted)]">{V40_COPY.evidence.professionalReportNote}</p></div>
            {result.axes.map((axis, index) => (
              <AxisBlock
                key={axis.axis}
                axis={axis}
                quotes={quotes[index] ?? NO_QUOTES}
                selfLine={selfLines?.[index] ?? null}
                onReview={onReviewAxis}
              />
            ))}
          </div>
          <LegendTable marks={legendMarksFromEntries(entries)} />
          <QualityNotes notes={result.notes} placement="list" onReviewSkipped={onReviewSkipped} />
          <LastTimeCompare result={result} previous={previous} />
          {sendSlot ? <div data-result-section="send">{sendSlot}</div> : null}
          <TasteCard onOpen={onOpenTaste} href={tasteHref} />
        </>
      ) : null}
      <RestartBlock onRestart={onRestart} onClearStorage={onClearStorage} />
    </div>
  );
}

export default ResultScreen;
