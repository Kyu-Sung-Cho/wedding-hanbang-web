"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useCommunityStore } from "@/stores/communityStore";

function resetUserScopedStores() {
  useChatStore.getState().reset();
  useCommunityStore.getState().reset();
}

export function useAuthSessionSync(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let syncGeneration = 0;

    const refreshFromServer = async () => {
      const generation = ++syncGeneration;
      const beforeUserId = useAuthStore.getState().user?.id ?? null;
      await useAuthStore.getState().initialize({ force: true });
      if (generation !== syncGeneration) return;
      const afterUserId = useAuthStore.getState().user?.id ?? null;
      if (beforeUserId !== afterUserId) {
        useChatStore.getState().reset();
        // initialize() already purged the outgoing viewer before committing
        // the new auth identity. Keep the store bound to that new viewer.
        useCommunityStore.getState().bindViewer(afterUserId);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUserId = useAuthStore.getState().user?.id ?? null;
      const nextUserId = session?.user?.id ?? null;
      // 전환 조회 중 user가 비어 있어도 로그아웃은 대기 중인 조회를 무효화한다.
      if (currentUserId === nextUserId && event !== "SIGNED_OUT") return;
      // 이전 계정의 늦은 조회 후처리가 새 계정의 채팅을 다시 지우지 않는다.
      syncGeneration += 1;

      if (currentUserId === null && nextUserId !== null) {
        useChatStore.getState().reset();
        // bindViewer purges all guest caches while preserving only a draft
        // explicitly marked for the login-return handoff.
        useCommunityStore.getState().bindViewer(nextUserId);
        void useAuthStore.getState().initialize({ force: true });
        return;
      }

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
      syncGeneration += 1;
      subscription.unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);
}
