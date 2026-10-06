"use client";

import { useMemo, useState } from "react";
import { axisInfo } from "@/constants/weddingCodeV40";
import { personName, V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { Axis, CoupleResult, Perspective } from "@/lib/weddingCode/v40/types";
import { AnswerDistribution } from "./AnswerEvidence";
import { peopleInOrder } from "./CoupleAxisRow";
import { buildCouplePreparationReport, type CoupleReportSource } from "./couplePreparationReport";
import { SectionHeading } from "./ShareBlock";
import { buttonFocusFix, cx, noteText } from "./styles";

export interface CouplePreparationReportProps {
  readonly result: CoupleResult;
  readonly source?: CoupleReportSource;
  readonly perspective: Perspective | null;
  readonly idPrefix: string;
  readonly headingLevel: 2 | 3;
}

const STATE_LABEL = {
  same: "같은 방향을 먼저 골랐어요",
  different: "서로 다른 방향을 먼저 골랐어요",
  even: "순서를 함께 정해 볼 주제예요",
  excluded: "비교를 잠시 보류한 주제예요",
} as const;

const EXCLUSION_NOTE = {
  unset: "한쪽 또는 두 사람의 글자를 정할 만큼 답이 모이지 않았어요. 답한 수와 빠진 답부터 확인해 주세요.",
  provisional: "한쪽 또는 두 사람에게 임시 글자가 나왔어요. 지금은 방향별 역할과 장면 비교를 보류해요.",
  gate: "응답 상태를 먼저 확인해야 해서 비교를 보류했어요. 글자가 보여도 이번 결과로 담당을 정하지 않아요.",
} as const;

/** 제안과 원응답을 함께 읽는다. 담당을 확정하거나 의사결정을 저장하지 않는다. */
export function CouplePreparationReport({ result, source, perspective, idPrefix, headingLevel }: CouplePreparationReportProps) {
  const report = useMemo(() => buildCouplePreparationReport(result, source), [result, source]);
  const [activeAxis, setActiveAxis] = useState<Axis>("money");
  const row = report.rows.find((each) => each.axis === activeAxis) ?? report.rows[0];
  const topic = axisInfo(row.axis);
  const TopicHeading = headingLevel === 2 ? "h3" : "h4";
  const titleId = `${idPrefix}-preparation-title`;
  const topicId = `${idPrefix}-preparation-topic`;
  const roles = row.roleSuggestion;
  const scene = row.evidence.scene;
  const hasAssignedCandidates = roles?.frontCandidate != null && roles.backCandidate != null;
  const roleTasks = roles ? peopleInOrder(perspective).flatMap((person) => {
    if (roles.frontCandidate === person) return [{ person, task: roles.frontTask }];
    if (roles.backCandidate === person) return [{ person, task: roles.backTask }];
    return [];
  }) : [];

  return (
    <section id={`${idPrefix}-preparation-region`} tabIndex={-1} aria-labelledby={titleId} data-couple-preparation="" className="scroll-mt-6 focus:outline-none">
      <SectionHeading level={headingLevel} id={titleId}>우리 둘의 준비 리포트</SectionHeading>
      <p className={cx(noteText, "mt-3 max-w-3xl")}>이번 답에서 먼저 고른 기준을 준비에 어떻게 써 볼지 살펴봐요. 역할은 시도해 볼 제안이에요. 실제로 맡을 일과 순서는 둘이 정해 주세요.</p>
      <div role="group" aria-label="리포트에서 살펴볼 주제" className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        {report.rows.map((each) => (
          <button key={each.axis} type="button" aria-pressed={each.axis === row.axis} aria-controls={`${idPrefix}-preparation-content`} onClick={() => setActiveAxis(each.axis)} className={cx(buttonFocusFix, "min-h-12 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors", each.axis === row.axis ? "border-[var(--hb-summary-line)] bg-[var(--hb-summary-surface)] text-[var(--hb-summary-ink)]" : "border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)]")}>
            {axisInfo(each.axis).title}
          </button>
        ))}
      </div>
      <article id={`${idPrefix}-preparation-content`} aria-labelledby={topicId} data-preparation-axis={row.axis} data-preparation-state={row.state} className="mt-5 overflow-hidden rounded-2xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]">
        <header className="border-b border-[var(--hb-hairline)] px-5 py-6 sm:px-8 sm:py-7">
          <TopicHeading id={topicId} className="text-2xl font-semibold tracking-tight text-[var(--hb-text-strong)]">{topic.title}</TopicHeading>
          <p className="mt-2 text-sm font-medium text-[var(--hb-text-muted)]">{STATE_LABEL[row.state]}</p>
          {row.exclusionReason ? <p data-preparation-exclusion={row.exclusionReason} className={cx(noteText, "mt-3 max-w-[70ch]")}>{EXCLUSION_NOTE[row.exclusionReason]}</p> : null}
        </header>
        <dl className="divide-y divide-[var(--hb-hairline)] px-5 sm:px-8">
          <div className="grid gap-3 py-6 md:grid-cols-[11rem_1fr] md:gap-8">
            <dt className="text-sm font-semibold text-[var(--hb-text-strong)]">함께 활용할 점</dt>
            <dd className="max-w-[70ch] break-keep text-[15px] leading-relaxed text-[var(--hb-text-body)]">{row.helpfulPoint}</dd>
          </div>
          <div className="grid gap-3 py-6 md:grid-cols-[11rem_1fr] md:gap-8">
            <dt className="text-sm font-semibold text-[var(--hb-text-strong)]">조율할 상황</dt>
            <dd className="max-w-[70ch] break-keep text-[15px] leading-relaxed text-[var(--hb-text-body)]">{row.coordinationSituation}</dd>
          </div>
          <div className="grid gap-3 py-6 md:grid-cols-[11rem_1fr] md:gap-8">
            <dt className="text-sm font-semibold text-[var(--hb-text-strong)]">역할을 나눠 보는 제안</dt>
            <dd className="min-w-0 max-w-[70ch] text-[15px] leading-relaxed text-[var(--hb-text-body)]">
              {roles ? <>
                <p className="break-keep">{roles.intro}</p>
                <ul className="mt-4 space-y-3" aria-label="시도해 볼 준비 역할">
                  {hasAssignedCandidates ? roleTasks.map(({ person, task }) => (
                    <li key={person} data-role-candidate={person} className="break-keep"><span className="font-semibold text-[var(--hb-text-strong)]">{personName(perspective, person)}에게 제안하는 일</span><p className="mt-1">{task}</p></li>
                  )) : [roles.frontTask, roles.backTask].map((task) => <li key={task} className="break-keep">{task}</li>)}
                </ul>
                {!hasAssignedCandidates ? <p className={cx(noteText, "mt-3")}>누가 맡을지는 글자로 정하지 않고, 각자 편한 일과 지금 낼 수 있는 시간을 함께 확인해 주세요.</p> : null}
              </> : <p className="break-keep">{report.sourceStatus === "rejected" ? "결과와 원응답을 함께 확인하지 못해 담당 제안도 보류해요. 받은 링크를 다시 열어 주세요." : "지금은 담당을 제안하지 않아요. 아래 기준을 먼저 이야기하고, 비교에서 빠진 답을 다시 살펴봐 주세요."}</p>}
            </dd>
          </div>
          <div className="grid gap-3 py-6 md:grid-cols-[11rem_1fr] md:gap-8">
            <dt className="text-sm font-semibold text-[var(--hb-text-strong)]">먼저 맞출 기준</dt>
            <dd className="max-w-[70ch] break-keep text-base font-medium leading-relaxed text-[var(--hb-text-strong)]">{row.firstCriterion}</dd>
          </div>
        </dl>
        <details key={row.axis} className="border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 sm:px-8" data-preparation-evidence="">
          <summary className="flex min-h-14 cursor-pointer items-center py-4 text-sm font-semibold text-[var(--hb-text-strong)]">이번 답의 근거 펼쳐 보기</summary>
          <div className="pb-6">
            {report.sourceStatus === "rejected" ? <p role="status" className={cx(noteText, "mb-4")}>결과와 원응답을 함께 확인하지 못해 선택 장면은 보여 주지 않아요. 받은 링크를 다시 열어 주세요.</p> : null}
            <div className="grid gap-6 min-[640px]:grid-cols-2">
              {peopleInOrder(perspective).map((person) => <div key={person} data-preparation-person={person}>
                <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{personName(perspective, person)}의 답</p>
                <AnswerDistribution axis={row.axis} counts={row.evidence[person]} compact />
              </div>)}
            </div>
            {scene ? <div className="mt-6 border-t border-[var(--hb-hairline)] pt-5" data-preparation-scene={scene.itemId}>
              <p className="text-xs font-medium text-[var(--hb-text-muted)]">실제로 답한 상황 · {scene.caption}</p>
              <div className="mt-3 space-y-2 text-base font-medium leading-relaxed text-[var(--hb-text-strong)]">{scene.prompt.map((line, index) => <p key={index} className="break-keep">{line}</p>)}</div>
              {scene.prompt.some((line) => line.includes("상대")) || scene.firstText.includes("상대") || scene.secondText.includes("상대") ? <p className={cx(noteText, "mt-2")}>{V40_COPY.couple.viewpointNote}</p> : null}
              <div className="mt-4 grid gap-4 min-[640px]:grid-cols-2">{peopleInOrder(perspective).map((person) => <div key={person} data-scene-person={person}>
                <p className="text-xs font-semibold text-[var(--hb-text-muted)]">{personName(perspective, person)}의 선택</p>
                <p className="mt-2 break-keep text-sm leading-relaxed text-[var(--hb-text-body)]">{person === "first" ? scene.firstText : scene.secondText}</p>
              </div>)}</div>
              <p className={cx(noteText, "mt-4")}>이 답 한 장면이 주제 전체를 대신하지는 않아요. 왜 골랐는지, 다른 상황에서는 무엇부터 바라는지도 함께 이야기해 주세요.</p>
            </div> : <p className={cx(noteText, "mt-5")}>{row.state === "excluded" ? "이 주제는 비교를 보류해 두 사람의 선택 장면을 나란히 보여 주지 않아요." : "이 결과에 함께 살펴볼 원문 장면이 없어요. 아래 주제별 응답과 펼쳐 볼 묶음부터 확인해 주세요."}</p>}
          </div>
        </details>
      </article>
    </section>
  );
}
