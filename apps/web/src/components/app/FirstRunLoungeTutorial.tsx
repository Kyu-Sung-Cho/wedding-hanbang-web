"use client";

import { useCallback, useEffect, useState } from "react";

import {
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
  FIRST_RUN_TUTORIAL_SESSION_KEY,
  FIRST_RUN_TUTORIAL_STEPS,
  shouldShowFirstRunTutorial,
  type FirstRunTutorialStepId,
} from "@hanbang/shared";
import SpotlightTutorial, {
  type SpotlightStep,
} from "@/components/ui/SpotlightTutorial";
import {
  asFirstRunTutorialProfileClient,
  markFirstRunTutorialCompleted,
  readFirstRunTutorialState,
} from "@/lib/firstRun/firstRunTutorialProfile";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import LoungeFirstHello from "./LoungeFirstHello";

/**
 * 웨딩 라운지에 처음 도착한 사람에게 한 번만 뜨는 안내.
 *
 * ## 왜 화면 쪽에 "언제 뜨는가"를 두지 않는가
 *
 * 예전 투어 두 벌은 완성돼 있었는데 아무 데서도 실행되지 않았다 — 조건을 아무도
 * 소유하지 않아서다. 그래서 조건은 `@hanbang/shared`의 계약이 정하고, 이 컴포넌트는
 * 계약이 "띄우라"고 할 때만 오버레이를 마운트한다.
 *
 * ## 실패는 화면을 막지 않는다
 *
 * 상태 읽기는 마이그레이션 전 배포에서 컬럼이 없을 수 있다. 그 select 하나 때문에
 * 첫 화면이 오류가 되면 안 되므로 읽기·쓰기 모두 던지지 않는 헬퍼를 쓴다.
 */

/**
 * 같은 기기에서 두 번 뜨지 않게 하는 보조 잠금(SpotlightTutorial이 직접 쓴다).
 * 완료 사실의 정본은 계정(profiles)이고, 이건 계정 쓰기가 실패한 세션을 버티는 용도다.
 */
const DEVICE_STORAGE_KEY = "hanbang_first_run_tutorial_done";
export const LOUNGE_TUTORIAL_REPLAY_EVENT = "hanbang:replay-lounge-tutorial";

const STEPS: readonly { id: FirstRunTutorialStepId; step: SpotlightStep }[] = FIRST_RUN_TUTORIAL_STEPS.map((step) => ({
  id: step.id,
  step: {
    selector: `[data-tutorial-target="${step.id}"]`,
    title: step.title,
    description: step.body,
  },
}));

function stepsFor(stepIds: readonly FirstRunTutorialStepId[] | undefined): SpotlightStep[] {
  return STEPS.filter(({ id }) => !stepIds || stepIds.includes(id)).map(({ step }) => step);
}

function readShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(FIRST_RUN_TUTORIAL_SESSION_KEY) === "1";
  } catch {
    // 저장소를 막아둔 브라우저다. 세션 기억을 포기하고 계정 기록만 믿는다.
    return false;
  }
}

function rememberShownThisSession() {
  try {
    sessionStorage.setItem(FIRST_RUN_TUTORIAL_SESSION_KEY, "1");
  } catch {
    /* 저장 못 해도 계정 기록이 정본이라 다음 방문에서 걸러진다. */
  }
}

