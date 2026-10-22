"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS } from "@/components/ui/amoraActionStyles";
import { personalActionOwner, useAmoraPersonalActions } from "@/hooks/useAmoraPersonalActions";
import { useAuthStore } from "@/stores/authStore";
import type { PersonalAction } from "@hanbang/shared/amora-personal-actions";
import AmoraSheetFrame from "@/components/app/chat/AmoraSheetFrame";
import { weddingLinkProps } from "@/lib/weddingPaths";
import PersonalActionContinueButton from "./PersonalActionContinueButton";

export default function AmoraPersonalActions() {
  const data = useAmoraPersonalActions();
  const [deleting, setDeleting] = useState<PersonalAction | null>(null);
  useEffect(() => useAuthStore.subscribe((next, previous) => {
    if (personalActionOwner(next) !== personalActionOwner(previous)) setDeleting(null);
  }), []);
  const selected = deleting?.ownerUserId === data.owner ? deleting : null;
  return <div className="p-[18px] md:px-9 md:py-8">
    <h2 className="amora-display text-[26px]">나만 보는 할 일</h2>
    <p className="mt-2 text-sm text-[var(--amora-muted)]">나만 상담한 답변에서 직접 확인해 저장한 할 일이에요. 파트너에게 공유하거나 알림을 보내지 않아요.</p>
    <Link {...weddingLinkProps("/chat")} className={`${AMORA_ACTION_CLASS} my-3`}><AmoraMark className="size-5 shrink-0" />아모라 대화로 돌아가기</Link>
    {data.isDemo && <p role="status" className="mb-3 text-sm">체험에서는 개인 할 일을 저장하지 않아요.</p>}
    {(data.error || data.writeError) && <div role="alert" className="mb-3 rounded-lg border border-[var(--amora-line)] p-3 text-sm">
      <p>{data.error || data.writeError}</p><Button variant="ghost" type="button" className="min-h-11 px-0! font-normal! underline" onClick={() => void data.load()}>목록 다시 확인</Button>
    </div>}
    {data.loading && <p role="status" className="my-3 text-sm">개인 할 일을 확인하고 있어요…</p>}
    {!data.owner && !data.isDemo && <p role="status" className="my-3 text-sm">로그인 정보를 확인하고 있어요. 연결이 끊겼다면 다시 로그인해 주세요.</p>}
    {data.owner && !data.loading && !data.error && data.actions.length === 0 && <p className="rounded-xl bg-white p-5 text-sm">저장한 개인 할 일이 없어요. 나만 상담한 답변의 ‘개인 할 일로 저장’에서 제목을 적고 확인해 주세요.</p>}
    <ul className="space-y-3">
      {data.actions.map(action => <li key={action.id} className="rounded-xl border border-[var(--amora-line)] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className={`min-w-0 break-words text-base font-semibold ${action.status === "done" ? "line-through opacity-60" : ""}`}>{action.title}</h3>
          <span className="text-xs">{action.status === "done" ? "완료" : "진행 중"}</span>
        </div>
        {action.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{action.description}</p>}
        {action.dueDate && <p className="mt-2 text-xs text-[var(--amora-muted)]">마감일 {action.dueDate}</p>}
        <div className="mt-2 flex flex-wrap gap-3">
          <PersonalActionContinueButton action={action} />
          <Button variant="ghost" type="button" disabled={data.busyIds.includes(action.id)} onClick={() => void data.update(action)} className="min-h-11 rounded-lg! px-2! font-normal! underline disabled:opacity-50">{action.status === "done" ? "진행 중으로 되돌리기" : "완료로 표시"}</Button>
          <Button variant="ghost" type="button" disabled={data.busyIds.includes(action.id)} onClick={() => setDeleting(action)} className="min-h-11 rounded-lg! px-2! font-normal! underline disabled:opacity-50">삭제</Button>
        </div>
      </li>)}
    </ul>
    {data.actions.length > 0 && <p className="mt-3 text-xs">전체 {data.count}개 중 {data.actions.length}개 표시</p>}
    {data.nextCursor && <Button variant="ghost" type="button" disabled={data.loading} className="mt-3 min-h-11 rounded-lg! border border-[var(--amora-line)] px-4! font-normal!" onClick={() => void data.load(data.nextCursor ?? undefined)}>개인 할 일 더 보기</Button>}
    {selected && <AmoraSheetFrame title="개인 할 일을 삭제할까요?" description="이 개인 할 일만 삭제해요. 원래 대화는 그대로 남아요."
      disabled={data.busyIds.includes(selected.id)} busy={data.busyIds.includes(selected.id)} applyLabel="개인 할 일 삭제" error={data.writeError}
      onClose={() => setDeleting(null)} onDefer={() => setDeleting(null)} onConfirm={() => void data.remove(selected).then(ok => { if (ok) setDeleting(null); })}>
      <p className="mb-4 break-words text-sm">{selected.title}</p>
    </AmoraSheetFrame>}
  </div>;
}
