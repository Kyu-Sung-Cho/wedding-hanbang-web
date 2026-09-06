"use client";

import { createPersonalActionContinuation, isPersonalActionId } from "@hanbang/shared/amora-personal-actions";
import { useAuthStore } from "@/stores/authStore";

function readScope(state = useAuthStore.getState()) {
  if (!state.isInitialized || state.isDemo || !state.user || state.profile?.id !== state.user.id
    || !isPersonalActionId(state.profile.couple_id)) return null;
  return { ownerId: state.user.id, coupleId: state.profile.couple_id };
}

const continuation = createPersonalActionContinuation({
  readScope,
  readAction: async (id, scope) => {
    const response = await fetch(`/api/amora/personal-actions?conversationCoupleId=${encodeURIComponent(scope.coupleId)}&actionId=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("개인 할 일을 다시 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return response.json();
  },
});

let observing = false;
export const personalActionContinuation = {
  ...continuation,
  review(id: string) {
    if (!observing) {
      observing = true;
      useAuthStore.subscribe((next, previous) => {
        const a = readScope(next); const b = readScope(previous);
        if (a?.ownerId !== b?.ownerId || a?.coupleId !== b?.coupleId) continuation.reset();
      });
    }
    return continuation.review(id);
  },
};