/** 이 기기에서 이미 안내가 끝난 적이 있는가(SpotlightTutorial이 남기는 키). */
function readDoneOnThisDevice(): boolean {
  try {
    return localStorage.getItem(DEVICE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * `stepIds` 를 주면 그 단계만 순서대로 띄운다. 청첩장 홈(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전
 * 같아야해)에는 옛 라운지의 "오늘 챙길 한 가지"(lounge-focus)와 "준비 도구 칸"(lounge-tools) 자리가 없다. 없는
 * 앵커를 남겨 두면 엔진이 그 단계마다 화면 전체를 어둡게 덮었다가 건너뛰므로, 있는 자리만 넘긴다(앱 홈과 같은 둘).
 * 없으면 네 단계 모두다.
 */
export default function FirstRunLoungeTutorial({
  stepIds,
}: {
  stepIds?: readonly FirstRunTutorialStepId[];
} = {}) {
  const { profile, isDemo } = useAuthStore();
  if (isDemo || !profile?.id || !profile.onboarding_completed) return null;

  return (
    <>
      <LoungeFirstHello key={`hello-${profile.id}`} ownerId={profile.id} />
      <OwnedLoungeTutorial key={`tutorial-${profile.id}`} stepIds={stepIds} />
    </>
  );
}

function OwnedLoungeTutorial({ stepIds }: { stepIds?: readonly FirstRunTutorialStepId[] }) {
  const { profile, isDemo } = useAuthStore();
  const userId = profile?.id ?? null;
  const onboardingCompleted = profile?.onboarding_completed === true;
  // 안내 도중 단계 목록이 바뀌면 엔진의 순번이 어긋난다. 이 화면이 떠 있는 동안 한 번 정한 목록을 쓴다.
  const [steps] = useState(() => stepsFor(stepIds));
  const [armed, setArmed] = useState(false);
  const [replayCount, setReplayCount] = useState(0);

  useEffect(() => {
    if (!userId || !onboardingCompleted || isDemo || typeof window === "undefined") return;
    const handleReplay = () => {
      try {
        localStorage.removeItem(DEVICE_STORAGE_KEY);
      } catch {
        /* */
      }
      rememberShownThisSession();
      setReplayCount((count) => count + 1);
      setArmed(true);
    };
    window.addEventListener(LOUNGE_TUTORIAL_REPLAY_EVENT, handleReplay);
    return () => window.removeEventListener(LOUNGE_TUTORIAL_REPLAY_EVENT, handleReplay);
  }, [isDemo, onboardingCompleted, userId]);

  useEffect(() => {
    // 온보딩을 마치지 않았으면 절대 띄우지 않는다 — 라운지에 아직 보여줄 게 없고,
    // 온보딩 중간에 끼어들면 하던 것을 잃는다.
    if (!userId || !onboardingCompleted) return;
    // 체험 모드에는 완료를 적을 계정 행이 없다. 매번 다시 뜨느니 띄우지 않는다.
    if (isDemo) return;
    if (readShownThisSession()) return;

    let cancelled = false;
    void (async () => {
      const state = await readFirstRunTutorialState(
        asFirstRunTutorialProfileClient(createClient()),
        userId,
      );
      if (cancelled) return;
      if (
        !shouldShowFirstRunTutorial({
          onboardingCompleted,
          state,
          shownThisSession: readShownThisSession(),
        })
      ) {
        return;
      }
      // 이 기기에서는 이미 끝냈는데 계정에는 안 적혀 있는 경우가 있다. 계정 쓰기가
      // 실패했거나, 컬럼이 아직 없는 배포에서 안내를 봤거나.
      //
      // 그대로 두면 SpotlightTutorial이 기기 키를 보고 조용히 시작하지 않고, 시작하지
      // 않았으니 onFinish도 없고, 그래서 계정은 영영 "안 봤다"로 남는다 — 안내도
      // 아모라 첫마디도 다시는 뜨지 않는데 기록만 비어 있는 상태다. 다른 기기에서는
      // 매번 처음부터 다시 보게 된다.
      //
      // 그래서 여기서 계정만 맞춰두고 화면은 건드리지 않는다.
      if (readDoneOnThisDevice()) {
        rememberShownThisSession();
        void markFirstRunTutorialCompleted(
          asFirstRunTutorialProfileClient(createClient()),
          userId,
        );
        return;
      }

      rememberShownThisSession();
      setArmed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isDemo, onboardingCompleted, userId]);

  const handleFinish = useCallback(() => {
    // 완주든 건너뛰기든 "끝났다"는 같다. 건너뛴 사람에게 매번 다시 띄우는 건
    // 안내가 아니라 방해다.
    //
    // 이벤트를 먼저 쏜다 — 인라인 첫인사가 네트워크를 기다리지 않게 한다.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    }
    if (!userId) return;
    void markFirstRunTutorialCompleted(
      asFirstRunTutorialProfileClient(createClient()),
      userId,
    );
  }, [userId]);

  if (!armed) return null;

  return (
    <SpotlightTutorial
      key={replayCount}
      steps={steps}
      storageKey={DEVICE_STORAGE_KEY}
      mode="auto"
      // 라운지의 카드들이 자리를 잡은 뒤에 앵커를 잰다. 너무 이르면 첫 스텝이
      // "타깃 없음"으로 건너뛰어진다.
      delayMs={replayCount > 0 ? 150 : 900}
      onFinish={handleFinish}
    />
  );
}
