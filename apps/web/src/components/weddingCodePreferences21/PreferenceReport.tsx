"use client";

import Button from "@/components/ui/Button";
import { TOPICS } from "@/lib/weddingCode/preferences21/bank";
import type { ItemId, PreferenceReport as Report } from "@/lib/weddingCode/preferences21/types";
import { ACTION, FOCUS, PANEL, TEXT } from "./styles";

export default function PreferenceReport({ report, onEdit }: { report: Report; onEdit: (id: ItemId) => void }) {
  return <div className="space-y-6" data-testid="p21-report">
    <section className={`${PANEL} bg-[var(--hb-selected-bg)]`}>
      <p className="text-xs font-semibold tracking-widest">MY PREPARATION NOTES</p>
      <h1 id="p21-report-heading" tabIndex={-1} className="mt-3 text-3xl font-semibold leading-snug tracking-tight outline-none sm:text-4xl">{report.core.headline}</h1>
      <p className={`mt-4 ${TEXT}`}>{report.core.summary}</p>
      {report.core.highlights.length > 0 && <ul className={`mt-4 list-disc space-y-2 pl-5 ${TEXT}`}>{report.core.highlights.map((entry) => <li key={entry.itemId}>{entry.text} <span className="text-xs">· 문항 {Number(entry.itemId.slice(1))}</span></li>)}</ul>}
      <p className={`mt-4 ${TEXT}`}>선택한 문항 {report.counts.responded}/21 · 1–5 응답 {report.counts.numeric}개</p>
      <p className={`mt-1 ${TEXT}`}>모름 {report.counts.unknown} · 해당 없음 {report.counts.notApplicable} · 답하지 않음 {report.counts.skipped} · 미응답 {report.counts.unanswered}</p>
      <p className={`mt-5 border-t border-[var(--hb-hairline)] pt-4 ${TEXT}`}>{report.character.message}</p>
    </section>
    {report.counts.numeric === 0 && <section className={PANEL}>
      <h2 className="text-xl font-semibold">지금 편하게 이야기할 수 있는 다음 단계</h2>
      {report.contextCaveats.map((entry, index) => <p className={`mt-3 ${TEXT}`} key={`context-${index}`}>{entry.text}</p>)}
      <div className={`mt-3 space-y-3 ${TEXT}`}>{report.partnerQuestions.map((entry, index) => <p key={`question-${index}`}><strong>파트너와 확인</strong><br />{entry.text}</p>)}{report.actions.map((entry, index) => <p key={`action-${index}`}><strong>해볼 일</strong><br />{entry.text}</p>)}</div>
    </section>}
    <section aria-labelledby="p21-reading">
      <h2 id="p21-reading" className="text-xl font-semibold">네 장면에서 읽은 내 답</h2>
      <p className={`mt-2 ${TEXT}`}>실제 답을 먼저 확인하고, 지금도 맞는 해석인지 살펴보세요. 문항을 펼치면 근거와 함께 이야기할 말을 볼 수 있어요.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {report.topics.map((topic) => <section key={topic.id} className={PANEL}>
          <p className="text-xs font-semibold text-[var(--hb-text-body)]">SCENE {topic.id}</p>
          <h3 className="mt-2 text-lg font-semibold">{topic.title}</h3>
          <p className={`my-4 ${TEXT}`}>{topic.summary}</p>
          <div className="divide-y divide-[var(--hb-hairline)]">
            {report.evidence.filter((entry) => TOPICS.find((definition) => definition.id === topic.id)?.itemIds.some((id) => id === entry.itemId)).map((entry) => {
              const insight = topic.insights.find((candidate) => candidate.itemId === entry.itemId);
              return <details key={entry.itemId} className="py-3">
                <summary className={`min-h-12 cursor-pointer rounded-lg py-2 text-sm leading-6 ${FOCUS}`}>
                  <span className="font-semibold">{entry.number}. {entry.statement}</span><br />
                  <span className="text-[var(--hb-selected-text)]">내 답 · {entry.responseLabel}</span>
                </summary>
                <div className={`mt-3 space-y-4 ${TEXT}`}>
                  <p><strong>답의 근거</strong><br />{entry.context}<br />선택: {entry.responseLabel}</p>
                  {insight ? <>
                    <p><strong>이 답에서 읽은 선호</strong><br />{insight.observation}</p>
                    <p><strong>해석이 달라질 수 있는 조건</strong><br />{insight.contextCaveat}</p>
                    <p><strong>파트너와 확인할 질문</strong><br />{insight.partnerQuestion}</p>
                    <p><strong>이렇게 부탁해 보세요</strong><br />{insight.action}</p>
                  </> : <p>이 답으로 선호를 정하지 않았어요. 지금 설명하고 싶지 않다면 그대로 두어도 괜찮아요.</p>}
                  <Button className={ACTION} onClick={() => onEdit(entry.itemId)}>이 문항 답 수정</Button>
                </div>
              </details>;
            })}
          </div>
        </section>)}
      </div>
    </section>
    {report.combinations.length > 0 && <section className={PANEL}>
      <h2 className="text-xl font-semibold">함께 읽으면 더 구체적인 답</h2>
      <div className="mt-4 space-y-5">{report.combinations.map((note) => <div key={note.itemIds.join("-")} className={TEXT}>
        <p className="font-semibold">문항 {note.itemIds.map((id) => Number(id.slice(1))).join(" · ")}</p>
        <p>{note.message}</p><p className="mt-2">함께 확인: {note.partnerQuestion}</p><p className="mt-2">해볼 말: {note.action}</p>
      </div>)}</div>
    </section>}
    <section className={PANEL}>
      <h2 className="text-xl font-semibold">아직 이 답만으로 알 수 없는 것</h2>
      <ul className={`mt-3 list-disc space-y-2 pl-5 ${TEXT}`}>{report.unknowns.map((note, index) => <li key={`${note.kind}-${index}`}>{note.message}</li>)}</ul>
      <p className={`mt-4 ${TEXT}`}>전문가 검토·사용자 타당성 검증은 아직 진행되지 않았어요. 숨은 동기나 관계 건강을 진단하는 검사가 아닌, 지금 답을 바탕으로 준비 방식을 이야기하는 자료예요.</p>
    </section>
  </div>;
}
