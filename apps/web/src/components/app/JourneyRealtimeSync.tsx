"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/authStore";

export default function JourneyRealtimeSync() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const coupleId = useAuthStore((state) => state.journey?.couple_id ?? null);
  const isDemo = useAuthStore((state) => state.isDemo);
  const refreshJourney = useAuthStore((state) => state.refreshJourney);

  useEffect(() => {
    if (!userId || !coupleId || isDemo) return;

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
          void refreshJourney(userId);
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
          void refreshJourney(userId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [coupleId, isDemo, refreshJourney, userId]);

  return null;
}
