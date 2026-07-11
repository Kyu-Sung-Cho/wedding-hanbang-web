"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useCommunityStore } from "@/stores/communityStore";

function resetUserScopedStores() {
  useChatStore.getState().reset();
  // The community feed is public, but its rows contain user-specific vote and
  // bookmark projections. Clear identity-scoped state and cache, preserve the
  // active feed selection, and rebuild it for the new identity.
  void useCommunityStore.getState().refreshAfterAuthChange();
}

export function useAuthSessionSync(enabled = true) {
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!enabled || !supabaseUrl?.trim() || !supabaseAnonKey?.trim()) return;

    const supabase = createClient();

    const refreshFromServer = async () => {
      const beforeUserId = useAuthStore.getState().user?.id ?? null;
      await useAuthStore.getState().initialize({ force: true });
      const afterUserId = useAuthStore.getState().user?.id ?? null;
      if (beforeUserId !== afterUserId) {
        resetUserScopedStores();
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUserId = useAuthStore.getState().user?.id ?? null;
      const nextUserId = session?.user?.id ?? null;
      if (currentUserId === nextUserId) return;

      resetUserScopedStores();
      useAuthStore.getState().reset();
      void useAuthStore.getState().initialize({ force: true });
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

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);
}
