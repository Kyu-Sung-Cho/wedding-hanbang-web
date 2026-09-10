"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, X } from "lucide-react";
import {
  buildAmoraFirstHello,
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
  readPreparationStage,
} from "@hanbang/shared";
import {
  dismissAmoraFirstHelloBubble,
  getDeliveredAmoraFirstHello,
  peekPendingAmoraFirstHello,
  rememberPendingAmoraFirstHello,
  type PendingAmoraFirstHello,
} from "@/lib/amora/pendingFirstHello";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import Button from "@/components/ui/Button";

export default function LoungeFirstHello({ ownerId }: { ownerId: string }) {
  const [pending, setPending] = useState<PendingAmoraFirstHello | null>(null);

  useEffect(() => {
    // 저장소는 hydration 이후에 읽는다. 부모의 계정별 key가 이전 회원의 화면 상태를 버린다.
    const restored = peekPendingAmoraFirstHello({ ownerId });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소의 첫인사를 해당 계정 화면에 복원한다.
    setPending(restored);
    let helloCreated = Boolean(restored || getDeliveredAmoraFirstHello(ownerId));

    const handleCompleted = () => {
      const { profile, journey, partner, isDemo } = useAuthStore.getState();
      // 계정 전환 직전의 이벤트도 새 회원의 준비 정보로 인사를 만들지 않는다.
      if (helloCreated || isDemo || profile?.id !== ownerId || !profile.onboarding_completed) return;
      helloCreated = true;
      const existing = peekPendingAmoraFirstHello({ ownerId });
      if (existing) {
        setPending(existing);
        return;
      }
      if (getDeliveredAmoraFirstHello(ownerId)) return;
      const hello = buildAmoraFirstHello({
        weddingDate: journey?.wedding_date ?? null,
        preparationStage: readPreparationStage(journey?.progress),
        partnerLinked: Boolean(partner),
        now: Date.now(),
      });
      setPending(rememberPendingAmoraFirstHello(hello, { ownerId }));
    };

    window.addEventListener(FIRST_RUN_TUTORIAL_COMPLETED_EVENT, handleCompleted);
    return () => window.removeEventListener(FIRST_RUN_TUTORIAL_COMPLETED_EVENT, handleCompleted);
  }, [ownerId]);

  if (!pending || pending.ownerId !== ownerId || pending.bubbleDismissed) return null;

  return (
    <section aria-label="아모라의 첫인사" className="rounded-2xl border border-[var(--amora-line)] bg-white p-4 md:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--amora-low)] text-[var(--amora-ink)]">
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-[var(--amora-muted)]">아모라 · AI</p>
          <p aria-live="polite" className="mt-1 text-[14px] leading-[1.7] text-[var(--amora-ink)]">{pending.preview}</p>
          {/* 첫인사는 링크에서 소비하지 않는다. 전체 대화 화면이 기존 경로로 가져간다. */}
          <Link {...weddingLinkProps("/chat")} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-[13px] font-semibold text-[var(--amora-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)]">
            아모라와 대화하기 <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <Button
          variant="icon"
          type="button"
          label="아모라 첫인사 미리보기 닫기"
          className="shrink-0 !rounded-lg !text-[var(--amora-muted)] hover:!bg-[var(--amora-low)]"
          onClick={() => {
            dismissAmoraFirstHelloBubble({ ownerId });
            setPending((current) => current ? { ...current, bubbleDismissed: true } : null);
          }}
        >
          <X aria-hidden="true" className="size-[18px]" />
        </Button>
      </div>
    </section>
  );
}
