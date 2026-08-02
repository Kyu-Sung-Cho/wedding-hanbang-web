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
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [coupleId, isDemo, refreshJourney, userId]);

  return null;
}
