import { useEffect, useRef, useState } from "react";
import { router, usePathname, useRootNavigationState } from "expo-router";

import { supabase } from "@/lib/supabase";
import {
  MOBILE_CONSENT_ROUTE,
  shouldInterceptForConsent,
} from "@/lib/consentInterception";

type Session = { user: { user_metadata?: unknown } } | null;

/**
 * 어느 문으로 들어와도 동의 관문을 지나게 한다.
 *
 * 판정은 `consentInterception.ts` 에 있고 여기는 배선만 한다 — 왜 필요한지와
 * 무엇을 지나보내는지는 그 파일에 적혀 있다.
 *
 * **화면을 막지 않는다.** 아래 자식을 늘 그리고, 가로챌 때만 옆으로 보낸다.
 * 막으면 세션 조회가 느리거나 실패하는 사람에게 빈 화면이 남는다.
 */
export default function ConsentGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 루트 레이아웃은 내비게이터보다 먼저 그려진다. 그 전에 replace 하면 조용히
  // 버려져 **가로채지 못한 채 통과한다.** 준비될 때까지 기다린다.
  const navigationState = useRootNavigationState();
  const [session, setSession] = useState<Session>(null);
  // onAuthStateChange 는 INITIAL_SESSION 을 곧바로 준다. 그 뒤에 도착한
  // getSession() 결과로 덮어쓰면 방금 로그인·갱신한 값이 옛것으로 되돌아간다.
  const sawAuthEvent = useRef(false);

  useEffect(() => {
    let active = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      sawAuthEvent.current = true;
      setSession(next ?? null);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active || sawAuthEvent.current) return;
      setSession(data.session ?? null);
    }).catch(() => {
      // 못 읽으면 가로채지 않는다. 모르는 채로 막으면 나갈 길이 없다.
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!navigationState?.key) return;
    if (!shouldInterceptForConsent({ pathname, session })) return;
    router.replace(MOBILE_CONSENT_ROUTE);
  }, [navigationState?.key, pathname, session]);

  return <>{children}</>;
}
