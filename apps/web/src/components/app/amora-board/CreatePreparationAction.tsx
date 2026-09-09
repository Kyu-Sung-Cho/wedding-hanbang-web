"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { AmoraPreparationActionCreate } from "@/hooks/useAmoraPreparationActions";
import AmoraActionPlanFields from "./AmoraActionPlanFields";

type Props = {
  create: (fields: AmoraPreparationActionCreate) => Promise<boolean>;
  cancelCreate: () => boolean;
  locked: boolean;
  busy: boolean;
  available: boolean;
  isDemo: boolean;
  onCreated: () => void;
  focusIntent: (origin: HTMLElement | null) => () => boolean;
};

export default function CreatePreparationAction({ create, cancelCreate, locked, busy, available, isDemo, onCreated, focusIntent }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const finishFocus = useRef<(() => boolean) | null>(null);
  useLayoutEffect(() => {
    const finish = finishFocus.current; finishFocus.current = null;
    if (finish?.()) (open ? titleInput.current : trigger.current)?.focus();
  }, [open]);
  const close = (origin: HTMLElement | null) => {
    finishFocus.current = focusIntent(origin); setOpen(false);
  };
  const button = "rounded-full! px-4! text-[13px]! [font-weight:inherit]! whitespace-normal! gap-0! transition-none! duration-0! focus-visible:outline-solid! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-[var(--amora-accent)]! focus-visible:ring-0! focus-visible:ring-offset-0! disabled:opacity-40!";
  return <div className="mb-4">
    <Button ref={trigger} variant="secondary" type="button" aria-expanded={open} aria-controls={id} disabled={!available || busy} onClick={event => {
      finishFocus.current = focusIntent(event.currentTarget); setOpen(value => !value);
    }} className={`${button} border-[var(--amora-line)]! bg-[var(--amora-surface)]! text-[var(--amora-ink)]! hover:bg-[var(--amora-surface)]!`}>{open ? "추가 양식 닫기" : "공유 할 일 추가"}</Button>
    {isDemo && <p className="mt-1 text-[12px] text-[var(--amora-muted)]">새 할 일은 로그인 후 추가할 수 있어요.</p>}
    {open && <form id={id} aria-label="공유 할 일 추가" aria-busy={busy} className="mt-3 max-w-xl space-y-2 rounded-[14px] border border-[var(--amora-line)] bg-[var(--amora-warm)] p-4" onSubmit={async event => {
      event.preventDefault();
      if (!available || busy || inFlight.current || !title.trim() || title.trim().length > 120 || description.length > 500 || dueDate.length > 40) return;
      inFlight.current = true;
      const active = document.activeElement;
      const finish = focusIntent(active instanceof HTMLElement && event.currentTarget.contains(active) ? active : null);
      try {
        if (await create({ title: title.trim(), ...(category ? { category_key: category } : {}), ...(description ? { description } : {}), ...(dueDate ? { due_date: dueDate } : {}) })) {
          finishFocus.current = finish;
          setConfirmCancel(false); setTitle(""); setCategory(""); setDescription(""); setDueDate(""); setOpen(false); onCreated();
        } else finish();
      } finally { inFlight.current = false; }
    }}>
      <label htmlFor={`${id}-title`} className="block text-[12px] text-[var(--amora-muted)]">할 일 제목</label>
      <input ref={titleInput} type="text" id={`${id}-title`} value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required disabled={busy || locked} className="min-h-11 w-full rounded-[9px] border border-[var(--amora-line)] bg-[var(--amora-surface)] px-3 text-[13px] text-[var(--amora-ink)] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]" />
      <label htmlFor={`${id}-category`} className="block text-[12px] text-[var(--amora-muted)]">분야 <span>(선택)</span></label>
      <select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)} disabled={busy || locked} className="min-h-11 w-full rounded-[9px] border border-[var(--amora-line)] bg-[var(--amora-surface)] px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-[var(--amora-accent)]"><option value="">나중에 정하기</option>{CATEGORY_CHECKLISTS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      <AmoraActionPlanFields description={description} dueDate={dueDate} onDescriptionChange={setDescription} onDueDateChange={setDueDate} disabled={busy || locked} />
      <p className="pt-2 text-[12px] leading-relaxed text-[var(--amora-muted)]">함께 준비하는 사람에게도 보이는 할 일이에요. 저장은 두 사람의 합의나 실제 수행 완료를 뜻하지 않아요.</p>
      {locked && !busy && <p role="status" className="text-[12px] leading-relaxed text-[var(--amora-muted)]">이미 저장됐을 수 있어 같은 내용으로 다시 확인해요. 이 요청은 현재 화면에서만 유지돼요. 화면을 다시 열었다면 목록부터 확인해 주세요.</p>}
      <div className="flex flex-wrap gap-2 pt-1"><Button variant="primary" type="submit" disabled={busy || !available || !title.trim()} className={`${button} bg-[var(--amora-ink)]! text-white! hover:bg-[var(--amora-ink)]!`}>{busy ? "추가하는 중…" : locked ? "같은 요청 다시 확인" : "할 일 저장"}</Button><Button variant="secondary" type="button" disabled={busy} onClick={event => {
        if (locked) { setConfirmCancel(true); return; }
        if (cancelCreate()) { setTitle(""); setCategory(""); setDescription(""); setDueDate(""); close(event.currentTarget); }
      }} className={`${button} border-[var(--amora-line)]! bg-[var(--amora-surface)]! text-[var(--amora-soft)]! hover:bg-[var(--amora-surface)]!`}>작성 취소</Button></div>
      {confirmCancel && <div className="space-y-2 rounded-[9px] border border-[var(--amora-line)] p-3">
        <p className="text-[12px] leading-relaxed text-[var(--amora-ink)]">이미 저장된 할 일은 취소해도 삭제되지 않아요. 목록에서 기존 항목을 확인했으며, 다음 작성은 별도의 새 할 일로 시작할까요?</p>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" type="button" disabled={busy} className={`${button} border border-[var(--amora-line)] text-inherit! hover:bg-transparent!`} onClick={event => {
          if (!cancelCreate()) return;
          setConfirmCancel(false); setTitle(""); setCategory(""); setDescription(""); setDueDate(""); close(event.currentTarget);
        }}>확인했어요 · 새 작성으로 전환</Button><Button variant="ghost" type="button" disabled={busy} className={`${button} text-inherit! hover:bg-transparent!`} onClick={() => setConfirmCancel(false)}>같은 요청 유지</Button></div>
      </div>}
    </form>}
  </div>;
}
