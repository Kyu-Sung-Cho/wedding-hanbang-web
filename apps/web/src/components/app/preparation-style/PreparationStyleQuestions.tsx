"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import Button from "@/components/ui/Button";
import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";

export default function PreparationStyleQuestions({ initialAnswers, onReview, onCancel }: {
  initialAnswers: WeddingCodeV06Answers;
  onReview: (answers: WeddingCodeV06Answers) => void;
  onCancel: () => void;
}) {
  const { questions } = CURRENT_WEDDING_CODE_SCENE_CONFIG;
  const [answers, setAnswers] = useState(initialAnswers);
  const [index, setIndex] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const questionRef = useRef<HTMLDivElement>(null);
  const question = questions[index];
  const picked = answers[question.key];
  const last = index === questions.length - 1;

  useEffect(() => {
    questionRef.current?.focus({ preventScroll: true });
    questionRef.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [index]);

  function next(nextAnswers = answers) {
    if (last) onReview(nextAnswers);
    else setIndex(value => value + 1);
  }

  return <div className="mx-auto max-w-2xl scroll-mt-28" ref={questionRef} tabIndex={-1} aria-label={`${index + 1}번째 장면`}>
    <div className="mb-5 flex items-center justify-between gap-3">
      <Button variant="icon" label="이전 문항" disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ArrowLeft className="size-4" aria-hidden="true" /></Button>
      <p className="text-sm font-semibold text-[var(--hb-text-body)]">{index + 1} / {questions.length} 장면</p>
      <Button variant="ghost" onClick={onCancel}>답하기 그만두기</Button>
    </div>
    <p id="preparation-answer-help" className="mb-5 text-sm leading-7 text-[var(--hb-text-body)]">지금 나라면 어떻게 할지 생각해 보세요. 가장 가까운 답 하나를 고르면 돼요. 우리 상황과 맞지 않으면 건너뛰어도 괜찮아요.</p>
    <section data-question={question.key} aria-describedby="preparation-answer-help" className="overflow-hidden rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] p-5 sm:p-7">
        <h2 className="text-[var(--hb-text-strong)]">{question.scene}</h2>
        <p className="mt-3 text-sm font-semibold leading-7 text-[var(--hb-text-body)]">{question.question}</p>
      </div>
      <div className="divide-y divide-[var(--hb-hairline)]">
        {question.options.map(option => <Button key={option.value} variant="ghost" fullWidth type="button" data-option={option.value} aria-pressed={picked === option.value}
          onClick={() => setAnswers(previous => ({ ...previous, [question.key]: option.value }))}
          className={`!flex min-h-16 !justify-start !gap-4 !whitespace-normal !rounded-none py-5 text-left focus-visible:ring-inset focus-visible:!ring-offset-0 sm:px-7 ${picked === option.value ? "bg-[var(--hb-selected-bg)] hover:!bg-[var(--hb-selected-bg)]" : "hover:bg-[var(--hb-surface-hover)]"}`}>
          <span className="flex-1 text-base font-medium leading-7 text-[var(--hb-text-strong)]">{option.label}</span>
          <span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${picked === option.value ? "border-[var(--hb-selected-line)] text-[var(--hb-selected-text)]" : "border-[var(--hb-hairline)]"}`}>{picked === option.value && <Check className="size-4" />}</span>
        </Button>)}
      </div>
    </section>
    <Button variant="primary" fullWidth className="mt-5" disabled={!picked && !skipped.includes(question.key)} onClick={() => next()}>{last ? "내 답 확인하기" : "다음 문항"}<ArrowRight className="size-4" aria-hidden="true" /></Button>
    <Button variant="ghost" fullWidth className="mt-2" onClick={() => {
      const remaining = { ...answers };
      delete remaining[question.key];
      setAnswers(remaining);
      setSkipped(previous => [...new Set([...previous, question.key])]);
      next(remaining);
    }}>이 장면은 건너뛸게요</Button>
    <p className="mt-5 text-center text-xs leading-6 text-[var(--hb-text-muted)]">아직 저장하지 않았어요. 마지막에 내 답을 확인한 뒤 저장할 수 있어요.</p>
  </div>;
}
