"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import AmoraAvatar from "@/components/ui/AmoraAvatar";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS } from "@/components/ui/amoraActionStyles";
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
import { openAmoraInsteadOfLink, useAmoraDock } from "@/components/app/amora/amoraDock";

export default function LoungeFirstHello({ ownerId }: { ownerId: string }) {
  const [pending, setPending] = useState<PendingAmoraFirstHello | null>(null);
  // 라운지에서 아모라를 열면 라운지 옆(큰 화면)이나 위(작은 화면)에 열린다. 그 자리가 첫마디를
  // 가져가므로(`AmoraDockHost`) 이 미리보기는 내려놓는다.
  const amoraDock = useAmoraDock();
  const amoraOpen = amoraDock?.isOpen ?? false;

  // 이 카드의 링크가 아니라 상단 바·본문 질문으로 열어도 아모라 자리가 첫마디를 가져간다. 가져가면 보관이
  // 비므로, 열릴 때 보관을 다시 읽어 카드를 내린다. 남겨 두면 같은 인사가 카드와 아모라 두 군데에 보인다.
  useEffect(() => {
    if (!amoraOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 아모라 자리가 첫마디를 가져갔는지 보관에서 다시 읽는다.
    setPending(peekPendingAmoraFirstHello({ ownerId }));
  }, [amoraOpen, ownerId]);

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
        <AmoraAvatar sizeClassName="size-9" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-[var(--amora-muted)]">아모라 · AI</p>
          <p aria-live="polite" className="mt-1 text-[14px] leading-[1.7] text-[var(--amora-ink)]">{pending.preview}</p>
          {/* 옆자리가 있으면 이 자리에서 아모라를 열고, 아모라가 첫인사를 대화에 건넨다. 카드는 내린다.
              새 탭이나 옆자리가 없는 화면에서는 링크대로 전체 대화 화면이 기존 경로로 첫인사를 가져간다.
              링크에서는 첫인사를 소비하지 않는다. */}
          <Link
            {...weddingLinkProps("/chat")}
            onClick={(event) => {
              if (openAmoraInsteadOfLink(event, amoraDock)) setPending(null);
            }}
            className={`${AMORA_ACTION_CLASS} mt-2`}
          >
            <AmoraMark size={20} />
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
