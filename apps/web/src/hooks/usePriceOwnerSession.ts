"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { createClient } from "@/lib/supabase/client";
import { isUuid } from "@/utils/requestValidation";

export const PRICE_EXPECTED_OWNER_HEADER = "X-Price-Expected-Owner";

export function priceResponseOwner(value: unknown): string | null {
  return value !== null && typeof value === "object" && "ownerUserId" in value && isUuid(value.ownerUserId)
    ? value.ownerUserId : null;
}

/** 공개 가격 화면의 개인 조회·쓰기도 로그인 계정과 같은 생명주기를 갖는다. */
export function usePriceOwnerSession(onInvalidate: (previousOwner: string | null) => void, enabled = true) {
  const invalidateCallback = useRef(onInvalidate);
  useLayoutEffect(() => { invalidateCallback.current = onInvalidate; }, [onInvalidate]);
  const scope = useMemo(() => {
    const state: { epoch: number; owner: string | null; sessionOwner: string | null | undefined } = {
      epoch: 0, owner: null, sessionOwner: undefined,
    };
    return {
      state,
      isCurrent: (epoch: number) => state.epoch === epoch,
      acceptOwner(owner: string | null, epoch: number) {
        if (!owner || state.epoch !== epoch
          || (state.sessionOwner !== undefined && state.sessionOwner !== owner)
          || (state.owner !== null && state.owner !== owner)) return false;
        state.owner = owner;
        return true;
      },
      invalidate() {
        const previousOwner = state.owner;
        state.epoch += 1;
        state.owner = null;
        state.sessionOwner = undefined;
        invalidateCallback.current(previousOwner);
      },
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // 네이티브는 Bearer를 브리지에 보관하므로 브라우저의 빈 세션으로 덮지 않는다.
    const subscription = window.ReactNativeWebView ? null : createClient().auth.onAuthStateChange((event, session) => {
      const nextOwner = session?.user.id ?? null;
      const previousOwner = scope.state.sessionOwner ?? scope.state.owner;
      const initialUnknown = scope.state.sessionOwner === undefined && scope.state.owner === null;
      scope.state.sessionOwner = nextOwner;
      if (event === "INITIAL_SESSION" && initialUnknown) return;
      if (previousOwner === nextOwner) return;
      scope.state.epoch += 1;
      scope.state.owner = null;
      invalidateCallback.current(previousOwner);
    }).data.subscription;
    return () => {
      scope.state.epoch += 1;
      scope.state.owner = null;
      subscription?.unsubscribe();
    };
  }, [enabled, scope]);

  return scope;
}
