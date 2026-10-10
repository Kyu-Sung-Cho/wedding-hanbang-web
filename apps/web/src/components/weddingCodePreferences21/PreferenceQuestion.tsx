"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";
import { SCALE_OPTIONS, SPECIAL_OPTIONS, SCALE_HELP, TOPICS, ITEMS21 } from "@/lib/weddingCode/preferences21/bank";
import type { Response } from "@/lib/weddingCode/preferences21/types";
import { ACTION, FOCUS, TEXT } from "./styles";

interface PreferenceQuestionProps {
  position: number;
  value: Response;
  responded: number;
  onAnswer: (value: Response) => void;
  onBack: () => void;
  onNext: () => void;
  onPause: () => void;
  editing?: boolean;
}

export default function PreferenceQuestion({ position, value, responded, onAnswer, onBack, onNext, onPause, editing = false }: PreferenceQuestionProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const item = ITEMS21[position];
  const topic = TOPICS.find(entry => entry.id === item.topicId)!;
  useEffect(() => {
    heading.current?.focus();
  }, [item.id]);
  return <section data-testid="p21-question" aria-labelledby="p21-question-heading">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm tabular-nums" aria-label={`현재 문항 ${position + 1} / 21`}>질문 <strong>{position + 1}</strong> / 21</p>
      <Button variant="ghost" onClick={onPause} className={ACTION}>잠시 멈추기</Button>
    </div>
    <progress value={responded} max={21} aria-label="응답 진행률" aria-valuetext={`21문항 중 ${responded}개 응답 기록`} className="mt-3 h-1.5 w-full accent-[var(--hb-action)]" />
    <p className="mt-1 text-right text-xs tabular-nums text-[var(--hb-text-body)]">응답 기록 {responded}/21</p>
    <p className="mt-7 text-sm font-semibold text-[var(--hb-selected-text)]">{topic.title}</p>
    <details className="mt-3 border-l-2 border-[var(--hb-summary-line)] pl-4" open>
      <summary className={`cursor-pointer text-xs font-semibold ${FOCUS}`}>이 장면에서 생각할 조건</summary>
      <p id="p21-context" className={`mt-2 ${TEXT}`}>{topic.context}</p>
    </details>
    <h1 id="p21-question-heading" ref={heading} tabIndex={-1} aria-describedby="p21-context" className="mt-7 text-2xl font-semibold leading-[1.65] tracking-tight outline-none [overflow-wrap:anywhere] [word-break:keep-all] sm:text-3xl">{item.statement}</h1>
    <fieldset aria-labelledby="p21-question-heading" aria-describedby="p21-scale-help" className="mt-7 grid gap-2 sm:grid-cols-5">
      {SCALE_OPTIONS.map(option => <label key={option.value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm leading-6 transition-colors sm:flex-col sm:items-start ${value === option.value ? "border-[var(--hb-action)] bg-[var(--hb-summary-surface)] font-semibold" : "border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] hover:bg-[var(--hb-surface-hover)]"}`}>
        <span className="flex shrink-0 items-center gap-2"><input type="radio" name={`answer-${item.id}`} value={option.value} checked={value === option.value} onChange={() => onAnswer(option.value)} className={`size-5 accent-[var(--hb-action)] ${FOCUS}`} /><span className="tabular-nums">{option.value}</span></span>
        <span>{option.label}</span>
      </label>)}
      <div className="mt-2 grid gap-2 sm:col-span-5 sm:grid-cols-3">
        {SPECIAL_OPTIONS.map(option => <label key={option.value} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm leading-6 ${value === option.value ? "border-[var(--hb-action)] bg-[var(--hb-summary-surface)] font-semibold" : "border-[var(--hb-hairline)]"}`}>
          <input type="radio" name={`answer-${item.id}`} value={option.value} checked={value === option.value} onChange={() => onAnswer(option.value)} className={`size-5 shrink-0 accent-[var(--hb-action)] ${FOCUS}`} /><span>{option.label}</span>
        </label>)}
      </div>
    </fieldset>
    <p id="p21-scale-help" className={`mt-4 ${TEXT}`}>{SCALE_HELP}</p>
    <div className="mt-7 flex gap-3">
      <Button variant="secondary" disabled={position === 0} onClick={onBack} className={`flex-1 ${ACTION}`}>이전 문항</Button>
      <Button variant="primary" disabled={value === null} onClick={onNext} className={`flex-1 ${ACTION}`}>{editing ? "수정한 답으로 결과 보기" : position === 20 ? "내 답으로 결과 보기" : "다음 문항"}</Button>
    </div>
  </section>;
}
