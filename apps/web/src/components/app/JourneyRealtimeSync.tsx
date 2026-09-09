"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/authStore";

const PREPARATION_PATHS = new Set(["/budget", "/schedule", "/checklist", "/dashboard", "/chat", "/chat/missions", "/chat/board"]);

function ownerKey() {
  const state = useAuthStore.getState();
  return JSON.stringify([state.user?.id, state.isDemo, state.profile?.id,
    state.profile?.couple_id, state.profile?.role, state.couple?.id,
    state.journey?.couple_id, state.journey?.id]);
}

export default function JourneyRealtimeSync() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const coupleId = useAuthStore((state) => state.journey?.couple_id ?? null);
  const isDemo = useAuthStore((state) => state.isDemo);
  const refreshJourney = useAuthStore((state) => state.refreshJourney);
  // 실제 서비스는 /wedding/* 공개 URL을 같은 앱 화면으로 연결한다.
  const pathname = usePathname().replace(/^\/wedding(?=\/|$)/, "") || "/";
  const [ownerEpoch, setOwnerEpoch] = useState(0);

  useEffect(() => {
    if (!userId || !coupleId || isDemo) return;

    const initialOwner = ownerKey();
    let disposed = false;
    let invalidated = false;
    let subscribed = false;
    let pending = false;
    let inFlight: AbortController | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const owns = () => !disposed && !invalidated && ownerKey() === initialOwner;
    const isActive = () => owns() && document.visibilityState === "visible" && navigator.onLine !== false;
    const stopPoll = () => { clearTimeout(pollTimer); pollTimer = undefined; };
    const schedulePoll = () => {
      stopPoll();
      if (!isActive() || !PREPARATION_PATHS.has(pathname)) return;
      // 정상 구독도 이벤트 누락은 가능하다. 예산은 10초 안에 다시 확인하고,
      // 다른 준비 화면은 30초, 무관한 화면·숨겨진 탭은 반복 조회하지 않는다.
      const delay = pathname === "/budget" ? (subscribed ? 10_000 : 5_000) : 30_000;
      pollTimer = setTimeout(() => { void refresh(false); }, delay);
    };
    const refresh = async (queueIfBusy = true) => {
      if (!isActive()) return;
      if (inFlight) { pending ||= queueIfBusy; return; }
      stopPoll();
      const controller = new AbortController();
      inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        await refreshJourney(userId, controller.signal);
      } finally {
        clearTimeout(timeout);
        inFlight = null;
        if (owns() && pending && isActive()) {
          pending = false;
          void refresh();
        } else {
          pending = false;
          schedulePoll();
        }
      }
    };
    // React가 A→B→A를 한 번에 그려도 이전 구독·대기 요청은 다시 살아나지 않는다.
    const unsubscribeOwner = useAuthStore.subscribe(() => {
      if (!invalidated && ownerKey() !== initialOwner) {
        invalidated = true;
        stopPoll();
        inFlight?.abort();
        setOwnerEpoch(epoch => epoch + 1);
      }
    });
    const handleResume = () => {
      if (isActive()) void refresh();
      else { stopPoll(); pending = false; inFlight?.abort(); }
    };
    window.addEventListener("online", handleResume);
    window.addEventListener("offline", handleResume);
    window.addEventListener("pageshow", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    const supabase = createClient();
    const channel = supabase
      .channel(`web-journey-sync:${coupleId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wedding_journeys",
          filter: `couple_id=eq.${coupleId}`,
        },
        () => {
          void refresh();
        },
      )
      // 파트너가 합류하면 바뀌는 것은 `couples` 행이다. journey 만 듣고 있으면
      // 그 순간 아무 일도 일어나지 않아, 먼저 시작한 사람 화면이 계속
      // "혼자 준비 중" 으로 남는다(2026-08-24 감사).
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "couples",
          filter: `id=eq.${coupleId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe((status) => {
        if (!owns()) return;
        subscribed = status === "SUBSCRIBED";
        // 연결이 복구될 때 놓친 변경도 서버 정본에서 다시 읽는다.
        void refresh();
      });
    if (PREPARATION_PATHS.has(pathname)) void refresh();

    return () => {
      disposed = true;
      stopPoll();
      inFlight?.abort();
      unsubscribeOwner();
      window.removeEventListener("online", handleResume);
      window.removeEventListener("offline", handleResume);
      window.removeEventListener("pageshow", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      void supabase.removeChannel(channel);
    };
  }, [coupleId, isDemo, refreshJourney, userId, pathname, ownerEpoch]);

  return null;
}
