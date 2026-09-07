"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import Button from "@/components/ui/Button";
import { isPersonalActionId, normalizePersonalActionDraft, parsePersonalActionDraftMetadata, parsePersonalActionsViewMetadata } from "@hanbang/shared/amora-personal-actions";
import { personalActionOwner, useAmoraPersonalActions } from "@/hooks/useAmoraPersonalActions";
import { useAuthStore } from "@/stores/authStore";
import AmoraSheetFrame from "./AmoraSheetFrame";

type Props = { messageId: string; coupleId: string; content: string; personalActionDraft?: unknown; personalActionsView?: unknown };
export default function PersonalActionSaveButton(props: Props) {
  const owner = useAuthStore(personalActionOwner);
  return <OwnerSave key={`${owner}:${props.coupleId}:${props.messageId}`} {...props} />;
}

function OwnerSave({ messageId, coupleId, content, personalActionDraft, personalActionsView }: Props) {
  const { owner, isDemo, save, busyIds, writeError } = useAmoraPersonalActions(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saved, setSaved] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const submitting = useRef(false);
  const initialized = useRef(false);
  if (!isPersonalActionId(messageId) || !isPersonalActionId(coupleId)) return null;
  const draft = normalizePersonalActionDraft({ title, description, dueDate });
  const busy = busyIds.includes(messageId);
  const openPreview = () => {
    if (!initialized.current) {
      const suggestion = parsePersonalActionDraftMetadata(personalActionDraft);
      if (suggestion) { setTitle(suggestion.title); setDescription(suggestion.description ?? ""); setDueDate(suggestion.dueDate ?? ""); }
      initialized.current = true;
    }
    setOpen(true);
  };
  const confirm = async () => {
    if (!draft || !owner || submitting.current || isDemo) return;
    submitting.current = true;
    const fingerprint = JSON.stringify(draft);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await save(messageId, coupleId, draft, request.current.id);
      if (result && owner === personalActionOwner()) { setSaved(true); setOpen(false); }
    } finally { submitting.current = false; }
  };
  return <div className="mt-2 text-sm">
    {parsePersonalActionsViewMetadata(personalActionsView) && <p className="text-xs leading-5 text-[var(--hb-text-muted)]">개인 목록에서 진행·완료 상태와 이어서 상담할 할 일을 확인해 주세요.</p>}
    {saved ? <p role="status" className="text-[var(--hb-text-muted)]">개인 할 일을 저장했어요. <Link href="/chat/personal" className="inline-flex min-h-11 items-center underline">개인 목록 확인</Link></p>
      : <Button variant="ghost" type="button" onClick={openPreview} className="min-h-11 gap-1.5! rounded-lg! px-2! font-normal! text-[var(--hb-text-muted)]">
        <LockKeyhole className="size-3.5" aria-hidden="true" />개인 할 일로 저장
      </Button>}
    {!saved && <Link href="/chat/personal" className="inline-flex min-h-11 items-center px-2 underline">개인 목록 보기</Link>}
    {open && <AmoraSheetFrame title="개인 할 일로 저장할까요?" description="나만 보는 할 일이에요. 상대에게 공유하거나 알림을 보내지 않아요."
      disabled={!draft || busy || !owner || isDemo} busy={busy} applyLabel={busy ? "저장하는 중…" : "개인 할 일 저장"}
      error={writeError} notice={isDemo ? "체험에서는 개인 할 일을 저장하지 않아요." : null}
      onConfirm={() => void confirm()} onClose={() => setOpen(false)} onDefer={() => setOpen(false)}>
      <p className="mb-3 max-h-[18dvh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--amora-bg)] p-3 text-xs leading-5" aria-label="참고한 나만 상담 답변">{Array.from(content).slice(0, 500).join("")}</p>
      <label className="mb-3 block text-sm">할 일 제목 · 필수
        <input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} disabled={busy} placeholder="내가 직접 할 일을 적어 주세요"
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--amora-line)] p-2 focus-visible:outline-2" />
      </label>
      <label className="mb-3 block text-sm">내용 · 선택
        <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={500} disabled={busy} rows={3}
          className="mt-1 w-full rounded-lg border border-[var(--amora-line)] p-2 focus-visible:outline-2" />
      </label>
      <label className="mb-3 block text-sm">마감일 · 선택
        <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={busy}
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--amora-line)] p-2 focus-visible:outline-2" />
      </label>
      <p className="mb-4 text-xs leading-5 text-[var(--amora-muted)]">제목과 날짜는 직접 확인해 정해 주세요. 공유 예산·일정·체크리스트는 바뀌지 않아요. 연결된 개인 상담 답변이나 질문을 영구 삭제하면 이 할 일도 삭제돼요.</p>
    </AmoraSheetFrame>}
  </div>;
}
