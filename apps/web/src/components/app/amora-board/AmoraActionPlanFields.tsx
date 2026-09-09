"use client";

import { useId } from "react";

type Props = {
  description: string;
  dueDate: string;
  onDescriptionChange: (value: string) => void;
  onDueDateChange: (value: string) => void;
  disabled?: boolean;
};

export default function AmoraActionPlanFields({ description, dueDate, onDescriptionChange, onDueDateChange, disabled }: Props) {
  const id = useId();
  const field = "w-full min-w-0 rounded-[9px] border border-[var(--amora-line)] bg-[var(--amora-surface)] px-3 py-2 text-[13px] text-[var(--amora-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:opacity-50";
  return <>
    <label htmlFor={`${id}-description`} className="block text-[12px] text-[var(--amora-muted)]">설명 <span>(선택)</span></label>
    <textarea id={`${id}-description`} value={description} onChange={event => onDescriptionChange(event.target.value)} maxLength={500} rows={3} disabled={disabled} className={`${field} min-h-[84px] resize-y`} placeholder="무엇을 준비하거나 확인할지 적어 주세요" />
    <label htmlFor={`${id}-date`} className="block text-[12px] text-[var(--amora-muted)]">예정일 <span>(선택)</span></label>
    <input id={`${id}-date`} data-plan-date type="text" value={dueDate} onChange={event => onDueDateChange(event.target.value)} maxLength={40} disabled={disabled} aria-describedby={`${id}-date-hint`} className={`${field} min-h-11`} placeholder="예: 2026-10-15 또는 다음 주 중" />
    <p id={`${id}-date-hint`} className="text-[12px] leading-relaxed text-[var(--amora-muted)]">날짜나 예정 시기를 40자 이내로 적을 수 있어요.</p>
  </>;
}
