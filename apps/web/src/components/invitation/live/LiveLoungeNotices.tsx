"use client";

import { useMemo, useState } from "react";
import type { FirstRunTutorialStepId } from "@hanbang/shared";

import DailyAmoraFocusBridge from "@/components/app/DailyAmoraFocusBridge";
import FirstRunLoungeTutorial from "@/components/app/FirstRunLoungeTutorial";
import LoungeFirstArrival, { buildLoungeFirstArrival } from "@/components/app/LoungeFirstArrival";
import { getLoungeBudgetTotals } from "@/app/(app)/lounge/hubModel";
import { getProgressSummary } from "@/app/(app)/lounge/progressSummary";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";

import JoinedPlanHandoffNotice, { dismissJoinedHandoff, useJoinedPlanMarker } from "./JoinedPlanHandoffNotice";
import LiveNotificationsNotice from "./LiveNotificationsNotice";

const NO_PROGRESS: Record<string, ProgressItem> = {};

/**
 * 첫 실행 안내가 청첩장 홈에서 가리킬 수 있는 자리. 초대 카드(첫 도착 카드 안, 아직 혼자일 때)와 아모라로 가는
 * 자리(좁은 화면은 하단 메뉴의 아모라 칸, 넓은 화면은 대화 칸)다. 앱 홈과 같은 둘이다.
 */
export const INVITATION_TUTORIAL_STEPS: readonly FirstRunTutorialStepId[] = ["lounge-invite", "amora-fab"];

/** 넓은 화면에서 첫 실행 안내의 아모라 단계가 가리키는 대화 칸 표시. */
export const AMORA_TUTORIAL_TARGET = "amora-fab";

/**
 * 청첩장 홈의 알림 자리(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해). 옛 웨딩 라운지가 맡던
 * 일 가운데 제품·안전 몫을 사진 머리 아래로 옮겼다(앱 홈과 같은 자리·같은 순서). 할 말이 없으면 각 알림이 아무것도
 * 그리지 않아 자리도 생기지 않는다.
 *
 *   1. 아모라의 첫인사와 첫 실행 안내(`FirstRunLoungeTutorial`) — 안내를 마친 사람에게 첫인사를 한 번 미리 보인다.
 *   2. 상대가 바꾼 것과 준비 알림(`LiveNotificationsNotice`) — 옛 상단 바 알림 종이 하던 일.
 *   3. 합류 직후 안내(`JoinedPlanHandoffNotice`) — `?joined=1` 과 상대가 실제로 들어와 있을 때만.
 *   4. 오늘의 한 가지(`DailyAmoraFocusBridge`) — 접어 둔 한 줄. 합류 안내가 떠 있으면 접어 둔다.
 *   5. 첫 도착 안내(`LoungeFirstArrival`, 아직 혼자면 초대 코드로 가는 카드까지) — 커플이 아무것도 남기지 않았을
 *      때만. 합류 안내가 떠 있으면 접어 둔다(환영 카드 두 장이 겹치지 않게, 옛 라운지와 같다).
 *
 * 계정·커플을 바꾸는 사이에 이전 계획의 이름이나 체크 내용을 보이지 않게, 지금 계정의 커플 자료만 읽는다.
 * 체험 모드(예시 커플 화면)에는 그리지 않는다.
 */
export default function LiveLoungeNotices() {
  const isDemo = useAuthStore((state) => state.isDemo);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const profile = useAuthStore((state) => state.profile);
  const storedJourney = useAuthStore((state) => state.journey);
  const storedPartner = useAuthStore((state) => state.partner);
  const joinedMarker = useJoinedPlanMarker();

  const coupleId = userId && profile?.id === userId ? profile.couple_id : null;
  const journey = coupleId && storedJourney?.couple_id === coupleId ? storedJourney : null;
  const partner = coupleId && storedPartner?.couple_id === coupleId && storedPartner.id !== profile?.id ? storedPartner : null;
  const partnerLinked = Boolean(partner);
  const progress = journey?.progress ?? NO_PROGRESS;
  const totalBudget = journey?.total_budget ?? 0;
  const weddingDate = journey?.wedding_date ?? null;
  const onboardingCompleted = profile?.onboarding_completed === true;

  const summary = useMemo(() => getProgressSummary(progress), [progress]);
  // 명시적으로 기록한 지출만 센다(옛 금액 칸 `cost` 를 지출로 올리지 않는다). 옛 라운지와 같은 합산기다.
  const budgetTotals = useMemo(() => getLoungeBudgetTotals(progress), [progress]);
  const spentBudget = budgetTotals.spent;
  // 되읽기의 "며칠 남았어요" 같은 줄이 그릴 때마다 바뀌지 않게 이 화면을 연 시각 하나를 쓴다.
  const [now] = useState(() => Date.now());
  // 판정은 남긴 값(체크·카테고리 상태·예산·일정)에서 매번 다시 하므로 커플이 무언가 남기는 순간 저절로 사라진다.
  const firstArrival = useMemo(
    () =>
      coupleId
        ? buildLoungeFirstArrival({
          onboardingCompleted,
          weddingDate,
          progress,
          totalBudget,
          spentBudget,
          checkedItemCount: summary.done,
          partnerLinked,
          now,
        })
        : null,
    [coupleId, now, onboardingCompleted, partnerLinked, progress, spentBudget, summary.done, totalBudget, weddingDate],
  );

  if (isDemo) return null;
  const showJoinedHandoff = joinedMarker && partnerLinked;

  return (
    <div className="flex flex-col gap-3 empty:hidden" data-live-notices>
      <FirstRunLoungeTutorial stepIds={INVITATION_TUTORIAL_STEPS} />
      <LiveNotificationsNotice />
      {showJoinedHandoff ? (
        <JoinedPlanHandoffNotice
          facts={{
            weddingDate,
            venue: journey?.venue ?? null,
            totalBudget,
            checked: summary.done,
            total: summary.total,
          }}
          onDismiss={dismissJoinedHandoff}
        />
      ) : (
        <>
          <details className="rounded-[22px] bg-inv-paper-soft px-4 shadow-[inset_0_0_0_1px_#EEEAE6]" data-live-today-one>
            <summary className="flex min-h-12 cursor-pointer items-center text-[14px] text-inv-body">
              아모라와 오늘 할 일 정하기
            </summary>
            <div className="pb-4">
              <DailyAmoraFocusBridge partnerLinked={partnerLinked} />
            </div>
          </details>
          {firstArrival ? <LoungeFirstArrival view={firstArrival} /> : null}
        </>
      )}
    </div>
  );
}
