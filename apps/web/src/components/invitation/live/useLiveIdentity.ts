"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { useAuthStore } from "@/stores/authStore";

export type LiveIdentity = {
  /** 지금 로그인한 사람. 체험 모드나 로그인 전이면 null 이라 서버를 부르지 않는다. */
  owner: string | null;
  isDemo: boolean;
  /** 온보딩(역할·커플 연결·동의)을 마쳤다. 첫 대화(조건 묻기)는 그 뒤에만 보인다. */
  onboardingCompleted: boolean;
  /**
   * 준비 정보의 판. 실시간 동기화(`JourneyRealtimeSync`)가 상대의 변경을 받아 오면 바뀌고,
   * 화면은 이것을 보고 다시 읽는다.
   */
  refreshKey: string | null;
};

/** 청첩장 화면이 서버를 부를지와 누구의 자료인지 정한다. */
export function useLiveIdentity(): LiveIdentity {
  const isDemo = useAuthStore((state) => state.isDemo);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const onboardingCompleted = useAuthStore((state) => state.profile?.onboarding_completed === true);
  const refreshKey = useAuthStore((state) =>
    state.journey ? `${state.journey.id}:${state.journey.state_revision ?? state.journey.updated_at}` : null,
  );
  return { owner: isDemo ? null : userId, isDemo, onboardingCompleted, refreshKey };
}

/** Tailwind `lg`(64rem = 1024px). 이 폭부터 웹 두 칸 화면(`Web.dc`), 그 아래는 폰 화면이다. */
export const INVITATION_WIDE_QUERY = "(min-width: 64rem)";

function subscribeWide(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(INVITATION_WIDE_QUERY) : null;
  if (!query || typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readWide() {
  return typeof window.matchMedia === "function" ? window.matchMedia(INVITATION_WIDE_QUERY).matches : false;
}

/**
 * 넓은 화면인가. 실제 대화(`ChatSidePanel`)는 화면 하나에 한 번만 달아야 하므로(숨긴 쪽도 대화를 읽고
 * 첫 인사를 부른다) 예시 화면처럼 둘 다 그려 두고 CSS 로 숨기지 않고, 폭을 읽어 하나만 그린다.
 * 폭을 모르는 환경(서버, jsdom)은 폰 화면으로 본다.
 */
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, () => false);
}

/** 쓰기 응답이 화면을 떠난 뒤에 와도 상태를 바꾸지 않게 한다. */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
