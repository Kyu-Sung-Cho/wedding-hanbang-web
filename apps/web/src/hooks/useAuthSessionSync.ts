"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { clearUserScopedClientState } from "@/lib/auth/userScopedClientState";
import { useAuthStore } from "@/stores/authStore";

export function useAuthSessionSync(enabled = true) {
  const [isSessionVerified, setIsSessionVerified] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let active = true;
    let synchronizationGeneration = 0;

    const redirectToLogin = () => {
      if (window.location.pathname !== "/login") {
        window.location.replace("/login");
      }
    };

    const refreshFromServer = async (expectedUserId?: string) => {
      const generation = ++synchronizationGeneration;
      setIsSessionVerified(false);
      const beforeUserId = useAuthStore.getState().user?.id ?? null;
      await useAuthStore.getState().initialize({ force: true });

      if (!active || generation !== synchronizationGeneration) return;

      const authState = useAuthStore.getState();
      const afterUserId = useAuthStore.getState().user?.id ?? null;
      if (beforeUserId !== afterUserId) {
        clearUserScopedClientState();
      }

      if (
        !authState.isDemo &&
        (!afterUserId || (expectedUserId !== undefined && expectedUserId !== afterUserId))
      ) {
        clearUserScopedClientState();
        useAuthStore.getState().reset();
        redirectToLogin();
        return;
      }

      setIsSessionVerified(true);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUserId = useAuthStore.getState().user?.id ?? null;
      const nextUserId = session?.user?.id ?? null;

      if (nextUserId && currentUserId === nextUserId) return;

      synchronizationGeneration += 1;
      setIsSessionVerified(false);
      clearUserScopedClientState();
      useAuthStore.getState().reset();

      if (!nextUserId) {
        redirectToLogin();
        return;
      }

      // Defer network work until Supabase has finished publishing the new
      // cookie-backed session. The sensitive tree is already blank at this point.
      window.queueMicrotask(() => {
        if (active) void refreshFromServer(nextUserId);
      });
    });

    const handleFocus = () => {
      void refreshFromServer();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshFromServer();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void refreshFromServer();

    return () => {
      active = false;
      synchronizationGeneration += 1;
      subscription.unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);

  return !enabled || isSessionVerified;
}
