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

/**
 * 앱을 연 뒤 첫 `/api/auth/me` 가 아직 돌아오지 않은 상태인가.
 *
 * 이 창에서는 세션에 대해 아직 아무것도 확정되지 않았고, 날아가 있는 그 요청이
 * 곧 답을 들고 온다. 같은 질문을 한 번 더 보내면 답이 빨라지는 게 아니라 느려진다.
 */
function isFirstInitializeInFlight(): boolean {
  const { isInitialized, isLoading } = useAuthStore.getState();
  return !isInitialized && isLoading;
}

export function useAuthSessionSync(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();

    const refreshFromServer = async () => {
      // 첫 초기화가 아직 돌고 있으면 손대지 않는다.
      //
      // `initialize` 는 순번을 올려서 **먼저 나간 요청의 결과를 버린다.** 그래서
      // 느린 콜드 로드를 보다가 탭을 옮겼다 돌아오면, 거의 끝나가던 요청이 버려지고
      // 처음부터 다시 기다리게 된다. 스피너를 보다 지쳐 탭을 확인하는 행동이
      // 정확히 그 기다림을 리셋시켰다 — "가끔 영영 안 끝난다"의 정체다.
      if (isFirstInitializeInFlight()) return;

      const beforeUserId = useAuthStore.getState().user?.id ?? null;
      await useAuthStore.getState().initialize({ force: true });
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUserId = useAuthStore.getState().user?.id ?? null;
      const nextUserId = session?.user?.id ?? null;
      if (currentUserId === nextUserId) return;

      if (currentUserId === null && nextUserId !== null) {
        // 콜드 로드마다 여기로 들어온다: 구독을 걸면 supabase-js 가 저장된 세션으로
        // INITIAL_SESSION 을 즉시 쏘는데, 그 순간 스토어는 아직 비어 있어 "로그인
        // 상태가 새로 생겼다"로 보인다. 그래서 앱 셸이 이미 보낸 요청 위에 똑같은
        // 요청을 하나 더 얹었고, 화면이 열리기까지 `/api/auth/me` 가 **두 번** 나갔다.
        //
        // 그 요청이 곧 같은 세션을 들고 온다 — 서버는 방금 그 쿠키로 이 페이지를
        // 내보냈다. 기다리면 될 일이다. 로그인 직후처럼 초기화가 이미 끝난 뒤에
        // 세션이 생기는 경우는 이 조건에 걸리지 않으므로 그대로 동작한다.
        if (isFirstInitializeInFlight()) return;

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
      subscription.unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);
}
