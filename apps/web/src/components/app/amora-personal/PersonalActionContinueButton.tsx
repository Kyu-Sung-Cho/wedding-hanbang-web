"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PersonalAction, PersonalActionReview } from "@hanbang/shared/amora-personal-actions";
import Button from "@/components/ui/Button";
import AmoraSheetFrame from "@/components/app/chat/AmoraSheetFrame";
import { useAuthStore } from "@/stores/authStore";
import { personalActionContinuation } from "@/lib/amora/personalActionContinuation";

export default function PersonalActionContinueButton({ action }: { action: PersonalAction }) {
  const router = useRouter();
  const [review, setReview] = useState<PersonalActionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.profile?.couple_id !== previous.profile?.couple_id) {
        generation.current += 1; inFlight.current = false; setBusy(false); setReview(null); setError(null);
      }
    });
    return () => { generation.current += 1; unsubscribe(); };
  }, []);
  const run = async (confirm: boolean) => {
    if (inFlight.current || useAuthStore.getState().user?.id !== action.ownerUserId) return;
    inFlight.current = true; setBusy(true); setError(null);
    const epoch = generation.current;
    try {
      if (confirm && review) {
        await personalActionContinuation.stage(review);
        if (epoch === generation.current) { setReview(null); router.push("/chat?scope=private"); }
      } else {
        const next = await personalActionContinuation.review(action.id);
        if (epoch === generation.current) setReview(next);
      }
    } catch {
      if (epoch === generation.current) setError("이 할 일을 현재 나만 상담으로 이어갈 수 있는지 확인하지 못했어요. 다시 눌러 확인해 주세요.");
    } finally { if (epoch === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  return <>
    <Button variant="ghost" type="button" disabled={busy} onClick={() => void run(false)} className="min-h-11 rounded-lg! px-2! font-normal! underline">{busy && !review ? "확인하는 중…" : "이 할 일 이어서 상담"}</Button>
    {error && !review && <p role="alert" className="text-xs leading-5 text-[var(--amora-muted)]">{error}</p>}
    {review && <AmoraSheetFrame title="이 할 일로 나만 상담을 이어갈까요?" description="아래 내용만 나만 상담 입력창에 넣어요. 직접 보내기 전에는 대화로 전송하지 않아요."
      busy={busy} disabled={busy} applyLabel="나만 상담 입력창에 넣기" error={error} onClose={() => setReview(null)} onDefer={() => setReview(null)} onConfirm={() => void run(true)}>
      <p className="mb-2 whitespace-pre-wrap break-words text-sm font-semibold">{review.action.title}</p>
      {review.action.description && <p className="mb-2 whitespace-pre-wrap break-words text-sm">{review.action.description}</p>}
      <p className="mb-4 text-xs">{review.action.dueDate ? `마감일 ${review.action.dueDate}` : "마감일 없음"}</p>
    </AmoraSheetFrame>}
  </>;
}
